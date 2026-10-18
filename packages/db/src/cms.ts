// CMS pure helpers — slug normalisation and publish-timestamp stamping.
// Kept here (not in the routes) so vitest can exercise them without a DB.
//
// Used by services/crm-service/src/routes/web-pages.ts and blog-posts.ts.

/**
 * Normalise a free-form name into a URL-safe slug.
 *   "About Us!"        → "about-us"
 *   "  hello  world  " → "hello-world"
 *   "café"             → "caf"   (non-ASCII stripped; author can override)
 * Capped at 60 chars to keep URLs sensible.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Decide the value of publishedAt on a create or update.
 *
 * Behaviour:
 *   - On create with isPublished=true → stamp now.
 *   - On create with isPublished=false → null.
 *   - On update from Draft → Published, IF the doc has never been published
 *     before → stamp now. Otherwise leave existing publishedAt intact
 *     (unpublish + republish keeps the original "first published" date).
 *   - On update from Published → Draft → leave existing publishedAt (never
 *     clear; preserves the historical anchor for sitemap / RSS).
 */
export function resolvePublishedAt(
  existingPublishedAt: Date | null,
  incomingIsPublished: boolean,
  now: Date = new Date(),
): Date | null {
  if (!incomingIsPublished) return existingPublishedAt;
  if (existingPublishedAt) return existingPublishedAt;
  return now;
}

/**
 * Publish-gate check used by every /public read endpoint. Extracted so we
 * can't accidentally serve a Draft page from a new endpoint without going
 * through the same check. Returns a type predicate so callers can access
 * the row's fields inside the `if (isPubliclyReadable(row)) { … }` branch
 * without a null-assertion.
 */
export function isPubliclyReadable<T extends { isPublished: boolean }>(
  row: T | null,
): row is T {
  return !!row && row.isPublished;
}
