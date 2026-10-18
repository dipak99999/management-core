import { prisma, runReport, type ReportDefinition, type ReportResult } from "@lumaara/db";

// Scheduler for ScheduledReport rows created via accounting-service.
// Every tick (default hourly) we look for rows whose next-fire moment has
// passed since the last run. When one fires we:
//   1. Execute the SavedReport
//   2. Format as CSV (default) or JSON
//   3. Enqueue an EmailMessage per recipient (comma-separated `emailTo`)
//   4. Bump `lastRunAt`
// The actual email delivery is the auth-service email pipeline — we just
// hand off the rendered body as Pending.

export interface ScheduledReportTickResult {
  checked: number;
  fired: number;
  emailsQueued: number;
  errors: number;
}

// Would this schedule fire in the window [after, now]?
function shouldFire(
  schedule: {
    frequency: string;
    hourOfDay: number;
    dayOfWeek: number;
    dayOfMonth: number;
    lastRunAt: Date | null;
    createdAt: Date;
  },
  now: Date,
): boolean {
  const after = schedule.lastRunAt ?? schedule.createdAt;
  // Walk forward from `after` in cadence-appropriate steps until we pass now.
  // Cheap for hourly cadence, and O(days-since-last-run) worst case for
  // monthly (bounded).
  const cursor = new Date(after);
  while (cursor <= now) {
    // Advance to the next candidate moment.
    if (schedule.frequency === "Daily") {
      // Set to today (or day after `after`) at hourOfDay.
      cursor.setUTCHours(schedule.hourOfDay, 0, 0, 0);
      if (cursor <= after) cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else if (schedule.frequency === "Weekly") {
      // Advance day-by-day until dayOfWeek matches.
      cursor.setUTCHours(schedule.hourOfDay, 0, 0, 0);
      while (cursor.getUTCDay() !== schedule.dayOfWeek || cursor <= after) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    } else if (schedule.frequency === "Monthly") {
      cursor.setUTCHours(schedule.hourOfDay, 0, 0, 0);
      // Move to next occurrence of dayOfMonth strictly after `after`.
      while (cursor.getUTCDate() !== schedule.dayOfMonth || cursor <= after) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    } else {
      return false;
    }
    if (cursor <= now) return true;
    return false;
  }
  return false;
}

function toCsv(result: ReportResult): string {
  const header = result.columns.map((c) => JSON.stringify(c.label)).join(",");
  const body = result.rows
    .map((row) =>
      result.columns
        .map((c) => {
          const v = row[c.key];
          if (v == null) return "";
          const s = typeof v === "object" ? JSON.stringify(v) : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}`;
}

export async function runScheduledReportsTick(): Promise<ScheduledReportTickResult> {
  const now = new Date();
  const enabled = await prisma.scheduledReport.findMany({
    where: { enabled: true },
    include: { savedReport: true },
  });

  let fired = 0;
  let emailsQueued = 0;
  let errors = 0;

  for (const s of enabled) {
    try {
      if (!shouldFire(s, now)) continue;
      const result = await runReport(
        prisma,
        s.tenantId,
        s.savedReport.doctype,
        s.savedReport.definition as unknown as ReportDefinition,
      );
      const body =
        s.format === "json"
          ? JSON.stringify(result.rows, null, 2)
          : toCsv(result);

      const subject = `[${s.name}] ${s.savedReport.name} — ${result.rows.length} rows`;
      const bodyHtml =
        `<p><strong>${s.savedReport.name}</strong> (${result.rows.length} rows, ${s.format})</p>` +
        `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:12px;` +
        `background:#f5f4fb;padding:12px;border-radius:6px;overflow:auto">` +
        body.slice(0, 200_000).replace(/</g, "&lt;") +
        `</pre>`;

      const recipients = s.emailTo
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      for (const to of recipients) {
        await prisma.emailMessage.create({
          data: {
            tenantId: s.tenantId,
            toEmail: to,
            subject,
            body: bodyHtml,
            status: "Pending",
            linkedDoctype: "ScheduledReport",
            linkedId: s.id,
          },
        });
        emailsQueued += 1;
      }

      await prisma.scheduledReport.update({
        where: { id: s.id },
        data: { lastRunAt: now },
      });
      fired += 1;
    } catch {
      errors += 1;
    }
  }

  return { checked: enabled.length, fired, emailsQueued, errors };
}
