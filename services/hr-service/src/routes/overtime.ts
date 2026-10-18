import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// E7: Overtime + Attendance Regularization.
// - OvertimeRequest: employee logs OT hours + rate; HR approves.
// - AttendanceRegularization: employee requests to fix an Attendance row (missed
//   punch, wrong status). On approve, the target Attendance row is updated in
//   place — a `[Regularized by <user>]` note is appended to remarks.

export const overtimeRouter = Router();
export const attendanceRegRouter = Router();

const po = perms("OvertimeRequest");
const pa = perms("AttendanceRegularization");

// ---------------- Overtime ----------------

const otSchema = z.object({
  employeeId: z.string().min(1),
  otDate: z.string().datetime(),
  hours: z.coerce.number().positive(),
  hourlyRate: z.coerce.number().nonnegative(),
  reason: z.string().optional().nullable(),
});

overtimeRouter.get("/", po.read, async (req, res) => {
  const employeeId =
    typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const rows = await prisma.overtimeRequest.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
    },
    include: { employee: { select: { employeeCode: true, employeeName: true } } },
    orderBy: { otDate: "desc" },
  });
  res.json(rows);
});

overtimeRouter.post("/", po.create, async (req, res) => {
  const parsed = otSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  const name = await nextName(prisma, tenantId, "OT-");
  const hours = parsed.data.hours;
  const rate = parsed.data.hourlyRate;
  const row = await prisma.overtimeRequest.create({
    data: {
      tenantId,
      name,
      employeeId: parsed.data.employeeId,
      otDate: new Date(parsed.data.otDate),
      hours: new Prisma.Decimal(hours),
      hourlyRate: new Prisma.Decimal(rate),
      amount: new Prisma.Decimal(hours * rate),
      reason: parsed.data.reason ?? null,
    },
  });
  res.status(201).json(row);
});

overtimeRouter.post("/:id/approve", po.submit, async (req, res) => {
  const existing = await prisma.overtimeRequest.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot approve in status ${existing.status}` });
  const row = await prisma.overtimeRequest.update({
    where: { id: existing.id },
    data: { status: "Approved", approvedBy: req.auth!.userId, approvedAt: new Date() },
  });
  res.json(row);
});

overtimeRouter.post("/:id/reject", po.submit, async (req, res) => {
  const existing = await prisma.overtimeRequest.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot reject in status ${existing.status}` });
  const row = await prisma.overtimeRequest.update({
    where: { id: existing.id },
    data: { status: "Rejected", approvedBy: req.auth!.userId, approvedAt: new Date() },
  });
  res.json(row);
});

overtimeRouter.post("/:id/cancel", po.cancel, idempotency("POST /overtime/:id/cancel"), async (req, res) => {
  const existing = await prisma.overtimeRequest.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  const row = await prisma.overtimeRequest.update({
    where: { id: existing.id },
    data: { status: "Cancelled" },
  });
  res.json(row);
});

// ---------------- Attendance Regularization ----------------

const arSchema = z.object({
  employeeId: z.string().min(1),
  attendanceDate: z.string().datetime(),
  requestedStatus: z.enum(["Present", "Absent", "Half Day", "Work From Home"]),
  requestedCheckIn: z.string().datetime().optional().nullable(),
  requestedCheckOut: z.string().datetime().optional().nullable(),
  reason: z.string().min(1),
});

attendanceRegRouter.get("/", pa.read, async (req, res) => {
  const rows = await prisma.attendanceRegularization.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { employee: { select: { employeeCode: true, employeeName: true } } },
    orderBy: { attendanceDate: "desc" },
  });
  res.json(rows);
});

attendanceRegRouter.post("/", pa.create, async (req, res) => {
  const parsed = arSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  const name = await nextName(prisma, tenantId, "AR-");
  const row = await prisma.attendanceRegularization.create({
    data: {
      tenantId,
      name,
      employeeId: parsed.data.employeeId,
      attendanceDate: new Date(parsed.data.attendanceDate),
      requestedStatus: parsed.data.requestedStatus,
      requestedCheckIn: parsed.data.requestedCheckIn ? new Date(parsed.data.requestedCheckIn) : null,
      requestedCheckOut: parsed.data.requestedCheckOut ? new Date(parsed.data.requestedCheckOut) : null,
      reason: parsed.data.reason,
    },
  });
  res.status(201).json(row);
});

// Approve: apply the requested change to the target Attendance row. Upsert on
// (employee, date) so cases where no attendance exists yet also work.
attendanceRegRouter.post("/:id/approve", pa.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const ar = await tx.attendanceRegularization.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!ar) throw new Error("Not found");
      if (ar.status !== "Draft") throw new Error(`Cannot approve in status ${ar.status}`);

      const dateOnly = new Date(ar.attendanceDate);
      dateOnly.setUTCHours(0, 0, 0, 0);

      const workingHours =
        ar.requestedCheckIn && ar.requestedCheckOut
          ? Math.max(
              0,
              Math.round(
                ((ar.requestedCheckOut.getTime() - ar.requestedCheckIn.getTime()) /
                  3_600_000) *
                  100,
              ) / 100,
            )
          : null;

      const stamp = `[Regularized by ${userId} at ${new Date().toISOString()}: ${ar.reason}]`;
      const existing = await tx.attendance.findUnique({
        where: {
          tenantId_employeeId_date: {
            tenantId,
            employeeId: ar.employeeId,
            date: dateOnly,
          },
        },
      });
      if (existing) {
        await tx.attendance.update({
          where: { id: existing.id },
          data: {
            status: ar.requestedStatus,
            checkIn: ar.requestedCheckIn ?? existing.checkIn,
            checkOut: ar.requestedCheckOut ?? existing.checkOut,
            workingHours: workingHours != null ? new Prisma.Decimal(workingHours) : existing.workingHours,
            remarks: existing.remarks ? `${existing.remarks}\n${stamp}` : stamp,
          },
        });
      } else {
        await tx.attendance.create({
          data: {
            tenantId,
            employeeId: ar.employeeId,
            date: dateOnly,
            status: ar.requestedStatus,
            checkIn: ar.requestedCheckIn,
            checkOut: ar.requestedCheckOut,
            workingHours: workingHours != null ? new Prisma.Decimal(workingHours) : null,
            remarks: stamp,
          },
        });
      }

      return tx.attendanceRegularization.update({
        where: { id: ar.id },
        data: { status: "Approved", approvedBy: userId, approvedAt: new Date() },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

attendanceRegRouter.post("/:id/reject", pa.submit, async (req, res) => {
  const existing = await prisma.attendanceRegularization.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot reject in status ${existing.status}` });
  const row = await prisma.attendanceRegularization.update({
    where: { id: existing.id },
    data: { status: "Rejected", approvedBy: req.auth!.userId, approvedAt: new Date() },
  });
  res.json(row);
});
