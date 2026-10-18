import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  cancelGLEntries,
  computeAdvanceReturn,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// E4: Employee Advance. Draft → Approved (approvedBy/at stamped) → Paid
// (posts DR advance account / CR Bank|Cash, party = Employee). Cancel from
// Paid reverses GL. Adjustments against the advance are made via Payment
// Entries with partyType=Employee (already supported).

export const employeeAdvanceRouter = Router();

const p = perms("EmployeeAdvance");

const createSchema = z.object({
  employeeId: z.string().min(1),
  postingDate: z.string().datetime().optional(),
  purpose: z.string().min(1),
  advanceAmount: z.coerce.number().positive(),
  modeOfPayment: z.enum(["Bank", "Cash"]).default("Bank"),
  advanceAccountId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

employeeAdvanceRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.employeeAdvance.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

employeeAdvanceRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.employeeAdvance.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      advanceAccount: { select: { id: true, accountName: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

employeeAdvanceRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const body = parsed.data;

  const emp = await prisma.employee.findFirst({
    where: { id: body.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });

  if (body.advanceAccountId) {
    const acc = await prisma.account.findFirst({
      where: { id: body.advanceAccountId, tenantId, isGroup: false },
    });
    if (!acc) return res.status(400).json({ error: "Invalid advance account" });
  }

  const name = await nextName(prisma, tenantId, "EA-");
  const row = await prisma.employeeAdvance.create({
    data: {
      tenantId,
      name,
      employeeId: body.employeeId,
      postingDate: body.postingDate ? new Date(body.postingDate) : new Date(),
      purpose: body.purpose,
      advanceAmount: new Prisma.Decimal(body.advanceAmount),
      modeOfPayment: body.modeOfPayment,
      advanceAccountId: body.advanceAccountId ?? null,
      remarks: body.remarks ?? null,
    },
  });
  res.status(201).json(row);
});

employeeAdvanceRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.employeeAdvance.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit advance in status ${existing.status}` });

  const row = await prisma.employeeAdvance.update({
    where: { id: existing.id },
    data: {
      purpose: parsed.data.purpose ?? existing.purpose,
      advanceAmount:
        parsed.data.advanceAmount != null
          ? new Prisma.Decimal(parsed.data.advanceAmount)
          : undefined,
      modeOfPayment: parsed.data.modeOfPayment ?? existing.modeOfPayment,
      advanceAccountId: parsed.data.advanceAccountId ?? existing.advanceAccountId,
      remarks: parsed.data.remarks ?? existing.remarks,
      postingDate: parsed.data.postingDate
        ? new Date(parsed.data.postingDate)
        : existing.postingDate,
    },
  });
  res.json(row);
});

employeeAdvanceRouter.post("/:id/approve", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.employeeAdvance.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot approve advance in status ${existing.status}` });
  const row = await prisma.employeeAdvance.update({
    where: { id: existing.id },
    data: { status: "Approved", approvedBy: req.auth!.userId, approvedAt: new Date() },
  });
  res.json(row);
});

