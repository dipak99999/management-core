import { Router } from "express";
import { z } from "zod";
import { prisma, seedLeaveAnalytics } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// LeaveLedgerEntry — immutable append-only log of every leave-balance change
// per (employee, leave-type). Feeds the 18-field "Leave Ledger for Employee"
// report and every dashboard aggregation.
//
// Manual entries are limited to Adjustment / Opening / Encashment. Allocation
// and Consumption rows are produced by the /backfill endpoint (idempotent)
// from existing LeaveAllocation + Approved LeaveApplication + LeaveEncashment
// rows, and by hooks in leave-applications / leave-allocations at write time
// (added in a follow-up commit; existing rows will be captured by backfill).

export const leaveLedgerRouter = Router();
const p = perms("LeaveLedgerEntry");

const adjustmentSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  postingDate: z.string().datetime(),
  leaves: z.coerce.number(), // signed
  entryType: z.enum(["Opening", "Adjustment", "CarryForward", "Expiry"]),
  reason: z.string().min(1),
});

// ---------- Balance calc (used to stamp balanceAfter on each new entry) ----------

async function balanceAsOf(
  tenantId: string,
  employeeId: string,
  leaveTypeId: string,
  before: Date,
): Promise<number> {
  const agg = await prisma.leaveLedgerEntry.aggregate({
    where: {
      tenantId,
      employeeId,
      leaveTypeId,
      postingDate: { lt: before },
    },
    _sum: { leaves: true },
  });
  return Number(agg._sum.leaves ?? 0);
}

// ---------- List (with rich filters) ----------

