import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms, publishRealtime } from "@lumaara/service-auth";

export const attendanceRouter = Router();

const p = perms("Attendance");

const upsertSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string(), // YYYY-MM-DD
  status: z.enum(["Present", "Absent", "Half Day", "On Leave", "Work From Home"]),
  remarks: z.string().optional().nullable(),
});

// List, optionally filtered by employeeId and date range.
attendanceRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const rows = await prisma.attendance.findMany({
    where: {
      tenantId,
      ...(employeeId ? { employeeId } : {}),
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: { employee: { select: { employeeCode: true, employeeName: true } } },
    orderBy: [{ date: "desc" }, { employeeId: "asc" }],
  });
  res.json(rows);
});

// Upsert (one row per employee+date).
attendanceRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const emp = await prisma.employee.findFirst({
    where: { id: p.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });

  const date = new Date(p.date);
  const row = await prisma.attendance.upsert({
    where: {
      tenantId_employeeId_date: { tenantId, employeeId: p.employeeId, date },
    },
    create: {
      tenantId,
      employeeId: p.employeeId,
      date,
      status: p.status,
      remarks: p.remarks ?? null,
    },
    update: { status: p.status, remarks: p.remarks ?? null },
  });
  void publishRealtime(tenantId, "attendance", { id: row.id, status: row.status });
  res.json(row);
});
