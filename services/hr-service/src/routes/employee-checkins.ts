import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  checkFence,
  decryptSecrets,
  faceProviderFromSecrets,
  prisma,
  DEFAULT_FACE_MATCH_THRESHOLD,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E6: Employee Checkin. Raw IN/OUT punches. /build-attendance rolls a day of
// punches into an Attendance row per employee: first IN → checkIn, last OUT →
// checkOut, workingHours = diff in hours (2dp). Skips employees who already
// have an Attendance row for that date.

export const employeeCheckinRouter = Router();

const p = perms("EmployeeCheckin");

const createSchema = z.object({
  employeeId: z.string().min(1),
  ts: z.string().datetime(),
  logType: z.enum(["IN", "OUT"]),
  source: z.string().optional().nullable(),
  deviceId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  // Optional geo coordinates from mobile check-ins. When source="mobile"
  // and the employee's Branch has a fence configured, the check-in is
  // rejected if the point falls outside the fence radius.
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
});

const buildSchema = z.object({
  date: z.string(),
});

employeeCheckinRouter.get("/", p.read, async (req, res) => {
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const date = typeof req.query.date === "string" ? req.query.date : undefined;

  let where: Prisma.EmployeeCheckinWhereInput = { tenantId: req.auth!.tenantId };
  if (employeeId) where = { ...where, employeeId };
  if (date) {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    where = { ...where, ts: { gte: start, lt: end } };
  }
  const rows = await prisma.employeeCheckin.findMany({
    where,
    include: { employee: { select: { employeeCode: true, employeeName: true } } },
    orderBy: { ts: "desc" },
    take: 500,
  });
  res.json(rows);
});

employeeCheckinRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
    include: { branch: true },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });

  // Geo-fence enforcement for mobile check-ins. Skips silently for
  // non-mobile sources OR when the employee's branch has no fence.
  if (
    parsed.data.source === "mobile" &&
    emp.branch?.fenceLatitude != null &&
    emp.branch?.fenceLongitude != null &&
    emp.branch?.fenceRadiusMeters != null
  ) {
    if (parsed.data.latitude == null || parsed.data.longitude == null) {
      return res.status(400).json({ error: "latitude + longitude required for mobile check-in" });
    }
    const check = checkFence(
      {
        latitude: Number(emp.branch.fenceLatitude),
        longitude: Number(emp.branch.fenceLongitude),
        radiusMeters: emp.branch.fenceRadiusMeters,
      },
      { latitude: parsed.data.latitude, longitude: parsed.data.longitude },
    );
    if (!check.ok) {
      return res.status(400).json({
        error: `Outside geo-fence (you're ${Math.round(check.distanceMeters)}m away, allowed ${emp.branch.fenceRadiusMeters}m)`,
        distanceMeters: Math.round(check.distanceMeters),
      });
    }
  }

  const row = await prisma.employeeCheckin.create({
    data: {
      tenantId,
      employeeId: parsed.data.employeeId,
      ts: new Date(parsed.data.ts),
      logType: parsed.data.logType,
      source: parsed.data.source ?? null,
      deviceId: parsed.data.deviceId ?? null,
      remarks: parsed.data.remarks ?? null,
      latitude: parsed.data.latitude != null ? new Prisma.Decimal(parsed.data.latitude) : null,
      longitude: parsed.data.longitude != null ? new Prisma.Decimal(parsed.data.longitude) : null,
    },
  });
  res.status(201).json(row);
});

// Face-recognition check-in. Client uploads a JPEG (base64 in body);
// route pulls the tenant's active `FaceRecognition` TenantIntegration,
// spins up the provider, calls compare() against the employee's stored
// embedding, and creates a check-in with source="face" and the match
// confidence stamped for auditors.
const faceCheckinSchema = z.object({
  employeeId: z.string().min(1),
  ts: z.string().datetime(),
  logType: z.enum(["IN", "OUT"]),
  imageBase64: z.string().min(100), // guard obvious empties
  remarks: z.string().optional().nullable(),
});

