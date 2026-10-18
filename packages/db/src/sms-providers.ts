// Marketing P2 — SMS provider adapters.
//
// Ships three adapters today:
//   * TwilioAdapter — Twilio Programmable Messaging REST API.
//   * Msg91Adapter — MSG91 v5 flow API (India-focused).
//   * TestAdapter  — always succeeds; used in dev / CI when no
//                    TenantIntegration row exists OR when SMS_PROVIDER=test.
//
// The factory `getSmsAdapter(prisma, tenantId)` reads the tenant's
// `TenantIntegration provider="sms"` row. The row's `config.provider`
// selects which concrete adapter to instantiate; `secrets` (decrypted with
// the shared secrets-crypto helper) supplies per-provider credentials.
//
// Design notes:
//   * The interface is intentionally narrow — `send({to, body, from?})` returns
//     `{providerMessageId}` on success and throws on any 4xx/5xx or transport
//     error. The route layer catches, records `lastError`, and marks the
//     SmsMessage Failed.
//   * We use native fetch (Node 20+) so the db package stays dependency-free.
//   * `from` handling: Twilio requires a from-number (either a Messaging
//     Service SID or a purchased phone number); MSG91 uses a sender ID (6 chars
//     for India transactional). Both are per-tenant config, but callers may
//     pass an override in `send({from})`.
//   * We do NOT retry inside the adapter — the caller's send loop owns retry
//     policy (attempts counter on SmsMessage). Retrying inside a single HTTP
//     call would hide the real failure mode from ops.
//
// Adding another provider (Plivo, Vonage, AWS SNS, etc.):
//   1. New class implementing SmsAdapter.
//   2. Extend the switch inside `getSmsAdapter`.
//   3. Extend the providerName column enum in the plan / any downstream metrics.

import type { PrismaClient } from "@prisma/client";
import { decryptSecrets } from "./secrets-crypto";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface SmsSendInput {
  to: string;
  body: string;
  /** Optional per-call override for the "from" field. Provider-specific. */
  from?: string;
}

export interface SmsSendResult {
  /** Provider-native message id (Twilio SID, MSG91 request_id, etc.). */
  providerMessageId: string;
}

export interface SmsAdapter {
  /** Concrete provider name — persisted on SmsMessage.providerName. */
  readonly providerName: "twilio" | "msg91" | "plivo" | "test";
  send(input: SmsSendInput): Promise<SmsSendResult>;
}

// ---------------------------------------------------------------------------
// TestAdapter
// ---------------------------------------------------------------------------

/**
 * No-op adapter that always succeeds. Emits a stderr line in non-production so
 * developers can see the send even without a real provider wired up.
 */
export class TestAdapter implements SmsAdapter {
  readonly providerName = "test" as const;

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error(
        `[sms:test] to=${input.to} body=${input.body.slice(0, 120)}${
          input.body.length > 120 ? "…" : ""
        }`,
      );
    }
    // Use a stable prefix so tests + humans can spot fake IDs at a glance.
    // The random tail is base36 for compactness.
    const rand = Math.random().toString(36).slice(2, 10);
    return { providerMessageId: `test-${Date.now()}-${rand}` };
  }
}

// ---------------------------------------------------------------------------
// TwilioAdapter
// ---------------------------------------------------------------------------

/**
 * Programmable Messaging (POST /2010-04-01/Accounts/{sid}/Messages.json).
 *
 * Auth: HTTP Basic — username=AccountSID, password=AuthToken.
 * Body: application/x-www-form-urlencoded — {To, From, Body}.
 * Response 201: {sid, status, ...}. Non-2xx: JSON with {code, message}.
 */
export class TwilioAdapter implements SmsAdapter {
  readonly providerName = "twilio" as const;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    /** Injectable for tests. */
    private readonly baseUrl: string = "https://api.twilio.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    const from = input.from ?? this.from;
    if (!from) throw new Error("Twilio send: no `from` configured (no Messaging Service SID nor phone number)");

