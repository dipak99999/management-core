import { Router, type Request } from "express";
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptSecrets, prisma, withCrossTenant } from "@lumaara/db";

// Public inbound webhooks for SMS provider delivery-receipts (P2).
//
// Route shape: POST /sms-webhooks/<provider>/:tenantSlug. Providers don't
// know our tenantId, so we bake it into the webhook URL when the operator
// wires up the integration. Tenant.slug lookup is cross-tenant (the
// request is unauthenticated) — wrapped in withCrossTenant().
//
// Signature schemes:
//   * Twilio: HMAC-SHA1 over `url + sortedParams` (url = fully qualified),
//     verified with the tenant's Twilio auth token. Body is
//     application/x-www-form-urlencoded — we install express.urlencoded()
//     LOCALLY on the Twilio route only (crm-service global uses json()).
//   * MSG91:  bearer token in Authorization header. MSG91 doesn't sign
//     webhooks in v5; a shared secret in the header is the operator-
//     recommended pattern.
//
// Behavior on failure:
//   * Bad/missing signature      → 401, no DB write, quiet log.
//   * Unknown tenantSlug         → 404, silent.
//   * Unknown providerMessageId  → 200 (silent) — an old race or a message
//                                  from before we started persisting the id.
//     Providers retry on 5xx; we don't want them stampeding for cases we
//     don't care about.
//   * Any DB error post-verify   → still 200 so provider doesn't retry a
//     poisoned event forever.

export const smsWebhooksRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function resolveTenantId(tenantSlug: string): Promise<string | null> {
  const t = await prisma.tenant.findFirst(
    withCrossTenant({ where: { slug: tenantSlug }, select: { id: true } }),
  );
  return t?.id ?? null;
}

async function loadIntegrationSecrets(
  tenantId: string,
  provider: string,
): Promise<Record<string, unknown> | null> {
  const row = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider, isActive: true },
  });
  if (!row) return null;
  try {
    return decryptSecrets(row.secrets);
  } catch {
    return null;
  }
}

async function loadIntegrationConfig(
  tenantId: string,
  provider: string,
): Promise<Record<string, unknown> | null> {
  const row = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider, isActive: true },
  });
  return (row?.config as Record<string, unknown> | null) ?? null;
}

/**
 * Constant-time compare that handles differing lengths. Node's
 * timingSafeEqual throws on length mismatch — we pad both sides then OR the
 * length inequality in so distinct-length inputs never compare equal.
 */
function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(ab.length, bb.length);
  const ap = Buffer.alloc(len);
  const bp = Buffer.alloc(len);
  ab.copy(ap);
  bb.copy(bp);
  const eq = timingSafeEqual(ap, bp);
  return eq && ab.length === bb.length;
}

function logSigFail(provider: string, reason: string, req: Request): void {
  if (!process.env.DEBUG_WEBHOOK_INBOUND) return;
  // eslint-disable-next-line no-console
  console.debug(
    `[sms-webhooks] ${provider} signature-fail: ${reason} ip=${req.ip}`,
  );
}

/**
 * Map a provider-native status word to our SmsMessage.status enum + a flag
 * for whether the row should have `deliveredAt` stamped.
 *
 * We intentionally keep our vocabulary small and idempotent — repeated
 * webhook fires for the same state must produce identical rows.
 */
interface StatusUpdate {
  status: "Sent" | "Delivered" | "Failed" | "Undelivered";
  deliveredAt?: Date;
  lastError?: string | null;
}

function mapTwilioStatus(msgStatus: string, errorCode?: string): StatusUpdate | null {
  switch (msgStatus) {
    case "delivered":
      return { status: "Delivered", deliveredAt: new Date(), lastError: null };
    case "sent":
    case "queued":
    case "sending":
    case "accepted":
      // Idempotent Sent — the send loop already set this, but providers may
      // fire "sent" before our own state transition on very fast paths.
      return { status: "Sent" };
    case "failed":
      return { status: "Failed", lastError: errorCode ? `twilio:${errorCode}` : "twilio:failed" };
    case "undelivered":
      return {
        status: "Undelivered",
        lastError: errorCode ? `twilio:${errorCode}` : "twilio:undelivered",
      };
    default:
      return null;
  }
}