employeeCheckinRouter.post("/face", p.create, async (req, res) => {
  const parsed = faceCheckinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
    select: { id: true, faceEmbedding: true },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  if (!emp.faceEmbedding) {
    return res.status(400).json({ error: "Employee has no enrolled face — POST /:id/face/enroll first" });
  }
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "FaceRecognition", isActive: true },
  });
  if (!integration) {
    return res.status(400).json({ error: "Face recognition integration not configured for this tenant" });
  }
  const secrets = decryptSecrets(integration.secrets) as Record<string, unknown>;
  const threshold =
    typeof secrets.faceMatchThreshold === "number"
      ? secrets.faceMatchThreshold
      : DEFAULT_FACE_MATCH_THRESHOLD;
  const provider = faceProviderFromSecrets(secrets);
  const buf = Buffer.from(parsed.data.imageBase64, "base64");
  const confidence = await provider.compare(buf, emp.faceEmbedding);
  if (confidence < threshold) {
    return res.status(401).json({
      error: `Face match confidence ${confidence.toFixed(3)} below threshold ${threshold}`,
      confidence,
    });
  }
  const row = await prisma.employeeCheckin.create({
    data: {
      tenantId,
      employeeId: emp.id,
      ts: new Date(parsed.data.ts),
      logType: parsed.data.logType,
      source: "face",
      remarks: parsed.data.remarks ?? null,
      faceMatchConfidence: new Prisma.Decimal(confidence),
    },
  });
  res.status(201).json(row);
});

// Enroll an employee's face — same integration, calls provider.enroll
// and stores the returned embedding + timestamp.
const enrollSchema = z.object({
  employeeId: z.string().min(1),
  imageBase64: z.string().min(100),
});

employeeCheckinRouter.post("/face/enroll", p.write, async (req, res) => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
    select: { id: true },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "FaceRecognition", isActive: true },
  });
  if (!integration) {
    return res.status(400).json({ error: "Face recognition integration not configured for this tenant" });
  }
  const secrets = decryptSecrets(integration.secrets) as Record<string, unknown>;
  const provider = faceProviderFromSecrets(secrets);
  const buf = Buffer.from(parsed.data.imageBase64, "base64");
  const embedding = await provider.enroll(buf);
  await prisma.employee.update({
    where: { id: emp.id },
    data: { faceEmbedding: embedding, faceEnrolledAt: new Date() },
  });
  res.json({ ok: true, embeddingLength: embedding.length });
});

// Aggregate a day's punches into Attendance rows for every employee who
// punched in that day. Skips employees who already have an Attendance row
// (won't overwrite manual/leave records).
employeeCheckinRouter.post("/build-attendance", p.write, async (req, res) => {
  const parsed = buildSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const start = new Date(parsed.data.date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const dateOnly = new Date(start);

  const punches = await prisma.employeeCheckin.findMany({
    where: { tenantId, ts: { gte: start, lt: end } },
    orderBy: { ts: "asc" },
  });
  if (punches.length === 0) return res.json({ created: 0, skipped: 0, employees: [] });

  const byEmp = new Map<string, typeof punches>();
  for (const p of punches) {
    const arr = byEmp.get(p.employeeId) ?? [];
    arr.push(p);
    byEmp.set(p.employeeId, arr);
  }

  let created = 0;
  let skipped = 0;
  const results: { employeeId: string; created: boolean; workingHours: number | null; reason?: string }[] = [];

  for (const [employeeId, list] of byEmp) {
    const existing = await prisma.attendance.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: dateOnly,
        },
      },
    });
    if (existing) {
      skipped += 1;
      results.push({ employeeId, created: false, workingHours: null, reason: "attendance exists" });
      continue;
    }
    const firstIn = list.find((p) => p.logType === "IN");
    const lastOut = [...list].reverse().find((p) => p.logType === "OUT");
    const checkIn = firstIn ? firstIn.ts : list[0].ts;
    const checkOut = lastOut ? lastOut.ts : list[list.length - 1].ts;
    const hours =
      checkOut > checkIn ? (checkOut.getTime() - checkIn.getTime()) / 3_600_000 : 0;
    const workingHours = Math.round(hours * 100) / 100;

    await prisma.attendance.create({
      data: {
        tenantId,
        employeeId,
        date: dateOnly,
        status: workingHours < 4 && workingHours > 0 ? "Half Day" : "Present",
        checkIn,
        checkOut,
        workingHours: new Prisma.Decimal(workingHours),
      },
    });
    created += 1;
    results.push({ employeeId, created: true, workingHours });
  }

  res.json({ created, skipped, employees: results });
});

employeeCheckinRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.employeeCheckin.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.employeeCheckin.delete({ where: { id: existing.id } });
  res.status(204).send();
});
