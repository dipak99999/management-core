// Marketing P1 — link wrapping + open-pixel injection for outbound email.
//
// Design constraints:
//   * We can't drag in a full HTML parser (cheerio/parse5) for the email
//     pipeline — it's overkill and the payload sizes are small. A resilient
//     regex-based rewrite is sufficient for the shapes campaign editors + our
//     own templates produce (see tests for the concrete cases we cover).
//   * We MUST NOT touch anchors that already point at our tracker (double-wrap
//     produces broken URLs when the base64 payload gets re-encoded) and MUST
//     honor `data-notrack="1"` (unsubscribe links, legal disclaimers, "view in
//     browser" archive link — anything routed through our own domain).
//   * We MUST tolerate malformed input — a stray `<a href=...>` without
//     matching `</a>` should not throw. If we can't wrap it, we leave it alone.
//   * `mailto:`, `tel:`, `#anchor`, `javascript:` and any non-http(s) scheme
//     are left untouched — tracking them either makes no sense or is a XSS
//     surface.
//
// Endpoints on the receiving side:
//   GET /email/track/open/:trackingId.png     — 1×1 pixel + TrackingEvent(Open)
//   GET /email/track/click/:trackingId?url=…  — 302 redirect + TrackingEvent(Click)
//
// The `url` query parameter is the click target, base64url-encoded so it
// survives arbitrary characters (query-strings, fragments) inside the raw
// href without double-escaping.

export interface WrapOptions {
  trackingId: string;
  baseUrl: string; // e.g. "https://app.opennext.com" — no trailing slash needed
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// Matches an entire <a ...>…</a> element up to the closing tag. Non-greedy on
// both attributes and inner content so nested markup doesn't merge two links.
// The `s` flag lets `.` cross newlines (email HTML is often minified but
// occasionally wrapped).
const ANCHOR_RE = /<a\b([^>]*)>/gi;

// Extract the `href="..."` (or single-quoted / unquoted) value from an
// attribute blob. Returns { value, quote, start, end } or null.
interface HrefMatch {
  value: string;
  quote: '"' | "'" | "";
  start: number; // index in attr blob
  end: number;   // exclusive
}

function extractHref(attrs: string): HrefMatch | null {
  // Double-quoted
  let m = /\shref\s*=\s*"([^"]*)"/i.exec(attrs);
  if (m) {
    const start = m.index + m[0].indexOf('"') + 1;
    return { value: m[1], quote: '"', start, end: start + m[1].length };
  }
  // Single-quoted
  m = /\shref\s*=\s*'([^']*)'/i.exec(attrs);
  if (m) {
    const start = m.index + m[0].indexOf("'") + 1;
    return { value: m[1], quote: "'", start, end: start + m[1].length };
  }
  // Unquoted — value runs until whitespace or `>`. Rare in real templates but
  // technically valid HTML.
  m = /\shref\s*=\s*([^\s>]+)/i.exec(attrs);
  if (m) {
    const eq = attrs.indexOf("=", m.index);
    const start = eq + 1;
    // Skip any leading whitespace we accidentally captured.
    let s = start;
    while (s < attrs.length && /\s/.test(attrs[s])) s++;
    return { value: m[1], quote: "", start: s, end: s + m[1].length };
  }
  return null;
}