function mapMsg91Status(status: string | number): StatusUpdate | null {
  // MSG91 uses numeric status codes documented in their DLR API:
  //   1  = Delivered
  //   2  = Failed
  //   5  = Rejected
  //   6  = Awaited-DLR
  //   9  = Auto-failed / Unknown
  //   16 = Rejected by Operator
  //   17 = Blocked
  //   25 = Rejected by DLT
  // We accept either the numeric code or the friendly string ("delivered", "failed").
  const s = String(status).toLowerCase();
  if (s === "1" || s === "delivered") {
    return { status: "Delivered", deliveredAt: new Date(), lastError: null };
  }
  if (s === "2" || s === "failed" || s === "9") {
    return { status: "Failed", lastError: `msg91:${s}` };
  }
  if (s === "5" || s === "16" || s === "17" || s === "25" || s === "rejected" || s === "blocked") {
    return { status: "Undelivered", lastError: `msg91:${s}` };
  }
  if (s === "6" || s === "sent" || s === "queued") {
    return { status: "Sent" };
  }
  return null;
}

/**
 * Look up + update a single SmsMessage row by (tenantId, providerMessageId).
 * Returns true on write, false when no matching row exists. Idempotent:
 * re-firing the same webhook doesn't add rows — an UPDATE just re-sets
 * identical fields.
 */
