// Payment reminders — pure helpers for the scheduler job that emails
// customers about overdue invoices. Kept dependency-free so vitest can
// exercise the tricky bits (kind-escalation, dedup, threshold gaps)
// without a live DB.

export type ReminderKind = "First" | "Second" | "Final";

export interface ReminderThresholds {
  first?: number;   // days after dueDate
  second?: number;
  final?: number;
}

/**
 * Parse a Tenant.reminderThresholds JSON blob into a well-typed object.
 * Missing / malformed → null (interpreted as "reminders disabled for this
 * tenant"). Non-positive numbers dropped.
 */
export function parseReminderThresholds(raw: unknown): ReminderThresholds | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  };
  const out: ReminderThresholds = {
    first: num(r.first),
    second: num(r.second),
    final: num(r.final),
  };
  const anySet = out.first != null || out.second != null || out.final != null;
  return anySet ? out : null;
}

/**
 * Given days-overdue + configured thresholds + the kinds already sent
 * for this invoice, pick which reminder to fire next.
 *
 * Rules:
 *   - Kinds fire in order First → Second → Final.
 *   - A kind fires only when days-overdue ≥ its threshold.
 *   - A kind already sent (in `alreadySent`) never fires again.
 *   - **Once Final has been sent, no further reminders fire.** Sending a
 *     "friendly nudge" after an "escalating to collections" note would
 *     be a bad customer experience.
 *   - If two thresholds have both been crossed on the same tick (e.g. a
 *     90-day-old invoice on first-run), the HIGHEST unfired kind wins —
 *     we don't spam the customer with three catch-up emails.
 *   - Returns null when nothing is due.
 *
 * Dedup by "kind already sent" is a runtime concern, not a time-window
 * concern — the caller checks the DB. The 24h same-kind rule lives in
 * the scheduler job (belt-and-braces against clock drift on restart).
 */
export function pickReminderKind(
  daysOverdue: number,
  thresholds: ReminderThresholds,
  alreadySent: ReminderKind[],
): ReminderKind | null {
  if (daysOverdue < 0) return null;
  const sent = new Set(alreadySent);
  // Terminal state: Final has been sent → no more reminders, regardless
  // of how far past-due the invoice sails.
  if (sent.has("Final")) return null;
  // Iterate high → low so the strongest crossable-and-unfired wins.
  const order: { kind: ReminderKind; threshold: number | undefined }[] = [
    { kind: "Final", threshold: thresholds.final },
    { kind: "Second", threshold: thresholds.second },
    { kind: "First", threshold: thresholds.first },
  ];
  for (const { kind, threshold } of order) {
    if (threshold == null) continue;
    if (sent.has(kind)) continue;
    if (daysOverdue >= threshold) return kind;
  }
  return null;
}

/**
 * Compose the email subject line — kept in the pure helper so tests can
 * pin the exact text (some tenants want white-labelled subjects, but
 * "Reminder: <invoice #> · <N days overdue>" is a sensible default).
 */
export function composeReminderSubject(input: {
  kind: ReminderKind;
  invoiceName: string;
  daysOverdue: number;
  tenantName?: string | null;
}): string {
  const urgency =
    input.kind === "Final"
      ? "Final reminder"
      : input.kind === "Second"
        ? "Second reminder"
        : "Payment reminder";
  const days = `${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} overdue`;
  const prefix = input.tenantName ? `${input.tenantName} · ` : "";
  return `${prefix}${urgency}: ${input.invoiceName} — ${days}`;
}

/**
 * Days between two dates, ignoring time-of-day. `to - from` in whole days,
 * rounded down. Callers pass (dueDate, today). Negative when dueDate is
 * still in the future (invoice not yet overdue).
 */
