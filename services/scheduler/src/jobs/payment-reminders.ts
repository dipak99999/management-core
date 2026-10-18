// Payment reminders tick — walks Submitted SalesInvoices with
// outstandingAmt > 0. For invoices WITHOUT a payment schedule, we key off
// SI.dueDate (single-payment classic flow). For invoices WITH a schedule
// (InvoicePaymentSchedule rows), we walk each unpaid row separately —
// per-installment reminders catch first-installment slippage without
// waiting for the whole invoice's latest-installment dueDate to lapse.
//
// Idempotency: pickReminderKind's dedup key is (kind × sent-list). For
// per-installment reminders, that sent-list is filtered by
// paymentScheduleId so kinds tracked on installment A don't gate
// installment B's reminders.
//
// Same 24h same-kind belt-and-braces guard as before, scoped to the same
// (invoice, [installment]) unit.

import {
  prisma,
  daysBetween,
  parseReminderThresholds,
  pickReminderKind,
  sendPaymentReminder,
  type ReminderKind,
} from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("payment-reminders");

export interface RemindersTickResult {
  invoicesChecked: number;
  remindersSent: number;
  errors: number;
}

// Hard cap so a runaway tick doesn't blast out thousands of emails after
// a long scheduler outage. Applies across BOTH invoice-level and
// installment-level reminders — the two paths share this budget.
const MAX_SENDS_PER_TICK = 500;

export async function runPaymentRemindersTick(): Promise<RemindersTickResult> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      reminderThresholds: true,
    },
  });

  let invoicesChecked = 0;
  let remindersSent = 0;
  let errors = 0;

  for (const tenant of tenants) {
    const thresholds = parseReminderThresholds(tenant.reminderThresholds);
    if (!thresholds) continue;

    // Overdue Submitted invoices with outstanding balance. `dueDate` may
    // be the latest-installment date (per module 17) — for scheduled
    // invoices we ignore SI.dueDate and iterate rows directly; the
    // outer filter here just narrows to invoices we might have work on.
    const overdue = await prisma.salesInvoice.findMany({
      where: {
        tenantId: tenant.id,
        status: "Submitted",
        outstandingAmt: { gt: 0 },
        OR: [
          // Non-scheduled invoices: classic dueDate < today check.
          {
            paymentSchedule: { none: {} },
            dueDate: { lt: today },
          },
          // Scheduled invoices: any row is overdue and not fully paid.
          {
            paymentSchedule: {
              some: { dueDate: { lt: today } },
            },
          },
        ],
      },
      include: {
        customer: { select: { email: true, customerName: true } },
        paymentReminders: {
          select: { kind: true, createdAt: true, paymentScheduleId: true },
        },
        paymentSchedule: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    for (const inv of overdue) {
      invoicesChecked++;
      if (remindersSent >= MAX_SENDS_PER_TICK) break;
      if (!inv.customer.email) continue;

      const hasSchedule = inv.paymentSchedule.length > 0;

      if (!hasSchedule) {
        // Classic invoice-level path (unchanged from module 14).
        if (!inv.dueDate) continue;
        const days = daysBetween(inv.dueDate, today);
        const alreadySent = inv.paymentReminders
          .filter((r) => r.paymentScheduleId == null)
          .map((r) => r.kind as ReminderKind);
        const kind = pickReminderKind(days, thresholds, alreadySent);
        if (!kind) continue;
        const recentSameKind = inv.paymentReminders.find(
          (r) =>
            r.paymentScheduleId == null &&
            r.kind === kind &&
            today.getTime() - new Date(r.createdAt).getTime() < 24 * 60 * 60 * 1000,
        );
        if (recentSameKind) continue;

        try {
          await sendPaymentReminder(prisma, {
            tenantId: tenant.id,
            tenantName: tenant.name,
            invoice: inv,
            kind,
            daysOverdue: days,
            trigger: "Auto",
          });
          remindersSent++;
        } catch (e) {
          errors++;
          log.warn("failed to send reminder", {
            invoice: inv.name,
            tenantId: tenant.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        continue;
      }

      // Scheduled invoice: iterate unpaid, past-due installments. Each
      // row has its OWN reminder state — we filter paymentReminders by
      // paymentScheduleId so kinds from row 1 don't block row 2's fires.
      const totalRows = inv.paymentSchedule.length;
      for (const row of inv.paymentSchedule) {
        if (remindersSent >= MAX_SENDS_PER_TICK) break;
        const rowOutstanding = Number(row.amount) - Number(row.paidAmount);
        if (rowOutstanding <= 0.0001) continue; // installment settled
        const rowDays = daysBetween(row.dueDate, today);
        if (rowDays < 0) continue; // not yet due

        const rowRemindersSent = inv.paymentReminders
          .filter((r) => r.paymentScheduleId === row.id)
          .map((r) => r.kind as ReminderKind);
        const kind = pickReminderKind(rowDays, thresholds, rowRemindersSent);
        if (!kind) continue;

        const recentSameKind = inv.paymentReminders.find(
          (r) =>
            r.paymentScheduleId === row.id &&
            r.kind === kind &&
            today.getTime() - new Date(r.createdAt).getTime() < 24 * 60 * 60 * 1000,
        );
        if (recentSameKind) continue;

        try {
          await sendPaymentReminder(prisma, {
            tenantId: tenant.id,
            tenantName: tenant.name,
            invoice: inv,
            kind,
            daysOverdue: rowDays,
            trigger: "Auto",
            installment: {
              id: row.id,
              outstandingAmt: rowOutstanding,
              label: `Installment ${row.sortOrder + 1} of ${totalRows}`,
            },
          });
          remindersSent++;
        } catch (e) {
          errors++;
          log.warn("failed to send scheduled reminder", {
            invoice: inv.name,
            row: row.sortOrder,
            tenantId: tenant.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    if (remindersSent >= MAX_SENDS_PER_TICK) break;
  }

  return { invoicesChecked, remindersSent, errors };
}
