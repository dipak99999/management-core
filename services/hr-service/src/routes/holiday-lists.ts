import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E1: Holiday List. Named calendar of non-working days per tenant. Employees
// can point at one; else they use Tenant.defaultHolidayListId. Payroll and
// attendance reports use `isHoliday` to skip these dates.

export const holidayListRouter = Router();

const p = perms("HolidayList");

const holidaySchema = z.object({
  holidayDate: z.string().datetime(),
  description: z.string().min(1),
  isWeeklyOff: z.boolean().default(false),
});

const upsertSchema = z.object({
  name: z.string().min(1),
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  weeklyOffDay: z.string().optional().nullable(),
  holidays: z.array(holidaySchema).default([]),
});

function daysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(from);
  while (d <= to) {
    out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function autoWeeklyOffs(from: Date, to: Date, dow: number): { holidayDate: Date; description: string }[] {
  const days = daysBetween(from, to);
  const labels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days
    .filter((d) => d.getUTCDay() === dow)
    .map((d) => ({ holidayDate: d, description: `Weekly Off (${labels[dow]})` }));
}

holidayListRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.holidayList.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { holidays: true } } },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

holidayListRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.holidayList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      holidays: { orderBy: { holidayDate: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Helper: is a given date a holiday for a given employee? Falls back to the
// tenant default holiday list. Returns null if no list is applicable.
holidayListRouter.get("/is-holiday/check", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const date = typeof req.query.date === "string" ? req.query.date : "";
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : "";
  if (!date) return res.status(400).json({ error: "date required" });
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);

  let listId: string | null = null;
  if (employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { holidayListId: true },
    });
    listId = emp?.holidayListId ?? null;
  }
  if (!listId) {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultHolidayListId: true },
    });
    listId = t?.defaultHolidayListId ?? null;
  }
  if (!listId) return res.json({ isHoliday: false, listId: null });

  const h = await prisma.holiday.findFirst({
    where: { holidayListId: listId, holidayDate: d },
  });
  res.json({ isHoliday: !!h, listId, description: h?.description ?? null });
});

holidayListRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;
  const tenantId = req.auth!.tenantId;
  const fromDate = new Date(body.fromDate);
  const toDate = new Date(body.toDate);
  if (toDate < fromDate) return res.status(400).json({ error: "toDate must be >= fromDate" });

  const explicit = body.holidays.map((h) => ({
    holidayDate: new Date(h.holidayDate),
    description: h.description,
    isWeeklyOff: h.isWeeklyOff,
  }));
  let weeklyOffs: { holidayDate: Date; description: string; isWeeklyOff: boolean }[] = [];
  if (body.weeklyOffDay != null && body.weeklyOffDay !== "") {
    const dow = parseInt(body.weeklyOffDay, 10);
    if (dow >= 0 && dow <= 6) {
      const auto = autoWeeklyOffs(fromDate, toDate, dow);
      const explicitDates = new Set(
        explicit.map((h) => h.holidayDate.toISOString().slice(0, 10)),
      );
      weeklyOffs = auto
        .filter((a) => !explicitDates.has(a.holidayDate.toISOString().slice(0, 10)))
        .map((a) => ({ ...a, isWeeklyOff: true }));
    }
  }

  try {
    const row = await prisma.holidayList.create({
      data: {
        tenantId,
        name: body.name,
        fromDate,
        toDate,
        weeklyOffDay: body.weeklyOffDay ?? null,
        holidays: {
          create: [...explicit, ...weeklyOffs].sort(
            (a, b) => a.holidayDate.getTime() - b.holidayDate.getTime(),
          ),
        },
      },
      include: { holidays: { orderBy: { holidayDate: "asc" } } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Name already exists" });
    throw e;
  }
});

holidayListRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.holidayList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = parsed.data;

  const row = await prisma.$transaction(async (tx) => {
    if (body.holidays !== undefined) {
      await tx.holiday.deleteMany({ where: { holidayListId: existing.id } });
    }
    return tx.holidayList.update({
      where: { id: existing.id },
      data: {
        name: body.name ?? existing.name,
        fromDate: body.fromDate ? new Date(body.fromDate) : existing.fromDate,
        toDate: body.toDate ? new Date(body.toDate) : existing.toDate,
        weeklyOffDay: body.weeklyOffDay ?? existing.weeklyOffDay,
        holidays: body.holidays
          ? {
              create: body.holidays.map((h) => ({
                holidayDate: new Date(h.holidayDate),
                description: h.description,
                isWeeklyOff: h.isWeeklyOff,
              })),
            }
          : undefined,
      },
      include: { holidays: { orderBy: { holidayDate: "asc" } } },
    });
  });
  res.json(row);
});

holidayListRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.holidayList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.holidayList.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Set as tenant default.
holidayListRouter.post("/:id/set-default", p.write, async (req, res) => {
  const existing = await prisma.holidayList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.tenant.update({
    where: { id: req.auth!.tenantId },
    data: { defaultHolidayListId: existing.id },
  });
  res.json({ ok: true, defaultHolidayListId: existing.id });
});
