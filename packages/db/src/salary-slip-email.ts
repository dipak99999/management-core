// Salary slip email — pure helpers for composing the delivery email an
// employee receives when their pay stub is ready. Called from the
// hr-service /salary-slips/:id/email route (manual staff click) and,
// potentially, from a payroll-entry auto-send hook later.
//
// Same posture as payment-reminders (module 14): plain HTML body,
// deliberately un-templated. Tenants that want branded copy can flip to
// EmailTemplate lookup as a follow-up — the render surface here is a
// stable starting point.

export interface SalarySlipEmailInput {
  slipName: string;
  employeeName: string;
  periodStart: Date;
  periodEnd: Date;
  grossPay: number;
  totalDeduction: number;
  netPay: number;
  currency?: string;                // defaults to "INR" — matches tenant default
  tenantName: string;
  earnings?: Array<{ componentName: string; amount: number }>;
  deductions?: Array<{ componentName: string; amount: number }>;
}

/** Compose the subject line. Kept static + pinnable for tests. */
export function composeSalarySlipSubject(input: {
  slipName: string;
  periodStart: Date;
  periodEnd: Date;
  tenantName?: string | null;
}): string {
  const prefix = input.tenantName ? `${input.tenantName} · ` : "";
  return `${prefix}Salary slip ${input.slipName} — ${formatPeriod(input.periodStart, input.periodEnd)}`;
}

/**
 * Compose the full HTML body. Renders a compact earnings + deductions
 * breakdown so the recipient sees WHY the net is what it is without
 * opening a PDF attachment. Escaped throughout to survive quotes /
 * angle brackets in component names.
 */
export function composeSalarySlipBody(input: SalarySlipEmailInput): string {
  const currency = input.currency ?? "INR";
  const period = formatPeriod(input.periodStart, input.periodEnd);
  const earningsRows =
    input.earnings && input.earnings.length > 0
      ? input.earnings
          .map(
            (e) =>
              `<tr><td>${escapeHtml(e.componentName)}</td><td style="text-align:right">${fmt(e.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="2" style="color:#888">No earning components on this slip.</td></tr>`;
  const deductionRows =
    input.deductions && input.deductions.length > 0
      ? input.deductions
          .map(
            (d) =>
              `<tr><td>${escapeHtml(d.componentName)}</td><td style="text-align:right">${fmt(d.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="2" style="color:#888">No deductions.</td></tr>`;

  return `
    <p>Hi ${escapeHtml(input.employeeName)},</p>
    <p>Your salary slip for the period <strong>${period}</strong> is ready.</p>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;margin-top:10px">
      <thead>
        <tr>
          <th colspan="2" style="text-align:left;padding-bottom:4px">Earnings</th>
        </tr>
      </thead>
      <tbody>${earningsRows}</tbody>
    </table>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;margin-top:10px">
      <thead>
        <tr>
          <th colspan="2" style="text-align:left;padding-bottom:4px">Deductions</th>
        </tr>
      </thead>
      <tbody>${deductionRows}</tbody>
    </table>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;margin-top:14px">
      <tr>
        <td style="padding-right:20px"><strong>Gross pay</strong></td>
        <td style="text-align:right">${fmt(input.grossPay)} ${currency}</td>
      </tr>
      <tr>
        <td style="padding-right:20px"><strong>Total deductions</strong></td>
        <td style="text-align:right">−${fmt(input.totalDeduction)} ${currency}</td>
      </tr>
      <tr>
        <td style="padding-right:20px;padding-top:6px"><strong>Net pay</strong></td>
        <td style="text-align:right;padding-top:6px"><strong>${fmt(input.netPay)} ${currency}</strong></td>
      </tr>
    </table>
    <p style="margin-top:14px">Slip reference: <code>${escapeHtml(input.slipName)}</code></p>
    <p>Regards,<br/>${escapeHtml(input.tenantName)}</p>
  `;
}

/**
 * Convenience wrapper — combines subject + body.
 */
export function composeSalarySlipEmail(input: SalarySlipEmailInput): {
  subject: string;
  body: string;
} {
  return {
    subject: composeSalarySlipSubject({
      slipName: input.slipName,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      tenantName: input.tenantName,
    }),
    body: composeSalarySlipBody(input),
  };
}

function formatPeriod(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${fmt(from)} → ${fmt(to)}`;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[ch]!,
  );
}