async function applyStatusUpdate(
  tenantId: string,
  providerMessageId: string,
  update: StatusUpdate,
): Promise<boolean> {
  const existing = await prisma.smsMessage.findFirst({
    where: { tenantId, providerMessageId },
    select: { id: true, status: true, deliveredAt: true },
  });
  if (!existing) return false;

  // Idempotency: skip writes that would produce an identical row. Prevents
  // event-storm re-updates from bumping updatedAt and re-triggering
  // downstream subscribers.
  if (
    existing.status === update.status &&
    (!update.deliveredAt || existing.deliveredAt) // deliveredAt set once, kept
  ) {
    return true;
  }

  await prisma.smsMessage.update({
    where: { id: existing.id },
    data: {
      status: update.status,
      ...(update.deliveredAt ? { deliveredAt: update.deliveredAt } : {}),
      ...(update.lastError !== undefined ? { lastError: update.lastError } : {}),
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

smsWebhooksRouter.get("/health", (_req, res) => {
  res.json({ ok: true, providers: ["twilio", "msg91"] });
});

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------
//
// Twilio POSTs status callbacks as application/x-www-form-urlencoded. Fields
// we care about: MessageSid, MessageStatus, To, From, ErrorCode?.
//
// Signature verification (X-Twilio-Signature):
//   1. Take the fully qualified URL of the request (scheme + host + path +
//      querystring), exactly as Twilio POSTed to.
//   2. Sort the POST parameters alphabetically by key. Concatenate key+value
//      pairs (no separators).
//   3. Append the concatenated string to the URL.
//   4. HMAC-SHA1 with the tenant's Twilio auth token as key.
//   5. Base64-encode. Compare to X-Twilio-Signature.
//
// Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security

/**
 * Recreate the URL Twilio hashed against. If we sit behind a proxy the
 * operator should set `TWILIO_WEBHOOK_BASE_URL` (or per-tenant config.baseUrl)
 * to the public URL Twilio was configured with — the local Express req.url
 * won't match once a proxy rewrites the path.
 */
function twilioSignatureUrl(req: Request, baseOverride?: string): string {
  if (baseOverride) {
    // baseOverride should include scheme + host (+ optional prefix). Strip
    // any trailing slash then re-attach the router-local originalUrl.
    const trimmed = baseOverride.replace(/\/+$/, "");
    return `${trimmed}${req.originalUrl}`;
  }
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ??
    req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ??
    req.get("host") ??
    "";
  return `${proto}://${host}${req.originalUrl}`;
}

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let concat = url;
  for (const k of sortedKeys) concat += k + params[k];
  return createHmac("sha1", authToken).update(concat).digest("base64");
}

smsWebhooksRouter.post(
  "/twilio/:tenantSlug",
  // Twilio bodies are form-urlencoded — override the global express.json()
  // parser for THIS route only. `type: "*/*"` matters because Twilio sends
  // Content-Type: application/x-www-form-urlencoded but some proxies rewrite
  // it; being liberal here avoids empty-body silent failures.
  express.urlencoded({ extended: false, type: "*/*" }),
  async (req, res) => {
    const { tenantSlug } = req.params;
    const provider = "twilio-sms";

    const params = (req.body ?? {}) as Record<string, string>;
    const sigHeader = req.header("x-twilio-signature");
    if (!sigHeader) {
      logSigFail(provider, "missing X-Twilio-Signature", req);
      return res.status(401).end();
    }

    const tenantId = await resolveTenantId(tenantSlug);
    if (!tenantId) return res.status(404).end();

    const secrets = await loadIntegrationSecrets(tenantId, "sms");
    const config = await loadIntegrationConfig(tenantId, "sms");
    const authToken =
      (typeof secrets?.authToken === "string" && secrets.authToken) ||
      (typeof secrets?.auth_token === "string" && secrets.auth_token) ||
      "";
    if (!authToken) {
      logSigFail(provider, "no twilio authToken configured", req);
      return res.status(401).end();
    }

    const baseOverride =
      (typeof config?.webhookBaseUrl === "string" && config.webhookBaseUrl) ||
      process.env.TWILIO_WEBHOOK_BASE_URL ||
      undefined;
    const url = twilioSignatureUrl(req, baseOverride);
    const expected = computeTwilioSignature(authToken, url, params);
    if (!safeCompare(expected, sigHeader)) {
      logSigFail(provider, "hmac mismatch", req);
      return res.status(401).end();
    }

    const sid = String(params.MessageSid ?? "");
    const status = String(params.MessageStatus ?? "").toLowerCase();
    if (!sid || !status) {
      return res.status(200).json({ ok: true, note: "no MessageSid/MessageStatus" });
    }
    const update = mapTwilioStatus(status, params.ErrorCode ? String(params.ErrorCode) : undefined);
    if (!update) {
      return res.status(200).json({ ok: true, note: `unhandled status ${status}` });
    }

    try {
      await applyStatusUpdate(tenantId, sid, update);
    } catch {
      /* swallow — see file-header on poison-retry avoidance */
    }
    return res.status(200).json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// MSG91
// ---------------------------------------------------------------------------
//
// MSG91 v5 doesn't sign webhooks. Operator-recommended pattern is to configure
// the webhook URL with a shared secret and validate a bearer header on our
// side. We store the shared secret at `secrets.webhookBearer` (or fall back to
// `secrets.webhookToken`).
//
// Body (JSON):
//   {
//     requestId: "...",              // OR sometimes {report: [{requestId: ...}]}
//     report: [{ status: 1|2|..., number: "919...", requestId?: "..." }]
//   }

smsWebhooksRouter.post("/msg91/:tenantSlug", async (req, res) => {
  const { tenantSlug } = req.params;
  const provider = "msg91-sms";

  const auth = req.header("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!bearer) {
    logSigFail(provider, "missing bearer", req);
    return res.status(401).end();
  }

  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return res.status(404).end();

  const secrets = await loadIntegrationSecrets(tenantId, "sms");
  const token =
    (typeof secrets?.webhookBearer === "string" && secrets.webhookBearer) ||
    (typeof secrets?.webhookToken === "string" && secrets.webhookToken) ||
    "";
  if (!token) {
    logSigFail(provider, "no webhookBearer configured", req);
    return res.status(401).end();
  }
  if (!safeCompare(bearer, token)) {
    logSigFail(provider, "bearer mismatch", req);
    return res.status(401).end();
  }

  const body = (req.body ?? {}) as AnyRecord;
  const topRequestId = typeof body.requestId === "string" ? body.requestId : null;
  const reports: AnyRecord[] = Array.isArray(body.report) ? body.report : [];

  if (reports.length === 0 && topRequestId) {
    // MSG91 sometimes flattens single-report webhooks — fold into the array.
    reports.push({
      status: body.status ?? body.deliveryStatus,
      number: body.number ?? body.mobile,
      requestId: topRequestId,
    });
  }

  let processed = 0;
  for (const r of reports) {
    const sid = String(r.requestId ?? topRequestId ?? "");
    const statusRaw = r.status ?? r.deliveryStatus ?? "";
    if (!sid || statusRaw === "") continue;
    const update = mapMsg91Status(statusRaw);
    if (!update) continue;
    try {
      await applyStatusUpdate(tenantId, sid, update);
      processed += 1;
    } catch {
      /* swallow */
    }
  }
  return res.status(200).json({ ok: true, processed });
});

// Exposed for tests + reuse.
export const _internals = {
  resolveTenantId,
  loadIntegrationSecrets,
  safeCompare,
  computeTwilioSignature,
  twilioSignatureUrl,
  mapTwilioStatus,
  mapMsg91Status,
  applyStatusUpdate,
};
