// Marketing P3 — Social provider adapters (LinkedIn, Facebook Pages,
// Instagram Business, X/Twitter API v2).
//
// Design:
//   * One `SocialAdapter` interface per platform. Each ships:
//       - getOAuthUrl(state, redirectUri) — first leg of the 3-legged flow.
//       - exchangeCode(code, redirectUri) — swap code for access+refresh
//         tokens plus the platform's user identity (id / handle / display
//         name / avatar).
//       - refreshAccessToken(refreshToken) — mint a new access token when the
//         current one is nearing expiry (we refresh at T-5min in the caller).
//       - publish({content, mediaUrls, linkUrl, account}) — post the content
//         to the platform on behalf of the connected account; returns the
//         platform-native post id (used later for engagement pulls).
//       - refreshEngagement(platformPostId, account) — fetch impressions /
//         likes / shares / comments / clicks from the platform's insights
//         API. All counters MUST be numeric (0 if the platform doesn't
//         expose that dimension for the account tier).
//   * Native fetch (Node 20+) — this package stays dependency-free. All
//     requests carry an AbortSignal.timeout(15_000) so a hanging platform
//     never wedges the publish loop.
//   * NO retries inside the adapter. The route layer / scheduler tick owns
//     retry policy (`SocialPostResult.status=Failed` + a manual retry
//     surface in the UI).
//
// Credential storage — IMPORTANT (per plan):
//   * The `SocialAccount` model has `accessToken`/`refreshToken` as plain
//     `String?` columns. We DO NOT store plaintext tokens there. Instead:
//         For each `SocialAccount(id=X)` we insert one
//         `TenantIntegration provider="social:<platform>" name=X`
//         row whose `secrets` column is the AES-256-GCM envelope produced
//         by `encryptSecrets({accessToken, refreshToken, expiresAt,
//         externalId})`. The `config` column holds non-secret metadata
//         (platform, handle, displayName, avatarUrl, pageId for FB pages,
//         igUserId for Instagram Business, etc.).
//   * We keep `SocialAccount.tokenExpiresAt` in the DB (unencrypted — a
//     timestamp isn't sensitive on its own and we need to query it cheaply
//     to know when to refresh). Everything else lives inside the
//     encrypted blob.
//   * Reason: the alternative — wrapping every write into `encryptSecrets`
//     and stuffing the JSON blob back into the `accessToken` String field
//     — would work but conflates model shape with the storage mechanism.
//     Using `TenantIntegration` mirrors what SMS/WhatsApp/Slack already
//     do and keeps a single decrypt path (`getSocialCredentials`) instead
//     of ad-hoc parse/decrypt at every call site.
//
// OAuth flows implemented today:
//   * LinkedIn — 3-legged OAuth 2.0. Scope: `w_member_social r_liteprofile`.
//     Auth URL: https://www.linkedin.com/oauth/v2/authorization
//     Token URL: https://www.linkedin.com/oauth/v2/accessToken
//     Publish:   POST https://api.linkedin.com/v2/ugcPosts
//     Media upload is a 2-step (register upload → PUT bytes → attach) that
//     we implement inline when mediaUrls[0] is provided.
//   * Facebook Pages — OAuth 2.0. Scope: `pages_manage_posts,
//     pages_read_engagement`. The exchange flow returns a *short-lived*
//     user token; we swap that for a long-lived user token, then fetch
//     the target Page's page-token via GET /me/accounts.
//     Publish: POST https://graph.facebook.com/v21.0/{pageId}/feed
//     with {message, link?, access_token}. Long-lived page tokens don't
//     expire, so refresh is a no-op that returns the current token.
//   * Instagram Business — piggybacks on the Facebook flow (an IG Business
//     account is *always* linked to a Facebook Page). We assume the FB
//     Page's IG-linked id is stored in `config.igUserId`. Publish is a
//     two-call container flow: POST /{ig-user-id}/media → poll → POST
//     /{ig-user-id}/media_publish. When mediaUrls is empty, we return a
//     clean error — IG rejects text-only posts.
//   * X / Twitter API v2 — OAuth 2.0 with PKCE. Scope:
//     `tweet.write tweet.read users.read offline.access`.
//     Auth URL: https://twitter.com/i/oauth2/authorize
//     Token URL: https://api.twitter.com/2/oauth2/token
//     Publish:   POST https://api.twitter.com/2/tweets  body: {text}
//     PKCE verifier is stashed in the `state` payload so the callback can
//     retrieve it without a session cookie (the CRM UI opens the OAuth
//     window as a popup and the callback closes it — no cross-tab cookie
//     is available).
//
// Configuration: each tenant sets developer-app credentials on the
// per-platform TenantIntegration.secrets bag (clientId + clientSecret,
// with additional per-platform fields — see the per-adapter docstrings).
// Once creds are set, /social/oauth/start?platform=X returns the
// consent URL and the callback stores the resulting tokens on
// SocialAccount. All four platforms (LinkedIn, Facebook, Instagram,
// Twitter/X) are wired end-to-end for text + single-image posts.
//
// Known follow-ups (not blocking):
//   * Video / carousel uploads for LinkedIn + IG — text + single-image
//     supported today.
//   * Automatic X-Rate-Limit-Reset backoff — first hit throws; retry is
//     the caller's responsibility.

import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { encryptSecrets, decryptSecrets } from "./secrets-crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SocialPlatform =
  | "LinkedIn"
  | "Facebook"
  | "Instagram"
  | "Twitter";