// Pay out: DR advance account (party=Employee) / CR Bank|Cash. Flips to Paid.
employeeAdvanceRouter.post("/:id/pay", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const adv = await tx.employeeAdvance.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!adv) throw new Error("Not found");
      if (adv.status !== "Approved")
        throw new Error(`Cannot pay advance in status ${adv.status}`);

      const defaults = await requireTenantDefaults(tx, tenantId, [
        adv.modeOfPayment === "Cash" ? "defaultCashAccountId" : "defaultBankAccountId",
        "defaultEmployeePayableAccountId",
      ]);

      const bankAccountId =
        adv.modeOfPayment === "Cash"
          ? defaults.defaultCashAccountId!
          : defaults.defaultBankAccountId!;
      // Advance is a receivable from the employee: use the override if given,
      // else park it as a debit against Employee Payable (which will net down
      // the credit created by the next salary slip).
      const advAccountId = adv.advanceAccountId ?? defaults.defaultEmployeePayableAccountId!;
      const amount = Number(adv.advanceAmount);

      await postGLEntries(tx, {
        tenantId,
        postingDate: adv.postingDate,
        voucherType: "EmployeeAdvance",
        voucherId: adv.id,
        voucherName: adv.name,
        lines: [
          {
            accountId: advAccountId,
            debit: amount,
            credit: 0,
            partyType: "Employee",
            partyId: adv.employeeId,
          },
          {
            accountId: bankAccountId,
            debit: 0,
            credit: amount,
          },
        ],
      });

      return tx.employeeAdvance.update({
        where: { id: adv.id },
        data: { status: "Paid", paidAmount: new Prisma.Decimal(amount) },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// E4+: Return unused advance. DR Bank|Cash / CR advance account (reverses
// the outflow from /pay). Partial returns are supported and additive; the
// helper prevents over-return. Advance stays in "Paid" status regardless
// — remaining balance is `paidAmount − returnAmount`.
const returnSchema = z.object({
  amount: z.coerce.number().positive(),
  postingDate: z.string().datetime().optional(),
  modeOfPayment: z.enum(["Bank", "Cash"]).optional(),
});

employeeAdvanceRouter.post("/:id/return", p.submit, async (req, res) => {
  const parsed = returnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const adv = await tx.employeeAdvance.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!adv) throw new Error("Not found");
      if (adv.status !== "Paid")
        throw new Error(
          `Cannot record return for advance in status ${adv.status}`,
        );

      const quote = computeAdvanceReturn({
        paidAmount: Number(adv.paidAmount),
        existingReturnAmount: Number(adv.returnAmount),
        requestedReturn: parsed.data.amount,
      });
      if (!quote.ok) throw new Error(quote.reason ?? "Return denied");

      // Fall back to the advance's original modeOfPayment when caller
      // doesn't override — returns are usually via the same channel.
      const mode = parsed.data.modeOfPayment ?? adv.modeOfPayment;
      const defaults = await requireTenantDefaults(tx, tenantId, [
        mode === "Cash" ? "defaultCashAccountId" : "defaultBankAccountId",
        "defaultEmployeePayableAccountId",
      ]);
      const bankAccountId =
        mode === "Cash"
          ? defaults.defaultCashAccountId!
          : defaults.defaultBankAccountId!;
      const advAccountId =
        adv.advanceAccountId ?? defaults.defaultEmployeePayableAccountId!;
      const amount = parsed.data.amount;
      const postingDate = parsed.data.postingDate
        ? new Date(parsed.data.postingDate)
        : new Date();

      await postGLEntries(tx, {
        tenantId,
        postingDate,
        voucherType: "EmployeeAdvanceReturn",
        // voucherId is `${adv.id}-r${counter}` — need uniqueness across
        // multiple partial returns against the same advance. Simplest
        // scheme: use return timestamp as suffix.
        voucherId: `${adv.id}-r${Date.now()}`,
        voucherName: `${adv.name}/return`,
        lines: [
          {
            accountId: bankAccountId,
            debit: amount,
            credit: 0,
          },
          {
            accountId: advAccountId,
            debit: 0,
            credit: amount,
            partyType: "Employee",
            partyId: adv.employeeId,
            remarks: `Return of unused advance ${adv.name}`,
          },
        ],
      });

      return tx.employeeAdvance.update({
        where: { id: adv.id },
        data: { returnAmount: new Prisma.Decimal(quote.newReturnAmount) },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

employeeAdvanceRouter.post("/:id/cancel", p.cancel, idempotency("POST /employee-advances/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const adv = await tx.employeeAdvance.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!adv) throw new Error("Not found");
      if (adv.status === "Cancelled") throw new Error("Already cancelled");
      // If partial returns have been recorded, cancel gets complex —
      // cancelGLEntries would reverse the original outflow, but the
      // return GL entries would remain, leaving the ledger unbalanced
      // for this party. Refuse and force the operator to reverse the
      // returns first (a rarer flow — usually you either return OR
      // cancel, not both).
      if (Number(adv.returnAmount) > 0) {
        throw new Error(
          `Cannot cancel — advance has ${Number(adv.returnAmount).toFixed(2)} in returns recorded. Reverse the returns first.`,
        );
      }
      if (adv.status === "Paid") {
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "EmployeeAdvance",
          voucherId: adv.id,
        });
      }
      return tx.employeeAdvance.update({
        where: { id: adv.id },
        data: { status: "Cancelled" },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
