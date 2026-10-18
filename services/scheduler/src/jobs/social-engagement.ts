// Social-engagement tick — every 30 minutes (opt-in via
// SOCIAL_ENGAGEMENT_ENABLE=1).
//
// Walks published `SocialPostResult` rows within the last 30 days and
// re-fetches impressions/likes/shares/comments/clicks from each
// platform's insights API. Batches at 200 per tick so a big backlog
// drains gradually without wedging the loop. Orders by `lastSyncedAt`
// ASC so the oldest gets picked first — a naturally-fair rotation.
//
// When disabled the tick is a cheap no-op (no DB read) so it's safe to
// register the interval unconditionally.
//
// Failure semantics:
//   * Adapter/network failure on a single row: bump the row's
//     `lastSyncedAt` so it rotates to the tail of the queue, don't
//     otherwise mutate metrics.
//   * Missing credentials (row's account was disconnected): same
//     behavior — bump timestamp, move on.
//   * Structural bug (thrown by the shared helper for a reason other
//     than "provider said no"): logged via recordErr in the scheduler
//     wrapper.

import {
  prisma,
  getSocialAdapter,
  loadSocialCredentials,
  ensureFreshToken,
} from "@lumaara/db";

export interface SocialEngagementResult {
  scanned: number;
  refreshed: number;
  errors: number;
  mode: "on" | "off";
}

const ENABLED = process.env.SOCIAL_ENGAGEMENT_ENABLE === "1";
const WINDOW_DAYS = Number(process.env.SOCIAL_ENGAGEMENT_WINDOW_DAYS ?? 30);
const BATCH_SIZE = Number(process.env.SOCIAL_ENGAGEMENT_BATCH ?? 200);

export async function runSocialEngagementTick(): Promise<SocialEngagementResult> {
  if (!ENABLED) return { scanned: 0, refreshed: 0, errors: 0, mode: "off" };

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.socialPostResult.findMany({
    where: {
      status: "Published",
      publishedAt: { gte: since },
      platformPostId: { not: null },
    },
    include: { account: true },
    orderBy: { lastSyncedAt: "asc" },
    take: BATCH_SIZE,
    // findMany with a nested `account` include bypasses the tenant guard
    // by inference (the account carries the tenantId). We intentionally
    // scan across tenants here — this is a system-level tick, not a
    // per-tenant one.
  });

  let refreshed = 0;
  let errors = 0;
  for (const r of rows) {
    if (!r.platformPostId) continue;
    try {
      const creds = await loadSocialCredentials(
        prisma,
        r.account.tenantId,
        r.account.id,
        r.account.platform,
      );
      if (!creds) throw new Error("No credentials for account");
      const adapter = getSocialAdapter(r.account.platform);
      const fresh = await ensureFreshToken(
        prisma,
        r.account.tenantId,
        r.account.id,
        r.account.platform,
        creds,
        adapter,
      ).catch(() => creds);
      const metrics = await adapter.refreshEngagement(r.platformPostId, {
        id: r.account.id,
        platform: r.account.platform,
        handle: r.account.handle,
        externalId: r.account.externalId,
        credentials: fresh,
      });
      await prisma.socialPostResult.update({
        where: { id: r.id },
        data: {
          impressions: metrics.impressions,
          likes: metrics.likes,
          shares: metrics.shares,
          comments: metrics.comments,
          clicks: metrics.clicks,
          lastSyncedAt: new Date(),
        },
      });
      refreshed++;
    } catch {
      errors++;
      // Rotate to the tail of the queue so we don't retry-loop on a
      // permanently-broken account within a single tick.
      await prisma.socialPostResult
        .update({ where: { id: r.id }, data: { lastSyncedAt: new Date() } })
        .catch(() => {});
    }
  }

  return { scanned: rows.length, refreshed, errors, mode: "on" };
}
