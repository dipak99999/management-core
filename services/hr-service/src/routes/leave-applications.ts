import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  buildLeaveConsumptionReversalRow,
  buildLeaveConsumptionRow,
  computeLeaveBalanceAfter,
  finalizeLeaveLedgerRow,
  prisma,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const leaveApplicationRouter = Router();

const p = perms("LeaveApplication");
const reportPerms = perms("Report");

// Compute inclusive day count between two dates (half-day flag overrides).
function computeDays(fromDate: Date, toDate: Date, halfDay: boolean): number {
  if (halfDay) return 0.5;
  const ms = toDate.getTime() - fromDate.getTime();
  return Math.round(ms / 86400000) + 1;
}

const createSchema = z
  .object({
    employeeId: z.string().min(1),
    leaveTypeId: z.string().min(1),
    fromDate: z.string().datetime(),
    toDate: z.string().datetime(),
    halfDay: z.boolean().default(false),
    reason: z.string().optional().nullable(),
  })
  .refine((v) => new Date(v.toDate) >= new Date(v.fromDate), {
    message: "toDate must be on or after fromDate",
  });

leaveApplicationRouter.get("/", p.read, async (req, res) => {
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.leaveApplication.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      leaveType: { select: { id: true, leaveTypeName: true, color: true } },
    },
    orderBy: { fromDate: "desc" },
  });
  res.json(rows);
});

leaveApplicationRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.leaveApplication.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: true,
      leaveType: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

leaveApplicationRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const p2 = parsed.data;

  const [emp, lt] = await Promise.all([
    prisma.employee.findFirst({ where: { id: p2.employeeId, tenantId } }),
    prisma.leaveType.findFirst({ where: { id: p2.leaveTypeId, tenantId } }),
  ]);
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  if (!lt) return res.status(400).json({ error: "Invalid leave type" });

  const fromDate = new Date(p2.fromDate);
  const toDate = new Date(p2.toDate);
  const totalLeaveDays = computeDays(fromDate, toDate, p2.halfDay);

  const row = await prisma.leaveApplication.create({
    data: {
      tenantId,
      employeeId: p2.employeeId,
      leaveTypeId: p2.leaveTypeId,
      fromDate,
      toDate,
      halfDay: p2.halfDay,
      totalLeaveDays,
      reason: p2.reason ?? null,
      status: "Draft",
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      leaveType: { select: { id: true, leaveTypeName: true } },
    },
  });
  res.status(201).json(row);
});

leaveApplicationRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.leaveApplication.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit in status ${existing.status}` });

  const fromDate = new Date(parsed.data.fromDate);
  const toDate = new Date(parsed.data.toDate);
  const totalLeaveDays = computeDays(fromDate, toDate, parsed.data.halfDay);

  const row = await prisma.leaveApplication.update({
    where: { id: existing.id },
    data: {
      employeeId: parsed.data.employeeId,
      leaveTypeId: parsed.data.leaveTypeId,
      fromDate,
      toDate,
      halfDay: parsed.data.halfDay,
      totalLeaveDays,
      reason: parsed.data.reason ?? null,
    },
  });
  res.json(row);
});

// Approve: also enforces balance (rejects if approving would exceed the sum
// of allocations minus other approved apps for the same employee+type on
// overlapping dates).
leaveApplicationRouter.post("/:id/approve", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const app = await tx.leaveApplication.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!app) throw new Error("Not found");
      if (app.status !== "Draft")
        throw new Error(`Cannot approve in status ${app.status}`);

      // Balance check: sum of allocations covering the application's dates
      // for this employee+type, minus sum of already-approved apps for the
      // same employee+type overlapping the same allocation windows.
      const allocations = await tx.leaveAllocation.findMany({
        where: {
          tenantId,
          employeeId: app.employeeId,
          leaveTypeId: app.leaveTypeId,
          fromDate: { lte: app.toDate },
          toDate: { gte: app.fromDate },
        },
      });
      const totalAllocated = allocations.reduce(
        (s, a) => s.add(a.totalLeaves),
        new Prisma.Decimal(0),
      );
      const alreadyApproved = await tx.leaveApplication.aggregate({
        where: {
          tenantId,
          employeeId: app.employeeId,
          leaveTypeId: app.leaveTypeId,
          status: "Approved",
          NOT: { id: app.id },
        },
        _sum: { totalLeaveDays: true },
      });
      const used = new Prisma.Decimal(alreadyApproved._sum.totalLeaveDays ?? 0);
      const available = totalAllocated.sub(used);
      if (available.lt(app.totalLeaveDays))
        throw new Error(
          `Insufficient balance: ${available.toString()} day(s) available, ${app.totalLeaveDays.toString()} requested`,
        );

      // D+: write a Consumption ledger entry in the same tx as the
      // approval so the balance stays live without waiting for backfill.
      const emp = await tx.employee.findFirst({
        where: { id: app.employeeId, tenantId },
        select: { workGroupId: true, employeeCategoryId: true },
      });
      const prior = await tx.leaveLedgerEntry.findMany({
        where: {
          tenantId,
          employeeId: app.employeeId,
          leaveTypeId: app.leaveTypeId,
        },
        select: { leaves: true },
      });
      const raw = buildLeaveConsumptionRow({
        employeeId: app.employeeId,
        leaveTypeId: app.leaveTypeId,
        postingDate: app.fromDate,
        fromDate: app.fromDate,
        toDate: app.toDate,
        days: Number(app.totalLeaveDays),
        applicationId: app.id,
        workGroupId: emp?.workGroupId ?? null,
        employeeCategoryId: emp?.employeeCategoryId ?? null,
        createdBy: req.auth!.userId,
      });
      const ready = finalizeLeaveLedgerRow(
        raw,
        computeLeaveBalanceAfter(prior, raw.leaves),
      );
      await tx.leaveLedgerEntry.create({ data: { tenantId, ...ready } });

      return tx.leaveApplication.update({
        where: { id: app.id },
        data: {
          status: "Approved",
          approvedBy: req.auth!.userId,
          approvedAt: new Date(),
        },
        include: {
          employee: { select: { id: true, employeeCode: true, employeeName: true } },
          leaveType: { select: { id: true, leaveTypeName: true } },
        },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

leaveApplicationRouter.post("/:id/reject", p.submit, async (req, res) => {
  const existing = await prisma.leaveApplication.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot reject in status ${existing.status}` });
  const row = await prisma.leaveApplication.update({
    where: { id: existing.id },
    data: {
      status: "Rejected",
      approvedBy: req.auth!.userId,
      approvedAt: new Date(),
    },
  });
  res.json(row);
});

