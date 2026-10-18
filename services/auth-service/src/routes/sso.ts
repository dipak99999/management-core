// OIDC SSO — inbound Google / Microsoft / generic OIDC login for tenants.
//
// Flow (Authorization Code + PKCE):
//   1. POST /auth/sso/discover { email, tenantSlug }
//      → returns { authorizeUrl } if the email's domain is allowed for a
//        configured provider on this tenant; otherwise 404.
//   2. GET  /auth/sso/:provider/:tenantSlug/authorize?redirect=…
//      → 302 to the IdP's authorize endpoint. Stores {state, nonce,
//        codeVerifier} in the SsoState table (10 min TTL).
//   3. GET  /auth/sso/:provider/:tenantSlug/callback?code&state
//      → exchanges code for id_token, validates iss/aud/nonce, matches
//        or auto-provisions a User, issues a session JWT.
//
// Notes:
//   * Client secret is decrypted per-request via decryptSecrets (envelope
//     AES-256-GCM). Kept in Prisma; never returned by the admin API.
//   * OIDC discovery — we pull /.well-known/openid-configuration from the
//     issuer on first request and cache in-process (issuer configs are
//     static; a restart re-fetches).
//   * id_token verification uses the provider's JWKS (also cached), RS256
//     the standard. Both Google + Microsoft rotate keys — cache TTL 1h.

import { Router } from "express";
import { z } from "zod";
import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as cryptoVerify,
} from "node:crypto";
import jwt from "jsonwebtoken";
import {
  assignSystemManagerRole,
  decryptSecrets,
  getUserRoleNames,
  prisma,
} from "@lumaara/db";
import type { JwtClaims } from "@lumaara/shared-types";
import { JWT_SECRET, getLogger } from "@lumaara/service-auth";

const log = getLogger("auth-service").child({ component: "sso" });

export const ssoRouter = Router();

// SAML 2.0 Web Browser SSO. Powered by @node-saml/node-saml which handles
// the hard parts: XML canonicalization (C14N), signature validation
// against the IdP's X.509 cert, AuthnRequest generation, assertion
// decryption, NameID + attribute extraction.
//
// Flow:
//   1. GET  /auth/sso/saml/:tenantSlug/metadata
//      → public SP metadata XML. Admin uploads this to the IdP.
//   2. GET  /auth/sso/saml/:tenantSlug/login[?RelayState=/path]
//      → 302 to the IdP's entryPoint with a SAMLRequest.
//   3. POST /auth/sso/saml/:tenantSlug/acs
//      → IdP POSTs a SAMLResponse. We verify the signature, extract the
//        subject (NameID + email + displayName) and either match or JIT-
//        provision the User. Issues a session JWT the same way the OIDC
//        callback does.
//
// SsoProvider storage for SAML:
//   provider  = "saml"
//   issuer    = SP entityID (our side — matches metadata)
//   clientId  = IdP entryPoint URL (reuse the field)
//   clientSecretEnc = encrypted JSON: { cert: "<idp signing cert PEM>",
//                                       wantAssertionsSigned?: boolean,
//                                       emailAttr?: string,
//                                       displayNameAttr?: string }
//   allowedEmailDomains / autoProvision / defaultRole — same semantics
//   as OIDC.
//
// Why no SP signing? For MVP, our AuthnRequests are unsigned (common for
// SP-initiated flows; IdPs don't require it). Response signatures ARE
// mandatory and verified. If a customer needs signed requests, add a
// per-tenant SP keypair + sign in SAML config.

import { SAML } from "@node-saml/node-saml";

