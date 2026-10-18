// Marketing P3 — Social OAuth 3-legged flow.
//
// Two JWT'd routes per platform:
//   GET  /social/oauth/:platform/start?redirectUri=…
//     Returns { authUrl, state } — the caller opens `authUrl` in a popup;
//     the browser follows the platform's flow and ends up back at
//     `redirectUri` with ?code=…&state=…, which the popup POSTs back to
//     this service's callback endpoint.
//
//   GET  /social/oauth/:platform/callback?code=…&state=…
//     Verifies `state` (must decode to a token minted by /start), exchanges
//     the code, and creates/updates:
//       * SocialAccount (identity — platform, handle, displayName, avatar,
//         externalId, tokenExpiresAt)
//       * TenantIntegration (encrypted secrets) via
//         upsertSocialCredentials.
//     Returns 201 with the SocialAccount row.
//
// State token design:
//   We sign a small JSON blob using JWT and include:
//     { tenantId, userId, platform, csrf, pkceVerifier? }
//   All in the JWT payload so nothing needs to be persisted between /start
//   and /callback. csrf is a random 16-byte URL-safe string — its only job
//   is to make the state opaque even to holders of the JWT secret since
//   platforms echo state verbatim, so we don't want the raw values on the
//   wire.
//
//   For X (Twitter) we generate a PKCE verifier at /start and include it
//   in the state JWT so the /callback path can pass it into
//   exchangeCode(hints). We derive the challenge from the verifier and
//   append it to the URL as `code_challenge=…` (the adapter does this by
//   accepting a `state|challenge` combo string — see XAdapter comment).
//
// Deferred:
//   * Real OAuth needs the redirectUri to point at a browser-facing page
//     which POSTs the code back to this endpoint. Today the callback is
//     GET so it can be hit directly from the platform's redirect.
//   * We don't yet cache the popup's completion into the launching window
//     — the frontend polls /social/accounts after closing the popup.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@lumaara/db";
import {
  ensureFreshToken,
  getSocialAdapter,
  loadSocialCredentials,
  makePkceVerifier,
  pkceChallenge,
  upsertSocialCredentials,
} from "@lumaara/db";
import type { SocialPlatform } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";
import { randomBytes } from "node:crypto";

export const socialOAuthRouter = Router();

const SUPPORTED: SocialPlatform[] = ["LinkedIn", "Facebook", "Instagram", "Twitter"];

function stateSecret(): string {
  // Reuse the JWT secret used elsewhere for signing so tokens rotate with
  // the rest of the service's crypto material.
  return JWT_SECRET;
}

interface StatePayload {
  t: string;   // tenantId
  u: string;   // userId
  p: string;   // platform
  r: string;   // redirectUri (so callback validates it matches)
  c: string;   // csrf
  v?: string;  // pkceVerifier (X only)
}

function signState(p: StatePayload): string {
  return jwt.sign(p, stateSecret(), { expiresIn: "15m" });
}