    const url = `${this.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const body = new URLSearchParams();
    body.set("To", input.to);
    body.set("From", from);
    body.set("Body", input.body);

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    const text = await res.text();
    if (!res.ok) {
      // Twilio error bodies are JSON: {code, message, more_info, status}.
      // Surface the message + code so ops can find it in Twilio's docs.
      let detail = text.slice(0, 500);
      try {
        const j = JSON.parse(text) as { code?: number; message?: string };
        if (j.message) detail = `Twilio ${j.code ?? res.status}: ${j.message}`;
      } catch {
        /* leave detail as raw slice */
      }
      throw new Error(detail);
    }

    let sid: string | undefined;
    try {
      const j = JSON.parse(text) as { sid?: string };
      sid = j.sid;
    } catch {
      /* fall through */
    }
    if (!sid) throw new Error(`Twilio: 201 without sid — raw=${text.slice(0, 200)}`);
    return { providerMessageId: sid };
  }
}

// ---------------------------------------------------------------------------
// Msg91Adapter
// ---------------------------------------------------------------------------

/**
 * MSG91 sendhttp (v5 flow) — POST https://control.msg91.com/api/v5/flow.
 *
 * We chose /api/v5/flow (not /api/sendhttp.php) because:
 *   * v5 is Msg91's current-recommended API; sendhttp.php is deprecated /
 *     "legacy" per their docs and only supports transactional routes.
 *   * v5 supports both flows (template-based, DLT-approved) and plain SMS via
 *     the `sms` array. Our body-based send maps to the plain sms array.
 *   * v5 returns JSON — sendhttp.php returns plain text, which we'd have to
 *     regex-parse for request_id. JSON is safer.
 *
 * Auth: `authkey` header. No signature, plain shared key.
 * Body: JSON {sender, route, country, sms: [{message, to: [<num>, ...]}]}
 *   * sender = 6-char alphanumeric sender ID (India transactional).
 *   * route = "4" for transactional (default) / "1" for promotional.
 *   * country = "91" for India. We default to 91 but allow override via config.
 *
 * Response: {type: "success", request_id: "..."} on happy path.
 *           {type: "error", message: "..."} on failure.
 */
export class Msg91Adapter implements SmsAdapter {
  readonly providerName = "msg91" as const;

  constructor(
    private readonly authKey: string,
    private readonly senderId: string,
    private readonly route: string = "4",
    private readonly country: string = "91",
    /** Injectable for tests. */
    private readonly baseUrl: string = "https://control.msg91.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    // MSG91 expects numbers without a leading '+' (E.164 stripped). Strip
    // it defensively so callers can pass either form.
    const to = input.to.replace(/^\+/, "");

    const url = `${this.baseUrl}/api/v5/flow`;
    const payload = {
      sender: input.from ?? this.senderId,
      route: this.route,
      country: this.country,
      sms: [
        {
          message: input.body,
          to: [to],
        },
      ],
    };

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authkey: this.authKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 500);
      try {
        const j = JSON.parse(text) as { message?: string };
        if (j.message) detail = `MSG91 ${res.status}: ${j.message}`;
      } catch {
        /* raw slice */
      }
      throw new Error(detail);
    }

    let j: { type?: string; message?: string; request_id?: string };
    try {
      j = JSON.parse(text) as typeof j;
    } catch {
      throw new Error(`MSG91: unparseable response — raw=${text.slice(0, 200)}`);
    }
    if (j.type && j.type !== "success") {
      throw new Error(`MSG91 error: ${j.message ?? text.slice(0, 200)}`);
    }
    const id = j.request_id ?? "";
    if (!id) throw new Error(`MSG91: success without request_id — raw=${text.slice(0, 200)}`);
    return { providerMessageId: id };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Resolve the right SMS adapter for a tenant.
 *
 * Precedence:
 *   1. `SMS_PROVIDER=test` env → always TestAdapter (CI / e2e overrides).
 *   2. `TenantIntegration provider="sms" isActive=true` row → pick from
 *      config.provider ∈ {twilio, msg91, plivo}. plivo is a reserved slot —
 *      throws until we ship the adapter.
 *   3. No integration row → TestAdapter fallback. This means brand-new tenants
 *      have working SMS-write flows (no crash on POST /sms/process) even
 *      before wiring up a real provider — critical for the "install and
 *      explore" onboarding path.
 */
// Thrown when SMS send is attempted but no real provider is configured.
// Routes should catch this and return 503 with the message so the user
// sees "SMS not configured" instead of "SMS sent" against a stub.
export class NoSmsProviderError extends Error {
  constructor(tenantId: string) {
    super(
      `SMS provider not configured for tenant ${tenantId}. Wire up Twilio or MSG91 in Settings → Integrations before sending SMS.`,
    );
    this.name = "NoSmsProviderError";
  }
}

export async function getSmsAdapter(
  prisma: PrismaClient,
  tenantId: string,
): Promise<SmsAdapter> {
  // Explicit opt-in to TestAdapter via env — covers CI + local-dev where
  // we want flows to complete without a real SMS provider. Production
  // deployments MUST NOT set SMS_PROVIDER=test (and the hard-fail below
  // enforces that if they forget to configure a real provider).
  if (process.env.SMS_PROVIDER === "test") {
    return new TestAdapter();
  }

  const row = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "sms", isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!row) {
    // Prod: hard-fail so the SmsMessage never gets marked "Sent" with a
    // fake providerMessageId. Dev: keep TestAdapter so the first-boot
    // onboarding flow doesn't crash before a provider is wired up.
    if (process.env.NODE_ENV === "production") {
      throw new NoSmsProviderError(tenantId);
    }
    return new TestAdapter();
  }

  const config = (row.config as Record<string, unknown> | null) ?? {};
  const providerKey = String(config.provider ?? "").toLowerCase();
  let secrets: Record<string, unknown>;
  try {
    secrets = decryptSecrets(row.secrets);
  } catch (e) {
    throw new Error(
      `SMS integration secrets could not be decrypted for tenant ${tenantId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  switch (providerKey) {
    case "twilio": {
      const accountSid = str(secrets.accountSid ?? secrets.account_sid);
      const authToken = str(secrets.authToken ?? secrets.auth_token);
      const from = str(secrets.from ?? config.from ?? secrets.messagingServiceSid);
      if (!accountSid || !authToken) {
        throw new Error("Twilio SMS integration missing accountSid or authToken in secrets");
      }
      return new TwilioAdapter(accountSid, authToken, from);
    }
    case "msg91": {
      const authKey = str(secrets.authKey ?? secrets.auth_key);
      const senderId = str(secrets.senderId ?? config.senderId ?? secrets.sender);
      const route = str(config.route ?? secrets.route) || "4";
      const country = str(config.country ?? secrets.country) || "91";
      if (!authKey || !senderId) {
        throw new Error("MSG91 SMS integration missing authKey or senderId");
      }
      return new Msg91Adapter(authKey, senderId, route, country);
    }
    case "plivo":
      // Reserved. Fail loudly rather than silently drop to Test — an operator
      // who explicitly wired plivo needs to know we haven't built it yet.
      throw new Error("Plivo SMS adapter not implemented yet");
    case "test":
    case "":
      return new TestAdapter();
    default:
      throw new Error(`Unknown SMS provider: ${providerKey}`);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
