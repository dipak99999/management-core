import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E13: Employee Skills + Certifications. Simple sub-resources of Employee.
// Both filterable by employeeId query param, both writable per row.

export const employeeSkillRouter = Router();
export const employeeCertRouter = Router();

const ps = perms("EmployeeSkill");
const pc = perms("EmployeeCertification");

// ---- Skills ----

const skillSchema = z.object({
  employeeId: z.string().min(1),
  skillName: z.string().min(1),
  proficiency: z.enum(["Beginner", "Intermediate", "Advanced", "Expert"]),
  yearsOfExperience: z.coerce.number().nonnegative().optional().nullable(),
});

employeeSkillRouter.get("/", ps.read, async (req, res) => {
  const employeeId =
    typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const rows = await prisma.employeeSkill.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
    },
    include: { employee: { select: { employeeCode: true, employeeName: true } } },
    orderBy: [{ employeeId: "asc" }, { skillName: "asc" }],
  });
  res.json(rows);
});

employeeSkillRouter.post("/", ps.create, async (req, res) => {
  const parsed = skillSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  try {
    const row = await prisma.employeeSkill.create({
      data: {
        tenantId,
        employeeId: parsed.data.employeeId,
        skillName: parsed.data.skillName,
        proficiency: parsed.data.proficiency,
        yearsOfExperience:
          parsed.data.yearsOfExperience != null
            ? new Prisma.Decimal(parsed.data.yearsOfExperience)
            : null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Skill already recorded for this employee" });
    throw e;
  }
});

employeeSkillRouter.delete("/:id", ps.delete, async (req, res) => {
  const existing = await prisma.employeeSkill.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.employeeSkill.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---- Certifications ----

const certSchema = z.object({
  employeeId: z.string().min(1),
  certificationName: z.string().min(1),
  issuer: z.string().optional().nullable(),
  issueDate: z.string().datetime().optional().nullable(),
  expiryDate: z.string().datetime().optional().nullable(),
  credentialId: z.string().optional().nullable(),
  credentialUrl: z.string().optional().nullable(),
});

employeeCertRouter.get("/", pc.read, async (req, res) => {
  const employeeId =
    typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const expiringWithinDays =
    typeof req.query.expiringWithinDays === "string"
      ? Number(req.query.expiringWithinDays)
      : undefined;
  const filters: Prisma.EmployeeCertificationWhereInput = {
    tenantId: req.auth!.tenantId,
    ...(employeeId ? { employeeId } : {}),
  };
  if (expiringWithinDays && !Number.isNaN(expiringWithinDays)) {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + expiringWithinDays);
    filters.expiryDate = { lte: soon, gt: new Date() };
  }
  const rows = await prisma.employeeCertification.findMany({
    where: filters,
    include: { employee: { select: { employeeCode: true, employeeName: true } } },
    orderBy: [{ employeeId: "asc" }, { expiryDate: "asc" }],
  });
  res.json(rows);
});

employeeCertRouter.post("/", pc.create, async (req, res) => {
  const parsed = certSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  const row = await prisma.employeeCertification.create({
    data: {
      tenantId,
      employeeId: parsed.data.employeeId,
      certificationName: parsed.data.certificationName,
      issuer: parsed.data.issuer ?? null,
      issueDate: parsed.data.issueDate ? new Date(parsed.data.issueDate) : null,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null,
      credentialId: parsed.data.credentialId ?? null,
      credentialUrl: parsed.data.credentialUrl ?? null,
    },
  });
  res.status(201).json(row);
});

employeeCertRouter.delete("/:id", pc.delete, async (req, res) => {
  const existing = await prisma.employeeCertification.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.employeeCertification.delete({ where: { id: existing.id } });
  res.status(204).send();
});
