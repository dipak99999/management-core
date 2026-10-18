import { PrismaClient, Prisma } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";

// L4: Event dispatch. `emitEvent` enqueues one WebhookDelivery row per
// matching subscription (subscription.events contains the eventKey OR is
// empty = subscribe to everything). Delivery is async — a cron/worker calls
// `processWebhookDeliveries` to actually POST them.

export interface EventPayload {
  event: string; // e.g. "SalesInvoice.submit"
  tenantId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function emitEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  eventKey: string,
  data: Record<string, unknown>,
): Promise<{ enqueued: number }> {
  const subs = await prisma.webhookSubscription.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [{ events: { has: eventKey } }, { events: { isEmpty: true } }],
    },
    select: { id: true },
  });
  if (subs.length === 0) return { enqueued: 0 };

  const payload: EventPayload = {
    event: eventKey,
    tenantId,
    timestamp: new Date().toISOString(),
    data,
  };
  await prisma.webhookDelivery.createMany({
    data: subs.map((s) => ({
      subscriptionId: s.id,
      tenantId,
      eventKey,
      payload: payload as unknown as Prisma.InputJsonValue,
    })),
  });
  return { enqueued: subs.length };
}

// Retries use exponential backoff capped at MAX_WEBHOOK_ATTEMPTS. After each
// failure the row is re-queued with scheduledFor = now + backoff(nAttempts).
// nAttempts is post-increment, so first retry waits 30s, second 2m, third
// 8m, fourth 32m, fifth 2h13m, sixth (=cap) marks Failed permanently.
const MAX_WEBHOOK_ATTEMPTS = 6;
function backoffMs(attempts: number): number {
  return Math.min(30_000 * Math.pow(4, attempts - 1), 4 * 60 * 60_000);
}

// Cron-triggered flush. For each due delivery: POST the JSON to
// subscription.targetUrl with an HMAC-SHA256 header X-lumaara-Signature.
// On 2xx response → Delivered. On other → Retrying (with backoff) or Failed
// once the max-attempt ceiling is hit.
export async function processWebhookDeliveries(
  prisma: PrismaClient,
  opts: { limit?: number } = {},
): Promise<{
  processed: number;
  delivered: number;
  retrying: number;
  failed: number;
}> {
  const now = new Date();
  const batch = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ["Pending", "Retrying"] },
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    include: { subscription: true },
    orderBy: { createdAt: "asc" },
    take: Math.min(opts.limit ?? 50, 200),
  });
  if (batch.length === 0)
    return { processed: 0, delivered: 0, retrying: 0, failed: 0 };

  let delivered = 0;
  let retrying = 0;
  let failed = 0;
  for (const d of batch) {
    if (!d.subscription.isActive) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "Cancelled", lastError: "Subscription inactive" },
      });
      continue;
    }
    // Compute next-attempt count without a separate write — the transition to
    // Delivered / Retrying / Failed happens in one update below.
    const attempts = d.attempts + 1;
    try {
      const bodyStr = JSON.stringify(d.payload);
      const sig = createHmac("sha256", d.subscription.signingSecret)
        .update(bodyStr)
        .digest("hex");
      const res = await fetch(d.subscription.targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lumaara-signature": sig,
          "x-lumaara-event": d.eventKey,
          "x-lumaara-delivery": d.id,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        await prisma.webhookDelivery.update({
          where: { id: d.id },
          data: {
            status: "Delivered",
            attempts,
            deliveredAt: new Date(),
            lastStatusCode: res.status,
            lastError: null,
            scheduledFor: null,
          },
        });
        delivered += 1;
      } else {
        await scheduleRetryOrFail(prisma, d.id, attempts, `HTTP ${res.status}`, res.status);
        if (attempts >= MAX_WEBHOOK_ATTEMPTS) failed += 1;
        else retrying += 1;
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      await scheduleRetryOrFail(prisma, d.id, attempts, msg, null);
      if (attempts >= MAX_WEBHOOK_ATTEMPTS) failed += 1;
      else retrying += 1;
    }
  }
  return { processed: batch.length, delivered, retrying, failed };
}

async function scheduleRetryOrFail(
  prisma: PrismaClient,
  deliveryId: string,
  attempts: number,
  lastError: string,
  lastStatusCode: number | null,
): Promise<void> {
  if (attempts >= MAX_WEBHOOK_ATTEMPTS) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "Failed",
        attempts,
        lastError,
        ...(lastStatusCode !== null ? { lastStatusCode } : {}),
        scheduledFor: null,
      },
    });
    return;
  }
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "Retrying",
      attempts,
      lastError,
      ...(lastStatusCode !== null ? { lastStatusCode } : {}),
      scheduledFor: new Date(Date.now() + backoffMs(attempts)),
    },
  });
}

// Generate a new signing secret — used when creating subscriptions.
export function generateSigningSecret(): string {
  return randomBytes(24).toString("base64url");
}

// Verify an incoming HMAC signature. Used by both the outbound receiver test
// harness and the incoming-webhook receiver (L5).
export function verifyHmac(secret: string, body: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEq(expected, signature);
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
