import { Router } from "express";
import { z } from "zod";
import {
  nextName,
  prisma,
  runReport,
  type ReportDefinition,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// G7 + G8: ScheduledReport. Cron-triggered — runs the SavedReport, formats as
// CSV, and enqueues one EmailMessage per addressee (comma-separated list).
// The CSV body is embedded in the email body (no attachment infrastructure in
// MVP); useful for daily A/R aging blasts, weekly sales digests, etc.

export const scheduledReportRouter = Router();

const p = perms("ScheduledReport");

const upsertSchema = z.object({
  savedReportId: z.string().min(1),
  frequency: z.enum(["Daily", "Weekly", "Monthly"]),
  hourOfDay: z.coerce.number().int().min(0).max(23).default(9),
  dayOfWeek: z.coerce.number().int().min(0).max(6).default(1),
  dayOfMonth: z.coerce.number().int().min(1).max(28).default(1),
  emailTo: z.string().min(3),
  format: z.enum(["csv", "json"]).default("csv"),
  enabled: z.boolean().default(true),
});

scheduledReportRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.scheduledReport.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      savedReport: { select: { id: true, name: true, doctype: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

scheduledReportRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const saved = await prisma.savedReport.findFirst({
    where: { id: parsed.data.savedReportId, tenantId },
  });
  if (!saved) return res.status(400).json({ error: "Invalid saved report" });
  const name = await nextName(prisma, tenantId, "SCH-");
  const row = await prisma.scheduledReport.create({
    data: { tenantId, name, ...parsed.data },
  });
  res.status(201).json(row);
});

scheduledReportRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.scheduledReport.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.scheduledReport.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

scheduledReportRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.scheduledReport.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.scheduledReport.delete({ where: { id: existing.id } });
  res.status(204).send();
});

function toCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      if (c == null) return "";
      const s = String(c);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(",");
}

// Cron trigger. `?force=1` runs everything enabled regardless of schedule
// gate. Emits one EmailMessage per addressee.
scheduledReportRouter.post("/run", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const force = req.query.force === "1";
  const now = new Date();
  const hour = now.getUTCHours();
  const dow = now.getUTCDay();
  const dom = now.getUTCDate();

  const schedules = await prisma.scheduledReport.findMany({
    where: { tenantId, enabled: true },
    include: { savedReport: true },
  });

  let ran = 0;
  let skipped = 0;
  const errors: { id: string; error: string }[] = [];

  for (const s of schedules) {
    if (!force) {
      if (hour < s.hourOfDay) {
        skipped += 1;
        continue;
      }
      if (s.frequency === "Weekly" && dow !== s.dayOfWeek) {
        skipped += 1;
        continue;
      }
      if (s.frequency === "Monthly" && dom !== s.dayOfMonth) {
        skipped += 1;
        continue;
      }
      if (s.lastRunAt) {
        const since = now.getTime() - s.lastRunAt.getTime();
        const minSince =
          s.frequency === "Daily"
            ? 20 * 3600_000
            : s.frequency === "Weekly"
              ? 6 * 24 * 3600_000
              : 27 * 24 * 3600_000;
        if (since < minSince) {
          skipped += 1;
          continue;
        }
      }
    }

    try {
      const result = await runReport(
        prisma,
        tenantId,
        s.savedReport.doctype,
        s.savedReport.definition as unknown as ReportDefinition,
      );
      const header = toCsvRow(result.columns.map((c) => c.label));
      const rows = result.rows.map((r) =>
        toCsvRow(
          result.columns.map((c) => r[c.key] as string | number | null | undefined),
        ),
      );
      const csv = [header, ...rows].join("\n");

      const subject = `Scheduled report: ${s.savedReport.name}`;
      // Emit inline. CSV is HTML-safe when wrapped in <pre>; for real use we'd
      // attach — but the EmailMessage table doesn't have attachment support
      // yet (see Phase F deferred list).
      const body =
        `<p>Report <b>${s.savedReport.name}</b> generated on ${now.toISOString()}.</p>` +
        `<pre style="font-family:monospace;font-size:12px">${csv
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</pre>`;
      const recipients = s.emailTo
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      for (const to of recipients) {
        await prisma.emailMessage.create({
          data: {
            tenantId,
            toEmail: to,
            subject,
            body,
            linkedDoctype: "ScheduledReport",
            linkedId: s.id,
          },
        });
      }
      await prisma.scheduledReport.update({
        where: { id: s.id },
        data: { lastRunAt: now },
      });
      ran += 1;
    } catch (e) {
      errors.push({ id: s.id, error: e instanceof Error ? e.message : "Failed" });
    }
  }
  res.json({ scheduled: schedules.length, ran, skipped, errors });
});
