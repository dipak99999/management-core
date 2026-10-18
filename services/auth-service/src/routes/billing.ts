// Tenant-facing billing routes.
//
// Flow (checkout):
//   1. POST /billing/orders { planId }
//      → server resolves plan, creates Razorpay order, persists a
//        BillingInvoice(status=created) + returns {orderId, keyId, amount, currency}
//   2. Browser opens Razorpay Checkout with those values
//   3. On success Checkout returns {razorpay_order_id, razorpay_payment_id,
//      razorpay_signature}; browser POSTs to /billing/verify
//   4. Server verifies signature, flips invoice to paid, upserts
//      TenantSubscription (activates the plan), returns the fresh plan
//
// Flow (webhook — authoritative source of truth):
//   POST /billing/webhook with Razorpay JSON body + x-razorpay-signature
//   → verifyWebhookSignature(rawBody) MUST pass before any state change
//   → idempotent via BillingEvent.upstreamId unique index — Razorpay
//     retries up to 24h; we recognize + no-op the repeats
//
// GET /billing/invoices — tenant-scoped history
// GET /billing/subscription — the tenant's current active sub + next bill date
//
// Rate limited: billing endpoints are not high-volume; apiLimiter covers it.

import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  prisma,
  createPlatformOrder,
  resolveRazorpayCreds,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchPayment,
  NoBillingGatewayError,
} from "@lumaara/db";
import {
  requireAuth,
  getLogger,
  invalidateSubscriptionCache,
} from "@lumaara/service-auth";

const log = getLogger("auth-service:billing");

export const billingRouter = Router();
billingRouter.use(requireAuth);

const createOrderSchema = z.object({ planId: z.string().min(1) });

billingRouter.post("/orders", async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const plan = await prisma.subscriptionPlan.findFirst({
    where: { id: parsed.data.planId, tenantId },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found for this tenant" });
  if (Number(plan.priceMonthlyInr) <= 0) {
    return res.status(400).json({ error: "This plan is free — no payment required" });
  }

  try {
    const order = await createPlatformOrder({
      amountInr: Number(plan.priceMonthlyInr),
      receipt: `tenant_${tenantId.slice(0, 8)}_plan_${plan.id.slice(0, 8)}_${Date.now()}`,
      notes: { tenantId, planId: plan.id, userId: req.auth!.userId },
    });
    const invoice = await prisma.billingInvoice.create({
      data: {
        tenantId,
        planId: plan.id,
        provider: "razorpay",
        upstreamOrderId: order.id,
        amountInr: plan.priceMonthlyInr,
        currency: "INR",
        status: "created",
        metadata: { planName: plan.name, planTier: plan.tier, userId: req.auth!.userId },
      },
    });
    res.json({
      orderId: order.id,
      keyId: order.keyId,
      amount: order.amount, // paise — matches what Checkout expects
      currency: order.currency,
      invoiceId: invoice.id,
      planName: plan.name,
    });
  } catch (e) {
    if (e instanceof NoBillingGatewayError) {
      return res.status(503).json({ error: e.message });
    }
    log.error("create order failed", { err: e instanceof Error ? e.message : String(e) });
    res.status(502).json({ error: "Payment gateway upstream failed" });
  }
});

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

billingRouter.post("/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  let creds;
  try {
    creds = await resolveRazorpayCreds();
  } catch {
    return res.status(503).json({ error: "Billing gateway not configured" });
  }

  // Signature-verify FIRST — never trust the browser-reported paymentId
  // before this check. Timing-safe compare lives inside the helper.
  const sigOk = verifyPaymentSignature(
    creds.keySecret,
    parsed.data.razorpay_order_id,
    parsed.data.razorpay_payment_id,
    parsed.data.razorpay_signature,
  );
  if (!sigOk) {
    log.warn("signature mismatch on /billing/verify", {
      tenantId,
      orderId: parsed.data.razorpay_order_id,
    });
    return res.status(400).json({ error: "Payment signature invalid" });
  }

  // Look up the invoice we created at order time + confirm it belongs to
  // this tenant. Prevents a cross-tenant replay even if someone leaked
  // another tenant's order_id.
  const invoice = await prisma.billingInvoice.findFirst({
    where: {
      tenantId,
      upstreamOrderId: parsed.data.razorpay_order_id,
    },
  });
  if (!invoice) return res.status(404).json({ error: "No invoice for this order" });
  if (invoice.status === "paid") {
    // Already processed — idempotent. Return the current subscription.
    const sub = invoice.subscriptionId
      ? await prisma.tenantSubscription.findUnique({ where: { id: invoice.subscriptionId } })
      : null;
    return res.json({ ok: true, alreadyProcessed: true, subscription: sub });
  }

  // Double-check with Razorpay that the payment is actually captured — the
  // signature only proves authenticity, not state. A sophisticated attacker
  // can't forge both, but a canceled-then-re-attempted flow could still
  // reach us with a stale signature.
  let payment;
  try {
    payment = await fetchPayment(creds, parsed.data.razorpay_payment_id);
  } catch (e) {
    log.error("payment fetch failed", { err: e instanceof Error ? e.message : String(e) });
    return res.status(502).json({ error: "Unable to verify payment with Razorpay" });
  }
  if (payment.order_id !== parsed.data.razorpay_order_id) {
    return res.status(400).json({ error: "Payment does not belong to this order" });
  }
  if (!payment.captured || payment.status !== "captured") {
    return res.status(400).json({
      error: `Payment is not captured yet (status=${payment.status}). Retry when the gateway has settled.`,
    });
  }

  // Activate the subscription + mark the invoice paid in one txn.
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  const sub = await prisma.$transaction(async (tx) => {
    await tx.tenantSubscription.updateMany({
      where: { tenantId, isActive: true },
      data: { isActive: false, endDate: new Date() },
    });
    const newSub = await tx.tenantSubscription.create({
      data: {
        tenantId,
        planId: invoice.planId!,
        isActive: true,
        startDate: periodStart,
        gatewayProvider: "razorpay",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextBillingAt: periodEnd,
      },
    });
    await tx.billingInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "paid",
        upstreamPaymentId: parsed.data.razorpay_payment_id,
        subscriptionId: newSub.id,
        periodStart,
        periodEnd,
      },
    });
    return newSub;
  });
  invalidateSubscriptionCache(tenantId);
  res.json({ ok: true, subscription: sub });
});

