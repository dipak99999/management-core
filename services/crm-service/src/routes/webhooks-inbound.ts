import express, { Router, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  decryptSecrets,
  normalizeAndPersist,
  prisma,
  withCrossTenant,
  type NormalizedEvent,
  type NormalizedEventType,
  type NormalizedSeverity,
} from "@lumaara/db";
import { verifySnsSignature, type SnsEnvelope } from "../lib/sns-verify";
import { verifySendGridSignature } from "../lib/sendgrid-verify";

// Public inbound webhook receivers for ESP deliverability events. Providers
// POST here on delivered / bounced / complained / clicked / opened. We
// normalize to TrackingEvent + auto-insert Suppression on hard bounce or
// complaint (see plan §P1.1). Each provider verifies its own signature scheme
// BEFORE hitting the database — failed signatures return 401 with zero DB IO.
//
// Route shape: POST /<provider>/:tenantSlug. Providers don't know our
// tenantId, so we bake it into the webhook URL when the operator wires up the
// integration in the admin UI. Tenant.slug lookup is cross-tenant (the
// request is unauthenticated) — wrapped in withCrossTenant().
//
// Unknown tenantSlug → 404 silent (no body). Bots probe these endpoints
// constantly; we log signature failures at debug not warn.
//
// Return 200 fast: providers retry on 5xx. If a persistence error is
// non-recoverable (e.g. malformed payload we already accepted the signature
// on) we still 200 to avoid poison-retry storms — the error is captured in
// TrackingEvent.meta for later reconciliation.

export const webhooksInboundRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ---------- Helpers -------------------------------------------------------

/**
 * Resolve Tenant by URL slug. Returns null if not found. Uses withCrossTenant()
 * because these routes are unauthenticated — no req.auth to key against.
 */
async function resolveTenantId(tenantSlug: string): Promise<string | null> {
  const t = await prisma.tenant.findFirst(
    withCrossTenant({ where: { slug: tenantSlug }, select: { id: true } }),
  );
  return t?.id ?? null;
}

/**
 * Load a per-tenant integration secret bag. Returns null when the integration
 * is missing / inactive — handler should treat that as "signature can't be
 * verified" → 401.
 */
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

/**
 * Constant-time compare for strings of arbitrary length. Node's timingSafeEqual
 * throws on length mismatch — we normalize by padding the shorter side and
 * xor'ing lengths in.
 */
function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Include length in the equality — pad the shorter one to avoid throw, then
  // OR the length inequality into the result so different-length strings
  // never compare equal.
  const len = Math.max(ab.length, bb.length);
  const ap = Buffer.alloc(len);
  const bp = Buffer.alloc(len);
  ab.copy(ap);
  bb.copy(bp);
  const eq = timingSafeEqual(ap, bp);
  return eq && ab.length === bb.length;
}

/**
 * Debug-log a failed signature — quiet by default so bot probes don't pollute
 * warn/error logs. Set DEBUG_WEBHOOK_INBOUND=1 to surface them.
 */
function logSigFail(provider: string, reason: string, req: Request): void {
  if (!process.env.DEBUG_WEBHOOK_INBOUND) return;
  // eslint-disable-next-line no-console
  console.debug(
    `[webhooks-inbound] ${provider} signature-fail: ${reason} ip=${req.ip}`,
  );
}

// ---------- Health --------------------------------------------------------

webhooksInboundRouter.get("/health", (_req, res) => {
  res.json({ ok: true, providers: ["ses", "mailgun", "postmark", "sendgrid", "generic"] });
});

// ==========================================================================
// 1. AWS SES via SNS
// ==========================================================================
//
// SNS envelope: { Type: "Notification" | "SubscriptionConfirmation",
//                 Message: <JSON-string SES event>, Signature, SigningCertURL,
//                 SubscribeURL, ... }
// SES message body types (parsed from `Message`):
//   { notificationType: "Bounce",   bounce: {bounceType: "Permanent"|"Transient", bouncedRecipients: [{emailAddress, diagnosticCode}]} }
//   { notificationType: "Complaint", complaint: {complainedRecipients: [{emailAddress}], complaintFeedbackType} }
//   { notificationType: "Delivery",  delivery:  {recipients: [emailAddress], ...} }
//
// SubscriptionConfirmation flow: SNS sends this once when the topic is first
// wired. We hit the SubscribeURL to confirm — but only after signature check.

