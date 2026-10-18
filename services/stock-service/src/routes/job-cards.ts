import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  cancelGLEntries,
  nextName,
  postGLEntries,
  prisma,
} from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

export const jobCardRouter = Router();

const p = perms("JobCard");

const createSchema = z.object({
  workOrderId: z.string().min(1),
  operationId: z.string().min(1),
  // C12: optional Employee FK, plus a free-text fallback for legacy /
  // operators who aren't in the Employee master.
  employeeId: z.string().optional().nullable(),
  employeeName: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

jobCardRouter.get("/", p.read, async (req, res) => {
  const workOrderId = typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.jobCard.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(workOrderId ? { workOrderId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      workOrder: { select: { id: true, name: true, status: true } },
      operation: { select: { id: true, operationName: true } },
      workstation: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

jobCardRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.jobCard.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      workOrder: true,
      operation: true,
      workstation: true,
      employee: { select: { employeeCode: true, employeeName: true } },
      timeLogs: { orderBy: { fromTime: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Create a Job Card against a specific WorkOrderOperation. Workstation is
// snapshotted from the operation so the card can't drift from the WO's routing.
jobCardRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const wo = await prisma.workOrder.findFirst({
    where: { id: parsed.data.workOrderId, tenantId },
  });
  if (!wo) return res.status(400).json({ error: "Invalid work order" });
  if (wo.status === "Cancelled")
    return res.status(400).json({ error: "Cannot add job cards to a cancelled WO" });

  const op = await prisma.workOrderOperation.findFirst({
    where: { id: parsed.data.operationId, workOrderId: wo.id },
  });
  if (!op)
    return res
      .status(400)
      .json({ error: "Operation does not belong to the specified work order" });

  // C12: validate employeeId if supplied.
  if (parsed.data.employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: parsed.data.employeeId, tenantId },
    });
    if (!emp) return res.status(400).json({ error: "Invalid employee" });
  }

  const name = await nextName(prisma, tenantId, "JC-");
  const row = await prisma.jobCard.create({
    data: {
      tenantId,
      name,
      workOrderId: wo.id,
      operationId: op.id,
      workstationId: op.workstationId,
      employeeId: parsed.data.employeeId ?? null,
      employeeName: parsed.data.employeeName ?? null,
      status: "Open",
      remarks: parsed.data.remarks ?? null,
    },
    include: {
      workOrder: { select: { id: true, name: true, status: true } },
      operation: { select: { id: true, operationName: true } },
      workstation: { select: { id: true, name: true } },
    },
  });
  res.status(201).json(row);
});

// Start: stamps startedAt = now (or provided override), sets status InProgress.
const startSchema = z.object({
  startedAt: z.string().datetime().optional(),
});

jobCardRouter.post("/:id/start", p.submit, async (req, res) => {
  const parsed = startSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.jobCard.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw new Error("Not found");
      if (existing.status !== "Open" && existing.status !== "Paused")
        throw new Error(`Cannot start in status ${existing.status}`);

      const startAt = parsed.data.startedAt
        ? new Date(parsed.data.startedAt)
        : new Date();
      // C12: open a new TimeLog for this session. Also stamp startedAt on
      // first-ever start so historical queries have a "when did work begin".
      await tx.jobCardTimeLog.create({
        data: {
          jobCardId: existing.id,
          fromTime: startAt,
        },
      });
      const row = await tx.jobCard.update({
        where: { id: existing.id },
        data: {
          status: "InProgress",
          startedAt: existing.startedAt ?? startAt,
        },
        include: {
          workOrder: { select: { id: true, name: true } },
          operation: { select: { id: true, operationName: true } },
        },
      });

      // Roll up: mark the operation InProgress if it wasn't already.
      await tx.workOrderOperation.updateMany({
        where: { id: existing.operationId, status: "Pending" },
        data: { status: "InProgress" },
      });
      return row;
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// C12: pause — close the current TimeLog and flip card status to Paused.
// `at` overrides now (useful for after-the-fact corrections).
const pauseSchema = z.object({ at: z.string().datetime().optional() });
jobCardRouter.post("/:id/pause", p.submit, async (req, res) => {
  const parsed = pauseSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const card = await tx.jobCard.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!card) throw new Error("Not found");
      if (card.status !== "InProgress")
        throw new Error(`Cannot pause in status ${card.status}`);

      const openLog = await tx.jobCardTimeLog.findFirst({
        where: { jobCardId: card.id, toTime: null },
        orderBy: { fromTime: "desc" },
      });
      if (!openLog)
        throw new Error("No open time log for this card — cannot pause");
      const pauseAt = parsed.data.at ? new Date(parsed.data.at) : new Date();
      const mins = Math.max(
        0,
        (pauseAt.getTime() - openLog.fromTime.getTime()) / 60000,
      );
      await tx.jobCardTimeLog.update({
        where: { id: openLog.id },
        data: {
          toTime: pauseAt,
          minutes: new Prisma.Decimal(mins.toFixed(2)),
        },
      });
      return tx.jobCard.update({
        where: { id: card.id },
        data: {
          status: "Paused",
          // Update the card-level totalTimeMins snapshot on every pause so
          // list views don't need a JOIN.
          totalTimeMins: {
            increment: new Prisma.Decimal(mins.toFixed(2)),
          },
        },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Complete: caller passes quantity produced + either completedAt or explicit
// totalTimeMins. If completedAt is provided and startedAt is set, we compute
// totalTimeMins from the delta; otherwise use the explicit value. On complete
// we increment WorkOrderOperation.completedQty + actualTimeMins, and if that
// operation's completedQty reaches WO.qty we flip it to Completed.
const completeSchema = z.object({
  completedAt: z.string().datetime().optional(),
  totalTimeMins: z.coerce.number().nonnegative().optional(),
  quantity: z.coerce.number().positive(),
});

jobCardRouter.post("/:id/complete", p.submit, async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const card = await tx.jobCard.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!card) throw new Error("Not found");
      if (
        card.status !== "Open" &&
        card.status !== "InProgress" &&
        card.status !== "Paused"
      )
        throw new Error(`Cannot complete in status ${card.status}`);

      const completedAt = parsed.data.completedAt
        ? new Date(parsed.data.completedAt)
        : new Date();

      // C12: close any open TimeLog first + sum every log for accurate total.
      const openLog = await tx.jobCardTimeLog.findFirst({
        where: { jobCardId: card.id, toTime: null },
      });
      if (openLog) {
        const mins = Math.max(
          0,
          (completedAt.getTime() - openLog.fromTime.getTime()) / 60000,
        );
        await tx.jobCardTimeLog.update({
          where: { id: openLog.id },
          data: {
            toTime: completedAt,
            minutes: new Prisma.Decimal(mins.toFixed(2)),
          },
        });
      }
      // Recompute the card's total from all logs (source of truth).
      const logs = await tx.jobCardTimeLog.findMany({
        where: { jobCardId: card.id },
        select: { minutes: true },
      });
      let totalTimeMins = logs.reduce((s, l) => s + Number(l.minutes), 0);
      // Fallback to caller-supplied value when there were no logs at all
      // (e.g. card completed without ever being started).
      if (totalTimeMins === 0 && parsed.data.totalTimeMins !== undefined) {
        totalTimeMins = parsed.data.totalTimeMins;
      }

      // Delta vs the currently-snapshotted card total is what we roll up to
      // the operation (previous pauses have already been rolled into it).
      const deltaMins = totalTimeMins - Number(card.totalTimeMins);

      const updated = await tx.jobCard.update({
        where: { id: card.id },
        data: {
          status: "Completed",
          completedAt,
          totalTimeMins: new Prisma.Decimal(totalTimeMins.toFixed(2)),
          quantity: new Prisma.Decimal(parsed.data.quantity),
        },
      });

      // Roll up: bump the operation's completed qty + actual mins.
      await tx.workOrderOperation.update({
        where: { id: card.operationId },
        data: {
          completedQty: { increment: new Prisma.Decimal(parsed.data.quantity) },
          actualTimeMins: {
            increment: new Prisma.Decimal(Math.max(0, deltaMins).toFixed(2)),
          },
        },
      });

      // If this operation is now fully done for the WO qty, flip to Completed.
      const op = await tx.workOrderOperation.findUnique({
        where: { id: card.operationId },
        include: { workOrder: { select: { id: true, qty: true, status: true } } },
      });
      if (op && Number(op.completedQty) >= Number(op.workOrder.qty) - 1e-6) {
        await tx.workOrderOperation.update({
          where: { id: op.id },
          data: { status: "Completed" },
        });
        // C12: WO auto-close — if every operation on the WO is now Completed,
        // flip the WO status too. Doesn't touch `producedQty` (that's tracked
        // by the manufacturing SLE flow, not JC rollup).
        const remainingOps = await tx.workOrderOperation.count({
          where: {
            workOrderId: op.workOrder.id,
            status: { not: "Completed" },
          },
        });
        if (remainingOps === 0 && op.workOrder.status !== "Completed") {
          await tx.workOrder.update({
            where: { id: op.workOrder.id },
            data: { status: "Completed" },
          });
        }
      }

      // C12b: Labor cost posting. If the card has a linked Employee with a
      // baseSalary set, compute labor cost as (totalTimeMins / 60) * hourly
      // rate. Hourly rate = baseSalary / 173.33 (industry-standard avg
      // monthly billable hours). Posts DR SalaryExpense / CR Employee
      // Payable so the cost hits the P&L and creates a payable in the
      // employee's name. Skipped when employee is null, baseSalary is 0, or
      // the tenant hasn't seeded the required accounts.
      if (card.employeeId && totalTimeMins > 0) {
        const emp = await tx.employee.findFirst({
          where: { id: card.employeeId, tenantId },
          select: { baseSalary: true },
        });
        const baseSalary = emp ? Number(emp.baseSalary) : 0;
        if (baseSalary > 0) {
          const tenant = await tx.tenant.findUnique({
            where: { id: tenantId },
            select: {
              defaultSalaryExpenseAccountId: true,
              defaultEmployeePayableAccountId: true,
            },
          });
          if (
            tenant?.defaultSalaryExpenseAccountId &&
            tenant?.defaultEmployeePayableAccountId
          ) {
            const hourlyRate = baseSalary / 173.33;
            const laborCost =
              Math.round((totalTimeMins / 60) * hourlyRate * 100) / 100;
            if (laborCost > 0) {
              await postGLEntries(tx, {
                tenantId,
                postingDate: completedAt,
                voucherType: "JobCard",
                voucherId: card.id,
                voucherName: card.name,
                lines: [
                  {
                    accountId: tenant.defaultSalaryExpenseAccountId,
                    debit: laborCost,
                    credit: 0,
                  },
                  {
                    accountId: tenant.defaultEmployeePayableAccountId,
                    debit: 0,
                    credit: laborCost,
                    partyType: "Employee",
                    partyId: card.employeeId,
                  },
                ],
              });
            }
          }
        }
      }

      return updated;
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Cancel: reverses the completed-qty + actualTimeMins rollup if the card was
// Completed. Open/InProgress cards just flip to Cancelled with no rollback.
jobCardRouter.post("/:id/cancel", p.cancel, idempotency("POST /job-cards/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const card = await tx.jobCard.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!card) throw new Error("Not found");
      if (card.status === "Cancelled") throw new Error("Already cancelled");

      if (card.status === "Completed") {
        const op = await tx.workOrderOperation.update({
          where: { id: card.operationId },
          data: {
            completedQty: { decrement: card.quantity },
            actualTimeMins: { decrement: card.totalTimeMins },
            // If it was Completed via this card being the tipping point, roll it back.
            status: "InProgress",
          },
          include: { workOrder: { select: { id: true, status: true } } },
        });
        // C12: if the parent WO had auto-flipped to Completed, roll it back
        // now that this operation is no longer complete.
        if (op.workOrder.status === "Completed") {
          await tx.workOrder.update({
            where: { id: op.workOrder.id },
            data: { status: "In Process" },
          });
        }
        // C12b: reverse any labor-cost GL posted at complete time. Uses the
        // standard cancel pattern (mark existing entries isCancelled=true
        // rather than deleting — audit trail).
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "JobCard",
          voucherId: card.id,
        });
      }

      return tx.jobCard.update({
        where: { id: card.id },
        data: { status: "Cancelled" },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
