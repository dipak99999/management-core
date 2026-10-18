import { Router } from "express";
import { prisma, withCrossTenant } from "@lumaara/db";

// Public campaign archive — read-only permalink for a campaign whose
// archiveEnabled=true. URL shape: GET /a/:slug → renders campaign.bodyHtml.
//
// Why cross-tenant: this endpoint is unauthenticated (no JWT, no tenant
// context on req.auth). The lookup is by `archiveSlug` which is globally
// unique across all tenants (see schema.prisma — `@unique` on the column),
// so `withCrossTenant` is safe here — we can never accidentally return
// another tenant's row for the same slug.
//
// Rendering rules (see marketing plan P1 batch 7):
//   - Substitute recipient-personalization tokens with public-safe defaults
//     (empty string) BEFORE any tenant-defined merge vars, so leaked tokens
//     don't render `Hello John` for a random public viewer.
//   - Strip the tracking pixel entirely — archive views must not inflate
//     open/click counts for the original campaign send.
//   - Unwrap `/email/track/click/…?url=<b64>` links back to the original
//     URL so archive readers don't get redirect-bounced through our tracker.
//   - Set Cache-Control: 1h (archive content is immutable enough).
//   - Set X-Robots-Tag: noindex,nofollow (tenants must opt in explicitly
//     before we let search engines crawl their campaigns).

export const campaignArchiveRouter = Router();

// Keep the pre-existing health check — it's used by the CRM service startup
// smoke-test in /tmp/lumaara-crm-service.log.
campaignArchiveRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "archive" });
});

// --- pure helpers (exported for tests) -----------------------------------

// Substitutes the mandatory public-preview tokens. Case-insensitive on the
// token name; tolerant of internal whitespace (matches renderTemplate style
// used elsewhere in the codebase, see comm-render.ts).
const PUBLIC_TOKEN_DEFAULTS: Record<string, string> = {
  email: "",
  first_name: "",
  last_name: "",
  unsubscribe_url: "#",
  tracking_pixel: "",
};

export function substitutePublicTokens(html: string): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, keyRaw: string) => {
    const key = keyRaw.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PUBLIC_TOKEN_DEFAULTS, key)) {
      return PUBLIC_TOKEN_DEFAULTS[key];
    }
    // Leave unknown tokens alone — tenants may render their own merge vars
    // in a follow-up pipeline (or they may be intentional literal-braces
    // content the user put in the body).
    return match;
  });
}

// Unwraps `/email/track/click/<trackingId>?url=<base64>` back to the target
// URL, wherever it appears — as a full URL, a protocol-relative URL, or a
// site-relative path. This runs on href="..." AND raw text (some archive
// readers strip anchor tags), so we match the substring not just anchors.
//
// Base64 decoding is best-effort — if it doesn't decode to something that
// looks like a URL we leave the wrapper in place (safer than emitting
// garbage). We accept the URL-safe (base64url) variant too.
// Host prefix (optional) uses a NON-slash character class so the greedy
// match doesn't swallow the `/email/track/click/...` path we need to anchor
// against. Base64 chars allow both standard (+ /) and URL-safe (- _) alphabets;
// trailing = padding is accepted.
const CLICK_WRAP_RE =
  /(?:https?:\/\/[^/\s"'<>]+)?\/email\/track\/click\/[a-zA-Z0-9_-]+\?url=([A-Za-z0-9+/=_-]+)/g;

export function unwrapTrackedLinks(html: string): string {
  return html.replace(CLICK_WRAP_RE, (match, b64: string) => {
    try {
      // Normalize base64url → base64 before decoding.
      const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(normalized, "base64").toString("utf8");
      // Sanity-check: must at least start with http(s), mailto, tel, or "/".
      if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(decoded)) {
        return decoded;
      }
    } catch {
      // fallthrough — return original match
    }
    return match;
  });
}

// Composes the final archive HTML. Pure function so it's covered by unit
// tests without booting Express.
export function renderArchiveHtml(bodyHtml: string): string {
  const commented =
    "<!-- Archived campaign — publicly accessible view. Do not share for marketing purposes. -->\n";
  const substituted = substitutePublicTokens(bodyHtml);
  const unwrapped = unwrapTrackedLinks(substituted);
  return commented + unwrapped;
}

// The 404 page — deliberately plain (no branding assets, no CSS bundle)
// because this route is public and served with a 1h cache; we don't want to
// pull in per-tenant chrome for a not-found. Same body regardless of whether
// the slug is genuinely missing or the archive was disabled — no info leak.
export function notFoundHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>Campaign not available</title>",
    '<meta name="robots" content="noindex,nofollow">',
    "<style>",
    "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;",
    "background:#f7f7f8;color:#222;display:flex;align-items:center;",
    "justify-content:center;min-height:100vh;margin:0}",
    ".card{background:#fff;padding:2.5rem 3rem;border-radius:12px;",
    "box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:28rem;text-align:center}",
    "h1{font-size:1.25rem;margin:0 0 .5rem;font-weight:600}",
    "p{margin:0;color:#666;font-size:.95rem;line-height:1.5}",
    "</style>",
    "</head>",
    "<body>",
    '<div class="card">',
    "<h1>This campaign is not available</h1>",
    "<p>The link may have expired, or the archive is no longer public.</p>",
    "</div>",
    "</body>",
    "</html>",
  ].join("");
}

// --- route handlers ------------------------------------------------------

// GET /a/:slug.json — JSON metadata + raw body for reader integrations.
// Must be registered BEFORE the HTML :slug route so Express doesn't consume
// the ".json" suffix into the slug param.
campaignArchiveRouter.get("/:slug.json", async (req, res) => {
  const slug = req.params.slug;
  const row = await prisma.campaign.findFirst(
    withCrossTenant({
      where: { archiveSlug: slug },
      select: {
        name: true,
        subject: true,
        sentAt: true,
        bodyHtml: true,
        archiveEnabled: true,
      },
    }),
  );
  if (!row || !row.archiveEnabled) {
    return res.status(404).json({ error: "Not available" });
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.json({
    name: row.name,
    subject: row.subject,
    sentAt: row.sentAt,
    // Campaign doesn't currently have a separate publishedAt column — sentAt
    // is the moment it went out, which is what a reader wants. Kept as a
    // distinct field so the shape is stable if we ever split them.
    publishedAt: row.sentAt,
    bodyHtml: row.bodyHtml ?? "",
  });
});

// GET /a/:slug — HTML archive view.
campaignArchiveRouter.get("/:slug", async (req, res) => {
  const slug = req.params.slug;
  const row = await prisma.campaign.findFirst(
    withCrossTenant({
      where: { archiveSlug: slug },
      select: {
        bodyHtml: true,
        archiveEnabled: true,
      },
    }),
  );

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (!row || !row.archiveEnabled) {
    // No cache on 404s — a tenant may enable archive shortly after; we don't
    // want stale-not-found sticking in intermediaries for an hour.
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send(notFoundHtml());
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(renderArchiveHtml(row.bodyHtml ?? ""));
});