leaveApplicationRouter.post("/:id/cancel", p.cancel, idempotency("POST /leave-applications/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.leaveApplication.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      employee: { select: { workGroupId: true, employeeCategoryId: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Cancelled")
    return res.status(400).json({ error: "Already cancelled" });

  // D+: if the app was Approved, restore the balance with a POSITIVE
  // Adjustment ledger entry. Draft cancel doesn't need reversal —
  // ledger only had a Consumption entry after approval.
  const wasApproved = existing.status === "Approved";
  const row = await prisma.$transaction(async (tx) => {
    if (wasApproved) {
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
        days: Number(existing.totalLeaveDays),
        applicationId: existing.id,
        workGroupId: existing.employee.workGroupId,
        employeeCategoryId: existing.employee.employeeCategoryId,
        createdBy: req.auth!.userId,
      });
      const ready = finalizeLeaveLedgerRow(
        raw,
        computeLeaveBalanceAfter(prior, raw.leaves),
      );
      await tx.leaveLedgerEntry.create({ data: { tenantId, ...ready } });
    }
    return tx.leaveApplication.update({
      where: { id: existing.id },
      data: { status: "Cancelled" },
    });
  });
  void publishRealtime(tenantId, "leave-application", { id: row.id, status: "Cancelled" });
  res.json(row);
});

// Balance report: per-type totals for an employee. asOf defaults to today.
// Returns { leaveType, allocated, used, available } for each type that has
// either an allocation or an approved application.
leaveApplicationRouter.get("/balance/:employeeId", reportPerms.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const employeeId = req.params.employeeId;
  const asOf = typeof req.query.asOf === "string" ? new Date(req.query.asOf) : new Date();

  const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const [allocations, approved, types] = await Promise.all([
    prisma.leaveAllocation.findMany({
      where: {
        tenantId,
        employeeId,
        fromDate: { lte: asOf },
        toDate: { gte: asOf },
      },
      include: { leaveType: true },
    }),
    prisma.leaveApplication.findMany({
      where: {
        tenantId,
        employeeId,
        status: "Approved",
      },
      include: { leaveType: true },
    }),
    prisma.leaveType.findMany({ where: { tenantId } }),
  ]);

  const byType = new Map<
    string,
    {
      leaveType: { id: string; leaveTypeName: string; color: string | null };
      allocated: number;
      used: number;
    }
  >();
  for (const t of types) {
    byType.set(t.id, {
      leaveType: { id: t.id, leaveTypeName: t.leaveTypeName, color: t.color },
      allocated: 0,
      used: 0,
    });
  }
  for (const a of allocations) {
    const entry = byType.get(a.leaveTypeId);
    if (entry) entry.allocated += Number(a.totalLeaves);
  }
  for (const app of approved) {
    const entry = byType.get(app.leaveTypeId);
    if (entry) entry.used += Number(app.totalLeaveDays);
  }

  const rows = [...byType.values()]
    .filter((r) => r.allocated > 0 || r.used > 0)
    .map((r) => ({ ...r, available: r.allocated - r.used }));

  res.json({
    employee: { id: emp.id, employeeCode: emp.employeeCode, employeeName: emp.employeeName },
    asOf: asOf.toISOString(),
    rows,
  });
});
