import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  decryptSecrets,
  isSuppressed,
  prisma,
  renderTemplate,
  wrapLinksAndInjectPixel,
} from "@lumaara/db";
import { takeToken } from "@lumaara/queue";
import { getLogger, perms, requireAuth } from "@lumaara/service-auth";

const log = getLogger("auth-service").child({ component: "email" });
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// F2: Outbound email queue.
//
// - `POST /emails/send` — enqueue a raw email.
// - `POST /emails/send-from-template` — resolve template + vars first.
// - `POST /emails/process` — cron-triggered flush of Pending → Sent. Uses
//   nodemailer if SMTP_HOST is set, otherwise a fake sender that just logs to
//   stdout (dev / demo mode). Bounded batch (default 50).
// - `GET /emails` list.

export const emailMessageRouter = Router();
emailMessageRouter.use(requireAuth);

const p = perms("EmailMessage");

const emailSchema = z.object({
  toEmail: z.string().email(),
  ccEmail: z.string().optional().nullable(),
  bccEmail: z.string().optional().nullable(),
  subject: z.string().min(1),
  body: z.string().min(1),
  scheduledFor: z.string().datetime().optional().nullable(),
  linkedDoctype: z.string().optional().nullable(),
  linkedId: z.string().optional().nullable(),
});

const fromTemplateSchema = z.object({
  templateId: z.string().min(1),
  toEmail: z.string().email(),
  ccEmail: z.string().optional().nullable(),
  bccEmail: z.string().optional().nullable(),
  vars: z.record(z.unknown()).default({}),
  scheduledFor: z.string().datetime().optional().nullable(),
  linkedDoctype: z.string().optional().nullable(),
  linkedId: z.string().optional().nullable(),
});

emailMessageRouter.get("/", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.emailMessage.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

emailMessageRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.emailMessage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

emailMessageRouter.post("/send", p.create, async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.emailMessage.create({
    data: {
      tenantId: req.auth!.tenantId,
      senderUserId: req.auth!.userId,
      toEmail: parsed.data.toEmail,
      ccEmail: parsed.data.ccEmail ?? null,
      bccEmail: parsed.data.bccEmail ?? null,
      subject: parsed.data.subject,
      body: parsed.data.body,
      scheduledFor: parsed.data.scheduledFor
        ? new Date(parsed.data.scheduledFor)
        : null,
      linkedDoctype: parsed.data.linkedDoctype ?? null,
      linkedId: parsed.data.linkedId ?? null,
    },
  });
  res.status(201).json(row);
});

emailMessageRouter.post("/send-from-template", p.create, async (req, res) => {
  const parsed = fromTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const tpl = await prisma.emailTemplate.findFirst({
    where: { id: parsed.data.templateId, tenantId, enabled: true },
  });
  if (!tpl) return res.status(400).json({ error: "Invalid or disabled template" });

  const vars = parsed.data.vars as Record<string, unknown>;
  const subject = renderTemplate(tpl.subject, vars);
  const body = renderTemplate(tpl.body, vars);

  const row = await prisma.emailMessage.create({
    data: {
      tenantId,
      senderUserId: req.auth!.userId,
      toEmail: parsed.data.toEmail,
      ccEmail: parsed.data.ccEmail ?? null,
      bccEmail: parsed.data.bccEmail ?? null,
      subject,
      body,
      templateId: tpl.id,
      scheduledFor: parsed.data.scheduledFor
        ? new Date(parsed.data.scheduledFor)
        : null,
      linkedDoctype: parsed.data.linkedDoctype ?? null,
      linkedId: parsed.data.linkedId ?? null,
    },
  });
  res.status(201).json(row);
});

emailMessageRouter.post("/:id/cancel", p.cancel, async (req, res) => {
  const existing = await prisma.emailMessage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Pending")
    return res.status(400).json({ error: `Cannot cancel in status ${existing.status}` });
  const row = await prisma.emailMessage.update({
    where: { id: existing.id },
    data: { status: "Cancelled" },
  });
  res.json(row);
});

