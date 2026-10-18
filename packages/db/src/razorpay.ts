// L6: Razorpay adapter.
//
// Low-level primitives (used by the finance module's customer-facing
// invoice payments):
//   createRazorpayOrder({keyId, keySecret, amount, …})
//     → POST /v1/orders on api.razorpay.com with Basic auth
//   verifyPaymentSignature(secret, orderId, paymentId, signature)
//     → HMAC-SHA256(orderId + "|" + paymentId) — used by the client-side
//       checkout success callback to prove payment.
//
// Platform billing (used by the super-admin SaaS subscription flow):
//   resolveRazorpayCreds()        — reads PlatformBillingGateway + decrypts
//   createPlatformOrder({...})    — convenience wrapper around createRazorpayOrder
//   fetchPayment(creds, paymentId) — GET /v1/payments/<id> for verification
//   verifyWebhookSignature(...)   — HMAC-SHA256(rawBody, webhookSecret)

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./index";
import { decryptSecrets } from "./secrets-crypto";

export interface RazorpayOrderRequest {
  keyId: string;
  keySecret: string;
  amount: number; // in major units — we convert to paise inside
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id: string;
  amount: number; // paise
  currency: string;
  receipt: string;
  status: string;
}

export async function createRazorpayOrder(
  req: RazorpayOrderRequest,
): Promise<RazorpayOrderResponse> {
  const auth = Buffer.from(`${req.keyId}:${req.keySecret}`).toString("base64");
  const body = {
    amount: Math.round(req.amount * 100),
    currency: req.currency,
    receipt: req.receipt,
    notes: req.notes ?? {},
  };
  const r = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Razorpay createOrder failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return (await r.json()) as RazorpayOrderResponse;
}

export function verifyPaymentSignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
}

// ─────────────────────────────────────────────────────────────────────
// Platform billing — super-admin-configured gateway for SaaS plan
// subscriptions. Credentials stored encrypted on PlatformBillingGateway;
// resolved + decrypted here on each call so key rotation takes effect
// immediately (no in-process cache to invalidate).
// ─────────────────────────────────────────────────────────────────────

export interface RazorpayCreds {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  mode: "test" | "live";
}

export class NoBillingGatewayError extends Error {
  constructor() {
    super(
      "No active Razorpay gateway configured. Super Admin → Billing → Add gateway.",
    );
    this.name = "NoBillingGatewayError";
  }
}

/**
 * Resolve the active Razorpay credentials from PlatformBillingGateway.
 * Picks the single row with `provider="razorpay"` + `isActive=true`.
 * Operators flip between test and live by activating the matching row.
 */
export async function resolveRazorpayCreds(): Promise<RazorpayCreds> {
  const row = await prisma.platformBillingGateway.findFirst({
    where: { provider: "razorpay", isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) throw new NoBillingGatewayError();
  const config = (row.config ?? {}) as Record<string, unknown>;
  const secrets = decryptSecrets(row.secrets as never);
  const keyId = typeof config.keyId === "string" ? config.keyId : null;
  const keySecret = typeof secrets.keySecret === "string" ? secrets.keySecret : null;
  const webhookSecret =
    typeof secrets.webhookSecret === "string" ? secrets.webhookSecret : null;
  if (!keyId || !keySecret) throw new NoBillingGatewayError();
  return {
    keyId,
    keySecret,
    webhookSecret,
    mode: row.mode === "live" ? "live" : "test",
  };
}

/**
 * Convenience: resolve creds + create an order in one call. Used by the
 * super-admin subscription flow (create-order endpoint).
 */
export async function createPlatformOrder(input: {
  amountInr: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrderResponse & { keyId: string }> {
  const creds = await resolveRazorpayCreds();
  const order = await createRazorpayOrder({
    keyId: creds.keyId,
    keySecret: creds.keySecret,
    amount: input.amountInr,
    currency: input.currency ?? "INR",
    receipt: input.receipt ?? `receipt_${Date.now()}`,
    notes: input.notes,
  });
  // Return keyId too — the browser needs it to open Checkout.
  return { ...order, keyId: creds.keyId };
}

export interface RazorpayPayment {
  id: string;
  entity: "payment";
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  method: string;
  captured: boolean;
  email: string | null;
  contact: string | null;
  created_at: number;
}

export async function fetchPayment(
  creds: RazorpayCreds,
  paymentId: string,
): Promise<RazorpayPayment> {
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  const r = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: { authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Razorpay fetchPayment ${r.status}: ${t.slice(0, 300)}`);
  }
  return (await r.json()) as RazorpayPayment;
}

/**
 * Verify a webhook payload signature. Razorpay posts raw JSON with an
 * `X-Razorpay-Signature` header = HMAC-SHA256(body, webhookSecret). Pass
 * the ORIGINAL bytes — re-serializing JSON changes whitespace and the
 * signature stops matching. Timing-safe compare prevents side-channel
 * leaks of the expected digest.
 */
export function verifyWebhookSignature(
  webhookSecret: string,
  rawBody: Buffer | string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", webhookSecret)
    .update(rawBody as never)
    .digest("hex");
  let a: Buffer, b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
