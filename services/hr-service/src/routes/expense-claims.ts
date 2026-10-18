import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  cancelGLEntries,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const expenseClaimRouter = Router();

const p = perms("ExpenseClaim");

const itemSchema = z.object({
  expenseClaimTypeId: z.string().min(1),
  description: z.string().optional().nullable(),
  amount: z.coerce.number().positive(),
  expenseAccountId: z.string().optional().nullable(),
});

const createSchema = z.object({
  employeeId: z.string().min(1),
  postingDate: z.string().datetime().optional(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

expenseClaimRouter.get("/", p.read, async (req, res) => {
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.expenseClaim.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      _count: { select: { items: true } },
    },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

expenseClaimRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.expenseClaim.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: true,
      items: {
        include: {
          expenseClaimType: true,
          expenseAccount: { select: { id: true, accountName: true } },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

expenseClaimRouter.post("/", p.create, idempotency("POST /expense-claims"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const p2 = parsed.data;

  // Validate references.
  const emp = await prisma.employee.findFirst({ where: { id: p2.employeeId, tenantId } });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  const typeIds = [...new Set(p2.items.map((i) => i.expenseClaimTypeId))];
  const types = await prisma.expenseClaimType.findMany({
    where: { id: { in: typeIds }, tenantId },
  });
  if (types.length !== typeIds.length)
    return res.status(400).json({ error: "One or more expense claim types not found" });

  const totalAmount = p2.items.reduce(
    (s, i) => s.add(new Prisma.Decimal(i.amount)),
    new Prisma.Decimal(0),
  );
  const name = await nextName(prisma, tenantId, "EXP-");

  const row = await prisma.expenseClaim.create({
    data: {
      tenantId,
      name,
      employeeId: p2.employeeId,
      postingDate: p2.postingDate ? new Date(p2.postingDate) : new Date(),
      totalAmount,
      status: "Draft",
      remarks: p2.remarks ?? null,
      items: {
        create: p2.items.map((i) => ({
          expenseClaimTypeId: i.expenseClaimTypeId,
          description: i.description ?? null,
          amount: i.amount,
          expenseAccountId: i.expenseAccountId ?? null,
        })),
      },
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      items: true,
    },
  });
  res.status(201).json(row);
});

expenseClaimRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.expenseClaim.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit in status ${existing.status}` });

  const totalAmount = parsed.data.items.reduce(
    (s, i) => s.add(new Prisma.Decimal(i.amount)),
    new Prisma.Decimal(0),
  );

  const updated = await prisma.$transaction(async (tx) => {
    await tx.expenseClaimItem.deleteMany({ where: { expenseClaimId: existing.id } });
    return tx.expenseClaim.update({
      where: { id: existing.id },
      data: {
        employeeId: parsed.data.employeeId,
        postingDate: parsed.data.postingDate
          ? new Date(parsed.data.postingDate)
          : existing.postingDate,
        totalAmount,
        remarks: parsed.data.remarks ?? null,
        items: {
          create: parsed.data.items.map((i) => ({
            expenseClaimTypeId: i.expenseClaimTypeId,
            description: i.description ?? null,
            amount: i.amount,
            expenseAccountId: i.expenseAccountId ?? null,
          })),
        },
      },
      include: { items: true },
    });
  });
  res.json(updated);
});

// Approve (= submit): posts GL — DR per-item expense account, CR Employee
// Payable. Party is stamped on the credit line so employees show up as
// payable parties in Debtors/Creditors-style reports.
expenseClaimRouter.post("/:id/approve", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.expenseClaim.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          items: { include: { expenseClaimType: true } },
        },
      });
      if (!claim) throw new Error("Not found");
      if (claim.status !== "Draft")
        throw new Error(`Cannot approve in status ${claim.status}`);

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultEmployeePayableAccountId",
        "defaultExpenseAccountId",
      ]);

      const lines: {
        accountId: string;
        debit: number;
        credit: number;
        partyType?: string;
        partyId?: string;
        remarks?: string;
      }[] = [];

      // One debit line per item, using item override → type default → tenant default.
      for (const it of claim.items) {
        const accountId =
          it.expenseAccountId ??
          it.expenseClaimType.expenseAccountId ??
          defaults.defaultExpenseAccountId!;
        lines.push({
          accountId,
          debit: Number(it.amount),
          credit: 0,
          remarks: it.description ?? it.expenseClaimType.typeName,
        });
      }

      // Single credit to Employee Payable for the total, stamped with the
      // employee as party.
      lines.push({
        accountId: defaults.defaultEmployeePayableAccountId!,
        debit: 0,
        credit: Number(claim.totalAmount),
        partyType: "Employee",
        partyId: claim.employeeId,
      });

      await postGLEntries(tx, {
        tenantId,
        postingDate: claim.postingDate,
        voucherType: "ExpenseClaim",
        voucherId: claim.id,
        voucherName: claim.name,
        lines,
      });

      return tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          status: "Approved",
          approvedBy: req.auth!.userId,
          approvedAt: new Date(),
        },
        include: {
          employee: { select: { id: true, employeeCode: true, employeeName: true } },
          items: true,
        },
      });
    });
    void publishRealtime(tenantId, "expense-claim", { id: result.id, status: "Approved" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

expenseClaimRouter.post("/:id/reject", p.submit, async (req, res) => {
  const existing = await prisma.expenseClaim.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot reject in status ${existing.status}` });
  const row = await prisma.expenseClaim.update({
    where: { id: existing.id },
    data: {
      status: "Rejected",
      approvedBy: req.auth!.userId,
      approvedAt: new Date(),
    },
  });
  void publishRealtime(req.auth!.tenantId, "expense-claim", { id: row.id, status: "Rejected" });
  res.json(row);
});

expenseClaimRouter.post("/:id/cancel", p.cancel, idempotency("POST /expense-claims/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.expenseClaim.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!claim) throw new Error("Not found");
      if (claim.status === "Cancelled") throw new Error("Already cancelled");

      // Reverse GL entries only if the claim was actually posted.
      if (claim.status === "Approved" || claim.status === "Paid") {
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "ExpenseClaim",
          voucherId: claim.id,
        });
      }
      return tx.expenseClaim.update({
        where: { id: claim.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "expense-claim", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
