import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// F5: DocSubscription. "Watch this document" — user subscribes to (doctype,
// docId). Any comment / status change on that doc should call
// `POST /doc-subscriptions/notify` (invoked by workflow hooks + comment
// create) which fans out one Notification per subscriber.

export const docSubscriptionRouter = Router();
docSubscriptionRouter.use(requireAuth);

const p = perms("DocSubscription");

const subSchema = z.object({
  doctype: z.string().min(1),
  docId: z.string().min(1),
});

// List subscriptions for the current user (my watchlist).
docSubscriptionRouter.get("/", p.read, async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const docId = typeof req.query.docId === "string" ? req.query.docId : undefined;
  const rows = await prisma.docSubscription.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      ...(doctype ? { doctype } : {}),
      ...(docId ? { docId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

// Is the current user subscribed to a given doc? Convenience for the "Watch"
// toggle in detail pages.
docSubscriptionRouter.get("/is-subscribed", p.read, async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : "";
  const docId = typeof req.query.docId === "string" ? req.query.docId : "";
  if (!doctype || !docId) return res.json({ subscribed: false });
  const row = await prisma.docSubscription.findFirst({
    where: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      doctype,
      docId,
    },
  });
  res.json({ subscribed: !!row });
});

docSubscriptionRouter.post("/", p.create, async (req, res) => {
  const parsed = subSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.docSubscription.create({
      data: {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        doctype: parsed.data.doctype,
        docId: parsed.data.docId,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(200).json({ ok: true, already: true });
    }
    throw e;
  }
});

docSubscriptionRouter.delete("/", p.delete, async (req, res) => {
  const parsed = subSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await prisma.docSubscription.deleteMany({
    where: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      doctype: parsed.data.doctype,
      docId: parsed.data.docId,
    },
  });
  res.status(204).send();
});

// Fan-out helper. Callers (workflow hooks, comment create) POST here with the
// subject/body/optional deliverByEmail; every subscriber gets a Notification
// (and possibly an EmailMessage — subject to their preferences).
const notifySchema = z.object({
  doctype: z.string().min(1),
  docId: z.string().min(1),
  subject: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  category: z
    .enum(["workflow", "mentions", "updates", "direct"])
    .default("updates"),
  deliverByEmail: z.boolean().default(false),
  excludeUserId: z.string().optional(), // typically the actor
});

docSubscriptionRouter.post("/notify", p.create, async (req, res) => {
  const parsed = notifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const { doctype, docId, subject, body, category, deliverByEmail, excludeUserId } =
    parsed.data;

  const subs = await prisma.docSubscription.findMany({
    where: {
      tenantId,
      doctype,
      docId,
      ...(excludeUserId ? { NOT: { userId: excludeUserId } } : {}),
    },
    select: { userId: true },
  });
  if (subs.length === 0) return res.json({ notified: 0 });

  // Bulk-preferences fetch keyed by userId.
  const prefs = await prisma.notificationPreference.findMany({
    where: {
      tenantId,
      userId: { in: subs.map((s) => s.userId) },
      category,
    },
  });
  const prefFor = (userId: string, channel: "inapp" | "email" | "sms") => {
    const p = prefs.find((x) => x.userId === userId && x.channel === channel);
    return p?.enabled ?? (channel === "inapp");
  };

  const users = deliverByEmail
    ? await prisma.user.findMany({
        where: { tenantId, id: { in: subs.map((s) => s.userId) } },
        select: { id: true, email: true },
      })
    : [];
  const emailFor = new Map(users.map((u) => [u.id, u.email]));

  let notified = 0;
  for (const s of subs) {
    if (prefFor(s.userId, "inapp")) {
      await prisma.notification.create({
        data: {
          tenantId,
          userId: s.userId,
          subject,
          body: body ?? null,
          doctype,
          docId,
          category,
        },
      });
      notified += 1;
    }
    if (deliverByEmail && prefFor(s.userId, "email")) {
      const email = emailFor.get(s.userId);
      if (email) {
        await prisma.emailMessage.create({
          data: {
            tenantId,
            senderUserId: req.auth!.userId,
            toEmail: email,
            subject,
            body: body ?? subject,
            linkedDoctype: doctype,
            linkedId: docId,
          },
        });
      }
    }
  }
  res.json({ notified, subscribers: subs.length });
});
