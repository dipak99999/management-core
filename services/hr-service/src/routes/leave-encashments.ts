import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  buildLeaveEncashmentReversalRow,
  buildLeaveEncashmentRow,
  cancelGLEntries,
  computeLeaveBalanceAfter,
  finalizeLeaveLedgerRow,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// E14: Leave Encashment. Draft → Approved → Paid. On pay:
//   DR Salary Expense (amount)
//   CR Bank | Cash    (amount)
// Also mints a compensating negative LeaveAllocation to draw down the balance.

export const leaveEncashmentRouter = Router();

const p = perms("LeaveEncashment");

const createSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  encashmentDate: z.string().datetime(),
  days: z.coerce.number().positive(),
  dailyRate: z.coerce.number().nonnegative().optional(),
  modeOfPayment: z.enum(["Bank", "Cash"]).default("Bank"),
});

leaveEncashmentRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.leaveEncashment.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
      leaveType: { select: { leaveTypeName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

leaveEncashmentRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });

  const lt = await prisma.leaveType.findFirst({
    where: { id: parsed.data.leaveTypeId, tenantId },
  });
  if (!lt) return res.status(400).json({ error: "Invalid leave type" });
  if (!lt.isEncashable) return res.status(400).json({ error: "Leave type is not encashable" });

  // Balance check: sum allocations minus applied leaves.
  const allocs = await prisma.leaveAllocation.aggregate({
    where: { tenantId, employeeId: emp.id, leaveTypeId: lt.id },
    _sum: { totalLeaves: true },
  });
  const applied = await prisma.leaveApplication.aggregate({
    where: {
      tenantId,
      employeeId: emp.id,
      leaveTypeId: lt.id,
      status: "Approved",
    },
    _sum: { totalLeaveDays: true },
  });
  const balance =
    Number(allocs._sum.totalLeaves ?? 0) - Number(applied._sum.totalLeaveDays ?? 0);
  if (balance < parsed.data.days)
    return res
      .status(400)
      .json({ error: `Insufficient balance: ${balance.toFixed(2)} < ${parsed.data.days}` });

  const dailyRate = parsed.data.dailyRate ?? Number(emp.baseSalary) / 30;
  const amount = Math.round(parsed.data.days * dailyRate * 100) / 100;

  const name = await nextName(prisma, tenantId, "LEC-");
  const row = await prisma.leaveEncashment.create({
    data: {
      tenantId,
      name,
      employeeId: emp.id,
      leaveTypeId: lt.id,
      encashmentDate: new Date(parsed.data.encashmentDate),
      days: new Prisma.Decimal(parsed.data.days),
      dailyRate: new Prisma.Decimal(dailyRate),
      amount: new Prisma.Decimal(amount),
      modeOfPayment: parsed.data.modeOfPayment,
    },
  });
  res.status(201).json(row);
});

