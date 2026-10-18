import { Router } from "express";
import {
  Prisma,
  decryptSecrets,
  nextName,
  prisma,
  verifyHmac,
  verifyStripeWebhookSignature,
} from "@lumaara/db";
import { createHmac } from "node:crypto";
import { submitPaymentEntryTx } from "../lib/pe-submit";

// L5: Incoming webhook receiver.
//   POST /webhooks/incoming/:integrationId
// Body is verified against the integration's provider signature (Razorpay
// uses HMAC-SHA256 with the webhook secret; Slack uses its own scheme —
// unimplemented; generic/webhook uses the integration.secrets.hmacSecret).
//
// De-duplication: (provider, externalId) is unique on IntegrationEvent, so
// repeated deliveries of the same event won't double-process.
//
// Razorpay `payment.captured` events, when they carry a `notes.invoice_id`
// pointing to an lumaara SalesInvoice, create + submit a PaymentEntry
// against that invoice (mirrors the portal payment upload flow but
// auto-submits since the gateway already verified the money moved).

export const webhookReceiverRouter = Router();

// Body has to be captured raw for signature verification. Attach a
// path-scoped raw parser (bypasses the app-wide express.json).
import express from "express";
const rawParser = express.raw({ type: "*/*", limit: "1mb" });

webhookReceiverRouter.post("/incoming/:integrationId", rawParser, async (req, res) => {
  const integration = await prisma.tenantIntegration.findUnique({
    where: { id: req.params.integrationId },
  });
  if (!integration || !integration.isActive)
    return res.status(404).json({ error: "Integration not found" });

  const bodyBuf = req.body as Buffer;
  const bodyStr = bodyBuf.toString("utf8");
  const secrets = decryptSecrets(integration.secrets) as Record<string, string>;

  let externalId: string;
  let eventKey: string;
  let payload: Record<string, unknown>;

  try {
    if (integration.provider === "razorpay") {
      const sig = req.header("x-razorpay-signature") ?? "";
      if (!secrets.webhookSecret)
        return res.status(500).json({ error: "webhookSecret not configured" });
      const expected = createHmac("sha256", secrets.webhookSecret)
        .update(bodyStr)
        .digest("hex");
      if (expected !== sig)
        return res.status(401).json({ error: "Invalid signature" });
      const parsed = JSON.parse(bodyStr) as {
        event: string;
        payload?: {
          payment?: { entity?: Record<string, unknown> };
        };
      };
      eventKey = parsed.event;
      externalId = String(
        (parsed.payload?.payment?.entity as Record<string, unknown>)?.id ??
          `noid-${Date.now()}`,
      );
      payload = parsed as unknown as Record<string, unknown>;
    } else if (integration.provider === "stripe") {
      const sig = req.header("stripe-signature") ?? "";
      if (!secrets.webhookSecret)
        return res.status(500).json({ error: "webhookSecret not configured" });
      if (!verifyStripeWebhookSignature(secrets.webhookSecret, bodyStr, sig))
        return res.status(401).json({ error: "Invalid signature" });
      const parsed = JSON.parse(bodyStr) as {
        id: string;
        type: string;
        data?: { object?: Record<string, unknown> };
      };
      eventKey = parsed.type;
      // externalId is the event.id so retries of the same event de-dupe;
      // Stripe guarantees event.id is unique per event.
      externalId = String(parsed.id ?? `noid-${Date.now()}`);
      payload = parsed as unknown as Record<string, unknown>;
    } else {
      // Generic HMAC verification against integration.secrets.hmacSecret.
      const sig =
        req.header("x-lumaara-signature") ??
        req.header("x-signature") ??
        "";
      if (!secrets.hmacSecret)
        return res.status(500).json({ error: "hmacSecret not configured" });
      if (!verifyHmac(secrets.hmacSecret, bodyStr, sig))
        return res.status(401).json({ error: "Invalid signature" });
      const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
      eventKey = String(parsed.event ?? "unknown");
      externalId = String(
        parsed.id ?? parsed.externalId ?? `noid-${Date.now()}`,
      );
      payload = parsed;
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  // De-dup: unique on (tenant, provider, externalId).
  try {
    const evt = await prisma.integrationEvent.create({
      data: {
        tenantId: integration.tenantId,
        integrationId: integration.id,
        provider: integration.provider,
        eventKey,
        externalId,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    const isRazorpayCapture =
      integration.provider === "razorpay" && eventKey === "payment.captured";
    const isStripeSucceeded =
      integration.provider === "stripe" && eventKey === "payment_intent.succeeded";

    if (isRazorpayCapture || isStripeSucceeded) {
      try {
        if (isRazorpayCapture) {
          await handleRazorpayPaymentCaptured(evt.id, integration.tenantId, payload);
        } else {
          await handleStripePaymentSucceeded(evt.id, integration.tenantId, payload);
        }
        await prisma.integrationEvent.update({
          where: { id: evt.id },
          data: { status: "Processed", processedAt: new Date() },
        });
      } catch (e) {
        await prisma.integrationEvent.update({
          where: { id: evt.id },
          data: {
            status: "Failed",
            error: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
          },
        });
      }
    }

    return res.json({ ok: true, eventId: evt.id });
  } catch (e) {
    // Unique constraint = duplicate; treat as OK (idempotent) but don't
    // reprocess.
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.json({ ok: true, duplicate: true });
    throw e;
  }
});

interface RazorpayPaymentEntity {
  id: string;
  amount: number; // paise
  currency: string;
  method?: string;
  notes?: Record<string, string>;
  status?: string;
}

async function handleRazorpayPaymentCaptured(
  eventId: string,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const entity = (payload as unknown as {
    payload?: { payment?: { entity?: RazorpayPaymentEntity } };
  }).payload?.payment?.entity;
  if (!entity) throw new Error("Missing payment entity");
  const invoiceId = entity.notes?.invoice_id;
  const customerId = entity.notes?.customer_id;
  if (!invoiceId || !customerId)
    throw new Error("Missing notes.invoice_id or notes.customer_id");

  // Verify the invoice belongs to the tenant + customer.
  const inv = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, tenantId, customerId },
  });
  if (!inv) throw new Error("Invoice not found or wrong customer");

  // amount is in paise — convert to rupees. Divide as Decimal so a payment
  // like 100099 paise records as ₹1000.99, not ₹1000.99000000000001.
  const amount = new Prisma.Decimal(entity.amount).div(100);

  // Create + submit in one transaction. The gateway already verified the
  // money moved (signature checked upstream), so the PE goes straight to
  // Submitted — GL posts, invoice outstanding reduces, schedule allocates.
  await prisma.$transaction(async (tx) => {
    const name = await nextName(tx, tenantId, "PE-");
    const pe = await tx.paymentEntry.create({
      data: {
        tenantId,
        name,
        paymentType: "Receive",
        partyType: "Customer",
        partyId: customerId,
        paidAmount: amount,
        currency: entity.currency ?? "INR",
        modeOfPayment: "Bank",
        remarks: `[Razorpay ${entity.id}] event=${eventId}`,
        status: "Draft",
        references: {
          create: [
            {
              referenceDoctype: "SalesInvoice",
              referenceId: inv.id,
              allocatedAmount: amount,
            },
          ],
        },
      },
    });
    await submitPaymentEntryTx(tx, { tenantId, peId: pe.id });
  });
}

// Stripe PaymentIntent zero-decimal currencies use the raw amount, all others
// divide by 100 (mirrors createStripePaymentIntent's smallest-unit conversion).
const STRIPE_ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw",
  "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

interface StripePaymentIntentEntity {
  id: string;
  amount: number;
  amount_received?: number;
  currency: string;
  status?: string;
  metadata?: Record<string, string>;
}

async function handleStripePaymentSucceeded(
  eventId: string,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const entity = (payload as unknown as {
    data?: { object?: StripePaymentIntentEntity };
  }).data?.object;
  if (!entity) throw new Error("Missing payment_intent entity");
  const invoiceId = entity.metadata?.invoice_id;
  const customerId = entity.metadata?.customer_id;
  if (!invoiceId || !customerId)
    throw new Error("Missing metadata.invoice_id or metadata.customer_id");

  const inv = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, tenantId, customerId },
  });
  if (!inv) throw new Error("Invoice not found or wrong customer");

  const rawAmount = entity.amount_received ?? entity.amount;
  const currency = (entity.currency ?? inv.currency).toLowerCase();
  // Divide as Decimal so 100099 minor-units records as 1000.99 exactly.
  const amount = STRIPE_ZERO_DECIMAL.has(currency)
    ? new Prisma.Decimal(rawAmount)
    : new Prisma.Decimal(rawAmount).div(100);

  // Same pattern as Razorpay — Stripe signature-verified the amount, so
  // the PE auto-submits: GL posts, invoice outstanding reduces.
  await prisma.$transaction(async (tx) => {
    const name = await nextName(tx, tenantId, "PE-");
    const pe = await tx.paymentEntry.create({
      data: {
        tenantId,
        name,
        paymentType: "Receive",
        partyType: "Customer",
        partyId: customerId,
        paidAmount: amount,
        currency: currency.toUpperCase(),
        modeOfPayment: "Card",
        remarks: `[Stripe ${entity.id}] event=${eventId}`,
        status: "Draft",
        references: {
          create: [
            {
              referenceDoctype: "SalesInvoice",
              referenceId: inv.id,
              allocatedAmount: amount,
            },
          ],
        },
      },
    });
    await submitPaymentEntryTx(tx, { tenantId, peId: pe.id });
  });
}