interface SamlCreds {
  cert: string; // PEM, IdP signing certificate
  wantAssertionsSigned?: boolean;
  // SP-side keypair for signed AuthnRequests + encrypted assertion
  // decryption. Both optional — many deployments only need the IdP cert
  // to verify responses. Enable when the IdP requires signed requests
  // (common with Azure AD + strict Okta policies) or when assertions
  // are IdP-encrypted.
  spPrivateKey?: string; // PEM private key (PKCS#8 preferred)
  spCert?: string;       // PEM cert matching spPrivateKey
  signRequests?: boolean; // if true, AuthnRequest is signed with spPrivateKey
  // SLO configuration — optional. When the IdP supports Single Logout
  // and the admin pastes the IdP's SLO URL into logoutUrl, Lumaara's
  // logout action triggers a SAML LogoutRequest back to the IdP.
  logoutUrl?: string;
  logoutCallbackUrl?: string; // where IdP POSTs LogoutResponse (we provide the default)
  // Attribute mapping defaults — email usually comes from NameID
  // (emailAddress format) or an "email" attribute; displayName from
  // "displayName" / "cn" / full name attribute.
  emailAttr?: string;
  displayNameAttr?: string;
  // Replay-defense policy. "always" (default) rejects a SAMLResponse
  // whose InResponseTo doesn't match an AuthnRequest WE generated. Can
  // be loosened to "never" for IdP-initiated flows OR for broker setups
  // where our ACS receives responses forwarded from a third party.
  // "ifPresent" accepts both IdP-initiated and SP-initiated responses.
  validateInResponseTo?: "always" | "ifPresent" | "never";
}

function samlConfigFromProvider(
  cfg: { issuer: string; clientId: string; clientSecretEnc: unknown },
  acsUrl: string,
  sloUrl: string,
): { saml: SAML; creds: SamlCreds } {
  const creds = decryptSecrets(cfg.clientSecretEnc as never) as unknown as SamlCreds;
  if (!creds?.cert) {
    throw new Error("SAML provider misconfigured: missing IdP cert");
  }
  if (!cfg.clientId) {
    throw new Error("SAML provider misconfigured: entryPoint (clientId column) missing");
  }
  // signRequests requires both spCert + spPrivateKey. If only one is
  // provided, fail fast — a half-configured keypair silently produces
  // unsigned requests which the IdP will then reject.
  if (creds.signRequests) {
    if (!creds.spCert || !creds.spPrivateKey) {
      throw new Error("SAML provider misconfigured: signRequests=true requires both spCert and spPrivateKey");
    }
  }
  const saml = new SAML({
    callbackUrl: acsUrl,
    entryPoint: cfg.clientId,
    issuer: cfg.issuer || acsUrl, // SP entityID
    idpCert: creds.cert,
    identifierFormat:
      "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    disableRequestedAuthnContext: true,
    wantAssertionsSigned: creds.wantAssertionsSigned ?? true,
    // Enable signed requests when the admin configured a keypair.
    ...(creds.signRequests ? { privateKey: creds.spPrivateKey, signingCert: creds.spCert } : {}),
    // SLO — if admin configured, pass both URLs so the SAML lib builds
    // the correct LogoutRequest.
    ...(creds.logoutUrl ? { logoutUrl: creds.logoutUrl } : {}),
    logoutCallbackUrl: sloUrl,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    // Caching inResponseTo defends against replay. Default is strict
    // ("always") — operator can relax per-provider when they need to
    // accept IdP-initiated responses.
    validateInResponseTo: (creds.validateInResponseTo ?? "always") as never,
    requestIdExpirationPeriodMs: 10 * 60 * 1000, // 10 minutes
  });
  return { saml, creds };
}

function samlAcsUrl(tenantSlug: string): string {
  return `${publicBaseUrl()}/auth/sso/saml/${tenantSlug}/acs`;
}
function samlSloUrl(tenantSlug: string): string {
  return `${publicBaseUrl()}/auth/sso/saml/${tenantSlug}/slo`;
}

async function loadSamlProvider(tenantSlug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return null;
  const cfg = await prisma.ssoProvider.findFirst({
    where: { tenantId: tenant.id, provider: "saml", isActive: true },
  });
  if (!cfg) return null;
  return { tenant, cfg };
}