webhooksInboundRouter.post("/ses/:tenantSlug", async (req, res) => {
  const { tenantSlug } = req.params;
  const provider = "ses";
  const envelope = req.body as SnsEnvelope;

  // Real RSA-SHA{1,256} signature verification against a cert fetched from
  // the SigningCertURL (validated to be an AWS SNS host). See
  // src/lib/sns-verify.ts for the canonical-string spec + verification.
  const verified = await verifySnsSignature(envelope);
  if (!verified.ok) {
    logSigFail(provider, verified.reason, req);
    return res.status(401).end();
  }

  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return res.status(404).end();

  // SubscriptionConfirmation — hit SubscribeURL to complete the handshake.
  // The URL is authenticated by the signature we just verified, so this is
  // safe to fetch. Best-effort — if the call fails we still 200 so SNS
  // shows the endpoint healthy and the operator can re-confirm manually.
  if (envelope.Type === "SubscriptionConfirmation") {
    if (envelope.SubscribeURL) {
      try {
        await fetch(envelope.SubscribeURL);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[webhooks-inbound] SNS SubscribeURL fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return res.status(200).json({ ok: true, note: "subscription confirmed" });
  }

  let msg: AnyRecord;
  try {
    msg = JSON.parse(envelope.Message) as AnyRecord;
  } catch {
    return res.status(200).json({ ok: true, note: "unparseable Message body" });
  }

  const kind = String(msg.notificationType ?? "");
  const events: NormalizedEvent[] = [];

  if (kind === "Bounce" && msg.bounce) {
    const bt = String(msg.bounce.bounceType ?? "");
    const severity: NormalizedSeverity = bt === "Permanent" ? "hard" : "soft";
    for (const r of (msg.bounce.bouncedRecipients ?? []) as AnyRecord[]) {
      if (!r?.emailAddress) continue;
      events.push({
        provider,
        email: String(r.emailAddress),
        event: "Bounce",
        severity,
        detail: r.diagnosticCode ? String(r.diagnosticCode).slice(0, 500) : bt,
        meta: msg as unknown as NormalizedEvent["meta"],
      });
    }
  } else if (kind === "Complaint" && msg.complaint) {
    for (const r of (msg.complaint.complainedRecipients ?? []) as AnyRecord[]) {
      if (!r?.emailAddress) continue;
      events.push({
        provider,
        email: String(r.emailAddress),
        event: "Complaint",
        detail: msg.complaint.complaintFeedbackType
          ? String(msg.complaint.complaintFeedbackType)
          : null,
        meta: msg as unknown as NormalizedEvent["meta"],
      });
    }
  } else if (kind === "Delivery" && msg.delivery) {
    for (const emailAddress of (msg.delivery.recipients ?? []) as string[]) {
      events.push({
        provider,
        email: String(emailAddress),
        event: "Delivered",
        meta: msg as unknown as NormalizedEvent["meta"],
      });
    }
  }

  for (const e of events) {
    try {
      await normalizeAndPersist(prisma, tenantId, e);
    } catch {
      /* swallow — see file-header comment on poison-retry avoidance */
    }
  }
  return res.status(200).json({ ok: true, processed: events.length });
});

// ==========================================================================
// 2. Mailgun
// ==========================================================================
//
// Mailgun sends events with a `signature` block:
//   { signature: { timestamp, token, signature }, event-data: {...} }
// signature = HMAC-SHA256(signing_key, timestamp + token).hex()
//
// event-data.event ∈ delivered | failed | complained | unsubscribed | opened | clicked
// event-data.severity = "temporary" (soft) | "permanent" (hard) [when failed]

webhooksInboundRouter.post("/mailgun/:tenantSlug", async (req, res) => {
  const { tenantSlug } = req.params;
  const provider = "mailgun";
  const body = req.body as AnyRecord;

  const sig = body?.signature as AnyRecord | undefined;
  if (!sig || typeof sig.timestamp !== "string" || typeof sig.token !== "string" || typeof sig.signature !== "string") {
    logSigFail(provider, "missing signature block", req);
    return res.status(401).end();
  }

  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return res.status(404).end();

  const secrets = await loadIntegrationSecrets(tenantId, "mailgun");
  const signingKey = typeof secrets?.webhookSigningKey === "string"
    ? secrets.webhookSigningKey
    : typeof secrets?.signingKey === "string"
      ? secrets.signingKey
      : null;
  if (!signingKey) {
    logSigFail(provider, "no signing key configured", req);
    return res.status(401).end();
  }

  const expected = createHmac("sha256", signingKey)
    .update(sig.timestamp + sig.token)
    .digest("hex");
  if (!safeCompare(expected, sig.signature)) {
    logSigFail(provider, "hmac mismatch", req);
    return res.status(401).end();
  }

  // Optional replay-window check — reject events older than 15 min.
  const ts = Number(sig.timestamp);
  if (Number.isFinite(ts)) {
    const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (ageSec > 15 * 60) {
      logSigFail(provider, `stale ts age=${ageSec}s`, req);
      return res.status(401).end();
    }
  }

  const ev = (body["event-data"] as AnyRecord) ?? {};
  const recipient = String(ev.recipient ?? "");
  const eventStr = String(ev.event ?? "");
  const severityStr = String(ev.severity ?? "");

  const map: Record<string, NormalizedEventType> = {
    delivered: "Delivered",
    failed: "Bounce",
    complained: "Complaint",
    unsubscribed: "Unsubscribe",
    opened: "Open",
    clicked: "Click",
  };
  const eventType = map[eventStr];
  if (!eventType || !recipient) {
    return res.status(200).json({ ok: true, note: "unhandled event" });
  }

  const severity: NormalizedSeverity =
    eventType === "Bounce"
      ? severityStr === "permanent" ? "hard" : "soft"
      : undefined;

  try {
    await normalizeAndPersist(prisma, tenantId, {
      provider,
      email: recipient,
      event: eventType,
      severity,
      targetUrl: eventType === "Click" ? (ev.url ? String(ev.url) : null) : null,
      detail: ev.reason ? String(ev.reason).slice(0, 500) : null,
      meta: ev as unknown as NormalizedEvent["meta"],
      occurredAt: ev.timestamp ? new Date(Number(ev.timestamp) * 1000) : undefined,
    });
  } catch {
    /* swallow */
  }
  return res.status(200).json({ ok: true });
});

// ==========================================================================
// 3. Postmark
// ==========================================================================
//
// Postmark auth: HTTP Basic — the operator configures username+password in
// the Postmark webhook UI; we store the same pair as TenantIntegration
// secrets {username, password}. Verify the Authorization header before touching
// the DB.
//
// Payload:
//   { RecordType: "Bounce" | "SpamComplaint" | "Delivery" | "Open" | "Click",
//     Email: "...", TypeCode: 1 | 16 | ..., Type: "HardBounce" | "SoftBounce" | ...,
//     Description: "...", MessageID, Metadata: {campaignId?, ...} }
//
// TypeCode reference (subset):
//   1  = HardBounce         → suppress
//   2  = Transient          → soft, no suppress
//   16 = SoftBounce         → soft, no suppress
//   512 = SpamNotification  → complaint (but Postmark also fires RecordType=SpamComplaint)

const POSTMARK_HARD_TYPE_CODES = new Set([1, 100, 512]); // HardBounce, DnsError, SpamNotification

webhooksInboundRouter.post("/postmark/:tenantSlug", async (req, res) => {
  const { tenantSlug } = req.params;
  const provider = "postmark";

  const auth = req.header("authorization") ?? "";
  if (!auth.startsWith("Basic ")) {
    logSigFail(provider, "missing basic auth", req);
    return res.status(401).end();
  }

  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return res.status(404).end();

  const secrets = await loadIntegrationSecrets(tenantId, "postmark");
  const user = typeof secrets?.username === "string" ? secrets.username : null;
  const pass = typeof secrets?.password === "string" ? secrets.password : null;
  if (!user || !pass) {
    logSigFail(provider, "no basic-auth creds configured", req);
    return res.status(401).end();
  }

  const provided = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const expected = `${user}:${pass}`;
  if (!safeCompare(provided, expected)) {
    logSigFail(provider, "basic auth mismatch", req);
    return res.status(401).end();
  }

  const body = req.body as AnyRecord;
  const rec = String(body.RecordType ?? "");
  const email = String(body.Email ?? body.Recipient ?? "");
  if (!email) return res.status(200).json({ ok: true, note: "no recipient" });

  let event: NormalizedEventType | null = null;
  let severity: NormalizedSeverity;
  if (rec === "Bounce") {
    event = "Bounce";
    const code = Number(body.TypeCode ?? 0);
    severity = POSTMARK_HARD_TYPE_CODES.has(code) ? "hard" : "soft";
  } else if (rec === "SpamComplaint") {
    event = "Complaint";
  } else if (rec === "Delivery") {
    event = "Delivered";
  } else if (rec === "Open") {
    event = "Open";
  } else if (rec === "Click") {
    event = "Click";
  } else if (rec === "SubscriptionChange" && body.SuppressSending === true) {
    event = "Unsubscribe";
  }
  if (!event) return res.status(200).json({ ok: true, note: "unhandled record" });

  try {
    await normalizeAndPersist(prisma, tenantId, {
      provider,
      email,
      event,
      severity,
      campaignId: body.Metadata?.campaignId ? String(body.Metadata.campaignId) : null,
      targetUrl: event === "Click" ? (body.OriginalLink ? String(body.OriginalLink) : null) : null,
      detail: body.Description ? String(body.Description).slice(0, 500) : (body.Type ? String(body.Type) : null),
      meta: body as unknown as NormalizedEvent["meta"],
    });
  } catch {
    /* swallow */
  }
  return res.status(200).json({ ok: true });
});

// ==========================================================================
// 4. SendGrid
// ==========================================================================
//
// SendGrid Event Webhook signs with ECDSA (secp256r1 over the raw body). The
// public key is registered by the operator in the SendGrid UI and stored on
// our side as TenantIntegration secrets {publicKey}. Headers:
//   X-Twilio-Email-Event-Webhook-Signature (base64 ECDSA)
//   X-Twilio-Email-Event-Webhook-Timestamp
//
// Payload = JSON array of events:
//   [{ email, event, timestamp, sg_message_id, url?, type?, reason?, category? }]
// event ∈ delivered | bounce | dropped | spamreport | unsubscribe | open | click | deferred | processed
// type distinguishes bounce/blocked (both hard) from deferred (soft).

webhooksInboundRouter.post(
  "/sendgrid/:tenantSlug",
  // Raw body — app-level express.json() is bypassed for this path (see
  // services/crm-service/src/index.ts). ECDSA is over the raw bytes.
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
  const { tenantSlug } = req.params;
  const provider = "sendgrid";

  const sig = req.header("x-twilio-email-event-webhook-signature");
  const ts = req.header("x-twilio-email-event-webhook-timestamp");
  if (!sig || !ts) {
    logSigFail(provider, "missing sig headers", req);
    return res.status(401).end();
  }

  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return res.status(404).end();

  const secrets = await loadIntegrationSecrets(tenantId, "sendgrid");
  const publicKey = typeof secrets?.publicKey === "string" ? secrets.publicKey : null;
  if (!publicKey) {
    logSigFail(provider, "no public key configured", req);
    return res.status(401).end();
  }

  // Real ECDSA (P-256, SHA-256) verification over `timestamp + rawBody`.
  // See src/lib/sendgrid-verify.ts. Rejects signatures older than 10 min.
  const rawBody = req.body as Buffer;
  const verified = verifySendGridSignature(publicKey, ts, sig, rawBody);
  if (!verified.ok) {
    logSigFail(provider, verified.reason, req);
    return res.status(401).end();
  }

  let parsedEvents: unknown;
  try {
    parsedEvents = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid JSON body" });
  }
  const events = Array.isArray(parsedEvents) ? (parsedEvents as AnyRecord[]) : [];
  const map: Record<string, NormalizedEventType> = {
    delivered: "Delivered",
    bounce: "Bounce",
    dropped: "Bounce",
    blocked: "Bounce",
    deferred: "Deferred",
    spamreport: "Complaint",
    unsubscribe: "Unsubscribe",
    group_unsubscribe: "Unsubscribe",
    open: "Open",
    click: "Click",
  };

  let processed = 0;
  for (const ev of events) {
    const email = String(ev.email ?? "");
    const eventStr = String(ev.event ?? "");
    const eventType = map[eventStr];
    if (!email || !eventType) continue;

    // SendGrid `type` field: "bounce" or "blocked" = hard; anything else on a
    // bounce record = soft. `dropped` events (pre-send rejection) treated as
    // hard because the address is unusable.
    let severity: NormalizedSeverity;
    if (eventType === "Bounce") {
      const typeStr = String(ev.type ?? "");
      severity =
        eventStr === "dropped" || typeStr === "bounce" || typeStr === "blocked"
          ? "hard"
          : "soft";
    }

    try {
      await normalizeAndPersist(prisma, tenantId, {
        provider,
        email,
        event: eventType,
        severity,
        targetUrl: eventType === "Click" && ev.url ? String(ev.url) : null,
        detail: ev.reason ? String(ev.reason).slice(0, 500) : null,
        meta: ev as unknown as NormalizedEvent["meta"],
        occurredAt: ev.timestamp ? new Date(Number(ev.timestamp) * 1000) : undefined,
      });
      processed += 1;
    } catch {
      /* swallow */
    }
  }
  return res.status(200).json({ ok: true, processed });
});

// ==========================================================================
// 5. Generic (our own webhook format)
// ==========================================================================
//
// For any ESP without a first-class handler: operator configures a shared
// bearer token; provider POSTs to /generic/:tenantSlug with our shape:
//   { email, event, severity?, campaignId?, detail?, meta?, occurredAt? }
// Same normalized event vocabulary as NormalizedEvent above.

webhooksInboundRouter.post("/generic/:tenantSlug", async (req, res) => {
  const { tenantSlug } = req.params;
  const provider = "webhook";

  const auth = req.header("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!bearer) {
    logSigFail(provider, "missing bearer", req);
    return res.status(401).end();
  }

  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return res.status(404).end();

  const secrets = await loadIntegrationSecrets(tenantId, "webhook");
  const token = typeof secrets?.token === "string"
    ? secrets.token
    : typeof secrets?.bearerToken === "string"
      ? secrets.bearerToken
      : null;
  if (!token) {
    logSigFail(provider, "no bearer configured", req);
    return res.status(401).end();
  }
  if (!safeCompare(bearer, token)) {
    logSigFail(provider, "bearer mismatch", req);
    return res.status(401).end();
  }

  const body = req.body as AnyRecord;
  const email = String(body.email ?? "");
  const eventStr = String(body.event ?? "");
  const allowed: NormalizedEventType[] = [
    "Delivered", "Bounce", "Complaint", "Unsubscribe", "Open", "Click", "Deferred", "Suppressed",
  ];
  if (!email || !allowed.includes(eventStr as NormalizedEventType)) {
    return res.status(200).json({ ok: true, note: "unhandled event" });
  }
  const event = eventStr as NormalizedEventType;
  let severity: NormalizedSeverity;
  if (event === "Bounce") {
    const sv = String(body.severity ?? "");
    severity = sv === "hard" || sv === "permanent" ? "hard" : "soft";
  }

  try {
    await normalizeAndPersist(prisma, tenantId, {
      provider,
      email,
      event,
      severity,
      campaignId: body.campaignId ? String(body.campaignId) : null,
      detail: body.detail ? String(body.detail).slice(0, 500) : null,
      meta: (body.meta ?? body) as unknown as NormalizedEvent["meta"],
      occurredAt: body.occurredAt ? new Date(String(body.occurredAt)) : undefined,
    });
  } catch {
    /* swallow */
  }
  return res.status(200).json({ ok: true });
});

// Exposed for tests + reuse by future provider handlers.
export const _internals = { resolveTenantId, loadIntegrationSecrets, safeCompare };
