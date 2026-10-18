import { Router } from "express";
import { z } from "zod";
import { decryptSecrets, postSlackMessage, prisma } from "@lumaara/db";
import { getLogger, perms, requireAuth } from "@lumaara/service-auth";

const log = getLogger("auth-service").child({ component: "notifications" });
import { makeUnsubscribeToken } from "./email-messages";

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

const p = perms("Notification");

// Server-side create used by other services / workflow hooks. Requires the
// "create" permission so end users can't spam each other.
const createSchema = z.object({
  userId: z.string().min(1),
  subject: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  doctype: z.string().min(1).optional(),
  docId: z.string().min(1).optional(),
  // F4: category feeds NotificationPreference lookups + digest bucketing.
  category: z
    .enum(["workflow", "mentions", "digests", "direct", "updates", "broadcast"])
    .default("direct"),
  // F4: when true, also enqueue an EmailMessage — subject/body/doctype/docId
  // are copied. Honors the user's NotificationPreference for (category, email).
  deliverByEmail: z.boolean().default(false),
  // L8: when true, also mirror to Slack via the tenant's default Slack
  // integration (TenantIntegration provider="slack", secrets.webhookUrl).
  // Honors NotificationPreference for (category, slack).
  deliverBySlack: z.boolean().default(false),
});

// List notifications for the *current* user. `?unread=1` filters to unread only.
notificationRouter.get("/", p.read, async (req, res) => {
  const unreadOnly = req.query.unread === "1";
  const rows = await prisma.notification.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(rows);
});

// Header badge polls this. Kept as a separate endpoint so the shell can hit it
// cheaply without paging through the list.
notificationRouter.get("/unread-count", p.read, async (req, res) => {
  const count = await prisma.notification.count({
    where: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      isRead: false,
    },
  });
  res.json({ count });
});

notificationRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const { userId, subject, body, doctype, docId, category, deliverByEmail, deliverBySlack } =
    parsed.data;

  // Preference check: absent row = default (inapp on, email/sms off unless
  // explicitly requested).
  const prefs = await prisma.notificationPreference.findMany({
    where: { tenantId, userId, category },
  });
  // Slack was added later; unknown channels default to opted-in when the
  // caller has explicitly requested them via deliverBySlack.
  const prefFor = (channel: "inapp" | "email" | "sms" | "slack") =>
    prefs.find((p) => p.channel === channel)?.enabled ??
    (channel === "inapp" || channel === "slack");

  const row = await prisma.notification.create({
    data: {
      tenantId,
      userId,
      subject,
      body: body ?? null,
      doctype: doctype ?? null,
      docId: docId ?? null,
      category,
    },
  });

  if (deliverByEmail && prefFor("email")) {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { email: true },
    });
    if (user?.email) {
      const unsubToken = makeUnsubscribeToken(tenantId, userId, category);
      const publicBase = process.env.PUBLIC_AUTH_URL ?? "http://localhost:4001";
      const unsubUrl = `${publicBase}/unsubscribe/${unsubToken}`;
      const footer = `<hr><p style="color:#6b7280;font-size:0.85em;">You received this because you're subscribed to <b>${category}</b> notifications. <a href="${unsubUrl}">Unsubscribe</a></p>`;
      await prisma.emailMessage.create({
        data: {
          tenantId,
          senderUserId: req.auth!.userId,
          toEmail: user.email,
          subject,
          body: `${body ?? subject}${footer}`,
          linkedDoctype: doctype ?? null,
          linkedId: docId ?? null,
        },
      });
    }
  }

  if (deliverBySlack && prefFor("slack")) {
    const slackIntegration = await prisma.tenantIntegration.findFirst({
      where: { tenantId, provider: "slack", isActive: true, isDefault: true },
    });
    const webhookUrl = slackIntegration
      ? (decryptSecrets(slackIntegration.secrets) as Record<string, string>).webhookUrl
      : undefined;
    if (webhookUrl) {
      // Fire-and-forget; a failed Slack post shouldn't block the in-app
      // notification which is the source of truth.
      postSlackMessage(webhookUrl, {
        text: body ? `*${subject}*\n${body}` : subject,
      }).catch((e) => {
        // Best-effort; log so ops sees repeated failures.
        log.warn("slack mirror failed", {
          err: e instanceof Error ? e : new Error(String(e)),
          tenantId,
          category,
        });
      });
    }
  }

  res.status(201).json(row);
});

notificationRouter.post("/:id/read", p.write, async (req, res) => {
  const existing = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.notification.update({
    where: { id: existing.id },
    data: { isRead: true },
  });
  res.json(row);
});

notificationRouter.post("/read-all", p.write, async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      isRead: false,
    },
    data: { isRead: true },
  });
  res.json({ updated: result.count });
});

notificationRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.notification.delete({ where: { id: existing.id } });
  res.status(204).send();
});