function verifyState(token: string): StatePayload | null {
  try {
    const decoded = jwt.verify(token, stateSecret()) as StatePayload;
    if (!decoded.t || !decoded.u || !decoded.p) return null;
    return decoded;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------
// GET /social/oauth/:platform/start?redirectUri=…
// -------------------------------------------------------------------------

socialOAuthRouter.get("/:platform/start", async (req, res) => {
  const auth = req.auth!;
  const platform = req.params.platform as SocialPlatform;
  if (!SUPPORTED.includes(platform)) {
    return res.status(400).json({ error: `Unsupported platform: ${platform}` });
  }
  const redirectUri = String(req.query.redirectUri ?? "");
  if (!redirectUri || !/^https?:\/\//.test(redirectUri)) {
    return res.status(400).json({ error: "redirectUri query param is required (must be absolute URL)" });
  }

  const csrf = randomBytes(16).toString("hex");
  const payload: StatePayload = {
    t: auth.tenantId,
    u: auth.userId,
    p: platform,
    r: redirectUri,
    c: csrf,
  };

  // X (Twitter) uses PKCE — mint a verifier now and stash it in the state
  // JWT so /callback can pass it to exchangeCode. We embed the challenge
  // in the URL by using the "state|challenge" convention XAdapter honors.
  let stateForUrl: string;
  if (platform === "Twitter") {
    const verifier = makePkceVerifier();
    payload.v = verifier;
    const jwtState = signState(payload);
    const challenge = pkceChallenge(verifier);
    stateForUrl = `${jwtState}:${challenge}`;
  } else {
    stateForUrl = signState(payload);
  }

  const adapter = getSocialAdapter(platform);
  const authUrl = adapter.getOAuthUrl(stateForUrl, redirectUri);
  res.json({ authUrl, state: stateForUrl });
});

// -------------------------------------------------------------------------
// GET /social/oauth/:platform/callback?code=…&state=…
// -------------------------------------------------------------------------

socialOAuthRouter.get("/:platform/callback", async (req, res) => {
  const platform = req.params.platform as SocialPlatform;
  if (!SUPPORTED.includes(platform)) {
    return res.status(400).json({ error: `Unsupported platform: ${platform}` });
  }
  const code = String(req.query.code ?? "");
  const stateRaw = String(req.query.state ?? "");
  if (!code || !stateRaw) return res.status(400).json({ error: "code and state are required" });

  // X callback: state is "jwt:challenge" — strip the challenge before verify.
  let stateJwt = stateRaw;
  const colon = stateRaw.indexOf(":");
  if (colon > 0 && platform === "Twitter") stateJwt = stateRaw.slice(0, colon);

  const payload = verifyState(stateJwt);
  if (!payload) return res.status(400).json({ error: "Invalid or expired state" });
  if (payload.p !== platform) return res.status(400).json({ error: "State/platform mismatch" });

  // Cross-check the caller's JWT tenant against the state's tenant. This
  // stops a user in tenant A from hijacking a code intended for tenant B.
  const auth = req.auth!;
  if (payload.t !== auth.tenantId || payload.u !== auth.userId) {
    return res.status(403).json({ error: "State/session mismatch — re-run connect" });
  }

  const adapter = getSocialAdapter(platform);
  let exchange;
  try {
    exchange = await adapter.exchangeCode(code, payload.r, {
      codeVerifier: payload.v,
    });
  } catch (e) {
    return res.status(502).json({
      error: `OAuth exchange failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Create/update the SocialAccount row. Existing row keyed by
  // (tenantId, platform, handle).
  const existing = await prisma.socialAccount.findFirst({
    where: {
      tenantId: auth.tenantId,
      platform,
      handle: exchange.handle,
    },
  });

  const account = existing
    ? await prisma.socialAccount.update({
        where: { id: existing.id },
        data: {
          displayName: exchange.displayName,
          avatarUrl: exchange.avatarUrl ?? existing.avatarUrl,
          externalId: exchange.externalId,
          tokenExpiresAt: exchange.expiresAt ? new Date(exchange.expiresAt) : null,
          isActive: true,
        },
      })
    : await prisma.socialAccount.create({
        data: {
          tenantId: auth.tenantId,
          platform,
          handle: exchange.handle,
          displayName: exchange.displayName,
          avatarUrl: exchange.avatarUrl ?? null,
          externalId: exchange.externalId,
          tokenExpiresAt: exchange.expiresAt ? new Date(exchange.expiresAt) : null,
          isActive: true,
          addedByUserId: auth.userId,
        },
      });

  await upsertSocialCredentials(
    prisma,
    auth.tenantId,
    account.id,
    platform,
    {
      accessToken: exchange.accessToken,
      refreshToken: exchange.refreshToken,
      expiresAt: exchange.expiresAt,
      externalId: exchange.externalId,
      pageId: exchange.extra?.pageId as string | undefined,
      pageAccessToken: exchange.extra?.pageAccessToken as string | undefined,
      igUserId: exchange.extra?.igUserId as string | undefined,
    },
    {
      handle: exchange.handle,
      displayName: exchange.displayName,
      avatarUrl: exchange.avatarUrl,
    },
  );

  res.status(201).json(account);
});

// -------------------------------------------------------------------------
// Helper (exported for use by /social/posts/:id/publish and scheduler jobs):
// load an account + its decrypted credentials, refresh token if near expiry.
// Returns null when the account has no working integration row.
// -------------------------------------------------------------------------

export async function loadAccountWithFreshCreds(
  tenantId: string,
  accountId: string,
): Promise<{
  account: {
    id: string;
    tenantId: string;
    platform: string;
    handle: string;
    externalId: string | null;
  };
  credentials: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    externalId?: string;
    pageId?: string;
    pageAccessToken?: string;
    igUserId?: string;
  };
} | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: accountId, tenantId },
  });
  if (!account) return null;
  const creds = await loadSocialCredentials(prisma, tenantId, accountId, account.platform);
  if (!creds) return null;
  const adapter = getSocialAdapter(account.platform);
  const fresh = await ensureFreshToken(prisma, tenantId, accountId, account.platform, creds, adapter).catch(
    () => creds,
  );
  return { account, credentials: fresh };
}