export function daysBetween(from: Date, to: Date): number {
  const a = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const b = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Simple plain-HTML body. Deliberately un-templated — tenants that want
 * branded copy can flip to EmailTemplate lookup later. Kept here so the
 * scheduler tick + the manual "Send reminder" route emit identical mail.
 */
export function composeReminderBody(input: {
  kind: ReminderKind;
  invoiceName: string;
  customerName: string;
  daysOverdue: number;
  outstandingAmt: number;
  tenantName: string;
}): string {
  const opening =
    input.kind === "Final"
      ? "This is a final reminder"
      : input.kind === "Second"
        ? "This is a follow-up reminder"
        : "This is a friendly reminder";
  const amount = input.outstandingAmt.toFixed(2);
  return `
    <p>Hi ${escapeHtml(input.customerName)},</p>
    <p>${opening} that invoice <strong>${escapeHtml(input.invoiceName)}</strong>
    is now <strong>${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"}</strong>
    past its due date. The outstanding balance is <strong>${amount}</strong>.</p>
    <p>Please arrange payment at your earliest convenience. If you've
    already paid, please disregard this note.</p>
    <p>Thanks,<br/>${escapeHtml(input.tenantName)}</p>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[ch]!,
  );
}

// -----------------------------------------------------------------------
// Persistence helper — one place both the scheduler tick and the manual
// "Send reminder" route write from, so audit logging + outbox emission
// stay consistent.

import { PrismaClient, Prisma } from "@prisma/client";

export interface SendReminderInput {
  tenantId: string;
  tenantName: string;
  invoice: {
    id: string;
    name: string;
    outstandingAmt: Prisma.Decimal | number | string;
    customer: { email: string | null; customerName: string };
  };
  kind: ReminderKind;
  daysOverdue: number;
  /** "Auto" = scheduler tick; "Manual" = staff click. Recorded on PaymentReminder.trigger. */
  trigger: "Auto" | "Manual";
  /**
   * D10: when the invoice has an InvoicePaymentSchedule and this reminder
   * targets a specific installment, pass the schedule row's info here.
   * The subject/body then reference the installment's amount, not the
   * whole invoice, and the PaymentReminder audit row carries the FK so
   * subsequent ticks dedup at the (row × kind) level rather than
   * (invoice × kind).
   */
  installment?: {
    id: string;                                         // InvoicePaymentSchedule.id
    outstandingAmt: Prisma.Decimal | number | string;   // amount - paidAmount
    label?: string | null;                              // e.g. "Installment 2 of 3"
  };
}

/**
 * Emit a payment reminder — creates a PaymentReminder audit row + an
 * EmailMessage outbox row in one transaction. The mail-provider tick
 * delivers the EmailMessage separately.
 */
export async function sendPaymentReminder(
  prisma: PrismaClient,
  input: SendReminderInput,
): Promise<{ paymentReminderId: string; emailMessageId: string }> {
  const toEmail = input.invoice.customer.email;
  if (!toEmail) throw new Error("Customer has no email on file");

  // For per-installment reminders, use the row's outstanding + a subject
  // label that clarifies WHICH installment (so a customer with 3 tranches
  // doesn't wonder which one you're referring to). The invoice-level
  // path is untouched — installment is optional.
  const installmentSuffix = input.installment?.label
    ? ` (${input.installment.label})`
    : "";
  const invoiceNameWithSuffix = `${input.invoice.name}${installmentSuffix}`;
  const outstandingForRender = input.installment
    ? input.installment.outstandingAmt
    : input.invoice.outstandingAmt;

  const subject = composeReminderSubject({
    kind: input.kind,
    invoiceName: invoiceNameWithSuffix,
    daysOverdue: input.daysOverdue,
    tenantName: input.tenantName,
  });
  const body = composeReminderBody({
    kind: input.kind,
    invoiceName: invoiceNameWithSuffix,
    customerName: input.invoice.customer.customerName,
    daysOverdue: input.daysOverdue,
    outstandingAmt: Number(outstandingForRender),
    tenantName: input.tenantName,
  });

  // Both writes in one tx so we never end up with an email-sent-but-not-
  // logged (which would cause the next tick to duplicate the reminder).
  return prisma.$transaction(async (tx) => {
    const rem = await tx.paymentReminder.create({
      data: {
        tenantId: input.tenantId,
        salesInvoiceId: input.invoice.id,
        paymentScheduleId: input.installment?.id ?? null,
        kind: input.kind,
        daysOverdue: input.daysOverdue,
        outstandingAmt: outstandingForRender as never,
        toEmail,
        trigger: input.trigger,
      },
    });
    const em = await tx.emailMessage.create({
      data: {
        tenantId: input.tenantId,
        toEmail,
        subject,
        body,
        status: "Pending",
        linkedDoctype: "PaymentReminder",
        linkedId: rem.id,
      },
    });
    return { paymentReminderId: rem.id, emailMessageId: em.id };
  });
}