// Cron-triggered flush. Requires the "submit" permission on EmailMessage so it
// can only be called by ops/admins (or by an internal scheduler with an admin
// API token).
emailMessageRouter.post("/process", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const now = new Date();

  const batch = await prisma.emailMessage.findMany({
    where: {
      tenantId,
      status: "Pending",
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  if (batch.length === 0) return res.json({ processed: 0, sent: 0, failed: 0 });

  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let throttled = 0;
  // Cache campaign lookups per batch — many rows in a batch typically share
  // a campaign (bulk-broadcast), so we don't want to hit the DB per message.
  const campaignCache = new Map<
    string,
    { rateLimitPerMin: number | null } | null
  >();

  for (const m of batch) {
    // ---- Suppression pre-send check (marketing P1) ----
    // A blocked address SHOULD NOT count as an attempt — the send never left
    // the process. We set status=Suppressed with a clear reason so the row
    // is auditable + the UI can surface it.
    const supp = await isSuppressed(prisma, m.tenantId, m.toEmail);
    if (supp) {
      await prisma.emailMessage.update({
        where: { id: m.id },
        data: {
          status: "Suppressed",
          lastError: `Suppressed: ${supp.reason}`,
          sentAt: null,
        },
      });
      suppressed += 1;
      continue;
    }

    // ---- Per-tenant rate limit (marketing P1) ----
    // Only applies when the message is linked to a Campaign that has an
    // explicit rateLimitPerMin. Transactional email (no campaign linkage)
    // sends at full speed.
    if (m.linkedDoctype === "Campaign" && m.linkedId) {
      let campaign = campaignCache.get(m.linkedId);
      if (campaign === undefined) {
        campaign = await prisma.campaign
          .findFirst({
            where: { id: m.linkedId, tenantId: m.tenantId },
            select: { rateLimitPerMin: true },
          })
          .catch(() => null);
        campaignCache.set(m.linkedId, campaign);
      }
      if (campaign?.rateLimitPerMin && campaign.rateLimitPerMin > 0) {
        const allowed = await takeToken(m.tenantId, campaign.rateLimitPerMin);
        if (!allowed) {
          // Leave row Pending, do NOT increment attempts, and stop the batch —
          // trying more messages this tick would just fail the same throttle.
          throttled += 1;
          break;
        }
      }
    }

    // Mark Sending so a concurrent processor won't re-pick it.
    await prisma.emailMessage.update({
      where: { id: m.id },
      data: { status: "Sending", attempts: { increment: 1 } },
    });
    try {
      // ---- Tracking wrap (marketing P1) ----
      // When trackingEnabled=true, rewrite <a href> to click-tracker URLs and
      // inject an open pixel. If no trackingId is set yet, generate one first
      // so the tracking endpoints can look this row up later.
      let bodyToSend = m.body;
      let trackingId = m.trackingId;
      if (m.trackingEnabled) {
        if (!trackingId) {
          trackingId = randomUUID();
          await prisma.emailMessage.update({
            where: { id: m.id },
            data: { trackingId },
          });
        }
        bodyToSend = wrapLinksAndInjectPixel(m.body, {
          trackingId,
          baseUrl:
            process.env.AUTH_SERVICE_URL ?? "http://localhost:4101",
        });
      }

      const providerId = await deliverEmail(m.tenantId, {
        to: m.toEmail,
        cc: m.ccEmail,
        bcc: m.bccEmail,
        subject: m.subject,
        body: bodyToSend,
      });
      await prisma.emailMessage.update({
        where: { id: m.id },
        data: {
          status: "Sent",
          sentAt: new Date(),
          providerMessageId: providerId,
          lastError: null,
        },
      });
      sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.emailMessage.update({
        where: { id: m.id },
        data: { status: "Failed", lastError: msg.slice(0, 2000) },
      });
      failed += 1;
    }
  }
  res.json({ processed: batch.length, sent, failed, suppressed, throttled });
});

// SMTP resolution: TenantIntegration provider="smtp" secrets take precedence
// over env vars. Secrets shape: {host, port, user, pass, secure, from}. Any
// missing key falls back to the corresponding SMTP_* env var so a tenant can
// override just a subset (e.g. their own "from" while sharing infra creds).
interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

async function resolveSmtpConfig(tenantId: string): Promise<SmtpConfig | null> {
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "smtp", isActive: true, isDefault: true },
  });
  const s = integration
    ? (decryptSecrets(integration.secrets) as Record<string, string>)
    : ({} as Record<string, string>);
  const host = s.host || process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(s.port || process.env.SMTP_PORT || 587),
    secure: (s.secure ?? process.env.SMTP_SECURE) === "true",
    user: s.user || process.env.SMTP_USER || undefined,
    pass: s.pass || process.env.SMTP_PASS || undefined,
    from: s.from || process.env.SMTP_FROM || "no-reply@lumaara.local",
  };
}

