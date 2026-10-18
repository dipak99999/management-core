import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E12: HR taxonomy masters — EmployeeGrade, EmploymentType, Branch.
// Boilerplate CRUD; all three follow the same {name (unique per tenant)} shape.

export const employeeGradeRouter = Router();
export const employmentTypeRouter = Router();
export const branchRouter = Router();

const pg = perms("EmployeeGrade");
const pe = perms("EmploymentType");
const pb = perms("Branch");

// ---- EmployeeGrade ----

const gradeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  defaultBaseSalary: z.coerce.number().nonnegative().optional().nullable(),
});

employeeGradeRouter.get("/", pg.read, async (req, res) => {
  const rows = await prisma.employeeGrade.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

employeeGradeRouter.post("/", pg.create, async (req, res) => {
  const parsed = gradeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.employeeGrade.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        defaultBaseSalary:
          parsed.data.defaultBaseSalary != null
            ? new Prisma.Decimal(parsed.data.defaultBaseSalary)
            : null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Grade name already exists" });
    throw e;
  }
});

employeeGradeRouter.put("/:id", pg.write, async (req, res) => {
  const parsed = gradeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.employeeGrade.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.employeeGrade.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name ?? existing.name,
      description: parsed.data.description ?? existing.description,
      defaultBaseSalary:
        parsed.data.defaultBaseSalary !== undefined
          ? parsed.data.defaultBaseSalary != null
            ? new Prisma.Decimal(parsed.data.defaultBaseSalary)
            : null
          : undefined,
    },
  });
  res.json(row);
});

employeeGradeRouter.delete("/:id", pg.delete, async (req, res) => {
  const existing = await prisma.employeeGrade.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.employeeGrade.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---- EmploymentType ----

const employmentTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

employmentTypeRouter.get("/", pe.read, async (req, res) => {
  const rows = await prisma.employmentType.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

employmentTypeRouter.post("/", pe.create, async (req, res) => {
  const parsed = employmentTypeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.employmentType.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Type name already exists" });
    throw e;
  }
});

employmentTypeRouter.delete("/:id", pe.delete, async (req, res) => {
  const existing = await prisma.employmentType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.employmentType.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---- Branch ----

const branchSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});

branchRouter.get("/", pb.read, async (req, res) => {
  const rows = await prisma.branch.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

branchRouter.post("/", pb.create, async (req, res) => {
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.branch.create({
      data: { tenantId: req.auth!.tenantId, ...parsed.data },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Branch name already exists" });
    throw e;
  }
});

branchRouter.put("/:id", pb.write, async (req, res) => {
  const parsed = branchSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.branch.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.branch.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

branchRouter.delete("/:id", pb.delete, async (req, res) => {
  const existing = await prisma.branch.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.branch.delete({ where: { id: existing.id } });
  res.status(204).send();
});
