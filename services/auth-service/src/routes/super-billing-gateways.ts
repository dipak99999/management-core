// Super-admin API for PlatformBillingGateway. Operator configures the
// Razorpay keyId + keySecret + webhookSecret here. Secrets stored
// encrypted via secrets-crypto. UI at /admin/super/billing-gateways.
//
// Only one gateway per (provider, mode) can be active at a time — the
// unique index on the model enforces this at the DB layer, and we also
// deactivate siblings on create/activate to keep the UI consistent.

import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  encryptSecrets,
  decryptSecrets,
  createRazorpayOrder,
} from "@lumaara/db";
import { auditSuperAdmin, requireAuth, requireSuperAdmin } from "@lumaara/service-auth";

export const superBillingGatewaysRouter = Router();
superBillingGatewaysRouter.use(requireAuth, requireSuperAdmin, auditSuperAdmin("super-billing-gateways"));

const PROVIDERS = ["razorpay"] as const; // extend when Stripe/PayPal land

const createSchema = z.object({
  provider: z.enum(PROVIDERS),
  mode: z.enum(["test", "live"]),
  keyId: z.string().min(1).max(200),
  keySecret: z.string().min(1).max(500),
  webhookSecret: z.string().min(1).max(500).optional(),
  isActive: z.boolean().default(true),
});
const patchSchema = createSchema.partial();

function redact(row: {
  id: string;
  provider: string;
  mode: string;
  isActive: boolean;
  config: unknown;
  secrets: unknown;
  lastTestedAt: Date | null;
  lastTestResult: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const config = (row.config ?? {}) as Record<string, unknown>;
  let hasKeySecret = false;
  let hasWebhookSecret = false;
  try {
    const s = decryptSecrets(row.secrets as never);
    hasKeySecret = typeof s.keySecret === "string" && s.keySecret.length > 0;
    hasWebhookSecret = typeof s.webhookSecret === "string" && s.webhookSecret.length > 0;
  } catch {
    // bad ciphertext → treat as missing
  }
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    isActive: row.isActive,
    keyId: typeof config.keyId === "string" ? config.keyId : null,
    hasKeySecret,
    hasWebhookSecret,
    lastTestedAt: row.lastTestedAt,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

superBillingGatewaysRouter.get("/", async (_req, res) => {
  const rows = await prisma.platformBillingGateway.findMany({
    orderBy: [{ provider: "asc" }, { mode: "asc" }],
  });
  res.json(rows.map(redact));
});

superBillingGatewaysRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { provider, mode, keyId, keySecret, webhookSecret, isActive } = parsed.data;

  try {
    const row = await prisma.$transaction(async (tx) => {
      if (isActive) {
        // Only one active row per (provider, mode).
        await tx.platformBillingGateway.updateMany({
          where: { provider, mode, isActive: true },
          data: { isActive: false },
        });
      }
      return tx.platformBillingGateway.create({
        data: {
          provider,
          mode,
          isActive,
          config: { keyId },
          secrets: encryptSecrets({ keySecret, webhookSecret: webhookSecret ?? "" }) as never,
        },
      });
    });
    res.status(201).json(redact(row));
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: `Gateway for ${provider} ${mode} already exists — PATCH or activate instead` });
    }
    throw e;
  }
});

superBillingGatewaysRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.platformBillingGateway.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // Merge secrets — only overwrite the fields the caller provided.
  const existingSecrets = (() => {
    try {
      return decryptSecrets(existing.secrets as never);
    } catch {
      return {};
    }
  })();
  const nextSecrets: Record<string, unknown> = { ...existingSecrets };
  if (parsed.data.keySecret !== undefined) nextSecrets.keySecret = parsed.data.keySecret;
  if (parsed.data.webhookSecret !== undefined) nextSecrets.webhookSecret = parsed.data.webhookSecret;

  const existingConfig = (existing.config ?? {}) as Record<string, unknown>;
  const nextConfig: Record<string, unknown> = { ...existingConfig };
  if (parsed.data.keyId !== undefined) nextConfig.keyId = parsed.data.keyId;

  const row = await prisma.$transaction(async (tx) => {
    if (parsed.data.isActive === true) {
      await tx.platformBillingGateway.updateMany({
        where: {
          provider: parsed.data.provider ?? existing.provider,
          mode: parsed.data.mode ?? existing.mode,
          isActive: true,
          NOT: { id: existing.id },
        },
        data: { isActive: false },
      });
    }
    return tx.platformBillingGateway.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.provider ? { provider: parsed.data.provider } : {}),
        ...(parsed.data.mode ? { mode: parsed.data.mode } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        config: nextConfig as never,
        secrets: encryptSecrets(nextSecrets) as never,
      },
    });
  });
  res.json(redact(row));
});

superBillingGatewaysRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.platformBillingGateway.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.platformBillingGateway.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// Live round-trip test — create a tiny ₹1 order to prove the keys work.
// We cancel the order immediately via Razorpay's dashboard? No — orders
// in `created` state don't charge anything. They expire within 24h if
// unpaid. Still a side effect operators should be aware of.
superBillingGatewaysRouter.post("/:id/test", async (req, res) => {
  const row = await prisma.platformBillingGateway.findUnique({
    where: { id: req.params.id },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const config = (row.config ?? {}) as Record<string, unknown>;
  let keySecret = "";
  try {
    const s = decryptSecrets(row.secrets as never);
    keySecret = typeof s.keySecret === "string" ? s.keySecret : "";
  } catch {
    return res.status(400).json({ error: "Stored secret is corrupt — re-save" });
  }
  const keyId = typeof config.keyId === "string" ? config.keyId : "";
  if (!keyId || !keySecret) {
    return res.status(400).json({ error: "Missing keyId or keySecret" });
  }
  try {
    const order = await createRazorpayOrder({
      keyId,
      keySecret,
      amount: 1, // ₹1 — minimum. Order expires if unpaid; nothing charged.
      currency: "INR",
      receipt: `test_${Date.now()}`,
      notes: { purpose: "connectivity-test" },
    });
    await prisma.platformBillingGateway.update({
      where: { id: row.id },
      data: {
        lastTestedAt: new Date(),
        lastTestResult: `ok: order ${order.id} created`,
      },
    });
    res.json({ ok: true, orderId: order.id, keyId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.platformBillingGateway.update({
      where: { id: row.id },
      data: { lastTestedAt: new Date(), lastTestResult: msg.slice(0, 300) },
    });
    res.status(502).json({ ok: false, error: msg });
  }
});
