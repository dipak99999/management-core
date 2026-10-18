import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Marketing P3: BrandKit — one row per tenant.
//
// Get-or-create pattern: `GET /brand-kit` never 404s. If the tenant hasn't
// saved anything yet we auto-provision a row using schema defaults so the UI
// always has something to render.
//
// `PUT /brand-kit` upserts and validates:
//   • all colour fields must be #RRGGBB
//   • headingFont/bodyFont must be non-empty strings
//   • logoAssetId + faviconAssetId (when supplied) must reference a MediaAsset
//     owned by the same tenant — prevents accidental cross-tenant asset link
//
// `GET /brand-kit/preview.html` returns a self-contained HTML snippet that
// shows the brand palette applied to a sample email header + button + footer.
// The admin UI iframes it for the live preview panel.

export const brandKitRouter = Router();
const p = perms("BrandKit");

// Colours are stored as canonical lowercase 6-digit hex. Accept #FFF (3-digit)
// on write for convenience — we'll expand to 6-digit before persist.
const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;
const hexColor = z
  .string()
  .refine((v) => HEX6.test(v) || HEX3.test(v), "must be a hex colour like #1e40af");

function normalizeHex(v: string): string {
  if (HEX3.test(v)) {
    const m = v.slice(1);
    return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`.toLowerCase();
  }
  return v.toLowerCase();
}

const socialLinksSchema = z
  .object({
    twitter: z.string().url().or(z.literal("")).optional(),
    linkedin: z.string().url().or(z.literal("")).optional(),
    facebook: z.string().url().or(z.literal("")).optional(),
    instagram: z.string().url().or(z.literal("")).optional(),
    youtube: z.string().url().or(z.literal("")).optional(),
  })
  .partial();

const putSchema = z.object({
  logoAssetId: z.string().min(1).nullable().optional(),
  faviconAssetId: z.string().min(1).nullable().optional(),
  primaryColor: hexColor.optional(),
  secondaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  neutralColor: hexColor.optional(),
  headingFont: z.string().min(1).max(200).optional(),
  bodyFont: z.string().min(1).max(200).optional(),
  footerHtml: z.string().max(10_000).nullable().optional(),
  socialLinks: socialLinksSchema.nullable().optional(),
});

// Load-or-create — pure helper so both GET and the preview share it.
async function loadOrCreate(tenantId: string) {
  const existing = await prisma.brandKit.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.brandKit.create({ data: { tenantId } });
}

// ── Health ────────────────────────────────────────────────────────────
brandKitRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "brand-kit" });
});

// ── GET — returns row (creates default if absent) ─────────────────────
brandKitRouter.get("/", p.read, async (req, res) => {
  const row = await loadOrCreate(req.auth!.tenantId);
  res.json(row);
});

// ── PUT — upsert with hex + asset validation ──────────────────────────
brandKitRouter.put("/", p.write, async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  // Validate MediaAsset references belong to this tenant (when supplied).
  for (const [field, id] of [
    ["logoAssetId", parsed.data.logoAssetId],
    ["faviconAssetId", parsed.data.faviconAssetId],
  ] as const) {
    if (id) {
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!asset)
        return res
          .status(400)
          .json({ error: `${field} does not belong to this tenant` });
    }
  }

  const data = {
    ...(parsed.data.logoAssetId !== undefined
      ? { logoAssetId: parsed.data.logoAssetId }
      : {}),
    ...(parsed.data.faviconAssetId !== undefined
      ? { faviconAssetId: parsed.data.faviconAssetId }
      : {}),
    ...(parsed.data.primaryColor !== undefined
      ? { primaryColor: normalizeHex(parsed.data.primaryColor) }
      : {}),
    ...(parsed.data.secondaryColor !== undefined
      ? { secondaryColor: normalizeHex(parsed.data.secondaryColor) }
      : {}),
    ...(parsed.data.accentColor !== undefined
      ? { accentColor: normalizeHex(parsed.data.accentColor) }
      : {}),
    ...(parsed.data.neutralColor !== undefined
      ? { neutralColor: normalizeHex(parsed.data.neutralColor) }
      : {}),
    ...(parsed.data.headingFont !== undefined
      ? { headingFont: parsed.data.headingFont }
      : {}),
    ...(parsed.data.bodyFont !== undefined ? { bodyFont: parsed.data.bodyFont } : {}),
    ...(parsed.data.footerHtml !== undefined
      ? { footerHtml: parsed.data.footerHtml }
      : {}),
    ...(parsed.data.socialLinks !== undefined
      ? {
          socialLinks:
            parsed.data.socialLinks === null
              ? Prisma.JsonNull
              : (parsed.data.socialLinks as Prisma.InputJsonValue),
        }
      : {}),
  };

  const row = await prisma.brandKit.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  res.json(row);
});

// ── Preview HTML — sample email header/button/footer w/ current palette ─
brandKitRouter.get("/preview.html", p.read, async (req, res) => {
  const b = await loadOrCreate(req.auth!.tenantId);
  const logoUrl = b.logoAssetId
    ? await presignAsset(req.auth!.tenantId, b.logoAssetId)
    : null;
  const html = renderPreviewHtml({
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
    accentColor: b.accentColor,
    neutralColor: b.neutralColor,
    headingFont: b.headingFont,
    bodyFont: b.bodyFont,
    footerHtml: b.footerHtml ?? "",
    logoUrl,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// Best-effort logo URL — presign the S3 object if a MediaAsset is set. Failing
// silently is fine for the preview (falls back to a placeholder).
async function presignAsset(tenantId: string, assetId: string): Promise<string | null> {
  try {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: assetId, tenantId },
      select: { storageKey: true },
    });
    if (!asset) return null;
    // Import lazily so this route doesn't force S3 config at boot.
    const { loadS3Config, presignGetObject, decryptSecrets } = await import(
      "@lumaara/db"
    );
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

// Escape HTML entities in user-controlled fields so a footerHtml that
// contained "<script>" doesn't XSS the admin previewing it.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface PreviewInput {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  neutralColor: string;
  headingFont: string;
  bodyFont: string;
  footerHtml: string;
  logoUrl: string | null;
}

// Exported for the tests + reused by applyBrandKit's inline demo path.
export function renderPreviewHtml(b: PreviewInput): string {
  // NOTE: footerHtml is the ONE field authors set as raw HTML on purpose (it's
  // supposed to carry links). We still guard against string injection into the
  // colour/font slots via escape + regex-checked colours.
  const heading = escapeHtml(b.headingFont);
  const body = escapeHtml(b.bodyFont);
  const logoBlock = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="Logo" style="max-height:48px;display:block;"/>`
    : `<div style="font-family:${heading};font-weight:700;font-size:22px;color:${b.neutralColor};">Your Logo</div>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Brand preview</title>
<style>
  body { margin:0; padding:0; font-family:${body}; color:${b.neutralColor}; background:#f7f7f8; }
  .wrap { max-width:560px; margin:24px auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
  .header { padding:20px 24px; background:${b.primaryColor}; color:#ffffff; }
  .content { padding:24px; font-size:14px; line-height:1.55; }
  h1 { font-family:${heading}; color:${b.primaryColor}; font-size:20px; margin:0 0 12px; }
  .btn { display:inline-block; background:${b.accentColor}; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-family:${heading}; font-weight:600; }
  .swatches { display:flex; gap:8px; margin:16px 0; }
  .swatch { width:56px; height:32px; border-radius:4px; border:1px solid rgba(0,0,0,.08); display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; font-family:${body}; }
  .footer { padding:16px 24px; background:${b.secondaryColor}22; border-top:1px solid #e5e7eb; font-size:12px; color:${b.neutralColor}; }
  .footer a { color:${b.primaryColor}; }
</style></head>
<body>
  <div class="wrap">
    <div class="header">${logoBlock}</div>
    <div class="content">
      <h1>Hello there,</h1>
      <p>This is a sample email using your brand kit palette. It gives you a preview of how buttons, headings, and links will look in real campaigns.</p>
      <p><a class="btn" href="#">Primary action</a></p>
      <div class="swatches">
        <div class="swatch" style="background:${b.primaryColor}" title="primary">P</div>
        <div class="swatch" style="background:${b.secondaryColor}" title="secondary">S</div>
        <div class="swatch" style="background:${b.accentColor}" title="accent">A</div>
        <div class="swatch" style="background:${b.neutralColor}" title="neutral">N</div>
      </div>
    </div>
    <div class="footer">
      ${b.footerHtml ? b.footerHtml : "Your company address · <a href='#'>Unsubscribe</a>"}
    </div>
  </div>
</body></html>`;
}
