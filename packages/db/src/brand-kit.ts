// P3: Brand-kit merge-var helper for the email template renderer.
//
// Callers that render an email body should merge these vars into their vars
// object before calling renderTemplate() so `{{brand.primaryColor}}`,
// `{{brand.logoUrl}}`, `{{brand.footerHtml}}`, `{{brand.socialLinks.twitter}}`
// resolve against the per-tenant BrandKit row.
//
// If no BrandKit row exists we fall back to the schema-level defaults (same
// hex values as the Prisma `@default(...)` — kept in sync manually).
//
// `applyBrandKit(html, tenantId)` is a one-shot convenience for callers that
// don't want to touch their vars object: it re-runs renderTemplate over the
// html with just `{ brand: <vars> }` mixed in, so any `{{brand.*}}` tokens
// still present in the already-rendered body get filled in.
//
// Wired into: auth-service/src/routes/transactional.ts + broadcasts.ts and
// crm-service/src/routes/campaigns.ts test-send + preview. Each of those
// calls applyBrandKit() after the primary renderTemplate() pass so any
// `{{brand.*}}` tokens the template (or its layout wrapper) references
// still resolve, without every caller needing to know about BrandKit.

import { prisma } from ".";
import { renderTemplate } from "./comm-render";

// Kept in sync with prisma/schema.prisma BrandKit @default values.
export const BRAND_DEFAULTS = {
  logoUrl: "",
  faviconUrl: "",
  primaryColor: "#1e40af",
  secondaryColor: "#0ea5e9",
  accentColor: "#f59e0b",
  neutralColor: "#111827",
  headingFont: "Inter, sans-serif",
  bodyFont: "Inter, sans-serif",
  footerHtml: "",
  socialLinks: {
    twitter: "",
    linkedin: "",
    facebook: "",
    instagram: "",
    youtube: "",
  },
} as const;

export interface BrandVars {
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  neutralColor: string;
  headingFont: string;
  bodyFont: string;
  footerHtml: string;
  socialLinks: Record<string, string>;
}

// Load a plain-object bag of brand vars for a tenant. Falls back to defaults
// if the tenant hasn't saved a kit yet. Never throws — a schema drift or DB
// hiccup returns defaults so template rendering keeps working.
export async function loadBrandVars(tenantId: string): Promise<BrandVars> {
  let kit: Awaited<ReturnType<typeof prisma.brandKit.findUnique>> = null;
  try {
    kit = await prisma.brandKit.findUnique({ where: { tenantId } });
  } catch {
    kit = null;
  }
  if (!kit) return { ...BRAND_DEFAULTS, socialLinks: { ...BRAND_DEFAULTS.socialLinks } };

  // logoUrl is derived from the MediaAsset (presigned S3 URL). If the tenant
  // hasn't configured S3 or the asset row is gone, degrade to empty string —
  // templates that reference {{brand.logoUrl}} will render an empty <img>
  // src rather than exploding.
  let logoUrl = "";
  let faviconUrl = "";
  if (kit.logoAssetId) logoUrl = (await presignAsset(tenantId, kit.logoAssetId)) ?? "";
  if (kit.faviconAssetId)
    faviconUrl = (await presignAsset(tenantId, kit.faviconAssetId)) ?? "";

  const social = (kit.socialLinks ?? {}) as Record<string, string>;
  return {
    logoUrl,
    faviconUrl,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
    accentColor: kit.accentColor,
    neutralColor: kit.neutralColor,
    headingFont: kit.headingFont,
    bodyFont: kit.bodyFont,
    footerHtml: kit.footerHtml ?? "",
    socialLinks: {
      ...BRAND_DEFAULTS.socialLinks,
      ...social,
    },
  };
}

// Convenience: render `{{brand.*}}` merge vars against an already-templated
// html body. Idempotent — running twice with the same brand data produces
// the same output. Non-{{brand.*}} tokens are left alone (missing keys render
// empty per renderTemplate's contract; we keep only the brand.* namespace).
export async function applyBrandKit(html: string, tenantId: string): Promise<string> {
  const brand = await loadBrandVars(tenantId);
  return renderTemplate(html, { brand });
}

// ── Internals ──────────────────────────────────────────────────────────
async function presignAsset(tenantId: string, assetId: string): Promise<string | null> {
  try {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: assetId, tenantId },
      select: { storageKey: true },
    });
    if (!asset) return null;
    const { loadS3Config, presignGetObject } = await import("./s3");
    const { decryptSecrets } = await import("./secrets-crypto");
    const integ = await prisma.tenantIntegration.findFirst({
      where: { tenantId, provider: "s3", isActive: true, isDefault: true },
    });
    if (!integ) return null;
    const cfg = loadS3Config(decryptSecrets(integ.secrets));
    return presignGetObject(cfg, asset.storageKey, 900);
  } catch {
    return null;
  }
}