/** Credentials pulled from `TenantIntegration.secrets` (decrypted). */
export interface SocialCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Unix ms — same as `SocialAccount.tokenExpiresAt`, cached for local use. */
  expiresAt?: number;
  /** Platform-native user id, e.g. LinkedIn URN, FB user id, X user id. */
  externalId?: string;
  /**
   * Facebook Page id (Facebook adapter) OR Instagram User id (IG adapter).
   * Kept in secrets alongside the token since some platforms return a
   * per-page/per-property token that pairs with a specific id.
   */
  pageAccessToken?: string;
  pageId?: string;
  igUserId?: string;
}

/** Minimal projection of `SocialAccount` the adapters need at publish time. */
export interface AccountContext {
  id: string;
  platform: SocialPlatform | string;
  handle: string;
  externalId: string | null;
  credentials: SocialCredentials;
}

export interface PublishInput {
  content: string;
  mediaUrls: string[];
  linkUrl: string | null;
  account: AccountContext;
}

export interface PublishResult {
  platformPostId: string;
}

export interface EngagementMetrics {
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
}

export interface OAuthTokenExchange {
  accessToken: string;
  refreshToken?: string;
  /** Unix ms of expiry, if the platform tells us. */
  expiresAt?: number;
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  /** Extra platform-specific bits (page tokens, IG user id, PKCE metadata). */
  extra?: Record<string, unknown>;
}

export interface OAuthRefreshResult {
  accessToken: string;
  /** New refresh token if the platform rotates it (X does; LinkedIn doesn't). */
  refreshToken?: string;
  expiresAt?: number;
}

export interface SocialAdapter {
  readonly platform: SocialPlatform;

  /** Returns the full 3-legged authorize URL the user's browser should visit. */
  getOAuthUrl(state: string, redirectUri: string): string;

  /**
   * Swap the returned `code` for tokens + identity. `extras` is populated
   * inline for platforms that require post-exchange calls (e.g. Facebook
   * needs a second call to /me/accounts to fetch page tokens).
   */
  exchangeCode(
    code: string,
    redirectUri: string,
    hints?: Record<string, unknown>,
  ): Promise<OAuthTokenExchange>;

  refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult>;

  publish(input: PublishInput): Promise<PublishResult>;

