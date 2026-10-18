// Marketing P3 — Webinar provider adapters.
//
// Ships three adapter slots today:
//   * ZoomAdapter        — real Zoom API (Server-to-Server OAuth) integration.
//   * WebexAdapter       — Webex Meetings REST API. Configurable via
//     TenantIntegration.secrets.token (long-lived bot or OAuth token).
//   * GoogleMeetAdapter  — Google Calendar API v3 with Meet conference.
//     Configurable via TenantIntegration.secrets.accessToken (+ optional
//     .calendarId; defaults to "primary").
//
// The factory `getWebinarAdapter(prisma, tenantId, provider)` reads the
// tenant's `TenantIntegration provider="zoom"` (or "webex", "googlemeet")
// row. On any missing / malformed integration the factory returns null so
// route handlers can gracefully fall back to a Draft (unpublished) state
// without provisioning on the third-party side.
//
// Zoom-specific notes:
//   * We use Server-to-Server OAuth (grant_type=account_credentials) rather
//     than JWT (deprecated Sep 2023) or OAuth-user-context (requires a
//     browser flow the tenant admin doesn't need for hosted webinars).
//   * The OAuth token is cached in-memory per (tenantId) with a 5-minute
//     refresh buffer before expiry. This avoids a token round-trip on every
//     API call; Zoom's default token lifetime is 1h.
//   * We hit /users/me/meetings (registration_type=1 = "attendees register
//     once"). Zoom Webinar (real webinar product) requires a paid Webinar
//     add-on and a different endpoint (/users/me/webinars). We ship the
//     meeting-with-registration flow first because it works on the free /
//     standard Zoom plan and covers 90% of the CRM use case — teach-back,
//     product demo, small-cohort training. Upgrading to real Webinar is a
//     one-URL swap when tenants ask.
//
// Adding another provider:
//   1. New class implementing WebinarAdapter.
//   2. Extend the switch in getWebinarAdapter.
//   3. Document the credential shape in the class header.

import type { PrismaClient } from "@prisma/client";
import { decryptSecrets } from "./secrets-crypto";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface WebinarCreateInput {
  topic: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  agenda?: string | null;
  /** Max registrants. Null means "no cap" — providers may still enforce one. */
  capacity?: number | null;
}

export interface WebinarCreateResult {
  externalId: string;
  joinUrl: string;
  hostUrl: string;
}

export interface WebinarUpdateInput {
  topic?: string;
  startAt?: Date;
  endAt?: Date;
  timezone?: string;
  agenda?: string | null;
  capacity?: number | null;
}

export interface WebinarRegistrantInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface WebinarRegistrantResult {
  /** Per-registrant join URL (unique). Overrides the shared joinUrl. */
  join_url: string;
}

export type WebinarProviderKey = "Zoom" | "Webex" | "GoogleMeet";

export interface WebinarAdapter {
  readonly providerName: WebinarProviderKey;
  create(input: WebinarCreateInput): Promise<WebinarCreateResult>;
  update(externalId: string, input: WebinarUpdateInput): Promise<void>;
  delete(externalId: string): Promise<void>;
  addRegistrant(
    externalId: string,
    registrant: WebinarRegistrantInput,
  ): Promise<WebinarRegistrantResult>;
}

// ---------------------------------------------------------------------------
// ZoomAdapter — Server-to-Server OAuth + meetings-with-registration.
// ---------------------------------------------------------------------------

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

// In-memory token cache — { tenantId → {token, expiresAt} }. Zoom tokens
// last 1h; we refresh 5 min before expiry to avoid a race with a request
// mid-flight. This map is process-local (which is fine — restart-safe).
const zoomTokenCache = new Map<string, { token: string; expiresAt: number }>();
const ZOOM_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Test-only helper. Clears the OAuth cache for a tenant / all tenants. */
export function _clearZoomTokenCache(tenantId?: string): void {
  if (tenantId) zoomTokenCache.delete(tenantId);
  else zoomTokenCache.clear();
}

/**
 * Fetch (or reuse a cached) access token for a Zoom Server-to-Server OAuth
 * app. Zoom returns `{access_token, token_type: "bearer", expires_in: 3599}`.
 */