billingRouter.get("/invoices", async (req, res) => {
  const invoices = await prisma.billingInvoice.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(invoices);
});

billingRouter.get("/subscription", async (req, res) => {
  const sub = await prisma.tenantSubscription.findFirst({
    where: { tenantId: req.auth!.tenantId, isActive: true },
    include: { plan: true },
    orderBy: { startDate: "desc" },
  });
  res.json(sub);
});

// ─────────────────────────────────────────────────────────────────────
// Webhook. Mounted separately in index.ts WITHOUT requireAuth and WITH
// express.raw() so we see the untouched bytes for signature verification.
// Any mutation of state must gate on verifyWebhookSignature.
// ─────────────────────────────────────────────────────────────────────

export const billingWebhookRouter = Router();

billingWebhookRouter.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "512kb" }),
  async (req: Request, res: Response) => {
    const sig = req.header("x-razorpay-signature") ?? "";
    const rawBody = (req.body as Buffer) ?? Buffer.alloc(0);

    let creds;
    try {
      creds = await resolveRazorpayCreds();
    } catch {
      // Return 200 so Razorpay stops retrying — operator needs to notice
      // via the dashboard that we're not configured. Non-200 would spam
      // their retry queue indefinitely.
      log.warn("webhook received but no gateway configured");
      return res.status(200).json({ ok: false, reason: "gateway-not-configured" });
    }

    if (!creds.webhookSecret) {
      log.warn("webhook received but no webhookSecret configured");
      return res.status(200).json({ ok: false, reason: "webhook-secret-not-configured" });
    }
    if (!verifyWebhookSignature(creds.webhookSecret, rawBody, sig)) {
      log.warn("webhook signature invalid — ignoring");
      return res.status(401).json({ error: "signature invalid" });
    }

    let event: {
      event?: string;
      id?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; notes?: Record<string, string> } } };
    };
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "invalid json" });
    }
    const eventType = event.event ?? "unknown";
    const upstreamId = event.id ?? `${eventType}-${Date.now()}`;

    // Idempotency via unique(provider, upstreamId). If we've seen this id
    // before, no-op and return 200 — Razorpay retries indefinitely.
    try {
      await prisma.billingEvent.create({
        data: {
          provider: "razorpay",
          eventType,
          upstreamId,
          payload: event as never,
          tenantId:
            event.payload?.payment?.entity?.notes?.tenantId ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes("Unique constraint")) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      throw e;
    }

    // Process the event — currently we only act on payment.captured.
    // Other events are logged in BillingEvent for future reconciliation
    // but don't drive state transitions (verify + checkout flow is
    // authoritative for subscription activation).
    try {
      if (eventType === "payment.captured") {
        const p = event.payload?.payment?.entity;
        if (p?.order_id) {
          const invoice = await prisma.billingInvoice.findFirst({
            where: { upstreamOrderId: p.order_id },
          });
          if (invoice && invoice.status !== "paid") {
            await prisma.billingInvoice.update({
              where: { id: invoice.id },
              data: { status: "paid", upstreamPaymentId: p.id ?? null },
            });
            log.info("webhook: invoice marked paid", { invoiceId: invoice.id });
          }
        }
      }
      await prisma.billingEvent.updateMany({
        where: { provider: "razorpay", upstreamId },
        data: { processedAt: new Date() },
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.billingEvent.updateMany({
        where: { provider: "razorpay", upstreamId },
        data: { processError: msg.slice(0, 300) },
      });
      log.error("webhook processing failed", { eventType, upstreamId, err: msg });
      // 500 so Razorpay retries — a transient DB failure shouldn't drop
      // the event entirely.
      return res.status(500).json({ error: "processing failed" });
    }
  },
);
