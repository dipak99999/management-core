import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

const convertSchema = z.object({
  // Item used for the "hours" SI line. User must pick a service Item from
  // their catalog — we don't guess.
  itemId: z.string().min(1),
  // Defaults to today; caller can override for backdating.
  postingDate: z.string().datetime().optional(),
});

export const timesheetRouter = Router();

const p = perms("Timesheet");

const lineSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().optional().nullable(),
  date: z.string().datetime(),
  hours: z.coerce.number().positive(),
  isBillable: z.boolean().default(false),
  billingRate: z.coerce.number().nonnegative().default(0),
  description: z.string().optional().nullable(),
});

const upsertSchema = z.object({
  employeeId: z.string().min(1),
  weekStartDate: z.string().datetime(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
});

function computeTotals(lines: z.infer<typeof lineSchema>[]) {
  let totalHours = new Prisma.Decimal(0);
  let totalBillableHours = new Prisma.Decimal(0);
  let totalBillingAmount = new Prisma.Decimal(0);
  for (const l of lines) {
    const h = new Prisma.Decimal(l.hours);
    totalHours = totalHours.add(h);
    if (l.isBillable) {
      totalBillableHours = totalBillableHours.add(h);
      totalBillingAmount = totalBillingAmount.add(h.mul(l.billingRate));
    }
  }
  return { totalHours, totalBillableHours, totalBillingAmount };
}

timesheetRouter.get("/", p.read, async (req, res) => {
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.timesheet.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { weekStartDate: "desc" },
  });
  res.json(rows);
});

timesheetRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.timesheet.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: true,
      lines: {
        include: {
          project: { select: { id: true, name: true, projectName: true } },
          task: { select: { id: true, subject: true } },
        },
        orderBy: { date: "asc" },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

async function validateLines(
  tenantId: string,
  lines: z.infer<typeof lineSchema>[],
): Promise<string | null> {
  const projectIds = [...new Set(lines.map((l) => l.projectId))];
  const taskIds = [...new Set(lines.map((l) => l.taskId).filter((t): t is string => !!t))];
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, tenantId },
    select: { id: true },
  });
  if (projects.length !== projectIds.length) return "One or more projects not found";
  if (taskIds.length > 0) {
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds }, tenantId },
      select: { id: true, projectId: true },
    });
    if (tasks.length !== taskIds.length) return "One or more tasks not found";
    const projById = new Set(projectIds);
    for (const t of tasks) {
      if (!projById.has(t.projectId))
        return `Task ${t.id} does not belong to any of the specified projects`;
    }
  }
  return null;
}

timesheetRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });

  const err = await validateLines(tenantId, parsed.data.lines);
  if (err) return res.status(400).json({ error: err });

  const totals = computeTotals(parsed.data.lines);
  const name = await nextName(prisma, tenantId, "TS-");

  const row = await prisma.timesheet.create({
    data: {
      tenantId,
      name,
      employeeId: parsed.data.employeeId,
      weekStartDate: new Date(parsed.data.weekStartDate),
      totalHours: totals.totalHours,
      totalBillableHours: totals.totalBillableHours,
      totalBillingAmount: totals.totalBillingAmount,
      status: "Draft",
      notes: parsed.data.notes ?? null,
      lines: {
        create: parsed.data.lines.map((l) => ({
          projectId: l.projectId,
          taskId: l.taskId ?? null,
          date: new Date(l.date),
          hours: l.hours,
          isBillable: l.isBillable,
          billingRate: l.billingRate,
          billingAmount: l.isBillable ? l.hours * l.billingRate : 0,
          description: l.description ?? null,
        })),
      },
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      lines: true,
    },
  });
  res.status(201).json(row);
});