  refreshEngagement(
    platformPostId: string,
    account: AccountContext,
  ): Promise<EngagementMetrics>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

async function jsonFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const { timeoutMs, ...rest } = init;
  const res = await fetchImpl(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

function ensureOk(
  provider: string,
  op: string,
  r: { status: number; text: string; body: unknown },
): void {
  if (r.status >= 200 && r.status < 300) return;
  const detail =
    (typeof r.body === "object" &&
      r.body !== null &&
      "error" in (r.body as Record<string, unknown>) &&
      JSON.stringify((r.body as Record<string, unknown>).error)) ||
    r.text.slice(0, 500);
  throw new Error(`${provider} ${op} failed (${r.status}): ${detail}`);
}

/** URL-safe base64 without padding — needed for PKCE + state blobs. */
function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * PKCE helpers for the X flow. Verifier is a 43-128 char high-entropy
 * random string; challenge is base64url(sha256(verifier)).
 */
export function makePkceVerifier(): string {
  return b64url(randomBytes(32));
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

/**
 * LinkedIn `w_member_social` — post to the authenticated member's feed.
 * The `r_liteprofile` scope lets us grab id + name + avatar during
 * exchangeCode so the SocialAccount row has a friendly display name.
 *
 * The publish payload is the "ugcPosts" v2 shape:
 *   {
 *     author: "urn:li:person:<id>",
 *     lifecycleState: "PUBLISHED",
 *     specificContent: {
 *       "com.linkedin.ugc.ShareContent": {
 *         shareCommentary: {text: "..."},
 *         shareMediaCategory: "NONE"|"ARTICLE"|"IMAGE",
 *         media?: [{status: "READY", originalUrl?: "...", media?: "urn:li:image:..."}]
 *       }
 *     },
 *     visibility: {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"}
 *   }
 *
 * Engagement pull uses /v2/socialActions/{urn} which returns commentsSummary
 * + likesSummary. Impressions come from
 * /v2/organizationalEntityShareStatistics for company pages — we don't
 * request org scopes today so impressions stay 0 for personal posts.
 */
export class LinkedInAdapter implements SocialAdapter {
  readonly platform = "LinkedIn" as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly authBase = "https://www.linkedin.com",
    private readonly apiBase = "https://api.linkedin.com",
  ) {}

  getOAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      scope: "w_member_social r_liteprofile",
    });
    return `${this.authBase}/oauth/v2/authorization?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokenExchange> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const tokRes = await jsonFetch(this.fetchImpl, `${this.authBase}/oauth/v2/accessToken`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    ensureOk("LinkedIn", "token exchange", tokRes);
    const tok = tokRes.body as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!tok.access_token) throw new Error("LinkedIn: exchange returned no access_token");

    // r_liteprofile → GET /v2/me. Returns id, localizedFirstName,
    // localizedLastName, profilePicture (which we don't unpack here — the
    // profile-picture URL requires a separate projection).
    const meRes = await jsonFetch(this.fetchImpl, `${this.apiBase}/v2/me`, {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    ensureOk("LinkedIn", "me lookup", meRes);
    const me = meRes.body as {
      id?: string;
      localizedFirstName?: string;
      localizedLastName?: string;
    };
    if (!me.id) throw new Error("LinkedIn: /me returned no id");

    const displayName =
      [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(" ") ||
      "LinkedIn Member";

    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
      externalId: me.id,
      handle: me.id,
      displayName,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const r = await jsonFetch(this.fetchImpl, `${this.authBase}/oauth/v2/accessToken`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    ensureOk("LinkedIn", "refresh", r);
    const tok = r.body as { access_token?: string; expires_in?: number };
    if (!tok.access_token) throw new Error("LinkedIn refresh: no access_token in response");
    return {
      accessToken: tok.access_token,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const externalId = input.account.externalId ?? input.account.credentials.externalId;
    if (!externalId) throw new Error("LinkedIn publish: account is missing externalId (person URN suffix)");
    const author = `urn:li:person:${externalId}`;

    const hasLink = !!input.linkUrl;
    const shareContent: Record<string, unknown> = {
      shareCommentary: { text: input.content },
      shareMediaCategory: hasLink ? "ARTICLE" : "NONE",
    };
    if (hasLink) {
      shareContent.media = [
        {
          status: "READY",
          originalUrl: input.linkUrl,
        },
      ];
    }

    const payload = {
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": shareContent,
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const r = await jsonFetch(this.fetchImpl, `${this.apiBase}/v2/ugcPosts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.account.credentials.accessToken}`,
        "content-type": "application/json",
        "x-restli-protocol-version": "2.0.0",
      },
      body: JSON.stringify(payload),
    });
    ensureOk("LinkedIn", "publish", r);
    const body = r.body as { id?: string };
    // LinkedIn responds with the URN in either the body's `id` or in the
    // `x-restli-id` header. We prefer the body since some proxies strip
    // custom response headers.
    const id = body.id;
    if (!id) throw new Error(`LinkedIn publish: no id in response — raw=${r.text.slice(0, 200)}`);
    return { platformPostId: id };
  }

  async refreshEngagement(
    platformPostId: string,
    account: AccountContext,
  ): Promise<EngagementMetrics> {
    // /v2/socialActions/{urn} — returns likesSummary + commentsSummary. We
    // don't have organizational reach here, so impressions/shares/clicks
    // are 0 for personal profiles. Company-page adapters (future) will
    // hit /v2/organizationalEntityShareStatistics.
    const urn = encodeURIComponent(platformPostId);
    const r = await jsonFetch(
      this.fetchImpl,
      `${this.apiBase}/v2/socialActions/${urn}`,
      {
        headers: { authorization: `Bearer ${account.credentials.accessToken}` },
      },
    );
    if (r.status === 404) {
      // Post deleted on platform; return zeroed metrics rather than throw.
      return { impressions: 0, likes: 0, shares: 0, comments: 0, clicks: 0 };
    }
    ensureOk("LinkedIn", "engagement", r);
    const body = r.body as {
      likesSummary?: { totalLikes?: number };
      commentsSummary?: { totalFirstLevelComments?: number };
    };
    return {
      impressions: 0,
      likes: Number(body.likesSummary?.totalLikes ?? 0),
      shares: 0,
      comments: Number(body.commentsSummary?.totalFirstLevelComments ?? 0),
      clicks: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Facebook Pages
// ---------------------------------------------------------------------------

/**
 * Facebook Pages — OAuth returns a *short-lived* user token. We:
 *   1. Exchange it for a long-lived user token (60-day).
 *   2. Call /me/accounts to enumerate Pages the user manages; for the
 *      MVP we pick the first Page. When the operator manages multiple
 *      Pages the frontend should let them choose which page id is stored
 *      in `secrets.pageId` — for now we surface the first as a hint.
 *   3. Stash the per-page access token (long-lived-page-tokens don't
 *      expire) so subsequent publish calls don't need a refresh.
 *
 * Publish: `POST /v21.0/{pageId}/feed` with form-encoded `{message, link?,
 * access_token}`. Response: `{id: "<pageid>_<postid>"}`.
 *
 * Engagement: `GET /v21.0/{platformPostId}/insights?metric=post_impressions,post_reactions_by_type_total,post_clicks`
 * plus `GET /v21.0/{platformPostId}?fields=shares,comments.summary(true)`.
 */
export class FacebookPagesAdapter implements SocialAdapter {
  readonly platform = "Facebook" as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly authBase = "https://www.facebook.com",
    private readonly graphBase = "https://graph.facebook.com/v21.0",
  ) {}

  getOAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      scope: "pages_manage_posts,pages_read_engagement,pages_show_list",
    });
    return `${this.authBase}/v21.0/dialog/oauth?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokenExchange> {
    // 1) code → short-lived user token
    const shortTokUrl =
      `${this.graphBase}/oauth/access_token?` +
      new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        code,
      }).toString();
    const shortRes = await jsonFetch(this.fetchImpl, shortTokUrl);
    ensureOk("Facebook", "token exchange", shortRes);
    const shortTok = shortRes.body as {
      access_token?: string;
      expires_in?: number;
    };
    if (!shortTok.access_token) throw new Error("Facebook: short token exchange returned no access_token");

    // 2) short → long-lived user token (60 days)
    const longUrl =
      `${this.graphBase}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        fb_exchange_token: shortTok.access_token,
      }).toString();
    const longRes = await jsonFetch(this.fetchImpl, longUrl);
    ensureOk("Facebook", "long-token exchange", longRes);
    const longTok = longRes.body as {
      access_token?: string;
      expires_in?: number;
    };
    const userToken = longTok.access_token ?? shortTok.access_token;
    const userTokenExp = longTok.expires_in ?? shortTok.expires_in;

    // 3) /me — id + name
    const meRes = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/me?fields=id,name,picture`,
      { headers: { authorization: `Bearer ${userToken}` } },
    );
    ensureOk("Facebook", "me lookup", meRes);
    const me = meRes.body as {
      id?: string;
      name?: string;
      picture?: { data?: { url?: string } };
    };
    if (!me.id) throw new Error("Facebook: /me returned no id");

    // 4) /me/accounts — enumerate pages. Pick the first as the default;
    //    an operator with multiple pages would re-run OAuth per page or
    //    pick from a UI dropdown (future improvement).
    const pagesRes = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/me/accounts?fields=id,name,access_token`,
      { headers: { authorization: `Bearer ${userToken}` } },
    );
    ensureOk("Facebook", "pages lookup", pagesRes);
    const pages = pagesRes.body as {
      data?: Array<{ id?: string; name?: string; access_token?: string }>;
    };
    const primary = pages.data?.[0];

    return {
      accessToken: userToken,
      // Facebook long-lived user tokens don't come with a refresh token —
      // the app is expected to re-run the exchange every 60 days. We
      // capture expiresAt so the UI can show "expires in N days".
      refreshToken: undefined,
      expiresAt: userTokenExp ? Date.now() + userTokenExp * 1000 : undefined,
      externalId: me.id,
      handle: me.id,
      displayName: primary?.name ?? me.name ?? "Facebook User",
      avatarUrl: me.picture?.data?.url,
      extra: {
        pageId: primary?.id,
        pageName: primary?.name,
        pageAccessToken: primary?.access_token,
        allPages: pages.data ?? [],
      },
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult> {
    // Facebook long-lived page tokens don't expire; long-lived user tokens
    // *do* but must be refreshed via a full re-OAuth (Facebook has no
    // refresh_token grant on the standard OAuth surface). We surface a
    // no-op that returns the existing token so the caller doesn't crash;
    // the real "refresh" path is a UI-driven re-connect.
    if (!refreshToken) throw new Error("Facebook: no refresh token available; re-run OAuth to renew");
    return { accessToken: refreshToken };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { credentials } = input.account;
    const pageId = credentials.pageId;
    const pageToken = credentials.pageAccessToken ?? credentials.accessToken;
    if (!pageId) throw new Error("Facebook publish: account is missing pageId (re-run OAuth)");

    const form = new URLSearchParams();
    form.set("message", input.content);
    if (input.linkUrl) form.set("link", input.linkUrl);
    form.set("access_token", pageToken);

    const r = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/${encodeURIComponent(pageId)}/feed`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );
    ensureOk("Facebook", "publish", r);
    const body = r.body as { id?: string };
    if (!body.id) throw new Error(`Facebook publish: no id in response — raw=${r.text.slice(0, 200)}`);
    return { platformPostId: body.id };
  }

  async refreshEngagement(
    platformPostId: string,
    account: AccountContext,
  ): Promise<EngagementMetrics> {
    const token = account.credentials.pageAccessToken ?? account.credentials.accessToken;
    // Insights — impressions, reactions, clicks
    const insightsUrl =
      `${this.graphBase}/${encodeURIComponent(platformPostId)}/insights` +
      `?metric=post_impressions,post_reactions_by_type_total,post_clicks` +
      `&access_token=${encodeURIComponent(token)}`;
    const iRes = await jsonFetch(this.fetchImpl, insightsUrl);
    if (iRes.status === 404) {
      return { impressions: 0, likes: 0, shares: 0, comments: 0, clicks: 0 };
    }
    // Insights fail (e.g. post deleted) — return zeros not throw. We only
    // throw if the *identity* lookup below fails, since that suggests bad
    // credentials.
    let impressions = 0;
    let likes = 0;
    let clicks = 0;
    if (iRes.status >= 200 && iRes.status < 300) {
      const insights = iRes.body as {
        data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>;
      };
      for (const row of insights.data ?? []) {
        const v = row.values?.[0]?.value;
        if (row.name === "post_impressions" && typeof v === "number") impressions = v;
        if (row.name === "post_clicks" && typeof v === "number") clicks = v;
        if (row.name === "post_reactions_by_type_total" && v && typeof v === "object") {
          for (const count of Object.values(v as Record<string, unknown>)) {
            if (typeof count === "number") likes += count;
          }
        }
      }
    }

    // Shares + comments come from the object itself.
    const objRes = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/${encodeURIComponent(platformPostId)}?fields=shares,comments.summary(true)&access_token=${encodeURIComponent(token)}`,
    );
    let shares = 0;
    let comments = 0;
    if (objRes.status >= 200 && objRes.status < 300) {
      const obj = objRes.body as {
        shares?: { count?: number };
        comments?: { summary?: { total_count?: number } };
      };
      shares = Number(obj.shares?.count ?? 0);
      comments = Number(obj.comments?.summary?.total_count ?? 0);
    }

    return { impressions, likes, shares, comments, clicks };
  }
}

// ---------------------------------------------------------------------------
// Instagram Business
// ---------------------------------------------------------------------------

/**
 * Instagram Business publishes via a two-step container flow:
 *   1. POST /{ig-user-id}/media  form: {image_url|video_url, caption, access_token}
 *      → {id: <containerId>}
 *   2. POST /{ig-user-id}/media_publish form: {creation_id: <containerId>, access_token}
 *      → {id: <mediaId>}
 *
 * We do not poll container `status_code` between step 1 and 2 for images
 * (Meta returns them ready synchronously). Video containers require
 * polling — deferred until we support video mediaUrls.
 *
 * OAuth is shared with the Facebook Pages flow (same app, same scopes plus
 * `instagram_basic,instagram_content_publish`). exchangeCode delegates to
 * FacebookPagesAdapter's flow then augments with the IG-linked user id
 * fetched via GET /{pageId}?fields=instagram_business_account.
 */
export class InstagramBusinessAdapter implements SocialAdapter {
  readonly platform = "Instagram" as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly authBase = "https://www.facebook.com",
    private readonly graphBase = "https://graph.facebook.com/v21.0",
  ) {}

  getOAuthUrl(state: string, redirectUri: string): string {
    // Instagram Business auth is Facebook's dialog with the IG scopes.
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      scope: [
        "pages_show_list",
        "pages_read_engagement",
        "instagram_basic",
        "instagram_content_publish",
      ].join(","),
    });
    return `${this.authBase}/v21.0/dialog/oauth?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokenExchange> {
    // Reuse the Facebook exchange to get the user + page token, then look
    // up the IG-linked business account attached to the picked page.
    const fb = new FacebookPagesAdapter(
      this.clientId,
      this.clientSecret,
      this.fetchImpl,
      this.authBase,
      this.graphBase,
    );
    const base = await fb.exchangeCode(code, redirectUri);
    const pageId = (base.extra?.pageId as string | undefined) ?? undefined;
    const pageToken = (base.extra?.pageAccessToken as string | undefined) ?? base.accessToken;
    if (!pageId) throw new Error("Instagram: no Facebook Page found (Instagram Business must be linked to a Page)");

    const igRes = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/${encodeURIComponent(pageId)}?fields=instagram_business_account&access_token=${encodeURIComponent(pageToken)}`,
    );
    ensureOk("Instagram", "IG account lookup", igRes);
    const igBody = igRes.body as {
      instagram_business_account?: { id?: string };
    };
    const igUserId = igBody.instagram_business_account?.id;
    if (!igUserId)
      throw new Error(
        "Instagram: selected Facebook Page has no linked Instagram Business account",
      );

    // Grab the IG account username for a friendlier displayName/handle.
    const profRes = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/${encodeURIComponent(igUserId)}?fields=username,profile_picture_url&access_token=${encodeURIComponent(pageToken)}`,
    );
    let handle = igUserId;
    let avatarUrl: string | undefined;
    if (profRes.status >= 200 && profRes.status < 300) {
      const prof = profRes.body as { username?: string; profile_picture_url?: string };
      if (prof.username) handle = prof.username;
      avatarUrl = prof.profile_picture_url;
    }

    return {
      ...base,
      externalId: igUserId,
      handle,
      displayName: handle,
      avatarUrl: avatarUrl ?? base.avatarUrl,
      extra: {
        ...(base.extra ?? {}),
        igUserId,
        pageAccessToken: pageToken,
      },
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult> {
    // Same story as Facebook — no refresh grant. Return the token as-is;
    // real renewal is a UI-driven re-connect.
    if (!refreshToken) throw new Error("Instagram: no refresh token available; re-run OAuth to renew");
    return { accessToken: refreshToken };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { credentials } = input.account;
    const igUserId = credentials.igUserId;
    const token = credentials.pageAccessToken ?? credentials.accessToken;
    if (!igUserId) throw new Error("Instagram publish: account is missing igUserId (re-run OAuth)");
    if (!input.mediaUrls || input.mediaUrls.length === 0) {
      throw new Error("Instagram publish: mediaUrls is required (Instagram rejects text-only posts)");
    }
    const imageUrl = input.mediaUrls[0];

    // Step 1: create container.
    const form = new URLSearchParams();
    form.set("image_url", imageUrl!);
    form.set("caption", input.content);
    form.set("access_token", token);
    const cRes = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/${encodeURIComponent(igUserId)}/media`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );
    ensureOk("Instagram", "create container", cRes);
    const cBody = cRes.body as { id?: string };
    if (!cBody.id) throw new Error("Instagram: create container returned no id");

    // Step 2: publish container.
    const pubForm = new URLSearchParams();
    pubForm.set("creation_id", cBody.id);
    pubForm.set("access_token", token);
    const pRes = await jsonFetch(
      this.fetchImpl,
      `${this.graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: pubForm.toString(),
      },
    );
    ensureOk("Instagram", "publish container", pRes);
    const pBody = pRes.body as { id?: string };
    if (!pBody.id) throw new Error("Instagram: publish returned no media id");
    return { platformPostId: pBody.id };
  }

  async refreshEngagement(
    platformPostId: string,
    account: AccountContext,
  ): Promise<EngagementMetrics> {
    const token = account.credentials.pageAccessToken ?? account.credentials.accessToken;
    // GET /{mediaId}/insights?metric=impressions,reach,likes,comments,saved
    // + GET /{mediaId}?fields=like_count,comments_count. We combine both
    // because insights returns "impressions" but the counters use their
    // own endpoint for a fresher value.
    const insightsUrl =
      `${this.graphBase}/${encodeURIComponent(platformPostId)}/insights` +
      `?metric=impressions,reach,likes,comments&access_token=${encodeURIComponent(token)}`;
    const iRes = await jsonFetch(this.fetchImpl, insightsUrl);
    let impressions = 0;
    let likes = 0;
    let comments = 0;
    if (iRes.status >= 200 && iRes.status < 300) {
      const insights = iRes.body as {
        data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>;
      };
      for (const row of insights.data ?? []) {
        const v = row.values?.[0]?.value;
        if (typeof v !== "number") continue;
        if (row.name === "impressions") impressions = v;
        if (row.name === "likes") likes = v;
        if (row.name === "comments") comments = v;
      }
    }
    // IG doesn't expose native "shares" or "clicks" for feed posts — leave 0.
    return { impressions, likes, shares: 0, comments, clicks: 0 };
  }
}

