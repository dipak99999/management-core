import { Router } from "express";
import express from "express";
import { z } from "zod";
import {
  WhatsappClient,
  decryptSecrets,
  getWhatsappClient,
  prisma,
  withCrossTenant,
} from "@lumaara/db";
import { takeToken } from "@lumaara/queue";
import { getLogger, perms, requireAuth } from "@lumaara/service-auth";

// Marketing P2: WhatsApp Business Cloud API integration.
//
// Two auth surfaces on one router:
//   * Templates + send + process — all JWT'd via requireAuth (applied per-
//     route, not blanket-router, so the /webhook/* endpoints can stay public).
//   * /webhook/:tenantSlug (GET + POST) — public. Meta calls these.
//     - GET is the one-shot handshake (Meta echoes hub.challenge).
//     - POST body is HMAC-SHA256 signed with the tenant's App Secret
//       (X-Hub-Signature-256). We install an express.raw() parser locally on
//       POST /webhook so the signature can be verified against the exact
//       bytes Meta sent — the global express.json() would already have
//       consumed + reformatted the payload otherwise.
//
// Rate limit — per-tenant, 80/min default. Meta's default tier caps around
// 250 messages/day (grows to 1k → 10k → 100k after quality checks) but the
// per-second burst limit is generous. 80/min is a comfortable ceiling that
// won't nick Meta but keeps a runaway send loop from torching a WABA.

export const whatsappRouter = Router();

const log = getLogger("crm-service").child({ component: "whatsapp" });

const pt = perms("WhatsappTemplate");
const pm = perms("WhatsappMessage");

const WHATSAPP_RATE_PER_MIN = Math.max(
  1,
  Number(process.env.WHATSAPP_RATE_PER_MIN ?? 80),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ---------------------------------------------------------------------------
// Health (public — same shape as other routers).
// ---------------------------------------------------------------------------

whatsappRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "whatsapp" });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const templateSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, "name must be [a-z0-9_]+"),
  category: z.enum(["AUTHENTICATION", "MARKETING", "UTILITY"]),
  language: z.string().min(2).default("en_US"),
  headerType: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).nullable().optional(),
  headerText: z.string().nullable().optional(),
  bodyText: z.string().min(1),
  footerText: z.string().nullable().optional(),
  variables: z.array(z.string()).optional(),
});

// GET /templates — DB list (fast path). ?refresh=1 kicks a background sync
// from Meta so the UI can offer an explicit "refresh" button without blocking.
whatsappRouter.get("/templates", requireAuth, pt.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.whatsappTemplate.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
  });
  if (req.query.refresh === "1") {
    // Fire-and-forget — the /sync endpoint has the actual pull logic.
    void syncTemplatesFromMeta(tenantId).catch((e) => {
      log.warn("background whatsapp template sync failed", {
        tenantId,
        err: e instanceof Error ? e.message : String(e),
      });
    });
  }
  res.json(rows);
});

whatsappRouter.get("/templates/:id", requireAuth, pt.read, async (req, res) => {
  const row = await prisma.whatsappTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// POST /templates — creates the row locally AND submits to Meta. Meta returns
// {id, status: "PENDING"}; we persist Meta's id + status. If Meta rejects, the
// local row still saves so the operator can edit + retry via /templates/sync.
whatsappRouter.post("/templates", requireAuth, pt.create, async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  let localRow;
  try {
    localRow = await prisma.whatsappTemplate.create({
      data: {
        tenantId,
        name: parsed.data.name,
        category: parsed.data.category,
        language: parsed.data.language,
        headerType: parsed.data.headerType ?? null,
        headerText: parsed.data.headerText ?? null,
        bodyText: parsed.data.bodyText,
        footerText: parsed.data.footerText ?? null,
        variables: parsed.data.variables ?? [],
        status: "PENDING",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Template with this name+language already exists" });
    }
    throw e;
  }

  // Try to submit to Meta. If no integration is configured, keep the local
  // row Pending — the operator will re-sync once creds are added.
  const client = await getWhatsappClient(prisma, tenantId);
  if (!client) {
    return res.status(201).json({
      ...localRow,
      note: "Saved locally — no WhatsApp integration configured; template NOT submitted to Meta",
    });
  }

  try {
    const components = buildComponentsForMeta(parsed.data);
    const meta = await client.createTemplate(
      parsed.data.name,
      parsed.data.language,
      parsed.data.category,
      components,
    );
    const updated = await prisma.whatsappTemplate.update({
      where: { id: localRow.id },
      data: {
        wabaTemplateId: meta.id,
        status: meta.status ?? "PENDING",
      },
    });
    return res.status(201).json(updated);
  } catch (e) {
    // Persist the error but still return 201 — the local row exists. The UI
    // surfaces `lastError`-style feedback based on the message.
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("whatsapp template create rejected by meta", { tenantId, msg });
    return res.status(201).json({
      ...localRow,
      status: "REJECTED",
      note: msg.slice(0, 500),
    });
  }
});

// POST /templates/sync — full pull from Meta, upsert into our DB. Idempotent.
// Returns counts (inserted / updated) so the UI can render "synced X".
whatsappRouter.post("/templates/sync", requireAuth, pt.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const r = await syncTemplatesFromMeta(tenantId);
    if (!r) return res.status(400).json({ error: "No WhatsApp integration" });
    res.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: "Meta template list failed", detail: msg });
  }
});

