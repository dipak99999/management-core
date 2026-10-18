import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// The three supporting masters the Leave Ledger + 11 dashboards need:
//   WorkGroup            — dashboard pivot for entitlement/allocation
//   EmployeeCategory     — dashboard pivot for distribution
//   ApproverHierarchy    — Approval Hierarchy dashboard tree/flow
//
// All three are trivially CRUD, tenant-scoped, permissioned via the standard
// perms(doctype) middleware.

// -------- WorkGroup --------

export const workGroupRouter = Router();
const pWG = perms("WorkGroup");
const wgSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

workGroupRouter.get("/", pWG.read, async (req, res) => {
  const rows = await prisma.workGroup.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true } } },
  });
  res.json(rows);
});
workGroupRouter.post("/", pWG.create, async (req, res) => {
  const p = wgSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  try {
    const row = await prisma.workGroup.create({
      data: { tenantId: req.auth!.tenantId, ...p.data },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate" });
  }
});
workGroupRouter.put("/:id", pWG.write, async (req, res) => {
  const p = wgSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const existing = await prisma.workGroup.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.workGroup.update({ where: { id: existing.id }, data: p.data });
  res.json(row);
});
workGroupRouter.delete("/:id", pWG.delete, async (req, res) => {
  const existing = await prisma.workGroup.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { employees: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.employees > 0)
    return res.status(400).json({ error: `Cannot delete — ${existing._count.employees} employees still in this group` });
  await prisma.workGroup.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// -------- EmployeeCategory --------

export const employeeCategoryRouter = Router();
const pEC = perms("EmployeeCategory");
const ecSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

employeeCategoryRouter.get("/", pEC.read, async (req, res) => {
  const rows = await prisma.employeeCategory.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true } } },
  });
  res.json(rows);
});
employeeCategoryRouter.post("/", pEC.create, async (req, res) => {
  const p = ecSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  try {
    const row = await prisma.employeeCategory.create({
      data: { tenantId: req.auth!.tenantId, ...p.data },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate" });
  }
});
employeeCategoryRouter.put("/:id", pEC.write, async (req, res) => {
  const p = ecSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const existing = await prisma.employeeCategory.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.employeeCategory.update({ where: { id: existing.id }, data: p.data });
  res.json(row);
});
employeeCategoryRouter.delete("/:id", pEC.delete, async (req, res) => {
  const existing = await prisma.employeeCategory.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { employees: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.employees > 0)
    return res.status(400).json({ error: `Cannot delete — ${existing._count.employees} employees still in this category` });
  await prisma.employeeCategory.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// -------- ApproverHierarchy --------

export const approverHierarchyRouter = Router();
const pAH = perms("ApproverHierarchy");
const ahSchema = z.object({
  employeeId: z.string().min(1),
  approverEmployeeId: z.string().min(1),
  level: z.coerce.number().int().min(1).max(10).default(1),
  scope: z.enum(["Leave", "Expense", "Timesheet", "*"]).default("Leave"),
  isActive: z.boolean().default(true),
});

approverHierarchyRouter.get("/", pAH.read, async (req, res) => {
  const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
  if (typeof req.query.employeeId === "string") where.employeeId = req.query.employeeId;
  if (typeof req.query.scope === "string") where.scope = req.query.scope;
  const rows = await prisma.approverHierarchy.findMany({
    where,
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      approver: { select: { id: true, employeeCode: true, employeeName: true } },
    },
    orderBy: [{ level: "asc" }],
    take: 1000,
  });
  res.json(rows);
});
approverHierarchyRouter.post("/", pAH.create, async (req, res) => {
  const p = ahSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  if (p.data.employeeId === p.data.approverEmployeeId)
    return res.status(400).json({ error: "Employee cannot approve themselves" });
  try {
    const row = await prisma.approverHierarchy.create({
      data: { tenantId: req.auth!.tenantId, ...p.data },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate" });
  }
});
approverHierarchyRouter.put("/:id", pAH.write, async (req, res) => {
  const p = ahSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const existing = await prisma.approverHierarchy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.approverHierarchy.update({ where: { id: existing.id }, data: p.data });
  res.json(row);
});
approverHierarchyRouter.delete("/:id", pAH.delete, async (req, res) => {
  const existing = await prisma.approverHierarchy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.approverHierarchy.delete({ where: { id: existing.id } });
  res.status(204).send();
});
