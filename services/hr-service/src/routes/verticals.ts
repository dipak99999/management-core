import { Router } from "express";
import { z } from "zod";
import { Prisma, nextName, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Vertical modules shipped in one file to keep the count sane. Each
// section is a self-contained mini-CRUD. Sections registered under
// their own base path in services/hr-service/src/index.ts.

// ═════════════════════════════════════════════════════════════════════
// EDUCATION
// ═════════════════════════════════════════════════════════════════════

export const programRouter = Router();
const pProgram = perms("Program");

const programSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  academicYear: z.string().optional().nullable(),
  active: z.boolean().default(true),
});

programRouter.get("/", pProgram.read, async (req, res) => {
  const rows = await prisma.program.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

programRouter.post("/", pProgram.create, async (req, res) => {
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.program.create({
    data: { tenantId: req.auth!.tenantId, ...parsed.data },
  });
  res.status(201).json(row);
});

programRouter.put("/:id", pProgram.write, async (req, res) => {
  const parsed = programSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.program.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.program.update({ where: { id: existing.id }, data: parsed.data });
  res.json(row);
});

programRouter.delete("/:id", pProgram.delete, async (req, res) => {
  const existing = await prisma.program.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.program.delete({ where: { id: existing.id } });
  res.status(204).send();
});

export const courseRouter = Router();
const pCourse = perms("Course");
const courseSchema = z.object({
  programId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  credits: z.coerce.number().default(3),
  instructorEmployeeId: z.string().optional().nullable(),
});
courseRouter.get("/", pCourse.read, async (req, res) => {
  const programId = typeof req.query.programId === "string" ? req.query.programId : undefined;
  const rows = await prisma.course.findMany({
    where: { tenantId: req.auth!.tenantId, ...(programId ? { programId } : {}) },
    include: { program: { select: { code: true, name: true } } },
    orderBy: { code: "asc" },
  });
  res.json(rows);
});
courseRouter.post("/", pCourse.create, async (req, res) => {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.course.create({
    data: { tenantId: req.auth!.tenantId, ...parsed.data },
  });
  res.status(201).json(row);
});
courseRouter.put("/:id", pCourse.write, async (req, res) => {
  const parsed = courseSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.course.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  res.json(await prisma.course.update({ where: { id: existing.id }, data: parsed.data }));
});

export const studentRouter = Router();
const pStudent = perms("Student");
const studentSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  gender: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  guardianName: z.string().optional().nullable(),
  guardianPhone: z.string().optional().nullable(),
  status: z.enum(["Active", "Alumni", "Withdrawn", "Suspended"]).default("Active"),
  customerId: z.string().optional().nullable(),
});
studentRouter.get("/", pStudent.read, async (req, res) => {
  const rows = await prisma.student.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { studentCode: "asc" },
    take: 500,
  });
  res.json(rows);
});
studentRouter.get("/:id", pStudent.read, async (req, res) => {
  const row = await prisma.student.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      enrollments: { include: { program: { select: { code: true, name: true } } } },
      feePostings: { orderBy: { dueDate: "desc" }, take: 24 },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
studentRouter.post("/", pStudent.create, async (req, res) => {
  const parsed = studentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const studentCode = await nextName(prisma, tenantId, "STU-");
  const row = await prisma.student.create({
    data: {
      tenantId,
      studentCode,
      ...parsed.data,
      dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null,
    },
  });
  res.status(201).json(row);
});
studentRouter.put("/:id", pStudent.write, async (req, res) => {
  const parsed = studentSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.student.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  res.json(await prisma.student.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : undefined,
    },
  }));
});

export const enrollmentRouter = Router();
const pEnroll = perms("StudentEnrollment");
const enrollSchema = z.object({
  studentId: z.string().min(1),
  programId: z.string().min(1),
  academicYear: z.string().min(1),
  section: z.string().optional().nullable(),
});
enrollmentRouter.get("/", pEnroll.read, async (req, res) => {
  const rows = await prisma.studentEnrollment.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { student: true, program: { select: { name: true, code: true } } },
    orderBy: { enrolledAt: "desc" },
  });
  res.json(rows);
});
enrollmentRouter.post("/", pEnroll.create, async (req, res) => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.studentEnrollment.create({
    data: { tenantId: req.auth!.tenantId, ...parsed.data },
  });
  res.status(201).json(row);
});