// PATCH /templates/:id — local-only metadata update (Meta doesn't support
// editing templates — you must delete+recreate). We change local fields (e.g.
// friendly name grouping) while leaving Meta-owned status/wabaTemplateId alone.
const patchSchema = z.object({
  headerText: z.string().nullable().optional(),
  footerText: z.string().nullable().optional(),
  variables: z.array(z.string()).optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAUSED"]).optional(),
});

whatsappRouter.patch("/templates/:id", requireAuth, pt.write, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.whatsappTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.whatsappTemplate.update({
    where: { id: existing.id },
    data: {
      headerText: parsed.data.headerText === undefined ? existing.headerText : parsed.data.headerText,
      footerText: parsed.data.footerText === undefined ? existing.footerText : parsed.data.footerText,
      variables: parsed.data.variables === undefined ? existing.variables ?? undefined : parsed.data.variables,
      status: parsed.data.status ?? existing.status,
    },
  });
  res.json(row);
});

// DELETE /templates/:id — delete from Meta + drop the local row.
whatsappRouter.delete("/templates/:id", requireAuth, pt.delete, async (req, res) => {
  const existing = await prisma.whatsappTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const client = await getWhatsappClient(prisma, req.auth!.tenantId);
  if (client) {
    try {
      await client.deleteTemplate(existing.name);
    } catch (e) {
      // Meta returns 404 for already-deleted templates; either way we drop
      // the local row so state converges.
      log.warn("whatsapp template meta delete failed (dropping local anyway)", {
        tenantId: req.auth!.tenantId,
        name: existing.name,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  await prisma.whatsappTemplate.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Send: template + text
// ---------------------------------------------------------------------------

const sendTemplateSchema = z.object({
  to: z.string().min(6),
  templateId: z.string().min(1),
  vars: z.array(z.string()).default([]),
  scheduledFor: z.string().datetime().optional().nullable(),
  linkedDoctype: z.string().optional().nullable(),
  linkedId: z.string().optional().nullable(),
});

// List the tenant's WhatsApp messages — list view consumes this. 100-row
// cap matches the SMS/email list pages. Status + direction filters applied
// client-side so the backend stays simple.
whatsappRouter.get("/messages", requireAuth, pm.read, async (req, res) => {
  const rows = await prisma.whatsappMessage.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(rows);
});

whatsappRouter.post("/send", requireAuth, pm.create, async (req, res) => {
  const parsed = sendTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const tpl = await prisma.whatsappTemplate.findFirst({
    where: { id: parsed.data.templateId, tenantId },
  });
  if (!tpl) return res.status(400).json({ error: "Invalid template" });

  // Render preview body for our own audit log. Meta actually re-renders using
  // the approved template on their side using the positional params.
  const rendered = renderPositional(tpl.bodyText, parsed.data.vars);

  const row = await prisma.whatsappMessage.create({
    data: {
      tenantId,
      direction: "outbound",
      toMobile: parsed.data.to,
      templateId: tpl.id,
      body: rendered,
      senderUserId: req.auth!.userId,
      linkedDoctype: parsed.data.linkedDoctype ?? null,
      linkedId: parsed.data.linkedId ?? null,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      status: "Pending",
    },
  });
  res.status(201).json(row);
});

const sendTextSchema = z.object({
  to: z.string().min(6),
  body: z.string().min(1).max(4096),
  scheduledFor: z.string().datetime().optional().nullable(),
  linkedDoctype: z.string().optional().nullable(),
  linkedId: z.string().optional().nullable(),
});

// POST /send/text — 24h-window session text (must be preceded by an inbound
// message from the recipient in the last 24h — Meta enforces this).
whatsappRouter.post("/send/text", requireAuth, pm.create, async (req, res) => {
  const parsed = sendTextSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const row = await prisma.whatsappMessage.create({
    data: {
      tenantId,
      direction: "outbound",
      toMobile: parsed.data.to,
      body: parsed.data.body,
      senderUserId: req.auth!.userId,
      linkedDoctype: parsed.data.linkedDoctype ?? null,
      linkedId: parsed.data.linkedId ?? null,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      status: "Pending",
    },
  });
  res.status(201).json(row);
});

// POST /process — cron-triggered flush of Pending → Sent. Mirrors the sms
// processor: per-tenant throttle, per-message adapter call, batch abort on
// throttle so the next tick re-tries. Runs on-demand — the scheduler tick
// that hits this endpoint is intentionally NOT wired here (crm-service holds
// no scheduler config); ops enables it via CRON_HTTP_JOBS on the scheduler.
whatsappRouter.post("/process", requireAuth, pm.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const now = new Date();

  const batch = await prisma.whatsappMessage.findMany({
    where: {
      tenantId,
      direction: "outbound",
      status: "Pending",
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  if (batch.length === 0) {
    return res.json({ processed: 0, sent: 0, failed: 0, throttled: 0 });
  }

  const client = await getWhatsappClient(prisma, tenantId);

  let sent = 0;
  let failed = 0;
  let throttled = 0;

  for (const m of batch) {
    if (!client) {
      // No integration — mark Failed with a clean lastError. This is what the
      // UI shows the operator so they know to configure the integration.
      await prisma.whatsappMessage.update({
        where: { id: m.id },
        data: {
          status: "Failed",
          lastError: "No WhatsApp integration",
          attempts: { increment: 1 },
        },
      });
      failed += 1;
      continue;
    }

    const allowed = await takeToken(`whatsapp:${tenantId}`, WHATSAPP_RATE_PER_MIN);
    if (!allowed) {
      throttled += 1;
      break;
    }

    // Mark Sending so a concurrent poll won't re-pick us.
    await prisma.whatsappMessage.update({
      where: { id: m.id },
      data: { status: "Sending", attempts: { increment: 1 } },
    });

    try {
      let result;
      if (m.templateId) {
        // Template send — pull the template to get name + language + variable
        // list. Body is already rendered locally for our audit log; Meta
        // re-renders from the positional vars.
        const tpl = await prisma.whatsappTemplate.findFirst({
          where: { id: m.templateId, tenantId },
        });
        if (!tpl) throw new Error(`Template ${m.templateId} not found for tenant`);
        const vars = extractPositionalVars(tpl.bodyText, m.body);
        result = await client.sendTemplate(m.toMobile, tpl.name, tpl.language, vars);
      } else {
        result = await client.sendText(m.toMobile, m.body);
      }

      await prisma.whatsappMessage.update({
        where: { id: m.id },
        data: {
          status: "Sent",
          sentAt: new Date(),
          providerMessageId: result.wamid,
          lastError: null,
        },
      });
      sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.whatsappMessage.update({
        where: { id: m.id },
        data: {
          status: "Failed",
          lastError: msg.slice(0, 2000),
        },
      });
      failed += 1;
    }
  }
  res.json({
    processed: batch.length,
    sent,
    failed,
    throttled,
    integration: client ? "meta" : "none",
  });
});

// ---------------------------------------------------------------------------
// Webhook (public — Meta signature verified in-router)
// ---------------------------------------------------------------------------

// GET /webhook/:tenantSlug — Meta's one-shot handshake. Query carries
// ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>.
// If verify_token matches the integration's webhookVerifyToken we echo the
// challenge as plain text. Otherwise 401.
whatsappRouter.get("/webhook/:tenantSlug", async (req, res) => {
  const { tenantSlug } = req.params;
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  if (mode !== "subscribe" || !token || !challenge) {
    return res.status(400).end();
  }

  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return res.status(404).end();

  const secrets = await loadWhatsappSecrets(tenantId);
  if (!secrets || secrets.webhookVerifyToken !== token) {
    return res.status(401).end();
  }
  res.type("text/plain").send(challenge);
});

// POST /webhook/:tenantSlug — status events + inbound messages.
// Meta signs the RAW body with the App Secret. We install a route-local
// express.raw() parser so req.body is the untouched Buffer for
// signature verification. We then JSON.parse ourselves after verifying.
whatsappRouter.post(
  "/webhook/:tenantSlug",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    const { tenantSlug } = req.params;

    const rawBuf = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");
    const sigHeader = req.header("x-hub-signature-256") ?? null;

    const tenantId = await resolveTenantId(tenantSlug);
    if (!tenantId) return res.status(404).end();

    const secrets = await loadWhatsappSecrets(tenantId);
    if (!secrets) return res.status(401).end();

    if (!WhatsappClient.verifyWebhookSignature(rawBuf, sigHeader, secrets.appSecret)) {
      if (process.env.DEBUG_WEBHOOK_INBOUND) {
        log.debug("whatsapp webhook signature mismatch", { tenantSlug });
      }
      return res.status(401).end();
    }

    let payload: AnyRecord;
    try {
      payload = JSON.parse(rawBuf.toString("utf8") || "{}") as AnyRecord;
    } catch {
      // Signature was valid but payload isn't JSON — accept + drop so Meta
      // doesn't retry a poisoned event forever.
      return res.status(200).json({ ok: true, note: "unparseable body" });
    }

    const entries: AnyRecord[] = Array.isArray(payload.entry) ? payload.entry : [];
    let statusesProcessed = 0;
    let inboundProcessed = 0;
    for (const entry of entries) {
      const changes: AnyRecord[] = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = (change.value ?? {}) as AnyRecord;

        // Status updates: [{id: "wamid...", status: "delivered"|"read"|..., timestamp}]
        const statuses: AnyRecord[] = Array.isArray(value.statuses) ? value.statuses : [];
        for (const s of statuses) {
          const wamid = String(s.id ?? "");
          const statusRaw = String(s.status ?? "").toLowerCase();
          if (!wamid || !statusRaw) continue;
          try {
            const applied = await applyStatusUpdate(tenantId, wamid, statusRaw);
            if (applied) statusesProcessed += 1;
          } catch {
            /* swallow — see file-header on poison-retry avoidance */
          }
        }

        // Inbound messages: [{from, id: "wamid...", timestamp, type, text?, image?, ...}]
        const messages: AnyRecord[] = Array.isArray(value.messages) ? value.messages : [];
        for (const m of messages) {
          try {
            const created = await createInboundMessage(tenantId, m);
            if (created) inboundProcessed += 1;
          } catch {
            /* swallow */
          }
        }
      }
    }
    res.json({ ok: true, statuses: statusesProcessed, inbound: inboundProcessed });
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve Tenant by URL slug. Uses withCrossTenant() because these routes
 * are unauthenticated — no req.auth to key against.
 */
async function resolveTenantId(tenantSlug: string): Promise<string | null> {
  const t = await prisma.tenant.findFirst(
    withCrossTenant({ where: { slug: tenantSlug }, select: { id: true } }),
  );
  return t?.id ?? null;
}

interface LoadedSecrets {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  appSecret: string;
}

/**
 * Load whatsapp integration secrets straight from prisma. We DON'T reuse
 * getWhatsappClient() here because the webhook path needs to see the
 * verifyToken + appSecret even when accessToken is missing (a partial config
 * still lets us accept signed events for debugging).
 */
async function loadWhatsappSecrets(tenantId: string): Promise<LoadedSecrets | null> {
  const row = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "whatsapp", isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!row) return null;
  let s: Record<string, unknown>;
  try {
    s = decryptSecrets(row.secrets);
  } catch {
    return null;
  }
  const accessToken = typeof s.accessToken === "string" ? s.accessToken : "";
  const phoneNumberId = typeof s.phoneNumberId === "string" ? s.phoneNumberId : "";
  const businessAccountId = typeof s.businessAccountId === "string" ? s.businessAccountId : "";
  const webhookVerifyToken = typeof s.webhookVerifyToken === "string" ? s.webhookVerifyToken : "";
  const appSecret = typeof s.appSecret === "string" ? s.appSecret : "";
  if (!appSecret && !webhookVerifyToken) return null;
  return { accessToken, phoneNumberId, businessAccountId, webhookVerifyToken, appSecret };
}

/**
 * Map Meta's status word to our WhatsappMessage.status enum and stamp the
 * appropriate timestamp. Returns true if we updated a row, false if no wamid
 * match (silent — the message might have been sent through a different
 * channel or predate our persistence).
 */
async function applyStatusUpdate(
  tenantId: string,
  wamid: string,
  metaStatus: string,
): Promise<boolean> {
  const existing = await prisma.whatsappMessage.findFirst({
    where: { tenantId, providerMessageId: wamid },
    select: { id: true, status: true, deliveredAt: true, readAt: true },
  });
  if (!existing) return false;

  const now = new Date();
  const data: {
    status?: string;
    deliveredAt?: Date;
    readAt?: Date;
    lastError?: string;
  } = {};
  switch (metaStatus) {
    case "sent":
      // Idempotent — /process already flipped us to Sent. Skip write if
      // downstream state is more advanced.
      if (existing.status === "Sent" || existing.status === "Delivered" || existing.status === "Read") {
        return true;
      }
      data.status = "Sent";
      break;
    case "delivered":
      if (existing.status === "Read") return true; // don't regress
      data.status = "Delivered";
      if (!existing.deliveredAt) data.deliveredAt = now;
      break;
    case "read":
      data.status = "Read";
      if (!existing.readAt) data.readAt = now;
      if (!existing.deliveredAt) data.deliveredAt = now;
      break;
    case "failed":
      data.status = "Failed";
      data.lastError = "meta:failed";
      break;
    default:
      return false;
  }
  await prisma.whatsappMessage.update({ where: { id: existing.id }, data });
  return true;
}

/**
 * Persist an inbound WhatsApp message. Extract the text body (or use a media
 * placeholder). Returns true on insert, false when the payload was skipped
 * (e.g. unknown type + no body).
 */
async function createInboundMessage(
  tenantId: string,
  m: AnyRecord,
): Promise<boolean> {
  const from = typeof m.from === "string" ? m.from : "";
  const wamid = typeof m.id === "string" ? m.id : null;
  const type = typeof m.type === "string" ? m.type : "text";
  if (!from) return false;

  let body = "";
  let mediaUrl: string | null = null;
  if (type === "text" && m.text?.body) {
    body = String(m.text.body);
  } else if (type === "image" && m.image?.id) {
    body = m.image.caption ? String(m.image.caption) : "[image]";
    mediaUrl = String(m.image.id); // Meta media id — full URL requires a
                                    // signed fetch later
  } else if (type === "document" && m.document?.id) {
    body = m.document.caption ? String(m.document.caption) : `[document: ${m.document.filename ?? ""}]`;
    mediaUrl = String(m.document.id);
  } else if (type === "audio" && m.audio?.id) {
    body = "[audio]";
    mediaUrl = String(m.audio.id);
  } else if (type === "video" && m.video?.id) {
    body = m.video.caption ? String(m.video.caption) : "[video]";
    mediaUrl = String(m.video.id);
  } else if (type === "location" && m.location) {
    body = `[location: ${m.location.latitude},${m.location.longitude}]`;
  } else {
    body = `[${type}]`;
  }

  // De-dup by wamid — Meta retries inbound webhook on 5xx, and each retry
  // carries the same wamid. If we've already stored it, no-op.
  if (wamid) {
    const dup = await prisma.whatsappMessage.findFirst({
      where: { tenantId, direction: "inbound", providerMessageId: wamid },
      select: { id: true },
    });
    if (dup) return false;
  }

  await prisma.whatsappMessage.create({
    data: {
      tenantId,
      direction: "inbound",
      toMobile: "",
      fromMobile: from,
      body,
      mediaUrl,
      status: "Delivered",
      providerMessageId: wamid,
      sentAt: new Date(),
      deliveredAt: new Date(),
    },
  });
  return true;
}

/**
 * Full pull-and-upsert from Meta. Returns null if no integration is
 * configured. Idempotent: template names are unique in Meta's namespace so
 * we can key off (tenantId, name, language).
 */
async function syncTemplatesFromMeta(tenantId: string): Promise<
  { inserted: number; updated: number; total: number } | null
> {
  const client = await getWhatsappClient(prisma, tenantId);
  if (!client) return null;
  const remote = await client.listTemplates();
  let inserted = 0;
  let updated = 0;
  for (const t of remote) {
    const bodyText =
      (t.components ?? [])
        .find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";
    const headerComp = (t.components ?? []).find((c) => c.type?.toUpperCase() === "HEADER");
    const footerComp = (t.components ?? []).find((c) => c.type?.toUpperCase() === "FOOTER");
    const existing = await prisma.whatsappTemplate.findFirst({
      where: {
        tenantId,
        name: t.name,
        language: t.language ?? "en_US",
      },
    });
    if (existing) {
      await prisma.whatsappTemplate.update({
        where: { id: existing.id },
        data: {
          status: t.status ?? existing.status,
          category: t.category ?? existing.category,
          bodyText: bodyText || existing.bodyText,
          headerText: headerComp?.text ?? existing.headerText,
          footerText: footerComp?.text ?? existing.footerText,
          wabaTemplateId: t.id ?? existing.wabaTemplateId,
        },
      });
      updated += 1;
    } else {
      await prisma.whatsappTemplate.create({
        data: {
          tenantId,
          name: t.name,
          language: t.language ?? "en_US",
          category: t.category ?? "UTILITY",
          status: t.status ?? "PENDING",
          bodyText: bodyText || "",
          headerText: headerComp?.text ?? null,
          footerText: footerComp?.text ?? null,
          wabaTemplateId: t.id ?? null,
        },
      });
      inserted += 1;
    }
  }
  return { inserted, updated, total: remote.length };
}

/**
 * Build Meta's components array from our simplified template shape. Meta
 * requires strict ordering (HEADER, BODY, FOOTER, BUTTONS) so we assemble
 * in that order.
 */
function buildComponentsForMeta(
  data: z.infer<typeof templateSchema>,
): Array<{ type: string; format?: string; text?: string }> {
  const components: Array<{ type: string; format?: string; text?: string }> = [];
  if (data.headerType && data.headerText) {
    components.push({
      type: "HEADER",
      format: data.headerType,
      text: data.headerText,
    });
  }
  components.push({ type: "BODY", text: data.bodyText });
  if (data.footerText) {
    components.push({ type: "FOOTER", text: data.footerText });
  }
  return components;
}

/**
 * Simple positional-var renderer. Meta uses {{1}}, {{2}}, ... in the approved
 * template body — we substitute local vars in-order so our audit log matches
 * what the recipient sees. Missing vars render as the raw token.
 */
function renderPositional(body: string, vars: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, idx) => {
    const i = Number(idx) - 1;
    return i >= 0 && i < vars.length ? vars[i]! : m;
  });
}

/**
 * Reverse of renderPositional — best-effort extraction of positional vars
 * from a rendered body given the original template. Falls back to a single
 * "whole body" var when the template shape doesn't include {{n}} tokens.
 * Used by /process to pass params to Meta from our stored body.
 */
function extractPositionalVars(templateBody: string, renderedBody: string): string[] {
  const tokens: number[] = [];
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(templateBody)) !== null) {
    tokens.push(Number(match[1]));
  }
  if (tokens.length === 0) return [];
  // Build a regex where each {{n}} slot becomes a (.+?) capture. Anchored so
  // literal template text has to match. Escape regex meta-chars in the rest.
  const pattern = templateBody
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{\\\{\s*\d+\s*\\\}\\\}/g, "(.+?)");
  const m = new RegExp(`^${pattern}$`, "s").exec(renderedBody);
  if (!m) {
    // Rendering may have lost fidelity — fall back to empty strings so Meta
    // still gets the right slot COUNT (Meta rejects on count mismatch).
    return tokens.map(() => "");
  }
  return m.slice(1);
}

// Exposed for tests + reuse.
export const _internals = {
  resolveTenantId,
  loadWhatsappSecrets,
  applyStatusUpdate,
  createInboundMessage,
  syncTemplatesFromMeta,
  renderPositional,
  extractPositionalVars,
  buildComponentsForMeta,
};
