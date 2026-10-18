import { Router } from "express";
import { z } from "zod";
import { prisma, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E10: Recruitment. JobOpening (positions to fill) + JobApplicant (candidates
// per opening). `POST /job-applicants/:id/hire` mints a real Employee record
// from the applicant, links back, flips both to Hired + Closed as appropriate.

export const jobOpeningRouter = Router();
export const jobApplicantRouter = Router();

const po = perms("JobOpening");
const pa = perms("JobApplicant");

// ---------------- Job Openings ----------------

const openingSchema = z.object({
  title: z.string().min(1),
  department: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  employmentType: z.enum(["Full-time", "Part-time", "Contract", "Intern"]).optional().nullable(),
  publishedAt: z.string().datetime().optional().nullable(),
  status: z.enum(["Open", "Closed", "On Hold"]).default("Open"),
});

jobOpeningRouter.get("/", po.read, async (req, res) => {
  const rows = await prisma.jobOpening.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { applicants: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

jobOpeningRouter.get("/:id", po.read, async (req, res) => {
  const row = await prisma.jobOpening.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      applicants: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

jobOpeningRouter.post("/", po.create, async (req, res) => {
  const parsed = openingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const name = await nextName(prisma, tenantId, "JOB-");
  const row = await prisma.jobOpening.create({
    data: {
      tenantId,
      name,
      title: parsed.data.title,
      department: parsed.data.department ?? null,
      designation: parsed.data.designation ?? null,
      description: parsed.data.description ?? null,
      location: parsed.data.location ?? null,
      employmentType: parsed.data.employmentType ?? null,
      publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
      status: parsed.data.status,
    },
  });
  res.status(201).json(row);
});

jobOpeningRouter.put("/:id", po.write, async (req, res) => {
  const parsed = openingSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.jobOpening.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const b = parsed.data;
  const row = await prisma.jobOpening.update({
    where: { id: existing.id },
    data: {
      title: b.title ?? existing.title,
      department: b.department ?? existing.department,
      designation: b.designation ?? existing.designation,
      description: b.description ?? existing.description,
      location: b.location ?? existing.location,
      employmentType: b.employmentType ?? existing.employmentType,
      publishedAt: b.publishedAt ? new Date(b.publishedAt) : existing.publishedAt,
      status: b.status ?? existing.status,
      closedAt: b.status === "Closed" ? new Date() : existing.closedAt,
    },
  });
  res.json(row);
});

// ---------------- Job Applicants ----------------

const applicantSchema = z.object({
  applicantName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  coverLetter: z.string().optional().nullable(),
  resumeUrl: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  jobOpeningId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum([
    "New",
    "Shortlisted",
    "Interviewing",
    "Offer",
    "Hired",
    "Rejected",
    "Withdrawn",
  ]),
});

const hireSchema = z.object({
  designation: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  dateOfJoining: z.string().datetime().optional(),
  baseSalary: z.coerce.number().nonnegative().default(0),
});

jobApplicantRouter.get("/", pa.read, async (req, res) => {
  const jobOpeningId =
    typeof req.query.jobOpeningId === "string" ? req.query.jobOpeningId : undefined;
  const rows = await prisma.jobApplicant.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(jobOpeningId ? { jobOpeningId } : {}),
    },
    include: {
      jobOpening: { select: { id: true, name: true, title: true } },
      hiredEmployee: { select: { id: true, employeeCode: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

jobApplicantRouter.get("/:id", pa.read, async (req, res) => {
  const row = await prisma.jobApplicant.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      jobOpening: { select: { id: true, name: true, title: true } },
      hiredEmployee: { select: { id: true, employeeCode: true, employeeName: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

jobApplicantRouter.post("/", pa.create, async (req, res) => {
  const parsed = applicantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  if (parsed.data.jobOpeningId) {
    const jo = await prisma.jobOpening.findFirst({
      where: { id: parsed.data.jobOpeningId, tenantId },
    });
    if (!jo) return res.status(400).json({ error: "Invalid job opening" });
  }

  const name = await nextName(prisma, tenantId, "JAPP-");
  const row = await prisma.jobApplicant.create({
    data: {
      tenantId,
      name,
      applicantName: parsed.data.applicantName,
      email: parsed.data.email ?? null,
      mobile: parsed.data.mobile ?? null,
      coverLetter: parsed.data.coverLetter ?? null,
      resumeUrl: parsed.data.resumeUrl ?? null,
      source: parsed.data.source ?? null,
      jobOpeningId: parsed.data.jobOpeningId ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  res.status(201).json(row);
});

jobApplicantRouter.post("/:id/set-status", pa.write, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.jobApplicant.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.jobApplicant.update({
    where: { id: existing.id },
    data: { status: parsed.data.status },
  });
  res.json(row);
});

// Hire: create Employee, link back, flip applicant to Hired. If job opening
// is Open, closes it.
jobApplicantRouter.post("/:id/hire", pa.submit, async (req, res) => {
  const parsed = hireSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const applicant = await tx.jobApplicant.findFirst({
        where: { id: req.params.id, tenantId },
        include: { jobOpening: true },
      });
      if (!applicant) throw new Error("Not found");
      if (applicant.status === "Hired") throw new Error("Already hired");

      const employeeCode = await nextName(tx, tenantId, "EMP-");
      const employee = await tx.employee.create({
        data: {
          tenantId,
          employeeCode,
          employeeName: applicant.applicantName,
          email: applicant.email,
          mobile: applicant.mobile,
          designation: parsed.data.designation ?? applicant.jobOpening?.designation ?? null,
          department: parsed.data.department ?? applicant.jobOpening?.department ?? null,
          dateOfJoining: parsed.data.dateOfJoining
            ? new Date(parsed.data.dateOfJoining)
            : new Date(),
          baseSalary: parsed.data.baseSalary,
          status: "Active",
        },
      });
      await tx.jobApplicant.update({
        where: { id: applicant.id },
        data: { status: "Hired", hiredEmployeeId: employee.id },
      });
      if (applicant.jobOpening && applicant.jobOpening.status === "Open") {
        await tx.jobOpening.update({
          where: { id: applicant.jobOpening.id },
          data: { status: "Closed", closedAt: new Date() },
        });
      }
      return { employeeId: employee.id, employeeCode };
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