export const feeScheduleRouter = Router();
const pFee = perms("FeeSchedule");
const feeScheduleSchema = z.object({
  name: z.string().min(1),
  programId: z.string().optional().nullable(),
  academicYear: z.string().min(1),
  amount: z.coerce.number().positive(),
  dueDayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
  installments: z.coerce.number().int().min(1).default(1),
  active: z.boolean().default(true),
});
feeScheduleRouter.get("/", pFee.read, async (req, res) => {
  res.json(
    await prisma.feeSchedule.findMany({
      where: { tenantId: req.auth!.tenantId },
      orderBy: { createdAt: "desc" },
    }),
  );
});
feeScheduleRouter.post("/", pFee.create, async (req, res) => {
  const parsed = feeScheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.feeSchedule.create({
    data: { tenantId: req.auth!.tenantId, ...parsed.data },
  });
  res.status(201).json(row);
});

export const assessmentRouter = Router();
const pAsm = perms("Assessment");
const assessmentSchema = z.object({
  courseId: z.string().min(1),
  name: z.string().min(1),
  maxScore: z.coerce.number().positive(),
  weightPct: z.coerce.number().min(0).max(100).default(0),
  dueDate: z.string().datetime().optional().nullable(),
});
assessmentRouter.get("/", pAsm.read, async (req, res) => {
  const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;
  res.json(
    await prisma.assessment.findMany({
      where: { tenantId: req.auth!.tenantId, ...(courseId ? { courseId } : {}) },
      include: { _count: { select: { results: true } } },
      orderBy: { createdAt: "desc" },
    }),
  );
});
assessmentRouter.post("/", pAsm.create, async (req, res) => {
  const parsed = assessmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.assessment.create({
    data: {
      tenantId: req.auth!.tenantId,
      ...parsed.data,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    },
  });
  res.status(201).json(row);
});
const resultSchema = z.object({
  studentId: z.string().min(1),
  score: z.coerce.number().nonnegative(),
  comments: z.string().optional().nullable(),
});
assessmentRouter.post("/:id/results", pAsm.write, async (req, res) => {
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const asm = await prisma.assessment.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!asm) return res.status(404).json({ error: "Not found" });
  const row = await prisma.assessmentResult.upsert({
    where: { assessmentId_studentId: { assessmentId: asm.id, studentId: parsed.data.studentId } },
    update: { score: new Prisma.Decimal(parsed.data.score), comments: parsed.data.comments ?? null, gradedBy: req.auth!.userId },
    create: {
      tenantId: req.auth!.tenantId,
      assessmentId: asm.id,
      studentId: parsed.data.studentId,
      score: new Prisma.Decimal(parsed.data.score),
      comments: parsed.data.comments ?? null,
      gradedBy: req.auth!.userId,
    },
  });
  res.status(201).json(row);
});

// ═════════════════════════════════════════════════════════════════════
// HEALTHCARE
// ═════════════════════════════════════════════════════════════════════

