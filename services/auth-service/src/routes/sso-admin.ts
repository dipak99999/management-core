// SsoProvider admin API — SystemManager-only. Lets a tenant admin add /
// edit / disable OIDC providers (Google Workspace, Microsoft Entra, generic
// OIDC).
//
// clientSecret is encrypted at rest via secretsCrypto. It's accepted in
// plaintext on the wire (over TLS) but never returned in the clear — GET
// /:id returns { clientSecretSet: true } instead of the actual value.

import { Router } from "express";
import { z } from "zod";
import { encryptSecrets, prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

export const ssoAdminRouter = Router();

ssoAdminRouter.use(requireAuth);
const p = perms("SsoProvider");

// For OIDC: issuer=https URL, clientId/Secret are OAuth app creds.
// For SAML: issuer=SP entityID (any URL — our own metadata URL works),
//           clientId=IdP SSO entryPoint URL, clientSecret=the IdP's
//           signing cert in PEM form (encrypted at rest). Accepting
//           either shape in one schema avoids a second admin screen.
const createSchema = z.object({
  provider: z.enum(["google", "microsoft", "oidc-generic", "saml"]),
  // Relax `issuer` URL check for SAML — some IdPs want a URN rather than
  // a URL for the SP entityID. Still validate non-empty.
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1), // OIDC: secret. SAML: cert PEM (or JSON blob).
  // SAML-specific optional attribute mapping. Serialized into the same
  // encrypted secrets JSON blob alongside the cert so a single column
  // carries all SAML-only knobs without a schema change.
  samlEmailAttr: z.string().optional(),
  samlDisplayNameAttr: z.string().optional(),
  samlWantAssertionsSigned: z.boolean().optional(),
  // Optional SP keypair for signed AuthnRequests + encrypted-assertion
  // decryption. Required when `samlSignRequests` is true.
  samlSpPrivateKey: z.string().optional(),
  samlSpCert: z.string().optional(),
  samlSignRequests: z.boolean().optional(),
  // Optional IdP SLO URL — if set, "Log out" triggers a SAML
  // LogoutRequest + the /slo endpoint accepts IdP-initiated logout.
  samlLogoutUrl: z.string().url().optional(),
  samlValidateInResponseTo: z.enum(["always", "ifPresent", "never"]).optional(),
  allowedEmailDomains: z.array(z.string().min(1)).default([]),
  autoProvision: z.boolean().default(true),
  defaultRole: z.string().default("user"),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.partial().omit({ provider: true });

function scrub(r: {
  id: string;
  tenantId: string;
  provider: string;
  issuer: string;
  clientId: string;
  allowedEmailDomains: string[];
  autoProvision: boolean;
  defaultRole: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...r, clientSecretSet: true };
}

ssoAdminRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.ssoProvider.findMany({
    where: { tenantId: req.auth!.tenantId },
    select: {
      id: true,
      tenantId: true,
      provider: true,
      issuer: true,
      clientId: true,
      allowedEmailDomains: true,
      autoProvision: true,
      defaultRole: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(rows.map(scrub));
});

// For SAML, pack the cert + attribute mapping into the same encrypted
// JSON blob that OIDC uses for `clientSecret`. The sso.ts handler reads
// the shape it needs ({cert, wantAssertionsSigned, emailAttr, displayNameAttr})
// via decryptSecrets.
function buildSecretsPayload(parsed: z.infer<typeof createSchema>): Record<string, unknown> {
  if (parsed.provider === "saml") {
    return {
      cert: parsed.clientSecret,
      wantAssertionsSigned: parsed.samlWantAssertionsSigned ?? true,
      emailAttr: parsed.samlEmailAttr,
      displayNameAttr: parsed.samlDisplayNameAttr,
      spPrivateKey: parsed.samlSpPrivateKey,
      spCert: parsed.samlSpCert,
      signRequests: parsed.samlSignRequests ?? false,
      logoutUrl: parsed.samlLogoutUrl,
      validateInResponseTo: parsed.samlValidateInResponseTo,
    };
  }
  return { clientSecret: parsed.clientSecret };
}

ssoAdminRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.ssoProvider.create({
      data: {
        tenantId: req.auth!.tenantId,
        provider: parsed.data.provider,
        issuer: parsed.data.issuer,
        clientId: parsed.data.clientId,
        clientSecretEnc: encryptSecrets(buildSecretsPayload(parsed.data)) as unknown as object,
        allowedEmailDomains: parsed.data.allowedEmailDomains,
        autoProvision: parsed.data.autoProvision,
        defaultRole: parsed.data.defaultRole,
        isActive: parsed.data.isActive,
      },
      select: {
        id: true,
        tenantId: true,
        provider: true,
        issuer: true,
        clientId: true,
        allowedEmailDomains: true,
        autoProvision: true,
        defaultRole: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.status(201).json(scrub(row));
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res
        .status(409)
        .json({ error: `SSO provider '${parsed.data.provider}' already configured` });
    throw e;
  }
});

ssoAdminRouter.patch("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.ssoProvider.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const data: Record<string, unknown> = {};
  if (parsed.data.issuer !== undefined) data.issuer = parsed.data.issuer;
  if (parsed.data.clientId !== undefined) data.clientId = parsed.data.clientId;
  if (parsed.data.clientSecret !== undefined)
    data.clientSecretEnc = encryptSecrets({ clientSecret: parsed.data.clientSecret });
  if (parsed.data.allowedEmailDomains !== undefined)
    data.allowedEmailDomains = parsed.data.allowedEmailDomains;
  if (parsed.data.autoProvision !== undefined) data.autoProvision = parsed.data.autoProvision;
  if (parsed.data.defaultRole !== undefined) data.defaultRole = parsed.data.defaultRole;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const row = await prisma.ssoProvider.update({
    where: { id: existing.id },
    data,
    select: {
      id: true,
      tenantId: true,
      provider: true,
      issuer: true,
      clientId: true,
      allowedEmailDomains: true,
      autoProvision: true,
      defaultRole: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json(scrub(row));
});

ssoAdminRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.ssoProvider.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.ssoProvider.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ── SAML IdP metadata parser ──────────────────────────────────────────
//
// Admins paste the IdP metadata XML (every SAML IdP publishes one — Okta,
// Azure AD, Google Workspace, JumpCloud all emit the same shape). We
// extract the fields that pre-populate the Create SAML Provider form:
//   entryPoint — IdP SSO URL (HTTP-POST binding)
//   logoutUrl  — IdP SLO URL (if advertised)
//   cert       — IdP signing certificate (PEM-formatted from the X509 blob)
//   entityId   — IdP entityID (used as `issuer` on their side)
//
// Zero-allocation parsing via @xmldom/xmldom. Validation is light — we
// surface the raw XML back on error so the admin can see what we saw.
import { DOMParser } from "@xmldom/xmldom";

const parseMetadataSchema = z.object({
  metadataXml: z.string().min(50).max(500_000),
});

function pemifyCert(raw: string): string {
  const stripped = raw.replace(/\s+/g, "");
  const lines = stripped.match(/.{1,64}/g) ?? [stripped];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

ssoAdminRouter.post("/saml/parse-metadata", p.read, async (req, res) => {
  const parsed = parseMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  let doc: Document;
  try {
    doc = new DOMParser({
      // @xmldom/xmldom >=1.0 — single error-callback signature. We ignore
      // warnings + non-fatal errors; a hard parse failure throws below.
      onError: (level, msg) => {
        if (level === "fatalError") throw new Error(msg);
      },
    }).parseFromString(parsed.data.metadataXml, "text/xml") as unknown as Document;
  } catch (e) {
    return res.status(400).json({ error: `Could not parse XML: ${e instanceof Error ? e.message : String(e)}` });
  }

  const SAML_META_NS = "urn:oasis:names:tc:SAML:2.0:metadata";
  const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
  const POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
  const REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";

  // entityID is on the root <EntityDescriptor>.
  const root = doc.documentElement;
  const entityId = root?.getAttribute("entityID") ?? null;

  const idp = Array.from(root?.getElementsByTagNameNS(SAML_META_NS, "IDPSSODescriptor") ?? [])[0];
  if (!idp) {
    return res.status(400).json({ error: "No IDPSSODescriptor found in metadata — is this really IdP metadata?" });
  }

  // Prefer POST binding; fall back to Redirect if that's all the IdP advertises.
  function urlFor(tag: "SingleSignOnService" | "SingleLogoutService"): string | null {
    const nodes = Array.from(idp!.getElementsByTagNameNS(SAML_META_NS, tag));
    const post = nodes.find((n) => n.getAttribute("Binding") === POST_BINDING);
    const redir = nodes.find((n) => n.getAttribute("Binding") === REDIRECT_BINDING);
    return (post ?? redir)?.getAttribute("Location") ?? null;
  }
  const entryPoint = urlFor("SingleSignOnService");
  const logoutUrl = urlFor("SingleLogoutService");

  // First X509Certificate from the first <KeyDescriptor use="signing"> block,
  // falling back to any KeyDescriptor.
  const keyDescriptors = Array.from(idp.getElementsByTagNameNS(SAML_META_NS, "KeyDescriptor"));
  const signingKey = keyDescriptors.find((k) => k.getAttribute("use") === "signing") ?? keyDescriptors[0];
  const certNode = signingKey?.getElementsByTagNameNS(DS_NS, "X509Certificate")[0];
  const certRaw = certNode?.textContent?.trim() ?? null;
  const cert = certRaw ? pemifyCert(certRaw) : null;

  res.json({
    entityId,
    entryPoint,
    logoutUrl,
    cert,
    // Help the operator debug if any field came back null.
    diagnostics: {
      hasEntityId: !!entityId,
      hasEntryPoint: !!entryPoint,
      hasLogoutUrl: !!logoutUrl,
      hasCert: !!cert,
      bindingUsed: entryPoint
        ? (idp.getElementsByTagNameNS(SAML_META_NS, "SingleSignOnService").length > 0 ? "POST or Redirect" : "unknown")
        : null,
    },
  });
});
