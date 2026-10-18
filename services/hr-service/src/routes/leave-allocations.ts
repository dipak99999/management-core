import { Router } from "express";
import { z } from "zod";
import {
  buildLeaveAllocationRow,
  buildLeaveConsumptionReversalRow,
  computeLeaveBalanceAfter,
  finalizeLeaveLedgerRow,
  prisma,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const leaveAllocationRouter = Router();

const p = perms("LeaveAllocation");

const upsertSchema = z
  .object({
    employeeId: z.string().min(1),
    leaveTypeId: z.string().min(1),
    fromDate: z.string().datetime(),
    toDate: z.string().datetime(),
    totalLeaves: z.coerce.number().positive(),
    notes: z.string().optional().nullable(),
  })
  .refine((v) => new Date(v.toDate) >= new Date(v.fromDate), {
    message: "toDate must be on or after fromDate",
  });

leaveAllocationRouter.get("/", p.read, async (req, res) => {
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const rows = await prisma.leaveAllocation.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      leaveType: { select: { id: true, leaveTypeName: true, color: true } },
    },
    orderBy: { fromDate: "desc" },
  });
  res.json(rows);
});

leaveAllocationRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const p2 = parsed.data;

  const [emp, lt] = await Promise.all([
    prisma.employee.findFirst({
      where: { id: p2.employeeId, tenantId },
      select: {
        id: true,
        employeeCode: true,
        employeeName: true,
        workGroupId: true,
        employeeCategoryId: true,
      },
    }),
    prisma.leaveType.findFirst({ where: { id: p2.leaveTypeId, tenantId } }),
  ]);
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  if (!lt) return res.status(400).json({ error: "Invalid leave type" });

  const fromDate = new Date(p2.fromDate);
  const toDate = new Date(p2.toDate);

  // D+: allocation + matching LeaveLedgerEntry in a single tx so the
  // balance stays in sync without waiting for backfill. Ledger's
  // balanceAfter is computed against the CURRENT ledger for this
  // (employee, leaveType) pair.
  const row = await prisma.$transaction(async (tx) => {
    const allocation = await tx.leaveAllocation.create({
      data: {
        tenantId,
        employeeId: p2.employeeId,
        leaveTypeId: p2.leaveTypeId,
        fromDate,
        toDate,
        totalLeaves: p2.totalLeaves,
        notes: p2.notes ?? null,
      },
      include: {
        employee: { select: { id: true, employeeCode: true, employeeName: true } },
        leaveType: { select: { id: true, leaveTypeName: true } },
      },
    });
    const prior = await tx.leaveLedgerEntry.findMany({
      where: { tenantId, employeeId: p2.employeeId, leaveTypeId: p2.leaveTypeId },
      select: { leaves: true },
    });
    const raw = buildLeaveAllocationRow({
      employeeId: p2.employeeId,
      leaveTypeId: p2.leaveTypeId,
      postingDate: fromDate,
      fromDate,
      toDate,
      totalLeaves: p2.totalLeaves,
      allocationId: allocation.id,
      workGroupId: emp.workGroupId,
      employeeCategoryId: emp.employeeCategoryId,
      reason: p2.notes ?? null,
      createdBy: req.auth!.userId,
    });
    const ready = finalizeLeaveLedgerRow(
      raw,
      computeLeaveBalanceAfter(prior, raw.leaves),
    );
    await tx.leaveLedgerEntry.create({ data: { tenantId, ...ready } });
    return allocation;
  });
  res.status(201).json(row);
});

// Delete: also reverse the Allocation ledger entry with a negative
// Adjustment so the balance drops back to pre-allocation levels. We
// don't hard-delete the ledger row (append-only ledger) — the reversal
// is a separate immutable entry.
leaveAllocationRouter.delete("/:id", p.delete, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.leaveAllocation.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      employee: { select: { workGroupId: true, employeeCategoryId: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await prisma.$transaction(async (tx) => {
    const prior = await tx.leaveLedgerEntry.findMany({
      where: {
        tenantId,
        employeeId: existing.employeeId,
        leaveTypeId: existing.leaveTypeId,
      },
      select: { leaves: true },
    });
    const raw = buildLeaveConsumptionReversalRow({
      employeeId: existing.employeeId,
      leaveTypeId: existing.leaveTypeId,
      postingDate: new Date(),
      // Sign flipped from the reversal helper (which is Consumption→positive):
      // for an Allocation reversal we want a NEGATIVE adjustment.
      days: -Number(existing.totalLeaves),
      applicationId: existing.id, // reused sourceDocId field
      workGroupId: existing.employee.workGroupId,
      employeeCategoryId: existing.employee.employeeCategoryId,
      createdBy: req.auth!.userId,
    });
    // Overwrite reason since the helper's default mentions "leave
    // application" — this reversal is for a deleted allocation.
    raw.reason = "Reversal of deleted leave allocation";
    raw.sourceDoctype = "LeaveAllocation";
    const ready = finalizeLeaveLedgerRow(
      raw,
      computeLeaveBalanceAfter(prior, raw.leaves),
    );
    await tx.leaveLedgerEntry.create({ data: { tenantId, ...ready } });
    await tx.leaveAllocation.delete({ where: { id: existing.id } });
  });
  res.status(204).send();
});
