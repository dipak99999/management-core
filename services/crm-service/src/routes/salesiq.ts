import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// SalesIQ-style live chat + visitor tracking.
//
// TWO surfaces:
//
//   PUBLIC (no auth) — served from `publicRouter`, mounted at `/siq/public`
//   on crm-service. Consumed by the embeddable widget script that any
//   website drops onto their pages. Every call carries a `tenantSlug` so
//   the server can pick the right tenant without a JWT.
//     POST /siq/public/identify       body: { tenantSlug, fingerprint, userAgent?, referrer?, currentUrl?, ipAddress? }
//     POST /siq/public/track-page     body: { tenantSlug, fingerprint, url, title? }
//     POST /siq/public/start-chat     body: { tenantSlug, fingerprint, message, email?, name? }
//     POST /siq/public/messages       body: { sessionId, message }
//     GET  /siq/public/messages?sessionId=&after=<msgId>
//     GET  /siq/public/settings?tenantSlug=…   → widget appearance
//
//   OPERATOR (JWT) — served from `operatorRouter`, mounted at `/siq`. Used
//   by the CRM operator inbox UI.
//     GET  /siq/visitors                       → live visitor list
//     GET  /siq/chat-sessions                  → inbox
//     GET  /siq/chat-sessions/:id              → one session (+ visitor)
//     GET  /siq/chat-sessions/:id/messages
//     POST /siq/chat-sessions/:id/reply        body: { body }
//     POST /siq/chat-sessions/:id/close
//     POST /siq/chat-sessions/:id/create-lead  → converts the visitor to a CRM Lead
//     GET  /siq/settings                       → widget settings (auto-create default row)
//     PUT  /siq/settings                       → update widget settings

// ─── PUBLIC (no auth) ────────────────────────────────────────────────

export const salesiqPublicRouter = Router();

async function tenantIdForSlug(slug: string): Promise<string | null> {
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return t?.id ?? null;
}

async function ensureVisitor(
  tenantId: string,
  fingerprint: string,
  extras: {
    userAgent?: string;
    ipAddress?: string;
    referrer?: string;
    currentUrl?: string;
  } = {},
) {
  const existing = await prisma.siqVisitor.findUnique({
    where: { tenantId_fingerprint: { tenantId, fingerprint } },
  });
  if (existing) {
    return prisma.siqVisitor.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        ...(extras.userAgent && !existing.userAgent && { userAgent: extras.userAgent }),
        ...(extras.ipAddress && !existing.ipAddress && { ipAddress: extras.ipAddress }),
        ...(extras.referrer && !existing.referrer && { referrer: extras.referrer }),
        ...(extras.currentUrl && { currentUrl: extras.currentUrl }),
      },
    });
  }
  const count = await prisma.siqVisitor.count({ where: { tenantId } });
  return prisma.siqVisitor.create({
    data: {
      tenantId,
      fingerprint,
      displayName: `Anonymous #${count + 1}`,
      ...extras,
    },
  });
}