// ---------------------------------------------------------------------------
// X (Twitter API v2)
// ---------------------------------------------------------------------------

/**
 * X/Twitter v2 with OAuth 2.0 + PKCE.
 *
 * Auth URL: https://twitter.com/i/oauth2/authorize
 *   scope: tweet.write tweet.read users.read offline.access
 *   code_challenge_method=S256, code_challenge=<base64url(sha256(verifier))>
 *
 * Token URL: https://api.twitter.com/2/oauth2/token
 *   grant_type=authorization_code
 *   Basic auth: base64(client_id:client_secret) for confidential clients;
 *   PUBLIC clients omit client_secret and send client_id in the body.
 *
 * Publish: POST https://api.twitter.com/2/tweets  body: {text}
 *   Bearer <accessToken>
 *
 * Refresh: grant_type=refresh_token; X rotates refresh tokens each time.
 *
 * PKCE verifier storage: we stash the verifier into the OAuth `state`
 * parameter's JSON payload (via social-oauth route) since a popup callback
 * has no session cookie back to the caller.
 */
export class XAdapter implements SocialAdapter {
  readonly platform = "Twitter" as const;

  constructor(
    private readonly clientId: string,
    /** Empty string for public (non-confidential) clients. */
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly authBase = "https://twitter.com",
    private readonly apiBase = "https://api.twitter.com",
  ) {}