leaveLedgerRouter.get("/", p.read, async (req, res) => {
  const q = req.query;
  const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
  if (typeof q.employeeId === "string") where.employeeId = q.employeeId;
  if (typeof q.leaveTypeId === "string") where.leaveTypeId = q.leaveTypeId;
  if (typeof q.entryType === "string") where.entryType = q.entryType;
  if (typeof q.workGroupId === "string") where.workGroupId = q.workGroupId;
  if (typeof q.employeeCategoryId === "string") where.employeeCategoryId = q.employeeCategoryId;
  if (typeof q.from === "string" || typeof q.to === "string") {
    const range: { gte?: Date; lte?: Date } = {};
    if (typeof q.from === "string") range.gte = new Date(q.from);
    if (typeof q.to === "string") range.lte = new Date(q.to);
    where.postingDate = range;
  }
  const rows = await prisma.leaveLedgerEntry.findMany({
    where,
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      leaveType: { select: { id: true, leaveTypeName: true, color: true } },
    },
    orderBy: [{ postingDate: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  res.json(rows);
});

// ---------- Manual adjustment ----------

leaveLedgerRouter.post("/", p.create, async (req, res) => {
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const d = parsed.data;

  const emp = await prisma.employee.findFirst({
    where: { id: d.employeeId, tenantId },
    select: { id: true, workGroupId: true, employeeCategoryId: true },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  const lt = await prisma.leaveType.findFirst({ where: { id: d.leaveTypeId, tenantId } });
  if (!lt) return res.status(400).json({ error: "Invalid leave type" });

  const postingDate = new Date(d.postingDate);
  const bal = await balanceAsOf(tenantId, d.employeeId, d.leaveTypeId, postingDate);
  const row = await prisma.leaveLedgerEntry.create({
    data: {
      tenantId,
      employeeId: d.employeeId,
      leaveTypeId: d.leaveTypeId,
      postingDate,
      entryType: d.entryType,
      leaves: d.leaves,
      balanceAfter: bal + d.leaves,
      workGroupId: emp.workGroupId,
      employeeCategoryId: emp.employeeCategoryId,
      isCarryForward: d.entryType === "CarryForward",
      isExpired: d.entryType === "Expiry",
      isEncashment: false,
      sourceDoctype: "Adjustment",
      sourceDocId: null,
      reason: d.reason,
      createdBy: req.auth!.userId,
    },
  });
  res.status(201).json(row);
});

// ---------- Backfill (idempotent) ----------
//
// Rebuilds ledger rows from the current state of LeaveAllocation +
// Approved LeaveApplication + LeaveEncashment. Deletes only auto-generated
// rows (sourceDoctype in the three below), so manual Adjustments/Openings
// survive. Recomputes balanceAfter with a single pass per (employee, type).

leaveLedgerRouter.post("/backfill", p.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const scope = z
    .object({ employeeId: z.string().optional() })
    .parse(req.body ?? {});

  const empFilter = scope.employeeId ? { employeeId: scope.employeeId } : {};

  const [allocations, applications, encashments, employees] = await Promise.all([
    prisma.leaveAllocation.findMany({
      where: { tenantId, ...empFilter },
      include: { employee: { select: { workGroupId: true, employeeCategoryId: true } } },
    }),
    prisma.leaveApplication.findMany({
      where: { tenantId, ...empFilter, status: "Approved" },
      include: { employee: { select: { workGroupId: true, employeeCategoryId: true } } },
    }),
    prisma.leaveEncashment.findMany({
      where: { tenantId, ...empFilter },
      include: { employee: { select: { workGroupId: true, employeeCategoryId: true } } },
    }).catch(() => []),
    prisma.employee.findMany({
      where: { tenantId, ...(scope.employeeId ? { id: scope.employeeId } : {}) },
      select: { id: true },
    }),
  ]);

  // Remove auto-generated rows in scope. Manual Adjustment/Opening entries
  // stay put.
  await prisma.leaveLedgerEntry.deleteMany({
    where: {
      tenantId,
      ...(scope.employeeId ? { employeeId: scope.employeeId } : {}),
      sourceDoctype: { in: ["LeaveAllocation", "LeaveApplication", "LeaveEncashment"] },
    },
  });

  type Row = {
    employeeId: string;
    leaveTypeId: string;
    postingDate: Date;
    entryType: string;
    leaves: number;
    fromDate: Date | null;
    toDate: Date | null;
    workGroupId: string | null;
    employeeCategoryId: string | null;
    isCarryForward: boolean;
    isExpired: boolean;
    isEncashment: boolean;
    sourceDoctype: string;
    sourceDocId: string;
    reason: string;
  };

  const rows: Row[] = [];

  for (const a of allocations) {
    rows.push({
      employeeId: a.employeeId,
      leaveTypeId: a.leaveTypeId,
      postingDate: a.fromDate,
      entryType: "Allocation",
      leaves: Number(a.totalLeaves),
      fromDate: a.fromDate,
      toDate: a.toDate,
      workGroupId: a.employee?.workGroupId ?? null,
      employeeCategoryId: a.employee?.employeeCategoryId ?? null,
      isCarryForward: false,
      isExpired: false,
      isEncashment: false,
      sourceDoctype: "LeaveAllocation",
      sourceDocId: a.id,
      reason: a.notes ?? "Allocation",
    });
  }
  for (const app of applications) {
    rows.push({
      employeeId: app.employeeId,
      leaveTypeId: app.leaveTypeId,
      postingDate: app.fromDate,
      entryType: "Consumption",
      leaves: -Number(app.totalLeaveDays),
      fromDate: app.fromDate,
      toDate: app.toDate,
      workGroupId: app.employee?.workGroupId ?? null,
      employeeCategoryId: app.employee?.employeeCategoryId ?? null,
      isCarryForward: false,
      isExpired: false,
      isEncashment: false,
      sourceDoctype: "LeaveApplication",
      sourceDocId: app.id,
      reason: app.reason ?? "Approved leave",
    });
  }
  for (const enc of encashments as Array<{
    id: string;
    employeeId: string;
    leaveTypeId: string;
    encashmentDate?: Date | null;
    createdAt: Date;
    leavesEncashed?: unknown;
    daysEncashed?: unknown;
    employee?: { workGroupId: string | null; employeeCategoryId: string | null } | null;
  }>) {
    const leaves = Number(enc.leavesEncashed ?? enc.daysEncashed ?? 0);
    if (!leaves) continue;
    rows.push({
      employeeId: enc.employeeId,
      leaveTypeId: enc.leaveTypeId,
      postingDate: enc.encashmentDate ?? enc.createdAt,
      entryType: "Encashment",
      leaves: -leaves,
      fromDate: null,
      toDate: null,
      workGroupId: enc.employee?.workGroupId ?? null,
      employeeCategoryId: enc.employee?.employeeCategoryId ?? null,
      isCarryForward: false,
      isExpired: false,
      isEncashment: true,
      sourceDoctype: "LeaveEncashment",
      sourceDocId: enc.id,
      reason: "Encashment",
    });
  }

  // Group by (employee, leaveType), sort by date+source order, running balance
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.employeeId}::${r.leaveTypeId}`;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }
  const ORDER = { Allocation: 0, Consumption: 1, Encashment: 2, Adjustment: 3, Opening: -1, Expiry: 4, CarryForward: 5 } as const;

  const inserts: Array<Row & { balanceAfter: number; createdBy: string | null }> = [];
  for (const [key, arr] of byKey) {
    // Include the running balance from any manual Opening/Adjustment rows
    // still present, taking their impact as-of postingDate.
    const [employeeId, leaveTypeId] = key.split("::");
    const manual = await prisma.leaveLedgerEntry.findMany({
      where: {
        tenantId,
        employeeId,
        leaveTypeId,
        sourceDoctype: { in: ["Adjustment", null as unknown as string] },
      },
      select: { postingDate: true, leaves: true, entryType: true },
    });
    const merged: Array<{ postingDate: Date; leaves: number; kind: "manual" | "auto"; row?: Row }> = [
      ...manual.map((m) => ({ postingDate: m.postingDate, leaves: Number(m.leaves), kind: "manual" as const })),
      ...arr.map((r) => ({ postingDate: r.postingDate, leaves: r.leaves, kind: "auto" as const, row: r })),
    ];
    merged.sort((a, b) => {
      const t = a.postingDate.getTime() - b.postingDate.getTime();
      if (t !== 0) return t;
      const ao = a.kind === "manual" ? -2 : (ORDER as Record<string, number>)[a.row!.entryType] ?? 99;
      const bo = b.kind === "manual" ? -2 : (ORDER as Record<string, number>)[b.row!.entryType] ?? 99;
      return ao - bo;
    });
    let running = 0;
    for (const e of merged) {
      running += e.leaves;
      if (e.kind === "auto" && e.row) {
        inserts.push({ ...e.row, balanceAfter: running, createdBy: null });
      }
    }
  }

  const inserted = inserts.length
    ? await prisma.leaveLedgerEntry.createMany({
        data: inserts.map((r) => ({
          tenantId,
          employeeId: r.employeeId,
          leaveTypeId: r.leaveTypeId,
          postingDate: r.postingDate,
          entryType: r.entryType,
          leaves: r.leaves,
          balanceAfter: r.balanceAfter,
          fromDate: r.fromDate,
          toDate: r.toDate,
          workGroupId: r.workGroupId,
          employeeCategoryId: r.employeeCategoryId,
          isCarryForward: r.isCarryForward,
          isExpired: r.isExpired,
          isEncashment: r.isEncashment,
          sourceDoctype: r.sourceDoctype,
          sourceDocId: r.sourceDocId,
          reason: r.reason,
          createdBy: null,
        })),
      })
    : { count: 0 };

  res.json({
    scanned: {
      allocations: allocations.length,
      applications: applications.length,
      encashments: encashments.length,
      employees: employees.length,
    },
    inserted: inserted.count,
  });
});

// ---------- Seed analytics (SavedReport + 11 dashboards) ----------
//
// Idempotent. Cards get wiped + recreated on each run so re-seeding after a
// schema/palette tweak stays cheap. Gated on Dashboard:create — in practice
// only SystemManager and HR Manager get to run it.

leaveLedgerRouter.post("/seed-analytics", perms("Dashboard").create, async (req, res) => {
  try {
    const result = await seedLeaveAnalytics(prisma, req.auth!.tenantId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Seed failed" });
  }
});

// ---------- Balance snapshot (fast, uses last-row shortcut) ----------

leaveLedgerRouter.get("/balance/:employeeId", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.leaveLedgerEntry.findMany({
    where: { tenantId, employeeId: req.params.employeeId },
    include: { leaveType: { select: { id: true, leaveTypeName: true, color: true } } },
    orderBy: [{ postingDate: "desc" }, { createdAt: "desc" }],
  });
  const byType = new Map<string, { leaveType: { id: string; leaveTypeName: string; color: string | null }; balance: number; lastEntryAt: Date }>();
  for (const r of rows) {
    const k = r.leaveTypeId;
    if (byType.has(k)) continue; // first row per type = latest
    byType.set(k, {
      leaveType: r.leaveType,
      balance: Number(r.balanceAfter),
      lastEntryAt: r.postingDate,
    });
  }
  res.json(Array.from(byType.values()));
});