// Bulk-replace lines. Only allowed while Draft.
timesheetRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.timesheet.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit timesheet in status ${existing.status}` });

  const err = await validateLines(tenantId, parsed.data.lines);
  if (err) return res.status(400).json({ error: err });

  const totals = computeTotals(parsed.data.lines);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.timesheetLine.deleteMany({ where: { timesheetId: existing.id } });
    return tx.timesheet.update({
      where: { id: existing.id },
      data: {
        employeeId: parsed.data.employeeId,
        weekStartDate: new Date(parsed.data.weekStartDate),
        totalHours: totals.totalHours,
        totalBillableHours: totals.totalBillableHours,
        totalBillingAmount: totals.totalBillingAmount,
        notes: parsed.data.notes ?? null,
        lines: {
          create: parsed.data.lines.map((l) => ({
            projectId: l.projectId,
            taskId: l.taskId ?? null,
            date: new Date(l.date),
            hours: l.hours,
            isBillable: l.isBillable,
            billingRate: l.billingRate,
            billingAmount: l.isBillable ? l.hours * l.billingRate : 0,
            description: l.description ?? null,
          })),
        },
      },
      include: { lines: true },
    });
  });
  res.json(updated);
});

// Submit: locks the timesheet and rolls up per-task hours into Task.actualHours.
// Grouped by (taskId, hours) so we do one update per task with the sum.
timesheetRouter.post("/:id/submit", p.submit, idempotency("POST /timesheets/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const ts = await tx.timesheet.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lines: true },
      });
      if (!ts) throw new Error("Not found");
      if (ts.status !== "Draft") throw new Error(`Cannot submit in status ${ts.status}`);

      const perTask = new Map<string, number>();
      for (const l of ts.lines) {
        if (!l.taskId) continue;
        perTask.set(l.taskId, (perTask.get(l.taskId) ?? 0) + Number(l.hours));
      }
      for (const [taskId, hours] of perTask) {
        await tx.task.update({
          where: { id: taskId },
          data: { actualHours: { increment: new Prisma.Decimal(hours) } },
        });
      }

      return tx.timesheet.update({
        where: { id: ts.id },
        data: { status: "Submitted" },
        include: {
          employee: { select: { id: true, employeeCode: true, employeeName: true } },
          lines: true,
        },
      });
    });
    void publishRealtime(req.auth!.tenantId, "timesheet", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Convert a Submitted timesheet's un-billed billable lines into Draft
// SalesInvoices, one per unique customer. Lines are grouped by (customer,
// project) — each project becomes one SI line with:
//   qty     = sum(hours) across the project's lines on this timesheet
//   amount  = sum(billingAmount)
//   rate    = amount / qty (weighted average)
//   description = "<projectName> — TS-XXXX week starting YYYY-MM-DD"
// Each source TimesheetLine gets `salesInvoiceItemId` set to prevent
// double-billing on subsequent convert calls. The user picks a single Item
// (e.g. "Consulting hours") to attach to all generated SI lines.
timesheetRouter.post(
  "/:id/convert-to-invoice",
  p.submit,
  perms("SalesInvoice").create,
  async (req, res) => {
    const parsed = convertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const tenantId = req.auth!.tenantId;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const ts = await tx.timesheet.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            lines: { include: { project: true } },
            employee: { select: { employeeName: true, employeeCode: true } },
          },
        });
        if (!ts) throw new Error("Not found");
        if (ts.status !== "Submitted")
          throw new Error(`Timesheet must be Submitted to invoice (currently ${ts.status})`);

        // Validate item exists in tenant.
        const item = await tx.item.findFirst({
          where: { id: parsed.data.itemId, tenantId },
        });
        if (!item) throw new Error("Invalid item");

        // Filter: billable + not yet invoiced.
        const billable = ts.lines.filter(
          (l) => l.isBillable && !l.salesInvoiceItemId,
        );
        if (billable.length === 0) throw new Error("Nothing to invoice — no unbilled billable lines");

        // Every billable line's project must have a customerId.
        const projectsMissingCustomer = billable
          .map((l) => l.project)
          .filter((p) => !p.customerId);
        if (projectsMissingCustomer.length > 0) {
          const names = [...new Set(projectsMissingCustomer.map((p) => p.projectName))].join(", ");
          throw new Error(
            `Cannot invoice — these projects have no customer set: ${names}`,
          );
        }

        // Group lines by customerId → projectId → [lines].
        const byCustomer = new Map<string, Map<string, typeof billable>>();
        for (const l of billable) {
          const cid = l.project.customerId!;
          if (!byCustomer.has(cid)) byCustomer.set(cid, new Map());
          const byProject = byCustomer.get(cid)!;
          if (!byProject.has(l.projectId)) byProject.set(l.projectId, []);
          byProject.get(l.projectId)!.push(l);
        }

        const postingDate = parsed.data.postingDate
          ? new Date(parsed.data.postingDate)
          : new Date();
        const weekStr = ts.weekStartDate.toISOString().slice(0, 10);
        const createdInvoices: { id: string; name: string; customerId: string }[] = [];

        for (const [customerId, byProject] of byCustomer) {
          const siLineData: {
            itemId: string;
            qty: Prisma.Decimal;
            rate: Prisma.Decimal;
            amount: Prisma.Decimal;
            description: string;
            _srcLineIds: string[]; // stripped before create; used post-create
          }[] = [];

          let siTotal = new Prisma.Decimal(0);
          for (const [, lines] of byProject) {
            const hours = lines.reduce((s, l) => s + Number(l.hours), 0);
            const amount = lines.reduce((s, l) => s + Number(l.billingAmount), 0);
            const rate = hours > 0 ? amount / hours : 0;
            const proj = lines[0].project;
            siLineData.push({
              itemId: parsed.data.itemId,
              qty: new Prisma.Decimal(hours),
              rate: new Prisma.Decimal(rate),
              amount: new Prisma.Decimal(amount),
              description: `${proj.projectName} — ${ts.name} week of ${weekStr}`,
              _srcLineIds: lines.map((l) => l.id),
            });
            siTotal = siTotal.add(new Prisma.Decimal(amount));
          }

          const siName = await nextName(tx, tenantId, "SINV-");
          const si = await tx.salesInvoice.create({
            data: {
              tenantId,
              name: siName,
              customerId,
              postingDate,
              currency: "INR",
              netTotal: siTotal,
              totalTaxes: new Prisma.Decimal(0),
              grandTotal: siTotal,
              outstandingAmt: siTotal,
              status: "Draft",
              remarks: `Auto-generated from timesheet ${ts.name} (${ts.employee.employeeName})`,
              items: {
                create: siLineData.map(({ _srcLineIds, ...rest }) => rest),
              },
            },
            include: { items: true },
          });

          // Back-link each source TimesheetLine to its new SIItem. Match by
          // description (unique per project within this SI).
          for (const data of siLineData) {
            const created = si.items.find((it) => it.description === data.description);
            if (!created) continue;
            await tx.timesheetLine.updateMany({
              where: { id: { in: data._srcLineIds } },
              data: { salesInvoiceItemId: created.id },
            });
          }

          createdInvoices.push({ id: si.id, name: si.name, customerId });
        }

        return { invoices: createdInvoices };
      });
      res.status(201).json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
    }
  },
);

// Cancel: reverses the per-task hours rollup if the timesheet was submitted.
timesheetRouter.post("/:id/cancel", p.cancel, idempotency("POST /timesheets/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const ts = await tx.timesheet.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lines: true },
      });
      if (!ts) throw new Error("Not found");
      if (ts.status === "Cancelled") throw new Error("Already cancelled");

      if (ts.status === "Submitted") {
        const perTask = new Map<string, number>();
        for (const l of ts.lines) {
          if (!l.taskId) continue;
          perTask.set(l.taskId, (perTask.get(l.taskId) ?? 0) + Number(l.hours));
        }
        for (const [taskId, hours] of perTask) {
          await tx.task.update({
            where: { id: taskId },
            data: { actualHours: { decrement: new Prisma.Decimal(hours) } },
          });
        }
      }

      return tx.timesheet.update({
        where: { id: ts.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(req.auth!.tenantId, "timesheet", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// ── Start/stop timer (Toggl / Harvest style) ─────────────────────────
// One active timer per user. On /stop we roll elapsed minutes into a
// TimesheetLine in the user's Draft weekly Timesheet, auto-creating
// the parent Timesheet if none exists for the current week.

const startTimerSchema = z.object({
  employeeId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().optional().nullable(),
  isBillable: z.boolean().default(false),
  billingRate: z.coerce.number().nonnegative().default(0),
  description: z.string().optional().nullable(),
});

function mondayOfWeekUtc(d: Date): Date {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // Monday-based
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
}

timesheetRouter.get("/timer/current", p.read, async (req, res) => {
  const row = await prisma.runningTimer.findUnique({
    where: { userId: req.auth!.userId },
    include: {
      project: { select: { projectName: true } },
      task: { select: { subject: true } },
    },
  });
  res.json({ timer: row });
});

timesheetRouter.post("/timer/start", p.write, async (req, res) => {
  const parsed = startTimerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const [proj, task, emp, existing] = await Promise.all([
    prisma.project.findFirst({ where: { id: b.projectId, tenantId }, select: { id: true } }),
    b.taskId
      ? prisma.task.findFirst({ where: { id: b.taskId, tenantId }, select: { id: true } })
      : Promise.resolve(null),
    prisma.employee.findFirst({ where: { id: b.employeeId, tenantId }, select: { id: true } }),
    prisma.runningTimer.findUnique({ where: { userId: req.auth!.userId } }),
  ]);
  if (!proj) return res.status(400).json({ error: "project not found in tenant" });
  if (b.taskId && !task) return res.status(400).json({ error: "task not found in tenant" });
  if (!emp) return res.status(400).json({ error: "employee not found in tenant" });
  if (existing) return res.status(409).json({ error: "Timer already running — stop it first" });

  const row = await prisma.runningTimer.create({
    data: {
      tenantId,
      userId: req.auth!.userId,
      employeeId: b.employeeId,
      projectId: b.projectId,
      taskId: b.taskId ?? null,
      isBillable: b.isBillable,
      billingRate: new Prisma.Decimal(b.billingRate),
      description: b.description ?? null,
    },
  });
  res.status(201).json({ timer: row });
});

timesheetRouter.post("/timer/stop", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const timer = await prisma.runningTimer.findUnique({
    where: { userId: req.auth!.userId },
  });
  if (!timer) return res.status(404).json({ error: "No timer running" });

  const now = new Date();
  const elapsedMs = now.getTime() - timer.startedAt.getTime();
  const hours = Math.max(0, elapsedMs / (1000 * 60 * 60));
  const hoursRounded = Math.round(hours * 100) / 100;
  const weekStart = mondayOfWeekUtc(now);

  const result = await prisma.$transaction(async (tx) => {
    let ts = await tx.timesheet.findFirst({
      where: {
        tenantId,
        employeeId: timer.employeeId,
        weekStartDate: weekStart,
        status: "Draft",
      },
    });
    if (!ts) {
      const name = await nextName(tx, tenantId, "TS-");
      ts = await tx.timesheet.create({
        data: {
          tenantId,
          name,
          employeeId: timer.employeeId,
          weekStartDate: weekStart,
          status: "Draft",
        },
      });
    }
    const rate = Number(timer.billingRate);
    const billingAmount = timer.isBillable ? hoursRounded * rate : 0;
    const line = await tx.timesheetLine.create({
      data: {
        timesheetId: ts.id,
        projectId: timer.projectId,
        taskId: timer.taskId,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        hours: new Prisma.Decimal(hoursRounded),
        isBillable: timer.isBillable,
        billingRate: new Prisma.Decimal(rate),
        billingAmount: new Prisma.Decimal(billingAmount),
        description: timer.description,
      },
    });
    await tx.timesheet.update({
      where: { id: ts.id },
      data: {
        totalHours: { increment: new Prisma.Decimal(hoursRounded) },
        totalBillableHours: timer.isBillable
          ? { increment: new Prisma.Decimal(hoursRounded) }
          : undefined,
        totalBillingAmount: timer.isBillable
          ? { increment: new Prisma.Decimal(billingAmount) }
          : undefined,
      },
    });
    await tx.runningTimer.delete({ where: { id: timer.id } });
    return { timesheetId: ts.id, lineId: line.id, hours: hoursRounded };
  });
  res.json(result);
});

timesheetRouter.post("/timer/discard", p.write, async (req, res) => {
  const existing = await prisma.runningTimer.findUnique({
    where: { userId: req.auth!.userId },
  });
  if (!existing) return res.status(404).json({ error: "No timer running" });
  await prisma.runningTimer.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});