ssoRouter.get("/saml/:tenantSlug/metadata", async (req, res) => {
  const row = await loadSamlProvider(req.params.tenantSlug);
  if (!row) return res.status(404).type("text/plain").send("No active SAML provider for this tenant");
  try {
    const { saml } = samlConfigFromProvider(row.cfg, samlAcsUrl(req.params.tenantSlug), samlSloUrl(req.params.tenantSlug));
    // @node-saml v5 moved the standalone helper to a single-params-object
    // signature. The SAML instance method still takes (decryptionCert,
    // publicCerts) — use that to keep the call-site tiny and let the
    // instance's own issuer/callbackUrl flow through automatically.
    const xml = saml.generateServiceProviderMetadata(null, null);
    res.type("application/xml").send(xml);
  } catch (e) {
    res.status(500).type("text/plain").send(e instanceof Error ? e.message : "metadata failed");
  }
});

ssoRouter.get("/saml/:tenantSlug/login", async (req, res) => {
  const row = await loadSamlProvider(req.params.tenantSlug);
  if (!row) return res.status(404).json({ error: "No active SAML provider for this tenant" });
  const relayState = typeof req.query.RelayState === "string" ? req.query.RelayState : "";
  try {
    const { saml } = samlConfigFromProvider(row.cfg, samlAcsUrl(req.params.tenantSlug), samlSloUrl(req.params.tenantSlug));
    const url = await saml.getAuthorizeUrlAsync(relayState, undefined, {});
    res.redirect(302, url);
  } catch (e) {
    log.error("SAML login build failed", { tenantSlug: req.params.tenantSlug, err: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: "Could not build SAML AuthnRequest", detail: e instanceof Error ? e.message : "unknown" });
  }
});

ssoRouter.post("/saml/:tenantSlug/acs", async (req, res) => {
  const row = await loadSamlProvider(req.params.tenantSlug);
  if (!row) return res.status(404).json({ error: "No active SAML provider for this tenant" });

  // The IdP POSTs form-urlencoded SAMLResponse + optional RelayState.
  // express.urlencoded() isn't mounted globally; parse manually.
  const body = (req.body ?? {}) as Record<string, string>;
  if (!body.SAMLResponse) {
    return res.status(400).json({ error: "Missing SAMLResponse" });
  }

  let samlCtx;
  try {
    samlCtx = samlConfigFromProvider(row.cfg, samlAcsUrl(req.params.tenantSlug), samlSloUrl(req.params.tenantSlug));
  } catch (e) {
    return res.status(500).json({ error: "SAML config invalid", detail: e instanceof Error ? e.message : "unknown" });
  }

  // validatePostResponseAsync signature-verifies the response + enforces
  // destination/issuer/condition/inResponseTo checks per the SAML spec.
  // Throws SamlStatusError on failure — any throw here is a hard reject.
  let profile;
  try {
    const r = await samlCtx.saml.validatePostResponseAsync({
      SAMLResponse: body.SAMLResponse,
    });
    profile = r.profile;
  } catch (e) {
    log.warn("SAML response rejected", {
      tenantSlug: req.params.tenantSlug,
      err: e instanceof Error ? e.message : String(e),
    });
    return res.status(401).json({ error: "SAML response invalid", detail: e instanceof Error ? e.message : "unknown" });
  }
  if (!profile) return res.status(401).json({ error: "SAML response had no profile" });

  // Extract email + display name using attribute mapping (fallback to the
  // sensible defaults every IdP uses).
  const attrs = (profile.attributes ?? {}) as Record<string, string | string[] | undefined>;
  const emailAttr = samlCtx.creds.emailAttr ?? "email";
  const displayNameAttr = samlCtx.creds.displayNameAttr ?? "displayName";
  const emailRaw =
    (profile.nameID && typeof profile.nameID === "string" && profile.nameID.includes("@") ? profile.nameID : null) ??
    (typeof attrs[emailAttr] === "string" ? attrs[emailAttr] as string : null) ??
    (Array.isArray(attrs[emailAttr]) ? (attrs[emailAttr] as string[])[0] : null) ??
    (typeof attrs.email === "string" ? attrs.email as string : null) ??
    (typeof attrs["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] === "string"
      ? attrs["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] as string
      : null);
  const email = emailRaw ? String(emailRaw).toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "SAML assertion missing email" });

  const displayName =
    (typeof attrs[displayNameAttr] === "string" ? attrs[displayNameAttr] as string : null) ??
    (typeof attrs.displayName === "string" ? attrs.displayName as string : null) ??
    (typeof attrs.cn === "string" ? attrs.cn as string : null) ??
    email;

  const domain = email.split("@")[1] ?? "";
  if (
    row.cfg.allowedEmailDomains.length > 0 &&
    !row.cfg.allowedEmailDomains.some((d: string) => d.toLowerCase() === domain.toLowerCase())
  ) {
    return res.status(403).json({ error: "email domain not permitted for this SSO provider" });
  }

  // Match or JIT-provision — same logic as OIDC. (Factoring this into a
  // helper is tempting; leaving duplicated here to avoid cross-cutting
  // the already-landed OIDC flow in this patch.)
  let user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: row.tenant.id, email } },
  });
  if (!user) {
    if (!row.cfg.autoProvision) {
      return res.status(403).json({ error: "auto-provision disabled; ask admin to invite you" });
    }
    user = await prisma.user.create({
      data: {
        tenantId: row.tenant.id,
        email,
        passwordHash: randomBytes(32).toString("hex"),
        fullName: displayName,
        role: row.cfg.defaultRole,
        emailVerifiedAt: new Date(), // IdP asserted it
      },
    });
    if (row.cfg.defaultRole === "admin" || user.role === "admin") {
      await assignSystemManagerRole(prisma, row.tenant.id, user.id);
    }
  } else if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  // Issue session JWT (identical to OIDC callback).
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      jti: randomBytes(16).toString("hex"),
      userAgent: req.header("user-agent") ?? null,
      ipAddress: req.ip ?? null,
    },
  });
  const roles = await getUserRoleNames(prisma, user.id);
  const token = jwt.sign(
    {
      userId: user.id,
      tenantId: row.tenant.id,
      email: user.email,
      role: user.role,
      roles,
      jti: session.jti,
    } satisfies JwtClaims as object,
    JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  // RelayState (if present) is the pre-login path the user tried to reach.
  const relayState = typeof body.RelayState === "string" ? body.RelayState : "";
  const dest = relayState || `${publicBaseUrl()}/dashboard`;
  const sep = dest.includes("?") ? "&" : "?";
  res.redirect(302, `${dest}${sep}sso_token=${encodeURIComponent(token)}`);
});

