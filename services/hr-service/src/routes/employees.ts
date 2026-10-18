import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, validateCustomData, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const employeeRouter = Router();

const p = perms("Employee");

const upsertSchema = z.object({
  employeeName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  dateOfJoining: z.string().datetime().optional().nullable(),
  baseSalary: z.coerce.number().nonnegative().default(0),
  bankAccountNo: z.string().optional().nullable(),
  ifscCode: z.string().regex(/^$|^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, "invalid IFSC").optional().nullable(),
  bankName: z.string().optional().nullable(),
  status: z.enum(["Active", "Left", "On Leave"]).default("Active"),
  salaryStructureId: z.string().optional().nullable(),
  defaultShiftId: z.string().optional().nullable(),
  holidayListId: z.string().optional().nullable(),
  leavePolicyId: z.string().optional().nullable(),
  gradeId: z.string().optional().nullable(),
  employmentTypeId: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  customData: z.record(z.unknown()).optional().nullable(),
});

employeeRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.employee.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { employeeCode: "asc" },
  });
  res.json(rows);
});

// Org chart — every Active employee grouped under their manager. Nodes
// with no manager become roots (usually founders / country heads). The
// tree flattens `Left` / `On Leave` reports so the chart doesn't fill
// with departures; toggle via ?includeInactive=1.
//
// Response shape:
//   { roots: [ { id, employeeName, designation, department, reports: [...] }, … ] }
//
// Depth is unbounded — the client renders whatever comes back. Cycle
// safety: we detect and break cycles by refusing to re-visit a node
// (data corruption safeguard — the schema doesn't prevent them).
employeeRouter.get("/org-chart", p.read, async (req, res) => {
  const includeInactive = req.query.includeInactive === "1";
  const rows = await prisma.employee.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(includeInactive ? {} : { status: "Active" }),
    },
    select: {
      id: true,
      employeeName: true,
      employeeCode: true,
      designation: true,
      department: true,
      email: true,
      managerId: true,
      status: true,
    },
    orderBy: { employeeName: "asc" },
  });

  type Node = {
    id: string;
    employeeCode: string;
    employeeName: string;
    designation: string | null;
    department: string | null;
    email: string | null;
    status: string;
    reports: Node[];
  };
  const nodes = new Map<string, Node>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      designation: r.designation,
      department: r.department,
      email: r.email,
      status: r.status,
      reports: [],
    });
  }
  const roots: Node[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    // Manager filtered out (e.g. Left) → treat as a root so we don't hide the branch.
    const parent = r.managerId ? nodes.get(r.managerId) : undefined;
    if (parent && parent.id !== node.id) parent.reports.push(node);
    else roots.push(node);
  }
  res.json({ roots });
});

employeeRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.employee.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Master detail: employee + salary history + attendance summary + last 30
// days of attendance rows.
employeeRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!employee) return res.status(404).json({ error: "Not found" });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const last30 = new Date(now);
  last30.setDate(last30.getDate() - 30);

  const [salarySlips, mtdAgg, ytdAgg, recentAttendance, attendanceCounts] =
    await Promise.all([
      prisma.salarySlip.findMany({
        where: { tenantId, employeeId: employee.id },
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          grossPay: true,
          totalDeduction: true,
          netPay: true,
          status: true,
        },
        orderBy: { endDate: "desc" },
        take: 24,
      }),
      prisma.salarySlip.aggregate({
        where: {
          tenantId,
          employeeId: employee.id,
          status: { in: ["Submitted", "Paid"] },
          endDate: { gte: monthStart },
        },
        _sum: { grossPay: true, netPay: true },
      }),
      prisma.salarySlip.aggregate({
        where: {
          tenantId,
          employeeId: employee.id,
          status: { in: ["Submitted", "Paid"] },
          endDate: { gte: yearStart },
        },
        _sum: { grossPay: true, netPay: true },
      }),
      prisma.attendance.findMany({
        where: { tenantId, employeeId: employee.id, date: { gte: last30 } },
        orderBy: { date: "desc" },
      }),
      // Group attendance in the last 30d by status.
      prisma.attendance.groupBy({
        by: ["status"],
        where: { tenantId, employeeId: employee.id, date: { gte: last30 } },
        _count: true,
      }),
    ]);

  const attendance30 = attendanceCounts.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = r._count;
    return acc;
  }, {});

  res.json({
    employee,
    stats: {
      mtdGross: Number(mtdAgg._sum.grossPay ?? 0),
      mtdNet: Number(mtdAgg._sum.netPay ?? 0),
      ytdGross: Number(ytdAgg._sum.grossPay ?? 0),
      ytdNet: Number(ytdAgg._sum.netPay ?? 0),
      attendance30,
    },
    salarySlips,
    recentAttendance,
  });
});

// Walks up the manager chain from `startManagerId` looking for `employeeId`.
// Returns true iff assigning `startManagerId` as `employeeId`'s manager
// would create a cycle. Bounded to 100 hops as a runaway safeguard.
async function wouldCreateCycle(
  tenantId: string,
  employeeId: string,
  startManagerId: string,
): Promise<boolean> {
  if (employeeId === startManagerId) return true;
  let cursor: string | null = startManagerId;
  for (let i = 0; i < 100 && cursor; i++) {
    const currentId: string = cursor;
    const row: { managerId: string | null } | null = await prisma.employee.findFirst({
      where: { id: currentId, tenantId },
      select: { managerId: true },
    });
    if (!row) return false;
    if (row.managerId === employeeId) return true;
    cursor = row.managerId;
  }
  return false;
}

async function validateManager(
  tenantId: string,
  managerId: string | null | undefined,
  forEmployeeId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!managerId) return { ok: true };
  const m = await prisma.employee.findFirst({
    where: { id: managerId, tenantId },
    select: { id: true },
  });
  if (!m) return { ok: false, error: "managerId not found in this tenant" };
  if (forEmployeeId && (await wouldCreateCycle(tenantId, forEmployeeId, managerId))) {
    return { ok: false, error: "This assignment would create a manager cycle" };
  }
  return { ok: true };
}

employeeRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const mgr = await validateManager(tenantId, parsed.data.managerId);
  if (!mgr.ok) return res.status(400).json({ error: mgr.error });
  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Employee",
      (parsed.data.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const employeeCode = await nextName(prisma, tenantId, "EMP-");
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.employee.create({
    data: {
      ...rest,
      tenantId,
      employeeCode,
      dateOfJoining: parsed.data.dateOfJoining ? new Date(parsed.data.dateOfJoining) : null,
      customData: (customData ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  res.status(201).json(row);
});

employeeRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.employee.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.managerId !== undefined) {
    const mgr = await validateManager(tenantId, parsed.data.managerId, existing.id);
    if (!mgr.ok) return res.status(400).json({ error: mgr.error });
  }
  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Employee",
        parsed.data.customData as Record<string, unknown> | null,
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.employee.update({
    where: { id: existing.id },
    data: {
      ...rest,
      dateOfJoining: parsed.data.dateOfJoining
        ? new Date(parsed.data.dateOfJoining)
        : undefined,
      ...(parsed.data.customData !== undefined
        ? { customData: (customData ?? undefined) as Prisma.InputJsonValue | undefined }
        : {}),
    },
  });
  res.json(row);
});
