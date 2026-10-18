// Gmail + Outlook two-way sync — OAuth 2 helpers + inbound-poller
// primitives. Configurable per tenant via TenantIntegration.secrets:
//
//   Gmail:
//     { provider: "gmail", clientId, clientSecret, refreshToken,
//       redirectUri?, historyId? }
//   Outlook (Microsoft Graph):
//     { provider: "outlook", clientId, clientSecret, refreshToken,
//       tenantId?, redirectUri?, deltaLink? }
//
// The routes call `exchangeCode` on OAuth callback and store the
// refresh token; a scheduler tick then calls `pollNewMessages` on the
// tenant's active integrations and creates one CrmActivity per new
// email, matched to Lead/Customer/Contact by sender email.
//
// Access-token caching is the caller's responsibility (each call
// re-mints via the refresh token — Google's token endpoint tolerates
// this at reasonable rate).

export interface OAuthCodeExchangeInput {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  scope?: string;
  tokenType: string;
}

export interface InboundMessage {
  providerMessageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  subject: string;
  snippet: string;
  sentAt: Date;
  threadId: string | null;
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTHZ_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

// Build the URL the user hits to grant access. The redirect_uri must
// match one the app registered in Google Cloud Console.
export function buildGmailAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force refresh_token to be returned on repeat
    state,
  });
  return `${GOOGLE_AUTHZ_URL}?${p.toString()}`;
}

// Exchange the authorization code for tokens. Google returns a
// long-lived refresh_token on the first exchange with prompt=consent.
export async function exchangeGmailCode(
  input: OAuthCodeExchangeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokenBundle> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gmail token exchange failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  };
  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token — re-run the consent screen with prompt=consent",
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

// Refresh an access token using the stored refresh_token. Called by
// every poll cycle — cheap (< 100ms) and Google's endpoint is fine
// with it every few minutes.
export async function refreshGmailAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gmail refresh failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// Poll for new inbound messages since `sinceHistoryId`. Returns the
// list + a new historyId to persist for the next poll. Uses the
// history.list + messages.get endpoints.
export async function pollGmailNewMessages(
  accessToken: string,
  sinceHistoryId: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ messages: InboundMessage[]; newHistoryId: string | null }> {
  // First poll: bootstrap by reading the mailbox profile to grab a
  // starting historyId, then return empty list.
  if (!sinceHistoryId) {
    const profileRes = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) throw new Error(`Gmail profile failed: ${profileRes.status}`);
    const p = (await profileRes.json()) as { historyId?: string };
    return { messages: [], newHistoryId: p.historyId ?? null };
  }

  const histRes = await fetchImpl(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(sinceHistoryId)}&historyTypes=messageAdded`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (histRes.status === 404) {
    // startHistoryId too old — reset by re-bootstrapping.
    return { messages: [], newHistoryId: null };
  }
  if (!histRes.ok) throw new Error(`Gmail history failed: ${histRes.status}`);
  const histData = (await histRes.json()) as {
    history?: Array<{
      messagesAdded?: Array<{ message: { id: string; threadId?: string } }>;
    }>;
    historyId?: string;
  };
  const messageIds = new Set<string>();
  for (const h of histData.history ?? []) {
    for (const ma of h.messagesAdded ?? []) messageIds.add(ma.message.id);
  }
  const messages: InboundMessage[] = [];
  for (const id of messageIds) {
    const mRes = await fetchImpl(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!mRes.ok) continue;
    const m = (await mRes.json()) as {
      id: string;
      threadId?: string;
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    const h = m.payload?.headers ?? [];
    const from = h.find((x) => x.name.toLowerCase() === "from")?.value ?? "";
    const to = h.find((x) => x.name.toLowerCase() === "to")?.value ?? "";
    const subject = h.find((x) => x.name.toLowerCase() === "subject")?.value ?? "";
    const fromMatch = /(?:"?([^"<]+)"?\s*)?<?([^>\s]+@[^>\s]+)>?/.exec(from);
    const fromName = fromMatch?.[1]?.trim() || null;
    const fromEmail = (fromMatch?.[2] ?? "").toLowerCase();
    const toEmails = to.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const sentAt = m.internalDate ? new Date(Number(m.internalDate)) : new Date();
    messages.push({
      providerMessageId: m.id,
      fromEmail,
      fromName,
      toEmails,
      subject,
      snippet: m.snippet ?? "",
      sentAt,
      threadId: m.threadId ?? null,
    });
  }
  return { messages, newHistoryId: histData.historyId ?? sinceHistoryId };
}

// ── Outlook / Microsoft Graph ─────────────────────────────────────────

const MS_TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
const MS_AUTHZ_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`;
const MS_SCOPES = ["offline_access", "Mail.Read", "Mail.Send"];

export function buildOutlookAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  msTenantId = "common",
): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: MS_SCOPES.join(" "),
    state,
    response_mode: "query",
  });
  return `${MS_AUTHZ_URL(msTenantId)}?${p.toString()}`;
}

export async function exchangeOutlookCode(
  input: OAuthCodeExchangeInput & { msTenantId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokenBundle> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    scope: MS_SCOPES.join(" "),
  });
  const res = await fetchImpl(MS_TOKEN_URL(input.msTenantId ?? "common"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Outlook token exchange failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  };
  if (!data.refresh_token) throw new Error("Microsoft did not return refresh_token");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

export async function refreshOutlookAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  msTenantId = "common",
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MS_SCOPES.join(" "),
  });
  const res = await fetchImpl(MS_TOKEN_URL(msTenantId), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Outlook refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function pollOutlookNewMessages(
  accessToken: string,
  deltaLink: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ messages: InboundMessage[]; newDeltaLink: string | null }> {
  const url =
    deltaLink ??
    "https://graph.microsoft.com/v1.0/me/messages/delta?$select=id,subject,from,toRecipients,bodyPreview,receivedDateTime,conversationId";
  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Outlook delta failed: ${res.status}`);
  const data = (await res.json()) as {
    value?: Array<{
      id: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      toRecipients?: Array<{ emailAddress?: { address?: string } }>;
      bodyPreview?: string;
      receivedDateTime?: string;
      conversationId?: string;
    }>;
    "@odata.deltaLink"?: string;
  };
  const messages: InboundMessage[] = (data.value ?? []).map((m) => ({
    providerMessageId: m.id,
    fromEmail: (m.from?.emailAddress?.address ?? "").toLowerCase(),
    fromName: m.from?.emailAddress?.name ?? null,
    toEmails: (m.toRecipients ?? [])
      .map((r) => (r.emailAddress?.address ?? "").toLowerCase())
      .filter(Boolean),
    subject: m.subject ?? "",
    snippet: m.bodyPreview ?? "",
    sentAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
    threadId: m.conversationId ?? null,
  }));
  return { messages, newDeltaLink: data["@odata.deltaLink"] ?? null };
}
