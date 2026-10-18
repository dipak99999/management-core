import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@lumaara/db";
import { BCRYPT_COST, requireAuth } from "@lumaara/service-auth";

// OAuth 2 server. Supports authorization_code + PKCE, refresh_token, and
// client_credentials grant types. Access tokens are opaque (32-byte random,
// sha256-stored) so we can revoke instantly. See schema for shape.

export const oauthRouter = Router();

const SUPPORTED_GRANTS = new Set([
  "authorization_code",
  "refresh_token",
  "client_credentials",
]);
const ACCESS_TOKEN_TTL_SEC = 3600; // 1h
const REFRESH_TOKEN_TTL_SEC = 30 * 86400; // 30d
const AUTH_CODE_TTL_SEC = 600; // 10min

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function randToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
function pkceVerify(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method === "plain") return codeVerifier === codeChallenge;
  if (method === "S256") {
    const hash = createHash("sha256").update(codeVerifier).digest("base64url");
    return hash === codeChallenge;
  }
  return false;
}

// ---------- Admin: client registration ----------

const clientSchema = z.object({
  name: z.string().min(1).max(80),
  redirectUris: z.array(z.string().url()).min(1),
  grantTypes: z
    .array(z.enum(["authorization_code", "refresh_token", "client_credentials"]))
    .min(1),
  scopes: z.array(z.string()).default(["read"]),
  isPublic: z.boolean().default(false),
  isTrusted: z.boolean().default(false),
});

function requireSystemManager(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const roles = req.auth?.roles ?? [];
  const isAdmin =
    roles.includes("SystemManager") || req.auth?.role === "admin";
  if (!isAdmin)
    return res.status(403).json({ error: "SystemManager role required" });
  next();
}