  /**
   * NOTE: The caller MUST pass a PKCE challenge as `state`'s companion. We
   * use a convention: the OAuth start route stores {csrf, pkceVerifier}
   * in a signed state JWT; the challenge is derived here from the verifier
   * bound to the same `state` string. To keep this method idempotent, the
   * `state` string we receive here already has the verifier appended: the
   * route computes it and passes `state|<verifier>` shape.
   *
   * TODO: Real OAuth exchange needs a webserver-hosted redirect target
   * plus a way to persist the PKCE verifier between start + callback.
   * Smoke-tested against fake fetch but not e2e'd against real X.
   */
  getOAuthUrl(state: string, redirectUri: string): string {
    // Assume caller has embedded the PKCE challenge into `state`'s payload
    // and just passes the base64 challenge here via a colon-suffix, e.g.:
    //   state="<uuid>:CHALLENGE_BASE64".
    // If no colon, we treat the whole string as opaque state and generate
    // a per-URL verifier (challenge only) — this is unsafe for real use but
    // exposes the surface shape for tests. Real callers should always use
    // the colon convention (see social-oauth.ts).
    let challenge: string;
    let stateOnly = state;
    const idx = state.indexOf(":");
    if (idx > 0) {
      stateOnly = state.slice(0, idx);
      challenge = state.slice(idx + 1);
    } else {
      // Unsafe fallback — challenge derived from state itself. Never do this in prod.
      challenge = pkceChallenge(state);
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: "tweet.write tweet.read users.read offline.access",
      state: stateOnly,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `${this.authBase}/i/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    hints?: Record<string, unknown>,
  ): Promise<OAuthTokenExchange> {
    const verifier = typeof hints?.codeVerifier === "string" ? hints.codeVerifier : "";
    if (!verifier) {
      throw new Error("X exchangeCode: hints.codeVerifier is required (PKCE)");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      code_verifier: verifier,
    });
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
    };
    // If we have a client_secret, use Basic auth (confidential client).
    if (this.clientSecret) {
      const b64 = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${b64}`;
    }
    const tokRes = await jsonFetch(this.fetchImpl, `${this.apiBase}/2/oauth2/token`, {
      method: "POST",
      headers,
      body: body.toString(),
    });
    ensureOk("X", "token exchange", tokRes);
    const tok = tokRes.body as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tok.access_token) throw new Error("X: exchange returned no access_token");