function hasNotrack(attrs: string): boolean {
  return /\sdata-notrack\s*=\s*['"]?1['"]?/i.test(attrs);
}

function isTrackableUrl(url: string, baseUrl: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  // Already wrapped — check if it already points at our tracker.
  const base = stripTrailingSlash(baseUrl);
  if (url.startsWith(`${base}/email/track/click/`)) return false;
  if (url.startsWith(`${base}/email/track/open/`)) return false;
  return true;
}

function buildClickUrl(rawHref: string, opts: WrapOptions): string {
  const base = stripTrailingSlash(opts.baseUrl);
  const encoded = base64UrlEncode(rawHref);
  return `${base}/email/track/click/${encodeURIComponent(opts.trackingId)}?url=${encoded}`;
}

function buildPixelTag(opts: WrapOptions): string {
  const base = stripTrailingSlash(opts.baseUrl);
  const src = `${base}/email/track/open/${encodeURIComponent(opts.trackingId)}.png`;
  return `<img src="${src}" width="1" height="1" alt="" style="display:none">`;
}

/**
 * Rewrite every `<a href="http(s)://…">` in `html` to a click-tracked URL and
 * append a 1×1 open-pixel just before the closing `</body>` (or at the very
 * end when there is no body tag).
 *
 * Skips:
 *   * anchors with `data-notrack="1"` (or `data-notrack='1'`)
 *   * non-http(s) schemes (mailto, tel, javascript, #anchor, …)
 *   * anchors already pointing at our tracker (idempotent — safe to call twice)
 *   * anchors with no href attribute at all
 */
export function wrapLinksAndInjectPixel(html: string, opts: WrapOptions): string {
  if (!opts.trackingId) return html;
  if (typeof html !== "string" || html.length === 0) {
    return `${html ?? ""}${buildPixelTag(opts)}`;
  }

  // 1) Rewrite anchors.
  const rewritten = html.replace(ANCHOR_RE, (full, attrs: string) => {
    try {
      if (hasNotrack(attrs)) return full;
      const href = extractHref(attrs);
      if (!href) return full;
      if (!isTrackableUrl(href.value, opts.baseUrl)) return full;
      const newHref = buildClickUrl(href.value, opts);
      // Splice the new value back into the attr blob preserving surrounding
      // whitespace + the quote style the author used.
      const q = href.quote;
      const before = attrs.slice(0, href.start);
      const after = attrs.slice(href.end);
      const rebuilt =
        q === ""
          ? `${before}"${newHref}"${after}` // upgrade unquoted → quoted for safety
          : `${before}${newHref}${after}`;
      return `<a${rebuilt}>`;
    } catch {
      // Tolerate anything weird — leave the anchor untouched.
      return full;
    }
  });

  // 2) Inject open pixel. Prefer just before </body>, fall back to appending.
  const pixel = buildPixelTag(opts);
  const bodyCloseRe = /<\/body\s*>/i;
  if (bodyCloseRe.test(rewritten)) {
    return rewritten.replace(bodyCloseRe, (m) => `${pixel}${m}`);
  }
  return `${rewritten}${pixel}`;
}

/**
 * Reverse of `wrapLinksAndInjectPixel` for preview endpoints — strips the
 * open pixel and unwraps click-tracking anchors back to their raw targets.
 * Best-effort; malformed URLs are left as-is rather than throwing.
 */
export function unwrapForPreview(html: string): string {
  if (typeof html !== "string" || html.length === 0) return html ?? "";

  // 1) Remove open pixels — anything matching /email/track/open/.../.png.
  let out = html.replace(
    /<img[^>]*\/email\/track\/open\/[^>]*>/gi,
    "",
  );

  // 2) Unwrap click URLs. Match hrefs of shape .../email/track/click/<id>?url=<b64>.
  out = out.replace(
    /\shref\s*=\s*(['"])([^'"]*\/email\/track\/click\/[^'"?]+\?url=([A-Za-z0-9_-]+)[^'"]*)\1/gi,
    (_full, quote: string, _url: string, encoded: string) => {
      try {
        const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
        const decoded = Buffer.from(b64 + pad, "base64").toString("utf8");
        return ` href=${quote}${decoded}${quote}`;
      } catch {
        return _full;
      }
    },
  );

  // 3) Unquoted variant — best effort.
  out = out.replace(
    /\shref\s*=\s*([^\s>'"]*\/email\/track\/click\/[^\s>'"?]+\?url=([A-Za-z0-9_-]+)[^\s>'"]*)/gi,
    (_full, _url: string, encoded: string) => {
      try {
        const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
        const decoded = Buffer.from(b64 + pad, "base64").toString("utf8");
        return ` href="${decoded}"`;
      } catch {
        return _full;
      }
    },
  );

  return out;
}