// Delivery adapter. Prefers per-tenant SMTP integration when present, then
// env SMTP_HOST, else fake sender (dev / demo).
async function deliverEmail(
  tenantId: string,
  msg: {
    to: string;
    cc: string | null;
    bcc: string | null;
    subject: string;
    body: string;
  },
): Promise<string> {
  const cfg = await resolveSmtpConfig(tenantId);
  if (!cfg) {
    log.info("email skipped (no smtp)", {
      tenantId,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
    });
    return `fake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  let nodemailer: typeof import("nodemailer") | null = null;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    log.warn("email skipped (nodemailer not installed)", {
      to: msg.to,
      subject: msg.subject,
    });
    return `no-nodemailer-${Date.now()}`;
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
  });
  const info = await transporter.sendMail({
    from: cfg.from,
    to: msg.to,
    cc: msg.cc ?? undefined,
    bcc: msg.bcc ?? undefined,
    subject: msg.subject,
    html: msg.body,
    text: msg.body.replace(/<[^>]+>/g, ""),
  });
  return info.messageId ?? `sent-${Date.now()}`;
}

// ---------- F5: Unsubscribe token ----------

// Signed token: base64url(`${tenantId}.${userId}.${category}`) + "." +
// hmac(secret). No expiry — unsubscribe links stay valid until the recipient
// re-enables the category in preferences.

import { UNSUBSCRIBE_SECRET } from "@lumaara/service-auth";
function unsubscribeSecret(): string {
  return UNSUBSCRIBE_SECRET;
}

export function makeUnsubscribeToken(
  tenantId: string,
  userId: string,
  category: string,
): string {
  const payload = Buffer.from(`${tenantId}.${userId}.${category}`).toString("base64url");
  const sig = createHmac("sha256", unsubscribeSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyUnsubscribeToken(token: string): {
  tenantId: string;
  userId: string;
  category: string;
} | null {
  const [payload, sig] = token.split(".", 2);
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", unsubscribeSecret()).update(payload).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const raw = Buffer.from(payload, "base64url").toString("utf8");
  const [tenantId, userId, category] = raw.split(".", 3);
  if (!tenantId || !userId || !category) return null;
  return { tenantId, userId, category };
}

// Public router (no auth) — the recipient clicks a link in an email.
export const unsubscribeRouter = Router();

unsubscribeRouter.get("/:token", async (req, res) => {
  const claims = verifyUnsubscribeToken(req.params.token);
  if (!claims) return res.status(400).send("Invalid or expired unsubscribe link.");
  await prisma.notificationPreference.upsert({
    where: {
      tenantId_userId_category_channel: {
        tenantId: claims.tenantId,
        userId: claims.userId,
        category: claims.category,
        channel: "email",
      },
    },
    update: { enabled: false },
    create: {
      tenantId: claims.tenantId,
      userId: claims.userId,
      category: claims.category,
      channel: "email",
      enabled: false,
    },
  });
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(
    `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;max-width:520px;margin:auto;">
      <h2>Unsubscribed</h2>
      <p>You will no longer receive <b>${claims.category}</b> emails.</p>
      <p style="color:#6b7280;font-size:.9rem;">To resubscribe, visit your notification preferences after signing in.</p>
    </body></html>`,
  );
});
