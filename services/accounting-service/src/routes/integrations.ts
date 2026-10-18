import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  INTEGRATION_CATALOG,
  catalogFor,
  encryptSecrets,
  generateSigningSecret,
  prisma,
  processWebhookDeliveries,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// L1-L2: TenantIntegration CRUD. Secrets are treated as opaque, redacted on
// read. Only the isDefault flag is transactional (one default per provider).

export const integrationRouter = Router();
export const webhookSubscriptionRouter = Router();
export const webhookDeliveryRouter = Router();

const pI = perms("TenantIntegration");
const pW = perms("WebhookSubscription");

const PROVIDERS = [
  "razorpay",
  "stripe",
  "slack",
  "s3",
  "smtp",
  "google-calendar",
  "webhook",
  "custom",
] as const;

const integrationSchema = z.object({
  provider: z.enum(PROVIDERS),
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
  secrets: z.record(z.unknown()).default({}),
});

function redactSecrets(stored: unknown): Record<string, string> {
  // Encrypted blobs never expose the plaintext — surface a summary of key
  // names only. For legacy unencrypted rows we still redact each value.
  const s = (stored ?? {}) as Record<string, unknown>;
  if (s && (s as { enc?: unknown }).enc === true) {
    // Client sees "keys were set", not their names.
    return { _encrypted: "true" };
  }
  const bag =
    s && (s as { enc?: unknown }).enc === false
      ? ((s as { data?: Record<string, unknown> }).data ?? {})
      : s;
  const out: Record<string, string> = {};
  for (const k of Object.keys(bag)) {
    const v = (bag as Record<string, unknown>)[k];
    if (typeof v === "string" && v.length > 0) {
      out[k] = v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-2)}` : "•••";
    } else {
      out[k] = "";
    }
  }
  return out;
}

integrationRouter.get("/", pI.read, async (req, res) => {
  const rows = await prisma.tenantIntegration.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ provider: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  res.json(
    rows.map((r) => ({ ...r, secrets: redactSecrets(r.secrets) })),
  );
});

// Catalog — the canonical list of supported providers + secret field
// specs. Renders the admin "Add integration" form.
integrationRouter.get("/catalog", pI.read, async (_req, res) => {
  res.json(INTEGRATION_CATALOG);
});

integrationRouter.get("/catalog/:slug", pI.read, async (req, res) => {
  const spec = catalogFor(req.params.slug);
  if (!spec) return res.status(404).json({ error: "Unknown provider" });
  res.json(spec);
});

integrationRouter.post("/", pI.create, async (req, res) => {
  const parsed = integrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.tenantIntegration.updateMany({
          where: { tenantId, provider: parsed.data.provider, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.tenantIntegration.create({
        data: {
          tenantId,
          provider: parsed.data.provider,
          name: parsed.data.name,
          isActive: parsed.data.isActive,
          isDefault: parsed.data.isDefault,
          config: parsed.data.config as unknown as Prisma.InputJsonValue,
          secrets: encryptSecrets(parsed.data.secrets) as unknown as Prisma.InputJsonValue,
        },
      });
    });
    res.status(201).json({ ...row, secrets: redactSecrets(row.secrets) });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Integration name already exists for this provider" });
    throw e;
  }
});

integrationRouter.put("/:id", pI.write, async (req, res) => {
  const parsed = integrationSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.tenantIntegration.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault === true) {
      await tx.tenantIntegration.updateMany({
        where: {
          tenantId,
          provider: existing.provider,
          isDefault: true,
          NOT: { id: existing.id },
        },
        data: { isDefault: false },
      });
    }
    return tx.tenantIntegration.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name ?? existing.name,
        isActive: parsed.data.isActive ?? existing.isActive,
        isDefault: parsed.data.isDefault ?? existing.isDefault,
        ...(parsed.data.config !== undefined
          ? { config: parsed.data.config as unknown as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.secrets !== undefined
          ? {
              secrets: encryptSecrets(
                parsed.data.secrets,
              ) as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  });
  res.json({ ...row, secrets: redactSecrets(row.secrets) });
});

integrationRouter.delete("/:id", pI.delete, async (req, res) => {
  const existing = await prisma.tenantIntegration.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.tenantIntegration.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- L3: Webhook subscriptions ----------

const subSchema = z.object({
  name: z.string().min(1),
  targetUrl: z.string().url(),
  events: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  integrationId: z.string().optional().nullable(),
});

webhookSubscriptionRouter.get("/", pW.read, async (req, res) => {
  const rows = await prisma.webhookSubscription.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { deliveries: true } } },
    orderBy: { createdAt: "desc" },
  });
  // Redact signing secret on read.
  res.json(rows.map((r) => ({ ...r, signingSecret: `${r.signingSecret.slice(0, 4)}…` })));
});

webhookSubscriptionRouter.post("/", pW.create, async (req, res) => {
  const parsed = subSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const signingSecret = generateSigningSecret();
  try {
    const row = await prisma.webhookSubscription.create({
      data: {
        tenantId,
        name: parsed.data.name,
        targetUrl: parsed.data.targetUrl,
        events: parsed.data.events,
        isActive: parsed.data.isActive,
        integrationId: parsed.data.integrationId ?? null,
        signingSecret,
      },
    });
    // Return the signing secret in full ONCE on create so the user can copy it.
    res.status(201).json({ ...row, signingSecret });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Subscription name already exists" });
    throw e;
  }
});

webhookSubscriptionRouter.put("/:id", pW.write, async (req, res) => {
  const parsed = subSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.webhookSubscription.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.webhookSubscription.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json({ ...row, signingSecret: `${row.signingSecret.slice(0, 4)}…` });
});

webhookSubscriptionRouter.post("/:id/rotate-secret", pW.write, async (req, res) => {
  const existing = await prisma.webhookSubscription.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const signingSecret = generateSigningSecret();
  const row = await prisma.webhookSubscription.update({
    where: { id: existing.id },
    data: { signingSecret },
  });
  res.json({ ...row, signingSecret });
});

webhookSubscriptionRouter.delete("/:id", pW.delete, async (req, res) => {
  const existing = await prisma.webhookSubscription.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.webhookSubscription.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- Delivery viewer + processor ----------

webhookDeliveryRouter.get("/", pW.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const subscriptionId =
    typeof req.query.subscriptionId === "string" ? req.query.subscriptionId : undefined;
  const rows = await prisma.webhookDelivery.findMany({
    where: {
      tenantId,
      ...(status ? { status } : {}),
      ...(subscriptionId ? { subscriptionId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

webhookDeliveryRouter.post("/process", pW.submit, async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  const r = await processWebhookDeliveries(prisma, { limit });
  res.json(r);
});

webhookDeliveryRouter.post("/:id/retry", pW.write, async (req, res) => {
  const existing = await prisma.webhookDelivery.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Delivered")
    return res.status(400).json({ error: "Already delivered" });
  await prisma.webhookDelivery.update({
    where: { id: existing.id },
    data: { status: "Pending", lastError: null, scheduledFor: null },
  });
  res.json({ ok: true });
});
