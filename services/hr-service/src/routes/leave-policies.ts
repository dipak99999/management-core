import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  buildLeaveAllocationRow,
  computeLeaveBalanceAfter,
  finalizeLeaveLedgerRow,
  prisma,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E8: Leave Policy. Reusable annual allocation template. `/apply` creates a
// LeaveAllocation per detail row for each targeted employee within
// [fromDate, toDate]. Skips (employee, leaveType, range) pairs that would
// exactly duplicate an existing allocation.

export const leavePolicyRouter = Router();

const p = perms("LeavePolicy");

const detailSchema = z.object({
  leaveTypeId: z.string().min(1),
  annualAllocation: z.coerce.number().nonnegative(),
});

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  details: z.array(detailSchema).min(1),
});

const applySchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  employeeIds: z.array(z.string()).optional(), // omit or empty = all Active
});

leavePolicyRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.leavePolicy.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { details: true, employees: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

leavePolicyRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.leavePolicy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      details: {
        include: {
          leaveType: { select: { id: true, leaveTypeName: true } },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

leavePolicyRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const typeIds = parsed.data.details.map((d) => d.leaveTypeId);
  const validTypes = await prisma.leaveType.findMany({
    where: { id: { in: typeIds }, tenantId },
    select: { id: true },
  });
  if (validTypes.length !== new Set(typeIds).size)
    return res.status(400).json({ error: "One or more leave types are invalid" });

  try {
    const row = await prisma.leavePolicy.create({
      data: {
        tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        isActive: parsed.data.isActive,
        details: {
          create: parsed.data.details.map((d) => ({
            leaveTypeId: d.leaveTypeId,
            annualAllocation: new Prisma.Decimal(d.annualAllocation),
          })),
        },
      },
      include: { details: { include: { leaveType: true } } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Policy name already exists" });
    throw e;
  }
});

leavePolicyRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.leavePolicy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = parsed.data;

  const row = await prisma.$transaction(async (tx) => {
    if (body.details !== undefined) {
      await tx.leavePolicyDetail.deleteMany({ where: { leavePolicyId: existing.id } });
    }
    return tx.leavePolicy.update({
      where: { id: existing.id },
      data: {
        name: body.name ?? existing.name,
        description: body.description ?? existing.description,
        isActive: body.isActive ?? existing.isActive,
        details: body.details
          ? {
              create: body.details.map((d) => ({
                leaveTypeId: d.leaveTypeId,
                annualAllocation: new Prisma.Decimal(d.annualAllocation),
              })),
            }
          : undefined,
      },
      include: { details: { include: { leaveType: true } } },
    });
  });
  res.json(row);
});

leavePolicyRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.leavePolicy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.leavePolicy.delete({ where: { id: existing.id } });
  res.status(204).send();
});

leavePolicyRouter.post("/:id/apply", p.write, async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const policy = await prisma.leavePolicy.findFirst({
    where: { id: req.params.id, tenantId },
    include: { details: true },
  });
  if (!policy) return res.status(404).json({ error: "Not found" });
  if (!policy.isActive) return res.status(400).json({ error: "Policy is inactive" });

  const fromDate = new Date(parsed.data.fromDate);
  const toDate = new Date(parsed.data.toDate);
  if (toDate < fromDate)
    return res.status(400).json({ error: "toDate must be >= fromDate" });

  const employees = await prisma.employee.findMany({
    where: {
      tenantId,
      status: "Active",
      ...(parsed.data.employeeIds?.length
        ? { id: { in: parsed.data.employeeIds } }
        : {}),
    },
    select: { id: true, workGroupId: true, employeeCategoryId: true },
  });
  if (employees.length === 0)
    return res.status(400).json({ error: "No matching active employees" });

  let created = 0;
  let skipped = 0;

  for (const emp of employees) {
    for (const d of policy.details) {
      const existing = await prisma.leaveAllocation.findFirst({
        where: {
          tenantId,
          employeeId: emp.id,
          leaveTypeId: d.leaveTypeId,
          fromDate,
          toDate,
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      // Allocation + matching LeaveLedgerEntry in a single tx per pair
      // so a mid-loop crash doesn't leave allocations without ledger
      // entries.
      await prisma.$transaction(async (tx) => {
        const allocation = await tx.leaveAllocation.create({
          data: {
            tenantId,
            employeeId: emp.id,
            leaveTypeId: d.leaveTypeId,
            fromDate,
            toDate,
            totalLeaves: d.annualAllocation,
            notes: `Applied from policy: ${policy.name}`,
          },
        });
        const prior = await tx.leaveLedgerEntry.findMany({
          where: { tenantId, employeeId: emp.id, leaveTypeId: d.leaveTypeId },
          select: { leaves: true },
        });
        const raw = buildLeaveAllocationRow({
          employeeId: emp.id,
          leaveTypeId: d.leaveTypeId,
          postingDate: fromDate,
          fromDate,
          toDate,
          totalLeaves: Number(d.annualAllocation),
          allocationId: allocation.id,
          workGroupId: emp.workGroupId,
          employeeCategoryId: emp.employeeCategoryId,
          reason: `Applied from policy: ${policy.name}`,
          createdBy: req.auth!.userId,
        });
        const ready = finalizeLeaveLedgerRow(
          raw,
          computeLeaveBalanceAfter(prior, raw.leaves),
        );
        await tx.leaveLedgerEntry.create({ data: { tenantId, ...ready } });
      });
      created += 1;
    }
  }

  res.json({ created, skipped, employees: employees.length });
});