leaveEncashmentRouter.post("/:id/approve", p.submit, async (req, res) => {
  const existing = await prisma.leaveEncashment.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot approve in status ${existing.status}` });
  const row = await prisma.leaveEncashment.update({
    where: { id: existing.id },
    data: { status: "Approved" },
  });
  res.json(row);
});

leaveEncashmentRouter.post("/:id/pay", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const enc = await tx.leaveEncashment.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!enc) throw new Error("Not found");
      if (enc.status !== "Approved") throw new Error(`Cannot pay in status ${enc.status}`);

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultSalaryExpenseAccountId",
        enc.modeOfPayment === "Cash" ? "defaultCashAccountId" : "defaultBankAccountId",
      ]);
      const bankAccountId =
        enc.modeOfPayment === "Cash"
          ? defaults.defaultCashAccountId!
          : defaults.defaultBankAccountId!;
      const amount = Number(enc.amount);

      await postGLEntries(tx, {
        tenantId,
        postingDate: enc.encashmentDate,
        voucherType: "LeaveEncashment",
        voucherId: enc.id,
        voucherName: enc.name,
        lines: [
          { accountId: defaults.defaultSalaryExpenseAccountId!, debit: amount, credit: 0 },
          { accountId: bankAccountId, debit: 0, credit: amount },
        ],
      });

      // Compensating negative allocation to reduce balance for the
      // existing /create balance check (which reads from LeaveAllocation
      // aggregate — see line ~60). Kept for backwards compat.
      await tx.leaveAllocation.create({
        data: {
          tenantId,
          employeeId: enc.employeeId,
          leaveTypeId: enc.leaveTypeId,
          fromDate: enc.encashmentDate,
          toDate: enc.encashmentDate,
          totalLeaves: new Prisma.Decimal(-Number(enc.days)),
          notes: `Encashment ${enc.name} (${Number(enc.days).toFixed(2)} days)`,
        },
      });

      // D+: LeaveLedgerEntry (Encashment, negative) in the same tx so
      // the balance dashboard + ledger report reflect the drawdown
      // without waiting for backfill. We do NOT mirror the compensating
      // negative allocation to a second ledger row — the Encashment
      // entry is the one that appears, so the balance drops exactly once.
      const emp = await tx.employee.findFirst({
        where: { id: enc.employeeId, tenantId },
        select: { workGroupId: true, employeeCategoryId: true },
      });
      const prior = await tx.leaveLedgerEntry.findMany({
        where: {
          tenantId,
          employeeId: enc.employeeId,
          leaveTypeId: enc.leaveTypeId,
        },
        select: { leaves: true },
      });
      const raw = buildLeaveEncashmentRow({
        employeeId: enc.employeeId,
        leaveTypeId: enc.leaveTypeId,
        postingDate: enc.encashmentDate,
        days: Number(enc.days),
        encashmentId: enc.id,
        encashmentName: enc.name,
        workGroupId: emp?.workGroupId ?? null,
        employeeCategoryId: emp?.employeeCategoryId ?? null,
        createdBy: req.auth!.userId,
      });
      const ready = finalizeLeaveLedgerRow(
        raw,
        computeLeaveBalanceAfter(prior, raw.leaves),
      );
      await tx.leaveLedgerEntry.create({ data: { tenantId, ...ready } });

      return tx.leaveEncashment.update({
        where: { id: enc.id },
        data: { status: "Paid" },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

leaveEncashmentRouter.post("/:id/cancel", p.cancel, idempotency("POST /leave-encashments/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const enc = await tx.leaveEncashment.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!enc) throw new Error("Not found");
      if (enc.status === "Cancelled") throw new Error("Already cancelled");
      if (enc.status === "Paid") {
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "LeaveEncashment",
          voucherId: enc.id,
        });
        // Reverse the compensating allocation.
        await tx.leaveAllocation.deleteMany({
          where: {
            tenantId,
            employeeId: enc.employeeId,
            leaveTypeId: enc.leaveTypeId,
            fromDate: enc.encashmentDate,
            toDate: enc.encashmentDate,
            notes: { contains: enc.name },
          },
        });
        // D+: append-only ledger reversal — a POSITIVE Adjustment row
        // that restores the balance without mutating the original
        // Encashment entry.
        const emp = await tx.employee.findFirst({
          where: { id: enc.employeeId, tenantId },
          select: { workGroupId: true, employeeCategoryId: true },
        });
        const prior = await tx.leaveLedgerEntry.findMany({
          where: {
            tenantId,
            employeeId: enc.employeeId,
            leaveTypeId: enc.leaveTypeId,
          },
          select: { leaves: true },
        });
        const raw = buildLeaveEncashmentReversalRow({
          employeeId: enc.employeeId,
          leaveTypeId: enc.leaveTypeId,
          postingDate: new Date(),
          days: Number(enc.days),
          encashmentId: enc.id,
          encashmentName: enc.name,
          workGroupId: emp?.workGroupId ?? null,
          employeeCategoryId: emp?.employeeCategoryId ?? null,
          createdBy: req.auth!.userId,
        });
        const ready = finalizeLeaveLedgerRow(
          raw,
          computeLeaveBalanceAfter(prior, raw.leaves),
        );
        await tx.leaveLedgerEntry.create({ data: { tenantId, ...ready } });
      }
      return tx.leaveEncashment.update({
        where: { id: enc.id },
        data: { status: "Cancelled" },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