// List registered clients (secret hash never surfaces).
oauthRouter.get("/clients", requireAuth, requireSystemManager, async (req, res) => {
  const rows = await prisma.oAuthClient.findMany({
    where: { tenantId: req.auth!.tenantId },
    select: {
      id: true,
      clientId: true,
      name: true,
      redirectUris: true,
      grantTypes: true,
      scopes: true,
      isPublic: true,
      isTrusted: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

// Register a client. Returns client_id + client_secret (secret shown ONCE for
// confidential clients).
oauthRouter.post("/clients", requireAuth, requireSystemManager, async (req, res) => {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const clientId = "oc_" + randomBytes(12).toString("base64url");
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  if (!d.isPublic) {
    clientSecret = randToken(24);
    clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_COST);
  }

  const row = await prisma.oAuthClient.create({
    data: {
      tenantId: req.auth!.tenantId,
      clientId,
      clientSecretHash,
      name: d.name,
      redirectUris: d.redirectUris,
      grantTypes: d.grantTypes,
      scopes: d.scopes,
      isPublic: d.isPublic,
      isTrusted: d.isTrusted,
    },
  });
  res.status(201).json({
    id: row.id,
    clientId: row.clientId,
    clientSecret,
    warning: clientSecret
      ? "Save the client_secret now — it will not be shown again."
      : "Public client — no secret. Use PKCE.",
  });
});

oauthRouter.delete("/clients/:id", requireAuth, requireSystemManager, async (req, res) => {
  const row = await prisma.oAuthClient.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  await prisma.oAuthClient.delete({ where: { id: row.id } });
  res.status(204).send();
});

// ---------- Authorization endpoint ----------
//
// GET /oauth/authorize?response_type=code&client_id=...&redirect_uri=...
//   &scope=...&state=...&code_challenge=...&code_challenge_method=S256
//
// Requires the user to be authenticated (JWT via requireAuth). Returns a JSON
// envelope describing whether consent is required — the /oauth/consent page
// UI reads this and either auto-redirects (trusted or prior-consented) or
// prompts the user.

const authorizeQuery = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().optional().default(""),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.enum(["S256", "plain"]).optional().default("S256"),
});

oauthRouter.get("/authorize", requireAuth, async (req, res) => {
  const parsed = authorizeQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
  const q = parsed.data;

  const client = await prisma.oAuthClient.findFirst({
    where: { clientId: q.client_id, tenantId: req.auth!.tenantId },
  });
  if (!client) return res.status(400).json({ error: "invalid_client" });
  if (!client.grantTypes.includes("authorization_code"))
    return res.status(400).json({ error: "unauthorized_grant" });
  if (!client.redirectUris.includes(q.redirect_uri))
    return res.status(400).json({ error: "invalid_redirect_uri" });
  if (client.isPublic && !q.code_challenge)
    return res.status(400).json({ error: "code_challenge_required_for_public_client" });

  const requestedScopes = q.scope.split(/\s+/).filter(Boolean);
  const unknown = requestedScopes.filter((s) => !client.scopes.includes(s));
  if (unknown.length)
    return res.status(400).json({ error: "invalid_scope", scopes: unknown });

  // Check prior consent match.
  const consent = await prisma.oAuthConsent.findUnique({
    where: {
      clientId_userId: { clientId: client.id, userId: req.auth!.userId },
    },
  });
  const hasConsent =
    client.isTrusted ||
    (consent && requestedScopes.every((s) => consent.scopes.includes(s)));

  res.json({
    client: {
      id: client.id,
      name: client.name,
      isTrusted: client.isTrusted,
    },
    scopes: requestedScopes,
    redirectUri: q.redirect_uri,
    state: q.state ?? null,
    codeChallenge: q.code_challenge ?? null,
    codeChallengeMethod: q.code_challenge_method,
    consentRequired: !hasConsent,
  });
});

// User accepts (or declines) the consent screen. On accept we mint an auth
// code and hand back the full redirect URL the frontend should send the user to.
const consentSchema = z.object({
  clientDbId: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()),
  state: z.string().optional().nullable(),
  codeChallenge: z.string().optional().nullable(),
  codeChallengeMethod: z.enum(["S256", "plain"]).optional().nullable(),
  approve: z.boolean(),
});

oauthRouter.post("/authorize/consent", requireAuth, async (req, res) => {
  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const c = parsed.data;

  const client = await prisma.oAuthClient.findFirst({
    where: { id: c.clientDbId, tenantId: req.auth!.tenantId },
  });
  if (!client) return res.status(400).json({ error: "invalid_client" });
  if (!client.redirectUris.includes(c.redirectUri))
    return res.status(400).json({ error: "invalid_redirect_uri" });

  const u = new URL(c.redirectUri);
  if (!c.approve) {
    u.searchParams.set("error", "access_denied");
    if (c.state) u.searchParams.set("state", c.state);
    return res.json({ redirectUrl: u.toString() });
  }

  // Persist consent for future silent flows.
  await prisma.oAuthConsent.upsert({
    where: {
      clientId_userId: { clientId: client.id, userId: req.auth!.userId },
    },
    create: {
      clientId: client.id,
      userId: req.auth!.userId,
      scopes: c.scopes,
    },
    update: {
      scopes: c.scopes, // widen if new scopes granted
    },
  });

  const code = randToken(24);
  await prisma.oAuthAuthCode.create({
    data: {
      codeHash: sha256Hex(code),
      clientId: client.id,
      userId: req.auth!.userId,
      redirectUri: c.redirectUri,
      scopes: c.scopes,
      codeChallenge: c.codeChallenge ?? null,
      codeChallengeMethod: c.codeChallengeMethod ?? null,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000),
    },
  });

  u.searchParams.set("code", code);
  if (c.state) u.searchParams.set("state", c.state);
  res.json({ redirectUrl: u.toString() });
});

// ---------- Token endpoint ----------
//
// POST /oauth/token
// Content-Type: application/x-www-form-urlencoded (also accepts JSON)
// grant_type=authorization_code&code=...&redirect_uri=...&client_id=...&client_secret=...&code_verifier=...
// grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
// grant_type=client_credentials&client_id=...&client_secret=...&scope=...

