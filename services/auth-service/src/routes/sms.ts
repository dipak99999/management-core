import { Router } from "express";
import { z } from "zod";
import { getSmsAdapter, NoSmsProviderError, prisma, renderTemplate } from "@lumaara/db";
import { takeToken } from "@lumaara/queue";
import { getLogger, perms, requireAuth } from "@lumaara/service-auth";

const log = getLogger("auth-service").child({ component: "sms" });

// F3: SMS templates + queue.
//
// P2 wiring: `POST /sms/process` now resolves a real provider per-tenant via
// `getSmsAdapter` (Twilio / MSG91 / Test). Adapter throws on 4xx/5xx which
// we catch → SmsMessage.status="Failed" + lastError. On success we persist
// `providerName` + `providerMessageId` so the delivery-receipt webhook
// (services/crm-service/src/routes/sms-webhooks.ts) can find the row.
//
// Rate limit: reuse the shared token-bucket (see @lumaara/queue). Default
// 60/min per tenant — SMS is expensive so we default conservative; ops can
// tune per-tenant later. Throttled rows stay Pending and the batch aborts
// (same shape as the email processor).

export const smsTemplateRouter = Router();
export const smsMessageRouter = Router();
smsTemplateRouter.use(requireAuth);
smsMessageRouter.use(requireAuth);

const pt = perms("SmsTemplate");
const pm = perms("SmsMessage");

// Default sends-per-minute per tenant when no explicit override is provided.
// SMS pricing is materially higher than email; a 60/min ceiling gives ops a
// cheap circuit-breaker without needing a config change on day one.
const DEFAULT_SMS_RATE_PER_MIN = 60;

// ---- Templates ----

const templateSchema = z.object({
  name: z.string().min(1),
  body: z.string().min(1).max(1600),
  enabled: z.boolean().default(true),
});

smsTemplateRouter.get("/", pt.read, async (req, res) => {
  const rows = await prisma.smsTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

smsTemplateRouter.post("/", pt.create, async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.smsTemplate.create({
      data: { tenantId: req.auth!.tenantId, ...parsed.data },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Template name already exists" });
    throw e;
  }
});

smsTemplateRouter.delete("/:id", pt.delete, async (req, res) => {
  const existing = await prisma.smsTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.smsTemplate.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---- Messages ----

const smsSchema = z.object({
  toMobile: z.string().min(6),
  body: z.string().min(1),
  scheduledFor: z.string().datetime().optional().nullable(),
  linkedDoctype: z.string().optional().nullable(),
  linkedId: z.string().optional().nullable(),
});

const smsFromTemplateSchema = z.object({
  templateId: z.string().min(1),
  toMobile: z.string().min(6),
  vars: z.record(z.unknown()).default({}),
  scheduledFor: z.string().datetime().optional().nullable(),
  linkedDoctype: z.string().optional().nullable(),
  linkedId: z.string().optional().nullable(),
});

smsMessageRouter.get("/", pm.read, async (req, res) => {
  const rows = await prisma.smsMessage.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

smsMessageRouter.post("/send", pm.create, async (req, res) => {
  const parsed = smsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.smsMessage.create({
    data: {
      tenantId: req.auth!.tenantId,
      senderUserId: req.auth!.userId,
      ...parsed.data,
      scheduledFor: parsed.data.scheduledFor
        ? new Date(parsed.data.scheduledFor)
        : null,
    },
  });
  res.status(201).json(row);
});

smsMessageRouter.post("/send-from-template", pm.create, async (req, res) => {
  const parsed = smsFromTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const tpl = await prisma.smsTemplate.findFirst({
    where: { id: parsed.data.templateId, tenantId, enabled: true },
  });
  if (!tpl) return res.status(400).json({ error: "Invalid or disabled template" });
  const body = renderTemplate(tpl.body, parsed.data.vars as Record<string, unknown>);
  const row = await prisma.smsMessage.create({
    data: {
      tenantId,
      senderUserId: req.auth!.userId,
      toMobile: parsed.data.toMobile,
      body,
      templateId: tpl.id,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      linkedDoctype: parsed.data.linkedDoctype ?? null,
      linkedId: parsed.data.linkedId ?? null,
    },
  });
  res.status(201).json(row);
});

smsMessageRouter.post("/process", pm.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const now = new Date();
  const batch = await prisma.smsMessage.findMany({
    where: {
      tenantId,
      status: "Pending",
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  if (batch.length === 0)
    return res.json({ processed: 0, sent: 0, failed: 0, throttled: 0 });

  // Resolve the adapter once per batch — every row shares the same tenant,
  // so the TenantIntegration lookup only runs once. If resolution itself
  // fails (e.g. bad secrets encryption) the whole batch fails uniformly.
  let adapter;
  try {
    adapter = await getSmsAdapter(prisma, tenantId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("sms adapter resolution failed", { tenantId, msg });
    // 503 (not 500) for the "unconfigured" case — tells the caller it's
    // a config problem they can fix, not a server bug.
    if (e instanceof NoSmsProviderError) {
      return res.status(503).json({ error: "SMS not configured", detail: msg });
    }
    return res.status(500).json({ error: "SMS provider misconfigured", detail: msg });
  }

  let sent = 0;
  let failed = 0;
  let throttled = 0;
  for (const m of batch) {
    // Per-tenant throttle. Break the loop when the bucket is empty — the
    // scheduler will re-tick us shortly. We deliberately DO NOT bump the
    // attempts counter for throttled rows: they never left the mailbox.
    const allowed = await takeToken(`sms:${tenantId}`, DEFAULT_SMS_RATE_PER_MIN);
    if (!allowed) {
      throttled += 1;
      break;
    }

    // Mark Sending so a concurrent poll from another node won't re-pick it.
    await prisma.smsMessage.update({
      where: { id: m.id },
      data: { status: "Sending", attempts: { increment: 1 } },
    });
    try {
      const { providerMessageId } = await adapter.send({
        to: m.toMobile,
        body: m.body,
      });
      await prisma.smsMessage.update({
        where: { id: m.id },
        data: {
          status: "Sent",
          sentAt: new Date(),
          providerMessageId,
          providerName: adapter.providerName,
          lastError: null,
        },
      });
      sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.smsMessage.update({
        where: { id: m.id },
        data: {
          status: "Failed",
          providerName: adapter.providerName,
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
    provider: adapter.providerName,
  });
});