salesiqPublicRouter.post("/identify", async (req, res) => {
  const parsed = z
    .object({
      tenantSlug: z.string().min(1),
      fingerprint: z.string().min(1),
      userAgent: z.string().optional(),
      referrer: z.string().optional(),
      currentUrl: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid" });

  const tenantId = await tenantIdForSlug(parsed.data.tenantSlug);
  if (!tenantId) return res.status(404).json({ error: "Unknown tenant" });

  const ipAddress = (req.ip ?? req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() || undefined;
  const v = await ensureVisitor(tenantId, parsed.data.fingerprint, {
    userAgent: parsed.data.userAgent,
    referrer: parsed.data.referrer,
    currentUrl: parsed.data.currentUrl,
    ipAddress,
  });
  res.json({
    visitorId: v.id,
    displayName: v.displayName,
    status: v.status,
  });
});

salesiqPublicRouter.post("/track-page", async (req, res) => {
  const parsed = z
    .object({
      tenantSlug: z.string().min(1),
      fingerprint: z.string().min(1),
      url: z.string().min(1),
      title: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid" });

  const tenantId = await tenantIdForSlug(parsed.data.tenantSlug);
  if (!tenantId) return res.status(404).json({ error: "Unknown tenant" });
  const v = await ensureVisitor(tenantId, parsed.data.fingerprint, {
    currentUrl: parsed.data.url,
  });
  await prisma.siqPageView.create({
    data: {
      visitorId: v.id,
      url: parsed.data.url,
      title: parsed.data.title ?? null,
      referrer: v.referrer,
    },
  });
  await prisma.siqVisitor.update({
    where: { id: v.id },
    data: { pageCount: { increment: 1 } },
  });
  res.json({ ok: true });
});

salesiqPublicRouter.post("/start-chat", async (req, res) => {
  const parsed = z
    .object({
      tenantSlug: z.string().min(1),
      fingerprint: z.string().min(1),
      message: z.string().min(1),
      email: z.string().email().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid" });

  const tenantId = await tenantIdForSlug(parsed.data.tenantSlug);
  if (!tenantId) return res.status(404).json({ error: "Unknown tenant" });

  const v = await ensureVisitor(tenantId, parsed.data.fingerprint);
  if (parsed.data.email || parsed.data.name) {
    await prisma.siqVisitor.update({
      where: { id: v.id },
      data: {
        email: parsed.data.email ?? v.email,
        displayName: parsed.data.name ?? v.displayName,
      },
    });
  }
  await prisma.siqVisitor.update({
    where: { id: v.id },
    data: { status: "Chatting" },
  });

  const session = await prisma.siqChatSession.create({
    data: {
      tenantId,
      visitorId: v.id,
      status: "Open",
      subject: parsed.data.message.slice(0, 120),
      unreadForOperator: 1,
      messages: {
        create: {
          sender: "Visitor",
          senderName: parsed.data.name ?? v.displayName ?? "Visitor",
          body: parsed.data.message,
        },
      },
    },
    include: { messages: true },
  });
  res.status(201).json({ sessionId: session.id, messages: session.messages });
});

salesiqPublicRouter.post("/messages", async (req, res) => {
  const parsed = z
    .object({
      sessionId: z.string().min(1),
      message: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid" });

  const session = await prisma.siqChatSession.findUnique({
    where: { id: parsed.data.sessionId },
    include: { visitor: { select: { displayName: true } } },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status === "Closed") return res.status(400).json({ error: "Session closed" });

  const msg = await prisma.siqChatMessage.create({
    data: {
      sessionId: session.id,
      sender: "Visitor",
      senderName: session.visitor.displayName ?? "Visitor",
      body: parsed.data.message,
    },
  });
  await prisma.siqChatSession.update({
    where: { id: session.id },
    data: { unreadForOperator: { increment: 1 } },
  });
  res.status(201).json(msg);
});

salesiqPublicRouter.get("/messages", async (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  const after = String(req.query.after ?? "");
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });

  const rows = await prisma.siqChatMessage.findMany({
    where: { sessionId, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  // Mark visitor's outstanding-read count to 0 since they polled.
  await prisma.siqChatSession.updateMany({
    where: { id: sessionId },
    data: { unreadForVisitor: 0 },
  });
  res.json(rows);
});

salesiqPublicRouter.get("/settings", async (req, res) => {
  const tenantSlug = String(req.query.tenantSlug ?? "");
  if (!tenantSlug) return res.status(400).json({ error: "tenantSlug required" });
  const tenantId = await tenantIdForSlug(tenantSlug);
  if (!tenantId) return res.status(404).json({ error: "Unknown tenant" });
  const s = await prisma.siqWidgetSettings.findUnique({ where: { tenantId } });
  res.json(
    s ?? {
      brandName: "Support",
      greeting: "Hi! How can we help?",
      primaryColor: "#7C3AED",
      position: "bottom-right",
      offlineMessage: "We're offline. Leave a message and we'll email you.",
    },
  );
});

// ─── OPERATOR (JWT) ──────────────────────────────────────────────────

export const salesiqOperatorRouter = Router();
const p = perms("SiqChatSession");

salesiqOperatorRouter.get("/visitors", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.siqVisitor.findMany({
    where: { tenantId: req.auth!.tenantId, ...(status ? { status } : {}) },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

salesiqOperatorRouter.get("/visitors/:id", p.read, async (req, res) => {
  const v = await prisma.siqVisitor.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      pageViews: { orderBy: { createdAt: "desc" }, take: 25 },
      chatSessions: { orderBy: { startedAt: "desc" }, take: 5 },
    },
  });
  if (!v) return res.status(404).json({ error: "Not found" });
  res.json(v);
});

salesiqOperatorRouter.get("/chat-sessions", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "Open";
  const rows = await prisma.siqChatSession.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status !== "all" ? { status } : {}),
    },
    include: {
      visitor: { select: { displayName: true, email: true, currentUrl: true, country: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

salesiqOperatorRouter.get("/chat-sessions/:id", p.read, async (req, res) => {
  const s = await prisma.siqChatSession.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { visitor: true },
  });
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});

salesiqOperatorRouter.get("/chat-sessions/:id/messages", p.read, async (req, res) => {
  const after = typeof req.query.after === "string" ? req.query.after : "";
  const s = await prisma.siqChatSession.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!s) return res.status(404).json({ error: "Not found" });
  const rows = await prisma.siqChatMessage.findMany({
    where: { sessionId: s.id, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  // Operator polled — clear operator-side unread.
  await prisma.siqChatSession.update({
    where: { id: s.id },
    data: { unreadForOperator: 0 },
  });
  res.json(rows);
});

salesiqOperatorRouter.post("/chat-sessions/:id/reply", p.write, async (req, res) => {
  const parsed = z.object({ body: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "body required" });
  const s = await prisma.siqChatSession.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!s) return res.status(404).json({ error: "Not found" });
  if (s.status === "Closed") return res.status(400).json({ error: "Session closed" });

  const msg = await prisma.siqChatMessage.create({
    data: {
      sessionId: s.id,
      sender: "Operator",
      senderUserId: req.auth!.userId,
      senderName: req.auth!.email,
      body: parsed.data.body,
    },
  });
  await prisma.siqChatSession.update({
    where: { id: s.id },
    data: {
      status: s.status === "Open" ? "Assigned" : s.status,
      operatorUserId: s.operatorUserId ?? req.auth!.userId,
      unreadForVisitor: { increment: 1 },
    },
  });
  res.status(201).json(msg);
});

salesiqOperatorRouter.post("/chat-sessions/:id/close", p.write, async (req, res) => {
  const s = await prisma.siqChatSession.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!s) return res.status(404).json({ error: "Not found" });
  await prisma.siqChatSession.update({
    where: { id: s.id },
    data: { status: "Closed", closedAt: new Date() },
  });
  await prisma.siqVisitor.update({
    where: { id: s.visitorId },
    data: { status: "Active" },
  });
  res.json({ ok: true });
});

salesiqOperatorRouter.post("/chat-sessions/:id/create-lead", p.write, async (req, res) => {
  const parsed = z
    .object({
      leadName: z.string().min(1),
      companyName: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      mobile: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const s = await prisma.siqChatSession.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { visitor: true },
  });
  if (!s) return res.status(404).json({ error: "Not found" });

  // Naming series — reuse existing helper via a simple count fallback.
  const leadCount = await prisma.lead.count({ where: { tenantId: req.auth!.tenantId } });
  const leadName = `LEAD-${String(leadCount + 1).padStart(4, "0")}`;

  const lead = await prisma.lead.create({
    data: {
      tenantId: req.auth!.tenantId,
      name: leadName,
      leadName: parsed.data.leadName,
      companyName: parsed.data.companyName ?? null,
      email: parsed.data.email ?? s.visitor.email ?? null,
      mobile: parsed.data.mobile ?? s.visitor.phone ?? null,
      status: "Open",
      source: "SalesIQ Chat",
      remarks: `Converted from chat session #${s.id.slice(0, 8)} on ${new Date().toISOString().slice(0, 10)}`,
    },
  });
  await prisma.siqVisitor.update({
    where: { id: s.visitorId },
    data: { linkedLeadId: lead.id },
  });
  res.status(201).json(lead);
});

salesiqOperatorRouter.get("/settings", p.read, async (req, res) => {
  const existing = await prisma.siqWidgetSettings.findUnique({
    where: { tenantId: req.auth!.tenantId },
  });
  if (existing) return res.json(existing);
  const created = await prisma.siqWidgetSettings.create({
    data: { tenantId: req.auth!.tenantId },
  });
  res.json(created);
});

salesiqOperatorRouter.put("/settings", p.write, async (req, res) => {
  const parsed = z
    .object({
      brandName: z.string().min(1).optional(),
      greeting: z.string().min(1).optional(),
      primaryColor: z.string().min(4).optional(),
      position: z.enum(["bottom-right", "bottom-left"]).optional(),
      botEnabled: z.boolean().optional(),
      offlineMessage: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.siqWidgetSettings.upsert({
    where: { tenantId: req.auth!.tenantId },
    create: { tenantId: req.auth!.tenantId, ...parsed.data },
    update: parsed.data,
  });
  res.json(row);
});