async function verifyClient(clientId: string, clientSecret: string | undefined, tenantId: string) {
  const client = await prisma.oAuthClient.findFirst({
    where: { clientId, tenantId },
  });
  if (!client) return null;
  if (client.isPublic) return client;
  if (!clientSecret || !client.clientSecretHash) return null;
  const ok = await bcrypt.compare(clientSecret, client.clientSecretHash);
  return ok ? client : null;
}

async function issueTokens(params: {
  clientId: string;
  userId: string | null;
  scopes: string[];
  withRefresh: boolean;
}) {
  const accessToken = randToken(32);
  const accessTokenHash = sha256Hex(accessToken);
  const at = await prisma.oAuthAccessToken.create({
    data: {
      tokenHash: accessTokenHash,
      clientId: params.clientId,
      userId: params.userId,
      scopes: params.scopes,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000),
    },
  });
  let refreshToken: string | null = null;
  if (params.withRefresh) {
    refreshToken = randToken(32);
    await prisma.oAuthRefreshToken.create({
      data: {
        tokenHash: sha256Hex(refreshToken),
        accessTokenId: at.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000),
      },
    });
  }
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    scope: params.scopes.join(" "),
  };
}

oauthRouter.post("/token", async (req, res) => {
  const body = { ...(req.body ?? {}) };
  // Some clients auth via HTTP Basic — decode if present.
  const basicHeader = req.header("authorization");
  if (basicHeader?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(basicHeader.slice(6), "base64").toString("utf8");
      const [id, secret] = decoded.split(":");
      body.client_id = body.client_id ?? id;
      body.client_secret = body.client_secret ?? secret;
    } catch {
      // ignore
    }
  }

  const grantType = String(body.grant_type ?? "");
  if (!SUPPORTED_GRANTS.has(grantType))
    return res.status(400).json({ error: "unsupported_grant_type" });

  const clientId = String(body.client_id ?? "");
  const clientSecret = body.client_secret ? String(body.client_secret) : undefined;

  // client_credentials + code exchange share the client verification path,
  // but we don't know tenantId until we look up the client. So allow any-tenant
  // resolution:
  const clientAnyTenant = await prisma.oAuthClient.findFirst({
    where: { clientId },
  });
  if (!clientAnyTenant) return res.status(401).json({ error: "invalid_client" });
  const client = await verifyClient(clientId, clientSecret, clientAnyTenant.tenantId);
  if (!client) return res.status(401).json({ error: "invalid_client" });
  if (!client.grantTypes.includes(grantType))
    return res.status(400).json({ error: "unauthorized_grant" });

  if (grantType === "authorization_code") {
    const code = String(body.code ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    const codeVerifier = body.code_verifier ? String(body.code_verifier) : undefined;
    if (!code || !redirectUri) return res.status(400).json({ error: "invalid_request" });

    const codeHash = sha256Hex(code);
    const rec = await prisma.oAuthAuthCode.findUnique({ where: { codeHash } });
    if (!rec || rec.clientId !== client.id) return res.status(400).json({ error: "invalid_grant" });
    if (rec.usedAt) return res.status(400).json({ error: "invalid_grant", details: "code already used" });
    if (rec.expiresAt < new Date()) return res.status(400).json({ error: "invalid_grant", details: "code expired" });
    if (rec.redirectUri !== redirectUri) return res.status(400).json({ error: "invalid_grant" });
    if (rec.codeChallenge) {
      if (!codeVerifier) return res.status(400).json({ error: "invalid_grant", details: "pkce required" });
      if (!pkceVerify(codeVerifier, rec.codeChallenge, rec.codeChallengeMethod ?? "S256"))
        return res.status(400).json({ error: "invalid_grant", details: "pkce mismatch" });
    }

    // Mark used (one-shot) + issue tokens atomically.
    const tokens = await prisma.$transaction(async (tx) => {
      await tx.oAuthAuthCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
      return issueTokens({
        clientId: client.id,
        userId: rec.userId,
        scopes: rec.scopes,
        withRefresh: client.grantTypes.includes("refresh_token"),
      });
    });
    return res.json(tokens);
  }

  if (grantType === "refresh_token") {
    const raw = String(body.refresh_token ?? "");
    if (!raw) return res.status(400).json({ error: "invalid_request" });
    const rec = await prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash: sha256Hex(raw) },
      include: { accessToken: true },
    });
    if (!rec || rec.revokedAt || rec.expiresAt < new Date())
      return res.status(400).json({ error: "invalid_grant" });
    if (rec.accessToken.clientId !== client.id)
      return res.status(400).json({ error: "invalid_grant" });

    // Rotate: revoke the used refresh token + its access token, issue new pair.
    const tokens = await prisma.$transaction(async (tx) => {
      await tx.oAuthRefreshToken.update({
        where: { id: rec.id },
        data: { revokedAt: new Date() },
      });
      await tx.oAuthAccessToken.update({
        where: { id: rec.accessTokenId },
        data: { revokedAt: new Date() },
      });
      return issueTokens({
        clientId: client.id,
        userId: rec.accessToken.userId,
        scopes: rec.accessToken.scopes,
        withRefresh: true,
      });
    });
    return res.json(tokens);
  }

  if (grantType === "client_credentials") {
    const requestedScopes = String(body.scope ?? "").split(/\s+/).filter(Boolean);
    const scopes = requestedScopes.length ? requestedScopes : client.scopes;
    const bad = scopes.filter((s) => !client.scopes.includes(s));
    if (bad.length) return res.status(400).json({ error: "invalid_scope", scopes: bad });
    const tokens = await issueTokens({
      clientId: client.id,
      userId: null, // no user context
      scopes,
      withRefresh: false, // client_credentials never gets a refresh token
    });
    return res.json(tokens);
  }

  return res.status(400).json({ error: "unsupported_grant_type" });
});