// ── Single Logout ─────────────────────────────────────────────────────
//
// Two triggers:
//   1. User clicks "Log out" in Lumaara while signed in via SAML — we
//      POST /auth/sso/saml/:tenantSlug/slo-initiate, which revokes the
//      session + builds a signed LogoutRequest + redirects to the IdP's
//      logoutUrl. The IdP then logs the user out of its own session.
//   2. User clicks "Log out" in the IdP — the IdP POSTs a LogoutRequest
//      to our /slo endpoint; we revoke the matching session + respond
//      with a LogoutResponse redirecting back to the IdP.
//
// Both flows require the IdP to have `logoutUrl` configured on the
// SsoProvider row. Without it, the slo-initiate endpoint falls back to
// a local-only logout (just revokes the session + clears client token)
// so the "Log out" button never 500s.

ssoRouter.post("/saml/:tenantSlug/slo-initiate", async (req, res) => {
  const row = await loadSamlProvider(req.params.tenantSlug);
  if (!row) return res.status(404).json({ error: "No active SAML provider" });

  const body = (req.body ?? {}) as { email?: string; nameID?: string; sessionIndex?: string };
  const email = typeof body.email === "string" ? body.email : null;
  const nameID = body.nameID ?? email;
  if (!nameID) return res.status(400).json({ error: "Need nameID or email to log out of SAML IdP" });

  // Best-effort session revoke on our side regardless of IdP response.
  if (email) {
    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: row.tenant.id, email } },
      select: { id: true },
    });
    if (user) {
      await prisma.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  // If no IdP SLO endpoint configured, local-only logout is the correct
  // result — tell the client it's done.
  try {
    const samlCtx = samlConfigFromProvider(row.cfg, samlAcsUrl(req.params.tenantSlug), samlSloUrl(req.params.tenantSlug));
    if (!samlCtx.creds.logoutUrl) {
      return res.json({ ok: true, logoutUrl: null });
    }
    const url = await samlCtx.saml.getLogoutUrlAsync(
      {
        nameID,
        nameIDFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        sessionIndex: body.sessionIndex,
        // Required by the Profile type; empty = per-request issuer.
        issuer: row.cfg.issuer,
      } as never,
      "",
      {},
    );
    res.json({ ok: true, logoutUrl: url });
  } catch (e) {
    log.error("SAML SLO initiate failed", { tenantSlug: req.params.tenantSlug, err: e instanceof Error ? e.message : String(e) });
    res.json({ ok: true, logoutUrl: null, warning: "Local session revoked, but IdP logout URL could not be built" });
  }
});

