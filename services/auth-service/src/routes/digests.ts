import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// F7: Event Digest. Users subscribe to daily/weekly rollups. `/digests/run` is
// cron-triggered — it finds due schedules and enqueues one EmailMessage per
// user with the aggregated content.
//
// Section keys (MVP): sales_invoices | payments | expense_claims | leaves | notifications

export const digestRouter = Router();
digestRouter.use(requireAuth);

const p = perms("DigestSchedule");

const SECTIONS = ["sales_invoices", "payments", "expense_claims", "leaves", "notifications"] as const;

const scheduleSchema = z.object({
  frequency: z.enum(["Daily", "Weekly"]),
  sections: z.array(z.enum(SECTIONS)).min(1),
  hourOfDay: z.coerce.number().int().min(0).max(23).default(9),
  dayOfWeek: z.coerce.number().int().min(0).max(6).default(1),
  enabled: z.boolean().default(true),
});

// Current user's schedules.
digestRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.digestSchedule.findMany({
    where: { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
    orderBy: { frequency: "asc" },
  });
  res.json(rows);
});

digestRouter.post("/", p.create, async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const row = await prisma.digestSchedule.upsert({
    where: {
      tenantId_userId_frequency: {
        tenantId,
        userId,
        frequency: parsed.data.frequency,
      },
    },
    update: {
      sections: parsed.data.sections as unknown as Prisma.InputJsonValue,
      hourOfDay: parsed.data.hourOfDay,
      dayOfWeek: parsed.data.dayOfWeek,
      enabled: parsed.data.enabled,
    },
    create: {
      tenantId,
      userId,
      frequency: parsed.data.frequency,
      sections: parsed.data.sections as unknown as Prisma.InputJsonValue,
      hourOfDay: parsed.data.hourOfDay,
      dayOfWeek: parsed.data.dayOfWeek,
      enabled: parsed.data.enabled,
    },
  });
  res.json(row);
});

digestRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.digestSchedule.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.digestSchedule.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Cron trigger — enqueues digest emails for all due schedules. `?force=1`
// skips the due-check for manual re-runs.
digestRouter.post("/run", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const force = req.query.force === "1";
  const now = new Date();
  const nowHour = now.getUTCHours();
  const nowDow = now.getUTCDay();

  const schedules = await prisma.digestSchedule.findMany({
    where: { tenantId, enabled: true },
  });

  let sent = 0;
  let skipped = 0;
  for (const s of schedules) {
    if (!force) {
      if (nowHour < s.hourOfDay) {
        skipped += 1;
        continue;
      }
      if (s.frequency === "Weekly" && nowDow !== s.dayOfWeek) {
        skipped += 1;
        continue;
      }
      if (s.lastSentAt) {
        const since = now.getTime() - s.lastSentAt.getTime();
        const minSinceLast = s.frequency === "Daily" ? 20 * 3600_000 : 6 * 24 * 3600_000;
        if (since < minSinceLast) {
          skipped += 1;
          continue;
        }
      }
    }

    const user = await prisma.user.findFirst({
      where: { id: s.userId, tenantId },
      select: { email: true, fullName: true },
    });
    if (!user?.email) {
      skipped += 1;
      continue;
    }

    const windowStart = new Date(now);
    windowStart.setUTCDate(
      windowStart.getUTCDate() - (s.frequency === "Daily" ? 1 : 7),
    );
    const sections = s.sections as unknown as string[];
    const body = await buildDigestBody(tenantId, windowStart, now, sections);
    const subject = `${s.frequency} digest — ${now.toISOString().slice(0, 10)}`;

    await prisma.emailMessage.create({
      data: {
        tenantId,
        toEmail: user.email,
        subject,
        body,
      },
    });
    await prisma.digestSchedule.update({
      where: { id: s.id },
      data: { lastSentAt: now },
    });
    sent += 1;
  }
  res.json({ scheduled: schedules.length, sent, skipped });
});

async function buildDigestBody(
  tenantId: string,
  from: Date,
  to: Date,
  sections: string[],
): Promise<string> {
  const chunks: string[] = [];
  chunks.push(
    `<p>Activity from ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.</p>`,
  );

  if (sections.includes("sales_invoices")) {
    const agg = await prisma.salesInvoice.aggregate({
      where: { tenantId, postingDate: { gte: from, lte: to }, status: { in: ["Submitted", "Paid"] } },
      _count: true,
      _sum: { grandTotal: true },
    });
    chunks.push(
      `<h3>Sales invoices</h3><p>${agg._count} submitted · total ${Number(agg._sum.grandTotal ?? 0).toFixed(2)}</p>`,
    );
  }
  if (sections.includes("payments")) {
    const agg = await prisma.paymentEntry.aggregate({
      where: { tenantId, postingDate: { gte: from, lte: to }, status: "Submitted" },
      _count: true,
      _sum: { paidAmount: true },
    });
    chunks.push(
      `<h3>Payments</h3><p>${agg._count} entries · total ${Number(agg._sum.paidAmount ?? 0).toFixed(2)}</p>`,
    );
  }
  if (sections.includes("expense_claims")) {
    const pending = await prisma.expenseClaim.count({
      where: { tenantId, status: "Draft", createdAt: { gte: from, lte: to } },
    });
    chunks.push(`<h3>Expense claims</h3><p>${pending} new drafts awaiting approval</p>`);
  }
  if (sections.includes("leaves")) {
    const pending = await prisma.leaveApplication.count({
      where: { tenantId, status: "Draft", createdAt: { gte: from, lte: to } },
    });
    chunks.push(`<h3>Leaves</h3><p>${pending} new leave applications</p>`);
  }
  if (sections.includes("notifications")) {
    const count = await prisma.notification.count({
      where: { tenantId, createdAt: { gte: from, lte: to } },
    });
    chunks.push(`<h3>Notifications</h3><p>${count} events</p>`);
  }
  return chunks.join("\n");
}
