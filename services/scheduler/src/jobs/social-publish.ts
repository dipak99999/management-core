// Social-publish tick — runs every 60s in the scheduler service.
//
// Behavior:
//   * When SOCIAL_PUBLISH_ENABLE=1 → real publish path. Walks
//     `SocialPost` rows where status="Scheduled" AND scheduledFor <= now,
//     takes up to 50, and calls the platform adapters (LinkedIn / FB /
//     IG / X) via the shared `publishPostReal` helper duplicated in the
//     crm-service route. To avoid a cross-service HTTP fan-out we
//     re-implement the same loop here against the direct Prisma client,
//     the same pattern recurring-invoices + email-sequences already use.
//   * When SOCIAL_PUBLISH_ENABLE is unset → mock publish (existing MVP
//     behavior) so demo tenants and CI keep working without provisioning
//     platform apps. The mock generates plausible engagement numbers so
//     the calendar view has content.
//
// Failure semantics:
//   * Per-channel exceptions are caught inside `publishPostReal`; the
//     enclosing loop only sees a boolean result. If EVERY channel fails
//     we mark the Post Failed with the joined error message; partial
//     failure ⇒ Post is Published with `failureReason` set for the
//     failing channels (operators can retry via the UI).

import {
  prisma,
  getSocialAdapter,
  loadSocialCredentials,
  ensureFreshToken,
  encryptSecrets,
} from "@lumaara/db";

export interface SocialTickResult {
  processed: number;
  published: number;
  failed: number;
  mode: "mock" | "real";
}

const REAL_MODE = process.env.SOCIAL_PUBLISH_ENABLE === "1";

export async function runSocialPublishTick(): Promise<SocialTickResult> {
  const now = new Date();
  const due = await prisma.socialPost.findMany({
    where: { status: "Scheduled", scheduledFor: { lte: now } },
    include: { results: { include: { account: true } } },
    take: 50,
  });

  let published = 0;
  let failed = 0;
  for (const post of due) {
    try {
      if (REAL_MODE) {
        const r = await realPublishOne(post);
        if (r === "Published") published++;
        else failed++;
      } else {
        await mockPublishOne(post, now);
        published++;
      }
    } catch (e) {
      failed++;
      await prisma.socialPost.update({
        where: { id: post.id },
        data: {
          status: "Failed",
          failureReason: e instanceof Error ? e.message.slice(0, 300) : "Publish error",
        },
      }).catch(() => {});
    }
  }
  return { processed: due.length, published, failed, mode: REAL_MODE ? "real" : "mock" };
}

// -------------------------------------------------------------------------
// Real path
// -------------------------------------------------------------------------

type PostWithResults = Awaited<ReturnType<typeof prisma.socialPost.findMany>>[number] & {
  results: Array<{
    id: string;
    accountId: string;
    status: string;
    account: {
      id: string;
      tenantId: string;
      platform: string;
      handle: string;
      externalId: string | null;
    };
  }>;
};

async function realPublishOne(post: PostWithResults): Promise<"Published" | "Failed"> {
  await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: "Publishing" },
  });

  const now = new Date();
  let publishedCount = 0;
  const failures: string[] = [];

  for (const r of post.results) {
    if (r.status === "Published") {
      publishedCount++;
      continue;
    }
    try {
      const creds = await loadSocialCredentials(
        prisma,
        r.account.tenantId,
        r.account.id,
        r.account.platform,
      );
      if (!creds) throw new Error(`No OAuth credentials for ${r.account.platform} account`);
      const adapter = getSocialAdapter(r.account.platform);
      const fresh = await ensureFreshToken(
        prisma,
        r.account.tenantId,
        r.account.id,
        r.account.platform,
        creds,
        adapter,
      ).catch(() => creds);

      const pubRes = await adapter.publish({
        content: post.content,
        mediaUrls: post.mediaUrls,
        linkUrl: post.linkUrl,
        account: {
          id: r.account.id,
          platform: r.account.platform,
          handle: r.account.handle,
          externalId: r.account.externalId,
          credentials: fresh,
        },
      });
      await prisma.socialPostResult.update({
        where: { id: r.id },
        data: {
          status: "Published",
          publishedAt: now,
          platformPostId: pubRes.platformPostId,
          error: null,
          lastSyncedAt: now,
        },
      });
      publishedCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
      failures.push(`${r.account.platform}: ${msg}`);
      await prisma.socialPostResult.update({
        where: { id: r.id },
        data: {
          status: "Failed",
          error: msg,
          lastSyncedAt: now,
        },
      });
    }
  }

  const finalStatus: "Published" | "Failed" = publishedCount > 0 ? "Published" : "Failed";
  await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      status: finalStatus,
      publishedAt: publishedCount > 0 ? now : null,
      failureReason: failures.length ? failures.join(" | ").slice(0, 1000) : null,
    },
  });
  return finalStatus;
}

// -------------------------------------------------------------------------
// Mock path (retained for the pre-OAuth demo tenants and CI)
// -------------------------------------------------------------------------

// Hard safety gate — never fabricate engagement data in production.
// The mock mode is for CI + local demo tenants only. In prod the operator
// must set SOCIAL_PUBLISH_ENABLE=1 and wire real adapters.
const ALLOW_MOCK_ENGAGEMENT =
  process.env.NODE_ENV !== "production" ||
  process.env.ALLOW_FAKE_SOCIAL_METRICS === "1";

async function mockPublishOne(post: PostWithResults, now: Date): Promise<void> {
  await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: "Publishing" },
  });
  for (const r of post.results) {
    const scale =
      r.account.platform === "Twitter" ? 500 :
      r.account.platform === "LinkedIn" ? 300 :
      r.account.platform === "Instagram" ? 800 :
      r.account.platform === "Facebook" ? 1000 :
      100;
    // In prod (unless explicitly opted in) write nulls so the UI shows
    // "— no data" instead of fake analytics the user might report on.
    // Schema declares these engagement counters as non-nullable Int with
    // default 0 — never write null. When mock engagement is off, we leave
    // the counters at their stored value (default 0) by not spreading
    // anything into the update.
    const metrics = ALLOW_MOCK_ENGAGEMENT
      ? {
          impressions: Math.floor(Math.random() * scale) + scale / 5,
          likes:    Math.floor((Math.floor(Math.random() * scale) + scale / 5) * (0.02 + Math.random() * 0.05)),
          shares:   Math.floor((Math.floor(Math.random() * scale) + scale / 5) * (0.005 + Math.random() * 0.015)),
          comments: Math.floor((Math.floor(Math.random() * scale) + scale / 5) * (0.003 + Math.random() * 0.01)),
          clicks:   Math.floor((Math.floor(Math.random() * scale) + scale / 5) * (0.01 + Math.random() * 0.03)),
        }
      : {};
    await prisma.socialPostResult.update({
      where: { id: r.id },
      data: {
        status: "Published",
        publishedAt: now,
        platformPostId: `mock_${r.account.platform}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        ...metrics,
        lastSyncedAt: now,
      },
    });
  }
  await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: "Published", publishedAt: now },
  });
}

// eslint-plain: `encryptSecrets` is imported for the (future) case when we
// need to update the SocialAccount's own token store — currently handled
// inside `ensureFreshToken` in @lumaara/db, but we keep the import here so
// the file compiles standalone if someone wires an inline refresh path.
void encryptSecrets;