export const patientRouter = Router();
const pPatient = perms("Patient");
const patientSchema = z.object({
  fullName: z.string().min(1),
  dateOfBirth: z.string().datetime().optional().nullable(),
  gender: z.string().optional().nullable(),
  bloodGroup: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  emergencyName: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  allergies: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(["Active", "Discharged", "Deceased"]).default("Active"),
  customerId: z.string().optional().nullable(),
});
patientRouter.get("/", pPatient.read, async (req, res) => {
  res.json(
    await prisma.patient.findMany({
      where: { tenantId: req.auth!.tenantId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );
});
patientRouter.get("/:id", pPatient.read, async (req, res) => {
  const row = await prisma.patient.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      appointments: { orderBy: { startAt: "desc" }, take: 10 },
      encounters: { orderBy: { encounterAt: "desc" }, take: 10, include: { prescriptions: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
patientRouter.post("/", pPatient.create, async (req, res) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const mrn = await nextName(prisma, req.auth!.tenantId, "PAT-");
  const row = await prisma.patient.create({
    data: {
      tenantId: req.auth!.tenantId,
      mrn,
      ...parsed.data,
      dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null,
    },
  });
  res.status(201).json(row);
});
patientRouter.put("/:id", pPatient.write, async (req, res) => {
  const parsed = patientSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.patient.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  res.json(await prisma.patient.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : undefined,
    },
  }));
});

export const appointmentRouter = Router();
const pAppt = perms("PatientAppointment");
const apptSchema = z.object({
  patientId: z.string().min(1),
  practitionerEmployeeId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().optional().nullable(),
});
appointmentRouter.get("/", pAppt.read, async (req, res) => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  res.json(
    await prisma.patientAppointment.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        ...(from || to
          ? { startAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      include: {
        patient: { select: { fullName: true, mrn: true } },
        practitioner: { select: { employeeName: true } },
      },
      orderBy: { startAt: "asc" },
    }),
  );
});
appointmentRouter.post("/", pAppt.create, async (req, res) => {
  const parsed = apptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.patientAppointment.create({
    data: {
      tenantId: req.auth!.tenantId,
      ...parsed.data,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
    },
  });
  res.status(201).json(row);
});
appointmentRouter.patch("/:id/status", pAppt.write, async (req, res) => {
  const status = typeof req.body?.status === "string" ? req.body.status : "";
  if (!["Scheduled", "CheckedIn", "InProgress", "Completed", "Cancelled", "NoShow"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const existing = await prisma.patientAppointment.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  res.json(await prisma.patientAppointment.update({ where: { id: existing.id }, data: { status } }));
});

export const encounterRouter = Router();
const pEnc = perms("PatientEncounter");
const encounterSchema = z.object({
  patientId: z.string().min(1),
  practitionerEmployeeId: z.string().min(1),
  chiefComplaint: z.string().optional().nullable(),
  historyOfIllness: z.string().optional().nullable(),
  examinationFindings: z.string().optional().nullable(),
  diagnosis: z.string().optional().nullable(),
  treatmentPlan: z.string().optional().nullable(),
  followUpAt: z.string().datetime().optional().nullable(),
  prescriptions: z.array(z.object({
    medication: z.string().min(1),
    dosage: z.string().min(1),
    frequency: z.string().min(1),
    durationDays: z.coerce.number().int().positive().optional(),
    instructions: z.string().optional().nullable(),
  })).default([]),
});
encounterRouter.post("/", pEnc.create, async (req, res) => {
  const parsed = encounterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const row = await prisma.patientEncounter.create({
    data: {
      tenantId: req.auth!.tenantId,
      patientId: d.patientId,
      practitionerEmployeeId: d.practitionerEmployeeId,
      chiefComplaint: d.chiefComplaint ?? null,
      historyOfIllness: d.historyOfIllness ?? null,
      examinationFindings: d.examinationFindings ?? null,
      diagnosis: d.diagnosis ?? null,
      treatmentPlan: d.treatmentPlan ?? null,
      followUpAt: d.followUpAt ? new Date(d.followUpAt) : null,
      prescriptions: {
        create: d.prescriptions.map((p) => ({
          tenantId: req.auth!.tenantId,
          medication: p.medication,
          dosage: p.dosage,
          frequency: p.frequency,
          durationDays: p.durationDays ?? null,
          instructions: p.instructions ?? null,
        })),
      },
    },
    include: { prescriptions: true },
  });
  res.status(201).json(row);
});

// ═════════════════════════════════════════════════════════════════════
// NON-PROFIT
// ═════════════════════════════════════════════════════════════════════

export const donorRouter = Router();
const pDonor = perms("Donor");
const donorSchema = z.object({
  donorName: z.string().min(1),
  donorType: z.enum(["Individual", "Corporation", "Foundation"]).default("Individual"),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  taxId: z.string().optional().nullable(),
  isAnonymous: z.boolean().default(false),
});
donorRouter.get("/", pDonor.read, async (req, res) => {
  res.json(await prisma.donor.findMany({ where: { tenantId: req.auth!.tenantId }, orderBy: { donorName: "asc" } }));
});
donorRouter.post("/", pDonor.create, async (req, res) => {
  const parsed = donorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const donorCode = await nextName(prisma, req.auth!.tenantId, "DON-");
  const row = await prisma.donor.create({
    data: { tenantId: req.auth!.tenantId, donorCode, ...parsed.data },
  });
  res.status(201).json(row);
});

export const donationRouter = Router();
const pDonation = perms("Donation");
const donationSchema = z.object({
  donorId: z.string().min(1),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3).default("INR"),
  postingDate: z.string().datetime().optional(),
  campaignName: z.string().optional().nullable(),
  paymentMethod: z.enum(["Bank", "Cash", "Cheque", "Online"]).default("Bank"),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
donationRouter.get("/", pDonation.read, async (req, res) => {
  res.json(
    await prisma.donation.findMany({
      where: { tenantId: req.auth!.tenantId },
      include: { donor: { select: { donorCode: true, donorName: true } } },
      orderBy: { postingDate: "desc" },
      take: 200,
    }),
  );
});
donationRouter.post("/", pDonation.create, async (req, res) => {
  const parsed = donationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const row = await prisma.donation.create({
    data: {
      tenantId: req.auth!.tenantId,
      donorId: b.donorId,
      amount: new Prisma.Decimal(b.amount),
      currency: b.currency,
      postingDate: b.postingDate ? new Date(b.postingDate) : new Date(),
      campaignName: b.campaignName ?? null,
      paymentMethod: b.paymentMethod,
      reference: b.reference ?? null,
      notes: b.notes ?? null,
    },
  });
  res.status(201).json(row);
});

export const grantRouter = Router();
const pGrant = perms("Grant");
const grantSchema = z.object({
  grantorName: z.string().min(1),
  grantCode: z.string().min(1),
  purpose: z.string().min(1),
  totalAmount: z.coerce.number().positive(),
  currency: z.string().length(3).default("INR"),
  awardedOn: z.string().datetime(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  status: z.enum(["Active", "Closed", "Cancelled"]).default("Active"),
  reportingCadence: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
grantRouter.get("/", pGrant.read, async (req, res) => {
  res.json(await prisma.grant.findMany({ where: { tenantId: req.auth!.tenantId }, orderBy: { awardedOn: "desc" } }));
});
grantRouter.post("/", pGrant.create, async (req, res) => {
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const row = await prisma.grant.create({
    data: {
      tenantId: req.auth!.tenantId,
      grantorName: b.grantorName,
      grantCode: b.grantCode,
      purpose: b.purpose,
      totalAmount: new Prisma.Decimal(b.totalAmount),
      currency: b.currency,
      awardedOn: new Date(b.awardedOn),
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate),
      status: b.status,
      reportingCadence: b.reportingCadence ?? null,
      notes: b.notes ?? null,
    },
  });
  res.status(201).json(row);
});

export const membershipRouter = Router();
const pMember = perms("Membership");
const membershipSchema = z.object({
  donorId: z.string().min(1),
  tier: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  amount: z.coerce.number().nonnegative(),
  currency: z.string().length(3).default("INR"),
});
membershipRouter.get("/", pMember.read, async (req, res) => {
  res.json(
    await prisma.membership.findMany({
      where: { tenantId: req.auth!.tenantId },
      include: { donor: { select: { donorCode: true, donorName: true } } },
      orderBy: { endDate: "desc" },
    }),
  );
});
membershipRouter.post("/", pMember.create, async (req, res) => {
  const parsed = membershipSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const row = await prisma.membership.create({
    data: {
      tenantId: req.auth!.tenantId,
      donorId: b.donorId,
      tier: b.tier,
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate),
      amount: new Prisma.Decimal(b.amount),
      currency: b.currency,
    },
  });
  res.status(201).json(row);
});