// ---------- Token revocation ----------

oauthRouter.post("/revoke", async (req, res) => {
  const token = String(req.body?.token ?? "");
  if (!token) return res.status(400).json({ error: "invalid_request" });
  const hash = sha256Hex(token);

  // Try access first, then refresh. Silent success either way (spec).
  const at = await prisma.oAuthAccessToken.findUnique({ where: { tokenHash: hash } });
  if (at) {
    await prisma.oAuthAccessToken.update({
      where: { id: at.id },
      data: { revokedAt: new Date() },
    });
    return res.json({ ok: true });
  }
  const rt = await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: hash } });
  if (rt) {
    await prisma.oAuthRefreshToken.update({
      where: { id: rt.id },
      data: { revokedAt: new Date() },
    });
    return res.json({ ok: true });
  }
  res.json({ ok: true });
});

// ---------- UserInfo endpoint ----------
//
// Standard OIDC-style endpoint. Requires a Bearer access token; returns the
// user's profile if the token was issued via authorization_code (i.e. has a
// user context). Client_credentials tokens get a 403 because there's no user.

oauthRouter.get("/userinfo", async (req, res) => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "missing_token" });
  const raw = header.slice(7);
  const at = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash: sha256Hex(raw) },
    include: {
      user: { select: { id: true, email: true, fullName: true, role: true } },
    },
  });
  if (!at || at.revokedAt || at.expiresAt < new Date())
    return res.status(401).json({ error: "invalid_token" });
  if (!at.userId || !at.user)
    return res.status(403).json({ error: "no_user_context" });
  res.json({
    sub: at.user.id,
    email: at.user.email,
    name: at.user.fullName,
    role: at.user.role,
    scope: at.scopes.join(" "),
  });
});