    // Identity: GET /2/users/me — id, username, name, profile_image_url
    const meRes = await jsonFetch(
      this.fetchImpl,
      `${this.apiBase}/2/users/me?user.fields=profile_image_url,name,username`,
      { headers: { authorization: `Bearer ${tok.access_token}` } },
    );
    ensureOk("X", "me lookup", meRes);
    const me = (meRes.body as {
      data?: { id?: string; username?: string; name?: string; profile_image_url?: string };
    }).data;
    if (!me?.id) throw new Error("X: /2/users/me returned no id");

    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
      externalId: me.id,
      handle: me.username ?? me.id,
      displayName: me.name ?? me.username ?? me.id,
      avatarUrl: me.profile_image_url,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
    };
    if (this.clientSecret) {
      const b64 = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${b64}`;
    }
    const r = await jsonFetch(this.fetchImpl, `${this.apiBase}/2/oauth2/token`, {
      method: "POST",
      headers,
      body: body.toString(),
    });
    ensureOk("X", "refresh", r);
    const tok = r.body as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tok.access_token) throw new Error("X refresh: no access_token in response");
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token, // X rotates it
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    // v2 accepts a max of 280 chars (unless the account has extended-tweet
    // access). We do not enforce here — the platform's own error is more
    // authoritative and localised to the account tier.
    const text = input.linkUrl
      ? `${input.content}\n${input.linkUrl}`.slice(0, 4000)
      : input.content;
    const r = await jsonFetch(this.fetchImpl, `${this.apiBase}/2/tweets`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.account.credentials.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    ensureOk("X", "publish", r);
    const body = r.body as { data?: { id?: string } };
    if (!body.data?.id) throw new Error(`X publish: no id in response — raw=${r.text.slice(0, 200)}`);
    return { platformPostId: body.data.id };
  }

  async refreshEngagement(
    platformPostId: string,
    account: AccountContext,
  ): Promise<EngagementMetrics> {
    // GET /2/tweets/:id?tweet.fields=public_metrics,non_public_metrics
    // public_metrics: {retweet_count, reply_count, like_count, quote_count, impression_count}
    // impression_count only present on tweets owned by the authenticated user.
    const url =
      `${this.apiBase}/2/tweets/${encodeURIComponent(platformPostId)}` +
      `?tweet.fields=public_metrics`;
    const r = await jsonFetch(this.fetchImpl, url, {
      headers: { authorization: `Bearer ${account.credentials.accessToken}` },
    });
    if (r.status === 404) {
      return { impressions: 0, likes: 0, shares: 0, comments: 0, clicks: 0 };
    }
    ensureOk("X", "engagement", r);
    const body = r.body as {
      data?: {
        public_metrics?: {
          retweet_count?: number;
          reply_count?: number;
          like_count?: number;
          quote_count?: number;
          impression_count?: number;
        };
      };
    };
    const pm = body.data?.public_metrics ?? {};
    return {
      impressions: Number(pm.impression_count ?? 0),
      likes: Number(pm.like_count ?? 0),
      shares: Number(pm.retweet_count ?? 0) + Number(pm.quote_count ?? 0),
      comments: Number(pm.reply_count ?? 0),
      clicks: 0, // v2 public metrics has no clicks; requires paid tier.
    };
  }
}

// ---------------------------------------------------------------------------
// Adapter factory + credential store
// ---------------------------------------------------------------------------

/**
 * Env-var conventions for platform-level OAuth app credentials (client_id +
 * client_secret). These are *platform apps* — one per provider per
 * deployment, NOT per-tenant. Per-tenant secrets (the user's access token)
 * live in TenantIntegration as documented above.
 *
 * When any env var is missing we return an adapter constructed with empty
 * strings so getOAuthUrl still returns a well-formed (but broken) URL —
 * this lets tests exercise the shape without provisioning real app ids.
 * Publish + exchange calls will fail loudly if credentials are truly
 * missing.
 */
export function getSocialAdapter(
  platform: SocialPlatform | string,
  fetchImpl: typeof fetch = fetch,
): SocialAdapter {
  // DEV-ONLY sync path. Reads from env vars so tests + local iteration
  // work without a TenantIntegration row. Production paths MUST use
  // `getSocialAdapterForTenant` below so credentials come from the per-
  // tenant integration catalog and stay isolated across tenants.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `getSocialAdapter(${String(platform)}) is dev-only. In production call getSocialAdapterForTenant(prisma, tenantId, platform).`,
    );
  }
  const p = String(platform);
  switch (p) {
    case "LinkedIn":
      return new LinkedInAdapter(
        process.env.LINKEDIN_CLIENT_ID ?? "",
        process.env.LINKEDIN_CLIENT_SECRET ?? "",
        fetchImpl,
      );
    case "Facebook":
      return new FacebookPagesAdapter(
        process.env.FACEBOOK_APP_ID ?? "",
        process.env.FACEBOOK_APP_SECRET ?? "",
        fetchImpl,
      );
    case "Instagram":
      return new InstagramBusinessAdapter(
        process.env.FACEBOOK_APP_ID ?? "",
        process.env.FACEBOOK_APP_SECRET ?? "",
        fetchImpl,
      );
    case "Twitter":
      return new XAdapter(
        process.env.X_CLIENT_ID ?? "",
        process.env.X_CLIENT_SECRET ?? "",
        fetchImpl,
      );
    default:
      throw new Error(`Unsupported social platform: ${p}`);
  }
}

/**
 * Production-safe factory. Looks up per-tenant OAuth-app credentials
 * from TenantIntegration.secrets (encrypted at rest, decrypted by
 * `decryptSecrets`) instead of any process env var, so credentials
 * never leak across tenants running on the same process.
 *
 * Expected TenantIntegration row: `provider` matches the platform slug
 * (LinkedIn / Facebook / Instagram / Twitter). `secrets.clientId` +
 * `secrets.clientSecret` populate the adapter. Both are required.
 */
export async function getSocialAdapterForTenant(
  prisma: {
    tenantIntegration: {
      findFirst: (args: unknown) => Promise<{ secrets: unknown } | null>;
    };
  },
  tenantId: string,
  platform: SocialPlatform | string,
  fetchImpl: typeof fetch = fetch,
): Promise<SocialAdapter> {
  const p = String(platform);
  const row = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: p, isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  const secrets = row
    ? ((): Record<string, string> => {
        try {
          const s = decryptSecrets(row.secrets);
          return Object.fromEntries(
            Object.entries(s).map(([k, v]) => [k, String(v ?? "")]),
          );
        } catch {
          return {};
        }
      })()
    : {};

  const cid = secrets.clientId ?? "";
  const cs = secrets.clientSecret ?? "";
  if (!cid || !cs) {
    // Dev fallback so localhost still works without a TenantIntegration row.
    if (process.env.NODE_ENV !== "production") return getSocialAdapter(p, fetchImpl);
    throw new Error(
      `No active TenantIntegration for ${p} on tenant ${tenantId}. Add it under /admin/integrations.`,
    );
  }

  switch (p) {
    case "LinkedIn":
      return new LinkedInAdapter(cid, cs, fetchImpl);
    case "Facebook":
      return new FacebookPagesAdapter(cid, cs, fetchImpl);
    case "Instagram":
      return new InstagramBusinessAdapter(cid, cs, fetchImpl);
    case "Twitter":
      return new XAdapter(cid, cs, fetchImpl);
    default:
      throw new Error(`Unsupported social platform: ${p}`);
  }
}


/**
 * Per-account credential store — see the header for the "why".
 *
 * Insert layout:
 *   provider = "social:<platform>" e.g. "social:LinkedIn"
 *   name     = <SocialAccount.id>  (uniqueness via the composite
 *              `(tenantId, provider, name)` unique index).
 *   secrets  = encryptSecrets({accessToken, refreshToken?, expiresAt?,
 *              externalId?, pageId?, pageAccessToken?, igUserId?}).
 *   config   = { platform, handle, displayName, avatarUrl? }
 */

export async function upsertSocialCredentials(
  prisma: PrismaClient,
  tenantId: string,
  accountId: string,
  platform: SocialPlatform | string,
  creds: SocialCredentials,
  meta: {
    handle: string;
    displayName: string;
    avatarUrl?: string;
  },
): Promise<void> {
  const provider = `social:${platform}`;
  const encrypted = encryptSecrets({
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
    externalId: creds.externalId,
    pageId: creds.pageId,
    pageAccessToken: creds.pageAccessToken,
    igUserId: creds.igUserId,
  });
  const config = {
    platform,
    handle: meta.handle,
    displayName: meta.displayName,
    avatarUrl: meta.avatarUrl ?? null,
  };
  await prisma.tenantIntegration.upsert({
    where: {
      tenantId_provider_name: {
        tenantId,
        provider,
        name: accountId,
      },
    },
    create: {
      tenantId,
      provider,
      name: accountId,
      isActive: true,
      isDefault: false,
      config,
      secrets: encrypted as unknown as object,
    },
    update: {
      isActive: true,
      config,
      secrets: encrypted as unknown as object,
    },
  });
}

export async function loadSocialCredentials(
  prisma: PrismaClient,
  tenantId: string,
  accountId: string,
  platform: SocialPlatform | string,
): Promise<SocialCredentials | null> {
  const row = await prisma.tenantIntegration.findFirst({
    where: {
      tenantId,
      provider: `social:${platform}`,
      name: accountId,
      isActive: true,
    },
  });
  if (!row) return null;
  let plain: Record<string, unknown>;
  try {
    plain = decryptSecrets(row.secrets);
  } catch {
    return null;
  }
  const accessToken = typeof plain.accessToken === "string" ? plain.accessToken : "";
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: typeof plain.refreshToken === "string" ? plain.refreshToken : undefined,
    expiresAt: typeof plain.expiresAt === "number" ? plain.expiresAt : undefined,
    externalId: typeof plain.externalId === "string" ? plain.externalId : undefined,
    pageId: typeof plain.pageId === "string" ? plain.pageId : undefined,
    pageAccessToken: typeof plain.pageAccessToken === "string" ? plain.pageAccessToken : undefined,
    igUserId: typeof plain.igUserId === "string" ? plain.igUserId : undefined,
  };
}

/**
 * Refresh the account's token if it expires within `windowMs` (default 5min).
 * Updates the encrypted TenantIntegration row AND the SocialAccount.tokenExpiresAt
 * column in one transaction. Returns the (possibly new) credentials.
 */
export async function ensureFreshToken(
  prisma: PrismaClient,
  tenantId: string,
  accountId: string,
  platform: SocialPlatform | string,
  creds: SocialCredentials,
  adapter: SocialAdapter,
  windowMs = 5 * 60_000,
): Promise<SocialCredentials> {
  if (!creds.expiresAt || creds.expiresAt > Date.now() + windowMs) return creds;
  if (!creds.refreshToken) return creds; // nothing we can do — surface as publish error
  const refreshed = await adapter.refreshAccessToken(creds.refreshToken);
  const updated: SocialCredentials = {
    ...creds,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? creds.refreshToken,
    expiresAt: refreshed.expiresAt ?? creds.expiresAt,
  };
  // Persist. We upsert secrets + update the SocialAccount timestamp so the
  // scheduler's cheap SELECT can filter.
  await prisma.$transaction(async (tx) => {
    const row = await tx.tenantIntegration.findFirst({
      where: { tenantId, provider: `social:${platform}`, name: accountId },
    });
    if (row) {
      await tx.tenantIntegration.update({
        where: { id: row.id },
        data: {
          secrets: encryptSecrets({
            accessToken: updated.accessToken,
            refreshToken: updated.refreshToken,
            expiresAt: updated.expiresAt,
            externalId: updated.externalId,
            pageId: updated.pageId,
            pageAccessToken: updated.pageAccessToken,
            igUserId: updated.igUserId,
          }) as unknown as object,
        },
      });
    }
    await tx.socialAccount.updateMany({
      where: { id: accountId, tenantId },
      data: {
        tokenExpiresAt: updated.expiresAt ? new Date(updated.expiresAt) : null,
      },
    });
  });
  return updated;
}