async function fetchZoomToken(
  tenantId: string,
  creds: ZoomCredentials,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<string> {
  const cached = zoomTokenCache.get(tenantId);
  if (cached && cached.expiresAt - Date.now() > ZOOM_REFRESH_BUFFER_MS) {
    return cached.token;
  }

  const url = `${baseUrl}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
    creds.accountId,
  )}`;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      // Zoom rejects requests without a Host / accept.
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zoom OAuth failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`Zoom OAuth: unparseable response — raw=${text.slice(0, 200)}`);
  }
  if (!parsed.access_token) {
    throw new Error(`Zoom OAuth: no access_token — raw=${text.slice(0, 200)}`);
  }
  const expiresInMs = (parsed.expires_in ?? 3600) * 1000;
  const entry = { token: parsed.access_token, expiresAt: Date.now() + expiresInMs };
  zoomTokenCache.set(tenantId, entry);
  return entry.token;
}

/** Duration in whole minutes between two dates. Rounded up so a 61-second
 *  meeting still shows as 1 minute. Zoom rejects duration=0. */
function minutesBetween(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  const mins = Math.ceil(diffMs / 60_000);
  return mins > 0 ? mins : 1;
}

/** ISO string without milliseconds; Zoom's start_time expects "YYYY-MM-DDTHH:mm:ss". */
function zoomIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class ZoomAdapter implements WebinarAdapter {
  readonly providerName = "Zoom" as const;

  constructor(
    private readonly tenantId: string,
    private readonly creds: ZoomCredentials,
    /** Overridable for tests. */
    private readonly apiBase: string = "https://api.zoom.us/v2",
    private readonly oauthBase: string = "https://zoom.us",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async authHeader(): Promise<string> {
    const token = await fetchZoomToken(
      this.tenantId,
      this.creds,
      this.fetchImpl,
      this.oauthBase,
    );
    return `Bearer ${token}`;
  }

  async create(input: WebinarCreateInput): Promise<WebinarCreateResult> {
    const auth = await this.authHeader();
    const body: Record<string, unknown> = {
      topic: input.topic,
      // 2 = Scheduled meeting. We always schedule ahead — no "recurring" or
      // "PMI" meetings from CRM webinars.
      type: 2,
      start_time: zoomIso(input.startAt),
      duration: minutesBetween(input.startAt, input.endAt),
      timezone: input.timezone,
      agenda: input.agenda ?? undefined,
      settings: {
        // 1 = "Attendees register once" — a single registration link works
        // for both live + on-demand replays.
        registration_type: 1,
        // 0 = "Automatically approve" — matches our CRM UX (registration is
        // instant, no host approval step). Move to 1 or 2 if a tenant needs
        // moderation.
        approval_type: 0,
        host_video: true,
        participant_video: false,
        join_before_host: false,
      },
    };

    const res = await this.fetchImpl(`${this.apiBase}/users/me/meetings`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Zoom create meeting failed (${res.status}): ${text.slice(0, 300)}`);
    }
    let parsed: { id?: number | string; join_url?: string; start_url?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`Zoom create: unparseable response — raw=${text.slice(0, 200)}`);
    }
    if (parsed.id == null || !parsed.join_url || !parsed.start_url) {
      throw new Error(
        `Zoom create: missing id/join_url/start_url — raw=${text.slice(0, 200)}`,
      );
    }
    return {
      externalId: String(parsed.id),
      joinUrl: parsed.join_url,
      hostUrl: parsed.start_url,
    };
  }

  async update(externalId: string, input: WebinarUpdateInput): Promise<void> {
    const auth = await this.authHeader();
    // Zoom PATCH accepts the same body shape as POST; only send changed fields.
    const body: Record<string, unknown> = {};
    if (input.topic != null) body.topic = input.topic;
    if (input.agenda != null) body.agenda = input.agenda;
    if (input.startAt) body.start_time = zoomIso(input.startAt);
    if (input.timezone) body.timezone = input.timezone;
    if (input.startAt && input.endAt) {
      body.duration = minutesBetween(input.startAt, input.endAt);
    }
    // Zoom returns 204 No Content on success.
    const res = await this.fetchImpl(
      `${this.apiBase}/meetings/${encodeURIComponent(externalId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Zoom update meeting failed (${res.status}): ${text.slice(0, 300)}`);
    }
  }

  async delete(externalId: string): Promise<void> {
    const auth = await this.authHeader();
    const res = await this.fetchImpl(
      `${this.apiBase}/meetings/${encodeURIComponent(externalId)}`,
      {
        method: "DELETE",
        headers: { Authorization: auth, Accept: "application/json" },
      },
    );
    // 204 = success, 404 = already gone (idempotent — swallow).
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Zoom delete meeting failed (${res.status}): ${text.slice(0, 300)}`);
    }
  }

  async addRegistrant(
    externalId: string,
    registrant: WebinarRegistrantInput,
  ): Promise<WebinarRegistrantResult> {
    const auth = await this.authHeader();
    const body = {
      email: registrant.email,
      // Zoom requires first_name; last_name is optional but recommended.
      first_name: registrant.firstName ?? registrant.email.split("@")[0] ?? "Guest",
      last_name: registrant.lastName ?? "",
    };
    const res = await this.fetchImpl(
      `${this.apiBase}/meetings/${encodeURIComponent(externalId)}/registrants`,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Zoom addRegistrant failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }
    let parsed: { join_url?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`Zoom addRegistrant: unparseable response — raw=${text.slice(0, 200)}`);
    }
    if (!parsed.join_url) {
      throw new Error(
        `Zoom addRegistrant: no join_url — raw=${text.slice(0, 200)}`,
      );
    }
    return { join_url: parsed.join_url };
  }
}

// ---------------------------------------------------------------------------
// WebexAdapter — live Webex Meetings REST API integration.
// ---------------------------------------------------------------------------

/**
 * Webex Meetings REST API adapter.
 *   Token: TenantIntegration.secrets.token (long-lived bot token, or
 *     an OAuth access-token refreshed elsewhere and pasted in).
 *   Docs: https://developer.webex.com/docs/api/v1/meetings/create-a-meeting
 */
export class WebexAdapter implements WebinarAdapter {
  readonly providerName = "Webex" as const;

  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    _tenantId: string,
    secrets: Record<string, unknown>,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.token = typeof secrets.token === "string" ? secrets.token : "";
    if (!this.token) {
      throw new Error(
        "Webex not configured — set `token` on the TenantIntegration.secrets bag",
      );
    }
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
    };
  }

  async create(input: WebinarCreateInput): Promise<WebinarCreateResult> {
    const body = {
      title: input.topic,
      agenda: input.agenda ?? undefined,
      start: input.startAt.toISOString(),
      end: input.endAt.toISOString(),
      timezone: input.timezone,
    };
    const res = await this.fetchImpl("https://webexapis.com/v1/meetings", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Webex create failed: ${res.status} ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as {
      id?: string;
      webLink?: string;
      hostKey?: string;
      password?: string;
    };
    if (!data.id || !data.webLink) throw new Error("Webex create: missing id/webLink in response");
    return {
      externalId: data.id,
      joinUrl: data.webLink,
      hostUrl: data.webLink, // Webex uses one URL; hostKey elevates on join
    };
  }

  async update(externalId: string, input: WebinarUpdateInput): Promise<void> {
    const body: Record<string, unknown> = {};
    if (input.topic !== undefined) body.title = input.topic;
    if (input.agenda !== undefined) body.agenda = input.agenda;
    if (input.startAt !== undefined) body.start = input.startAt.toISOString();
    if (input.endAt !== undefined) body.end = input.endAt.toISOString();
    if (input.timezone !== undefined) body.timezone = input.timezone;
    const res = await this.fetchImpl(
      `https://webexapis.com/v1/meetings/${encodeURIComponent(externalId)}`,
      { method: "PUT", headers: this.headers(), body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error(`Webex update failed: ${res.status}`);
  }

  async delete(externalId: string): Promise<void> {
    const res = await this.fetchImpl(
      `https://webexapis.com/v1/meetings/${encodeURIComponent(externalId)}`,
      { method: "DELETE", headers: this.headers() },
    );
    if (!res.ok && res.status !== 404) throw new Error(`Webex delete failed: ${res.status}`);
  }

  async addRegistrant(
    externalId: string,
    registrant: WebinarRegistrantInput,
  ): Promise<WebinarRegistrantResult> {
    // Webex uses `/meetingInvitees` — a POST creates the invitee AND
    // returns a per-invitee join link when the meeting is enabled for
    // registration.
    const body = {
      meetingId: externalId,
      email: registrant.email,
      displayName:
        [registrant.firstName, registrant.lastName].filter(Boolean).join(" ") || registrant.email,
      sendEmail: true,
    };
    const res = await this.fetchImpl("https://webexapis.com/v1/meetingInvitees", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Webex addRegistrant failed: ${res.status}`);
    const data = (await res.json()) as { meetingId?: string; joinUrl?: string };
    // Webex doesn't always return joinUrl per invitee — the meeting's
    // webLink from create() is the fallback.
    return { join_url: data.joinUrl ?? "" };
  }
}

// ---------------------------------------------------------------------------
// GoogleMeetAdapter — Google Calendar API v3 with Meet conference addon.
// Google Meet has no first-class webinar API; meetings are created as a side
// effect of a Calendar event with a `conferenceData.createRequest`.
// ---------------------------------------------------------------------------
export class GoogleMeetAdapter implements WebinarAdapter {
  readonly providerName = "GoogleMeet" as const;

  private readonly accessToken: string;
  private readonly calendarId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    _tenantId: string,
    secrets: Record<string, unknown>,
    fetchImpl: typeof fetch = fetch,
  ) {
    // `accessToken` is an OAuth 2 access token with scope
    //   https://www.googleapis.com/auth/calendar.events
    // Refresh flow is out of scope for this adapter — the caller
    // (integrations UI) refreshes and pastes the current token.
    this.accessToken = typeof secrets.accessToken === "string" ? secrets.accessToken : "";
    this.calendarId =
      typeof secrets.calendarId === "string" && secrets.calendarId
        ? secrets.calendarId
        : "primary";
    if (!this.accessToken) {
      throw new Error(
        "GoogleMeet not configured — set `accessToken` on TenantIntegration.secrets",
      );
    }
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.accessToken}`,
      "content-type": "application/json",
    };
  }

  private base(): string {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
  }

  async create(input: WebinarCreateInput): Promise<WebinarCreateResult> {
    const body = {
      summary: input.topic,
      description: input.agenda ?? undefined,
      start: { dateTime: input.startAt.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.endAt.toISOString(), timeZone: input.timezone },
      conferenceData: {
        createRequest: {
          requestId: `lumaara-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };
    const res = await this.fetchImpl(`${this.base()}?conferenceDataVersion=1`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GoogleMeet create failed: ${res.status} ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as {
      id?: string;
      hangoutLink?: string;
    };
    if (!data.id) throw new Error("GoogleMeet create: missing event id");
    // hangoutLink appears asynchronously — Google usually populates it
    // immediately, but for a freshly-provisioned account the first call
    // may return the event without it. In that case we return an empty
    // joinUrl and let the caller re-fetch.
    return {
      externalId: data.id,
      joinUrl: data.hangoutLink ?? "",
      hostUrl: data.hangoutLink ?? "", // Google: host = anyone with the link
    };
  }

  async update(externalId: string, input: WebinarUpdateInput): Promise<void> {
    const body: Record<string, unknown> = {};
    if (input.topic !== undefined) body.summary = input.topic;
    if (input.agenda !== undefined) body.description = input.agenda;
    if (input.startAt !== undefined || input.endAt !== undefined) {
      if (input.startAt !== undefined)
        body.start = { dateTime: input.startAt.toISOString(), timeZone: input.timezone ?? "UTC" };
      if (input.endAt !== undefined)
        body.end = { dateTime: input.endAt.toISOString(), timeZone: input.timezone ?? "UTC" };
    }
    const res = await this.fetchImpl(
      `${this.base()}/${encodeURIComponent(externalId)}`,
      { method: "PATCH", headers: this.headers(), body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error(`GoogleMeet update failed: ${res.status}`);
  }

  async delete(externalId: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.base()}/${encodeURIComponent(externalId)}`,
      { method: "DELETE", headers: this.headers() },
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`GoogleMeet delete failed: ${res.status}`);
    }
  }

  async addRegistrant(
    externalId: string,
    registrant: WebinarRegistrantInput,
  ): Promise<WebinarRegistrantResult> {
    // Fetch current event → append to attendees[] → PATCH back with
    // `sendUpdates=all` so Google emails the invitee automatically.
    const evRes = await this.fetchImpl(
      `${this.base()}/${encodeURIComponent(externalId)}`,
      { headers: this.headers() },
    );
    if (!evRes.ok) throw new Error(`GoogleMeet fetch event failed: ${evRes.status}`);
    const ev = (await evRes.json()) as {
      attendees?: Array<{ email: string; displayName?: string }>;
      hangoutLink?: string;
    };
    const attendees = ev.attendees ?? [];
    if (!attendees.some((a) => a.email.toLowerCase() === registrant.email.toLowerCase())) {
      const displayName =
        [registrant.firstName, registrant.lastName].filter(Boolean).join(" ") || undefined;
      attendees.push({ email: registrant.email, displayName });
    }
    const patch = await this.fetchImpl(
      `${this.base()}/${encodeURIComponent(externalId)}?sendUpdates=all`,
      {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ attendees }),
      },
    );
    if (!patch.ok) throw new Error(`GoogleMeet addRegistrant failed: ${patch.status}`);
    return { join_url: ev.hangoutLink ?? "" };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function coerceZoomCreds(secrets: Record<string, unknown>): ZoomCredentials | null {
  const accountId =
    typeof secrets.accountId === "string"
      ? secrets.accountId
      : typeof secrets.account_id === "string"
        ? secrets.account_id
        : "";
  const clientId =
    typeof secrets.clientId === "string"
      ? secrets.clientId
      : typeof secrets.client_id === "string"
        ? secrets.client_id
        : "";
  const clientSecret =
    typeof secrets.clientSecret === "string"
      ? secrets.clientSecret
      : typeof secrets.client_secret === "string"
        ? secrets.client_secret
        : "";
  if (!accountId || !clientId || !clientSecret) return null;
  return { accountId, clientId, clientSecret };
}

/**
 * Resolve the right webinar adapter for a tenant + provider.
 *
 * Returns null when there is no active integration for that provider — the
 * route layer treats this as "save Draft locally, do not provision".
 *
 * Precedence:
 *   1. `WEBINAR_PROVIDER=test` env → returns null unconditionally (route
 *      layer saves Draft locally). Used in CI + local dev without live keys.
 *   2. `TenantIntegration provider=<lc>` row → construct the concrete
 *      adapter from decrypted secrets.
 *   3. No row → null.
 */
export async function getWebinarAdapter(
  prismaClient: PrismaClient,
  tenantId: string,
  provider: WebinarProviderKey,
): Promise<WebinarAdapter | null> {
  if (process.env.WEBINAR_PROVIDER === "test") return null;

  const providerKey = provider.toLowerCase(); // TenantIntegration.provider is lc.
  const row = await prismaClient.tenantIntegration.findFirst({
    where: { tenantId, provider: providerKey, isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!row) return null;

  let secrets: Record<string, unknown>;
  try {
    secrets = decryptSecrets(row.secrets);
  } catch {
    // Bad envelope → treat as no integration. The route layer will save the
    // row as Draft (no provisioning). Ops can rotate the key + retry.
    return null;
  }

  switch (provider) {
    case "Zoom": {
      const creds = coerceZoomCreds(secrets);
      if (!creds) return null;
      return new ZoomAdapter(tenantId, creds);
    }
    case "Webex":
      return new WebexAdapter(tenantId, secrets);
    case "GoogleMeet":
      return new GoogleMeetAdapter(tenantId, secrets);
    default:
      return null;
  }
}

// Test hook — expose the coercion helper for hermetic unit tests.
export function _coerceZoomCreds(secrets: Record<string, unknown>): ZoomCredentials | null {
  return coerceZoomCreds(secrets);
}
