// Stripe adapter. Two operations mirror the Razorpay adapter:
//   createStripePaymentIntent({...}) — POST /v1/payment_intents with a bearer
//     secret key. Amount is in the smallest currency unit (cents/paise).
//   verifyStripeWebhookSignature(secret, rawBody, header, tolerance?) —
//     HMAC-SHA256 of `${timestamp}.${rawBody}`; header format is
//     `t=<ts>,v1=<sig>[,v0=<sig>]`. Optional timestamp tolerance window
//     (default 300s) guards against replay attacks.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface StripePaymentIntentRequest {
  secretKey: string;
  amount: number; // major units — converted to smallest unit inside
  currency: string; // ISO 4217, lowercased on the wire
  metadata?: Record<string, string>;
  description?: string;
  receiptEmail?: string;
  // Optional idempotency key; Stripe deduplicates by this within 24h.
  idempotencyKey?: string;
}

export interface StripePaymentIntentResponse {
  id: string;
  amount: number; // smallest unit
  currency: string;
  status: string;
  client_secret: string;
}

// Zero-decimal currencies per Stripe docs. All others use 100 as multiplier.
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw",
  "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

function toSmallestUnit(amount: number, currency: string): number {
  const c = currency.toLowerCase();
  return ZERO_DECIMAL.has(c) ? Math.round(amount) : Math.round(amount * 100);
}

export async function createStripePaymentIntent(
  req: StripePaymentIntentRequest,
): Promise<StripePaymentIntentResponse> {
  const form = new URLSearchParams();
  form.set("amount", String(toSmallestUnit(req.amount, req.currency)));
  form.set("currency", req.currency.toLowerCase());
  if (req.description) form.set("description", req.description);
  if (req.receiptEmail) form.set("receipt_email", req.receiptEmail);
  for (const [k, v] of Object.entries(req.metadata ?? {})) {
    form.set(`metadata[${k}]`, v);
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${req.secretKey}`,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (req.idempotencyKey) headers["idempotency-key"] = req.idempotencyKey;

  const r = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers,
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Stripe createPaymentIntent failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return (await r.json()) as StripePaymentIntentResponse;
}

// Parse the `Stripe-Signature` header: `t=<ts>,v1=<sig>,v0=<sig>`.
function parseSignatureHeader(header: string): {
  timestamp: number | null;
  signatures: string[];
} {
  const parts = header.split(",");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (!key || !value) continue;
    if (key === "t") {
      const n = Number(value);
      if (!Number.isNaN(n)) timestamp = n;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  return { timestamp, signatures };
}

export function verifyStripeWebhookSignature(
  secret: string,
  rawBody: string,
  header: string,
  toleranceSeconds = 300,
): boolean {
  const { timestamp, signatures } = parseSignatureHeader(header);
  if (timestamp === null || signatures.length === 0) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  for (const sig of signatures) {
    let sigBuf: Buffer;
    try {
      sigBuf = Buffer.from(sig, "hex");
    } catch {
      continue;
    }
    if (sigBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(sigBuf, expectedBuf)) return true;
  }
  return false;
}