// IdP-initiated logout: the IdP POSTs a LogoutRequest here. We revoke
// the matching session + respond with a LogoutResponse.
ssoRouter.post("/saml/:tenantSlug/slo", async (req, res) => {
  const row = await loadSamlProvider(req.params.tenantSlug);
  if (!row) return res.status(404).json({ error: "No active SAML provider" });
  const body = (req.body ?? {}) as Record<string, string>;
  if (!body.SAMLRequest && !body.SAMLResponse) {
    return res.status(400).json({ error: "Missing SAMLRequest / SAMLResponse" });
  }

  let samlCtx;
  try {
    samlCtx = samlConfigFromProvider(row.cfg, samlAcsUrl(req.params.tenantSlug), samlSloUrl(req.params.tenantSlug));
  } catch (e) {
    return res.status(500).json({ error: "SAML config invalid", detail: e instanceof Error ? e.message : "unknown" });
  }
  try {
    const r = await samlCtx.saml.validatePostResponseAsync(body);
    // On a LogoutRequest, r.loggedOut is true + r.profile has the NameID.
    if (r.loggedOut && r.profile?.nameID) {
      const email = typeof r.profile.nameID === "string" && r.profile.nameID.includes("@")
        ? r.profile.nameID.toLowerCase()
        : null;
      if (email) {
        const user = await prisma.user.findUnique({
          where: { tenantId_email: { tenantId: row.tenant.id, email } },
          select: { id: true },
        });
        if (user) {
          await prisma.userSession.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
    }
    // Build a LogoutResponse redirect back to the IdP, if we have the URL.
    if (samlCtx.creds.logoutUrl && r.profile) {
      const url = await samlCtx.saml.getLogoutResponseUrlAsync(
        r.profile,
        typeof body.RelayState === "string" ? body.RelayState : "",
        {},
        true,
      );
      return res.redirect(302, url);
    }
    res.json({ ok: true, loggedOut: !!r.loggedOut });
  } catch (e) {
    log.warn("SAML SLO rejected", { tenantSlug: req.params.tenantSlug, err: e instanceof Error ? e.message : String(e) });
    res.status(401).json({ error: "SLO message invalid", detail: e instanceof Error ? e.message : "unknown" });
  }
});

const JWT_TTL = (process.env.JWT_EXPIRES_IN ?? "7d") as jwt.SignOptions["expiresIn"];

// Public base URL for building the callback. Behind nginx this is the
// external URL customers hit.
function publicBaseUrl(): string {
  return process.env.PUBLIC_URL ?? process.env.NEXT_PUBLIC_SHELL_URL ?? "http://localhost:4001";
}

// ─── OIDC discovery + JWKS caches ─────────────────────────────────────────
interface OidcConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}
interface Jwk {
  kty: string;
  kid: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

const discoveryCache = new Map<string, { at: number; cfg: OidcConfig }>();
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();
const TTL_MS = 60 * 60 * 1000; // 1h

async function loadOidcConfig(issuer: string): Promise<OidcConfig> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.cfg;
  const url = issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${url}`);
  const cfg = (await res.json()) as OidcConfig;
  discoveryCache.set(issuer, { at: Date.now(), cfg });
  return cfg;
}

async function loadJwks(jwksUri: string): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.keys;
  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const j = (await res.json()) as { keys: Jwk[] };
  jwksCache.set(jwksUri, { at: Date.now(), keys: j.keys });
  return j.keys;
}

// ─── PKCE + state helpers ────────────────────────────────────────────────
function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makePkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ─── id_token verification (JWKS + RS256) ────────────────────────────────
async function verifyIdToken(
  idToken: string,
  jwksUri: string,
  expectedIssuer: string,
  expectedAudience: string,
  expectedNonce: string,
): Promise<Record<string, unknown>> {
  const [headerB64, payloadB64, sigB64] = idToken.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("malformed id_token");
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString()) as {
    kid: string;
    alg: string;
  };
  if (header.alg !== "RS256") throw new Error(`unsupported alg: ${header.alg}`);

  const keys = await loadJwks(jwksUri);
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk?.n || !jwk?.e) throw new Error(`kid ${header.kid} not in JWKS`);

  // Build an SPKI DER key from the JWK n + e.
  const pubKey = createPublicKey({
    key: { kty: "RSA", n: jwk.n, e: jwk.e },
    format: "jwk",
  });
  const signed = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const sig = Buffer.from(sigB64, "base64url");
  const ok = cryptoVerify("RSA-SHA256", signed, pubKey, sig);
  if (!ok) throw new Error("id_token signature invalid");

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<
    string,
    unknown
  >;
  if (payload.iss !== expectedIssuer) throw new Error(`iss mismatch: ${String(payload.iss)}`);
  const audOk =
    payload.aud === expectedAudience ||
    (Array.isArray(payload.aud) && (payload.aud as string[]).includes(expectedAudience));
  if (!audOk) throw new Error(`aud mismatch`);
  if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp)
    throw new Error("id_token expired");
  if (payload.nonce !== expectedNonce) throw new Error("nonce mismatch");
  return payload;
}

// ─── Discover: is there an SSO provider for this email + tenant? ─────────
const discoverSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().min(1),
  redirectTo: z.string().optional(),
});

ssoRouter.post("/discover", async (req, res) => {
  const parsed = discoverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, tenantSlug, redirectTo } = parsed.data;

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return res.status(404).json({ error: "SSO not available" });

  const providers = await prisma.ssoProvider.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: { provider: true, allowedEmailDomains: true },
  });
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const match = providers.find(
    (p) =>
      p.allowedEmailDomains.length === 0 ||
      p.allowedEmailDomains.some((d) => d.toLowerCase() === domain),
  );
  if (!match) return res.status(404).json({ error: "SSO not available for this email" });

  const authorizeUrl = `${publicBaseUrl()}/auth/sso/${match.provider}/${tenantSlug}/authorize${
    redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""
  }`;
  res.json({ authorizeUrl, provider: match.provider });
});

// ─── Authorize: 302 to IdP ────────────────────────────────────────────────
ssoRouter.get("/:provider/:tenantSlug/authorize", async (req, res) => {
  const { provider, tenantSlug } = req.params;
  const redirectTo = typeof req.query.redirect === "string" ? req.query.redirect : null;

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return res.status(404).json({ error: "unknown tenant" });

  const cfg = await prisma.ssoProvider.findFirst({
    where: { tenantId: tenant.id, provider, isActive: true },
  });
  if (!cfg) return res.status(404).json({ error: "SSO not configured" });

  const oidc = await loadOidcConfig(cfg.issuer);
  const { verifier, challenge } = makePkcePair();
  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(16));

  await prisma.ssoState.create({
    data: {
      ssoProviderId: cfg.id,
      state,
      nonce,
      codeVerifier: verifier,
      redirectTo,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const redirectUri = `${publicBaseUrl()}/auth/sso/${provider}/${tenantSlug}/callback`;
  const url = new URL(oidc.authorization_endpoint);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  res.redirect(302, url.toString());
});

// ─── Callback: exchange code, verify id_token, issue session ─────────────
ssoRouter.get("/:provider/:tenantSlug/callback", async (req, res) => {
  const { provider, tenantSlug } = req.params;
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (!code || !state) return res.status(400).json({ error: "missing code or state" });

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return res.status(404).json({ error: "unknown tenant" });

  const cfg = await prisma.ssoProvider.findFirst({
    where: { tenantId: tenant.id, provider, isActive: true },
  });
  if (!cfg) return res.status(404).json({ error: "SSO not configured" });

  const stateRow = await prisma.ssoState.findUnique({ where: { state } });
  if (!stateRow || stateRow.ssoProviderId !== cfg.id)
    return res.status(400).json({ error: "invalid state" });
  if (stateRow.expiresAt < new Date())
    return res.status(400).json({ error: "state expired" });
  // One-shot: delete before use so a leaked state can't be replayed.
  await prisma.ssoState.delete({ where: { id: stateRow.id } });

  const oidc = await loadOidcConfig(cfg.issuer);
  const secrets = decryptSecrets(cfg.clientSecretEnc);
  const clientSecret = typeof secrets.clientSecret === "string" ? secrets.clientSecret : "";
  if (!clientSecret) return res.status(500).json({ error: "SSO client secret missing" });

  const redirectUri = `${publicBaseUrl()}/auth/sso/${provider}/${tenantSlug}/callback`;
  const tokenRes = await fetch(oidc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: clientSecret,
      code_verifier: stateRow.codeVerifier,
    }).toString(),
  });
  if (!tokenRes.ok) {
    log.warn("token exchange failed", { status: tokenRes.status });
    return res.status(401).json({ error: "SSO token exchange failed" });
  }
  const tok = (await tokenRes.json()) as { id_token?: string };
  if (!tok.id_token) return res.status(401).json({ error: "no id_token" });

  let claims: Record<string, unknown>;
  try {
    claims = await verifyIdToken(tok.id_token, oidc.jwks_uri, cfg.issuer, cfg.clientId, stateRow.nonce);
  } catch (e) {
    log.warn("id_token verify failed", { err: e instanceof Error ? e.message : String(e) });
    return res.status(401).json({ error: "SSO id_token invalid" });
  }

  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  const emailVerified = claims.email_verified !== false; // Google always sets this; Microsoft: may be absent → treat as verified
  const name = typeof claims.name === "string" ? claims.name : email;
  if (!email) return res.status(401).json({ error: "no email in id_token" });
  if (!emailVerified) return res.status(401).json({ error: "email not verified with IdP" });

  const domain = email.split("@")[1] ?? "";
  if (
    cfg.allowedEmailDomains.length > 0 &&
    !cfg.allowedEmailDomains.some((d) => d.toLowerCase() === domain.toLowerCase())
  ) {
    return res.status(403).json({ error: "email domain not permitted for this SSO provider" });
  }

  // Match existing user or auto-provision.
  let user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });
  if (!user) {
    if (!cfg.autoProvision)
      return res.status(403).json({ error: "auto-provision disabled; ask admin to invite you" });
    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        // SSO-only users get a random unusable password. Setting a real
        // password requires the password-reset flow.
        passwordHash: randomBytes(32).toString("hex"),
        fullName: name,
        role: cfg.defaultRole,
        // IdP already verified email — mirror that state.
        emailVerifiedAt: new Date(),
      },
    });
    // Grant a default role — matches signup behavior.
    if (cfg.defaultRole === "admin" || user.role === "admin") {
      await assignSystemManagerRole(prisma, tenant.id, user.id);
    }
  } else if (!user.emailVerifiedAt) {
    // IdP proved control of the address — mark verified.
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  // Issue a session JWT with a jti so it's revokable via /sessions.
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      jti: randomBytes(16).toString("hex"),
      userAgent: req.header("user-agent") ?? null,
      ipAddress: req.ip ?? null,
    },
  });
  const roles = await getUserRoleNames(prisma, user.id);
  const token = jwt.sign(
    {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
      roles,
      jti: session.jti,
    } satisfies JwtClaims as object,
    JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  // Redirect to the shell with a token fragment, or JSON when the caller
  // asked for a headless flow (Accept: application/json).
  if (req.header("accept")?.includes("application/json")) {
    return res.json({ token, user: { id: user.id, email: user.email, fullName: user.fullName } });
  }
  const dest = stateRow.redirectTo ?? `${publicBaseUrl()}/dashboard`;
  const sep = dest.includes("?") ? "&" : "?";
  return res.redirect(302, `${dest}${sep}sso_token=${encodeURIComponent(token)}`);
});
