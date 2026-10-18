import { Router } from "express";
import { z } from "zod";
import { prisma, getSocialAdapter } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import { loadAccountWithFreshCreds } from "./social-oauth";
import { checkApprovalRequired } from "./approvals";

// Zoho-Social-style. All-JWT (no public surface). Routes:
//
//   Accounts:
//     GET/POST/PUT/DELETE /social/accounts
//   Posts:
//     GET  /social/posts?status=&channelId=&search=      list
//     GET  /social/posts/calendar?from=&to=              feed for the calendar view
//     GET  /social/posts/stats                           counts per status
//     POST /social/posts                                 create draft
//     GET  /social/posts/:id                             detail + per-channel results
//     PUT  /social/posts/:id                             update (draft-only edits)
//     POST /social/posts/:id/schedule  body: { scheduledFor }
//     POST /social/posts/:id/publish-now                 mock publish now
//     POST /social/posts/:id/unschedule                  back to Draft
//     DELETE /social/posts/:id
//   Monitors:
//     GET/POST/PUT/DELETE /social/monitors
//     POST /social/monitors/:id/generate-mock-mention    (for demo)
//   Mentions:
//     GET  /social/mentions?sentiment=&keyword=
//     POST /social/mentions/:id/mark-replied
//   Scheduler tick:
//     runSocialPublishTick()  — MOCK: marks Scheduled+due posts as Published

export const socialRouter = Router();
const pA = perms("SocialAccount");
const pP = perms("SocialPost");
const pM = perms("SocialMonitor");
const pMn = perms("SocialMention");

const PLATFORMS = [
  "Twitter", "Facebook", "Instagram", "LinkedIn",
  "GoogleMyBusiness", "YouTube",
] as const;

// ─── Accounts ─────────────────────────────────────────────────────────

const accountSchema = z.object({
  platform: z.enum(PLATFORMS),
  handle: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

socialRouter.get("/accounts", pA.read, async (req, res) => {
  const rows = await prisma.socialAccount.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { addedAt: "desc" },
  });
  res.json(rows);
});

socialRouter.post("/accounts", pA.create, async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  try {
    const row = await prisma.socialAccount.create({
      data: {
        tenantId: req.auth!.tenantId,
        platform: d.platform,
        handle: d.handle,
        displayName: d.displayName,
        avatarUrl: d.avatarUrl ?? null,
        externalId: d.externalId ?? null,
        isActive: d.isActive ?? true,
        addedByUserId: req.auth!.userId,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Account with that platform + handle already exists" });
    throw e;
  }
});

socialRouter.put("/accounts/:id", pA.write, async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.socialAccount.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.socialAccount.update({
    where: { id: existing.id },
    data: {
      platform: parsed.data.platform,
      handle: parsed.data.handle,
      displayName: parsed.data.displayName,
      avatarUrl: parsed.data.avatarUrl ?? null,
      externalId: parsed.data.externalId ?? null,
      isActive: parsed.data.isActive ?? existing.isActive,
    },
  });
  res.json(row);
});

socialRouter.delete("/accounts/:id", pA.delete, async (req, res) => {
  await prisma.socialAccount.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ─── Posts ────────────────────────────────────────────────────────────

const postSchema = z.object({
  content: z.string().min(1),
  mediaUrls: z.array(z.string()).optional(),
  linkUrl: z.string().nullable().optional(),
  channelIds: z.array(z.string()).min(1),
  scheduledFor: z.string().datetime().nullable().optional(),
});

socialRouter.get("/posts", pP.read, async (req, res) => {
  const { status, channelId, search } = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
  if (status) where.status = status;
  if (channelId) where.channelIds = { has: channelId };
  if (search) where.content = { contains: search, mode: "insensitive" };
  const rows = await prisma.socialPost.findMany({
    where,
    include: { results: { include: { account: { select: { platform: true, handle: true } } } } },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json(rows);
});

socialRouter.get("/posts/calendar", pP.read, async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  const to = req.query.to
    ? new Date(String(req.query.to))
    : new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.socialPost.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      OR: [
        { scheduledFor: { gte: from, lte: to } },
        { publishedAt: { gte: from, lte: to } },
      ],
    },
    include: { results: { select: { accountId: true } } },
    orderBy: { scheduledFor: "asc" },
  });
  res.json(rows);
});

socialRouter.get("/posts/stats", pP.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [drafts, scheduled, published, failed, thisWeek] = await Promise.all([
    prisma.socialPost.count({ where: { tenantId, status: "Draft" } }),
    prisma.socialPost.count({ where: { tenantId, status: "Scheduled" } }),
    prisma.socialPost.count({ where: { tenantId, status: "Published" } }),
    prisma.socialPost.count({ where: { tenantId, status: "Failed" } }),
    prisma.socialPost.count({
      where: {
        tenantId,
        publishedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  res.json({ drafts, scheduled, published, failed, publishedLast7d: thisWeek });
});

socialRouter.get("/posts/:id", pP.read, async (req, res) => {
  const row = await prisma.socialPost.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { results: { include: { account: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

socialRouter.post("/posts", pP.create, async (req, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  // Validate the channel ids belong to this tenant.
  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: d.channelIds }, tenantId: req.auth!.tenantId, isActive: true },
    select: { id: true },
  });
  if (accounts.length !== d.channelIds.length)
    return res.status(400).json({ error: "One or more channel ids are invalid" });

  const post = await prisma.socialPost.create({
    data: {
      tenantId: req.auth!.tenantId,
      authorUserId: req.auth!.userId,
      content: d.content,
      mediaUrls: d.mediaUrls ?? [],
      linkUrl: d.linkUrl ?? null,
      channelIds: d.channelIds,
      status: d.scheduledFor ? "Scheduled" : "Draft",
      scheduledFor: d.scheduledFor ? new Date(d.scheduledFor) : null,
      results: {
        create: d.channelIds.map((accountId) => ({ accountId })),
      },
    },
    include: { results: { include: { account: true } } },
  });
  res.status(201).json(post);
});

socialRouter.put("/posts/:id", pP.write, async (req, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.socialPost.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft" && existing.status !== "Scheduled")
    return res.status(400).json({ error: "Can only edit Draft or Scheduled posts" });
  const d = parsed.data;

  // Rebuild results if channels change.
  const post = await prisma.$transaction(async (tx) => {
    const channelsChanged =
      d.channelIds.length !== existing.channelIds.length ||
      d.channelIds.some((c) => !existing.channelIds.includes(c));
    if (channelsChanged) {
      await tx.socialPostResult.deleteMany({ where: { postId: existing.id } });
    }
    return tx.socialPost.update({
      where: { id: existing.id },
      data: {
        content: d.content,
        mediaUrls: d.mediaUrls ?? existing.mediaUrls,
        linkUrl: d.linkUrl ?? existing.linkUrl,
        channelIds: d.channelIds,
        scheduledFor: d.scheduledFor === undefined
          ? existing.scheduledFor
          : d.scheduledFor === null ? null : new Date(d.scheduledFor),
        status: d.scheduledFor
          ? "Scheduled"
          : existing.scheduledFor && !d.scheduledFor ? "Draft" : existing.status,
        ...(channelsChanged && {
          results: {
            create: d.channelIds.map((accountId) => ({ accountId })),
          },
        }),
      },
      include: { results: { include: { account: true } } },
    });
  });
  res.json(post);
});

socialRouter.post("/posts/:id/schedule", pP.write, async (req, res) => {
  const parsed = z
    .object({ scheduledFor: z.string().datetime() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "scheduledFor required" });
  // P3: gate scheduling behind the approval check when the tenant demands it.
  const gate = await checkApprovalRequired(
    prisma,
    req.auth!.tenantId,
    "SocialPost",
    req.params.id,
  );
  if (!gate.ok) {
    return res.status(409).json({ error: gate.reason, needsApproval: true });
  }
  const row = await prisma.socialPost.updateMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId, status: { in: ["Draft", "Scheduled"] } },
    data: { status: "Scheduled", scheduledFor: new Date(parsed.data.scheduledFor) },
  });
  res.json({ ok: true, updated: row.count });
});

socialRouter.post("/posts/:id/unschedule", pP.write, async (req, res) => {
  const row = await prisma.socialPost.updateMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId, status: "Scheduled" },
    data: { status: "Draft", scheduledFor: null },
  });
  res.json({ ok: true, updated: row.count });
});

socialRouter.post("/posts/:id/publish-now", pP.write, async (req, res) => {
  const post = await prisma.socialPost.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { results: { include: { account: true } } },
  });
  if (!post) return res.status(404).json({ error: "Not found" });
  if (post.status === "Published") return res.status(400).json({ error: "Already published" });
  // P3 approval gate — before any publish work happens.
  const gate = await checkApprovalRequired(prisma, req.auth!.tenantId, "SocialPost", post.id);
  if (!gate.ok) {
    return res.status(409).json({ error: gate.reason, needsApproval: true });
  }
  await mockPublishPost(post.id);
  const fresh = await prisma.socialPost.findUnique({
    where: { id: post.id },
    include: { results: { include: { account: true } } },
  });
  res.json(fresh);
});

// Real publish — walks each channel, calls the platform adapter, records
// per-channel status. Rolls up to Post.status=Published (all succeeded),
// Failed (all failed), or leaves Publishing (partial). This is the endpoint
// the scheduler tick calls too.
socialRouter.post("/posts/:id/publish", pP.write, async (req, res) => {
  const post = await prisma.socialPost.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!post) return res.status(404).json({ error: "Not found" });
  if (post.status === "Published") return res.status(400).json({ error: "Already published" });
  // P3 approval gate for the real publish path too.
  const gate = await checkApprovalRequired(prisma, req.auth!.tenantId, "SocialPost", post.id);
  if (!gate.ok) {
    return res.status(409).json({ error: gate.reason, needsApproval: true });
  }
  const result = await publishPostReal(post.id, req.auth!.tenantId);
  const fresh = await prisma.socialPost.findUnique({
    where: { id: post.id },
    include: { results: { include: { account: true } } },
  });
  res.json({ ...result, post: fresh });
});

// Batch: publish all Scheduled posts whose scheduledFor <= now. Callable
// via HTTP fan-out from the scheduler; safe to call directly too (idempotent
// — posts already Publishing/Published are skipped). Caps at 50 to bound
// request duration.
socialRouter.post("/posts/process", pP.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const now = new Date();
  const due = await prisma.socialPost.findMany({
    where: { tenantId, status: "Scheduled", scheduledFor: { lte: now } },
    select: { id: true },
    take: 50,
    orderBy: { scheduledFor: "asc" },
  });
  let published = 0;
  let failed = 0;
  let skippedForApproval = 0;
  const errors: string[] = [];
  for (const p of due) {
    try {
      // P3 approval gate — skip + mark Failed rather than silently pass over
      // so the failure surfaces in the "Failed" filter of the social inbox.
      const gate = await checkApprovalRequired(prisma, tenantId, "SocialPost", p.id);
      if (!gate.ok) {
        skippedForApproval++;
        await prisma.socialPost.update({
          where: { id: p.id },
          data: { status: "Failed", failureReason: gate.reason ?? "Requires approval" },
        }).catch(() => {});
        continue;
      }
      const r = await publishPostReal(p.id, tenantId);
      if (r.status === "Published") published++;
      else if (r.status === "Failed") failed++;
    } catch (e) {
      failed++;
      errors.push(e instanceof Error ? e.message.slice(0, 200) : String(e));
    }
  }
  res.json({ processed: due.length, published, failed, skippedForApproval, errors });
});

socialRouter.delete("/posts/:id", pP.delete, async (req, res) => {
  await prisma.socialPost.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ─── Monitors ─────────────────────────────────────────────────────────

const monitorSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["Keyword", "Hashtag", "Mention"]),
  query: z.string().min(1),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  isActive: z.boolean().optional(),
});

socialRouter.get("/monitors", pM.read, async (req, res) => {
  const rows = await prisma.socialMonitor.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

socialRouter.post("/monitors", pM.create, async (req, res) => {
  const parsed = monitorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.socialMonitor.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        type: parsed.data.type,
        query: parsed.data.query,
        platforms: parsed.data.platforms,
        isActive: parsed.data.isActive ?? true,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Monitor name taken" });
    throw e;
  }
});

socialRouter.put("/monitors/:id", pM.write, async (req, res) => {
  const parsed = monitorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.socialMonitor.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.socialMonitor.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      query: parsed.data.query,
      platforms: parsed.data.platforms,
      isActive: parsed.data.isActive ?? existing.isActive,
    },
  });
  res.json(row);
});

socialRouter.delete("/monitors/:id", pM.delete, async (req, res) => {
  await prisma.socialMonitor.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// Demo-only: create a mock mention row so the inbox has content without a
// real platform poller. Handy for screencasts.
socialRouter.post("/monitors/:id/generate-mock-mention", pM.write, async (req, res) => {
  const m = await prisma.socialMonitor.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!m) return res.status(404).json({ error: "Not found" });
  const platform = m.platforms[Math.floor(Math.random() * m.platforms.length)] ?? "Twitter";
  const sentiments = ["Positive", "Neutral", "Negative"] as const;
  const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)]!;
  const samples = {
    Positive: `Just tried ${m.query} and it's fantastic! Highly recommend 👏`,
    Neutral: `Anyone using ${m.query}? Curious about your experience.`,
    Negative: `Frustrated with ${m.query} today — support hasn't gotten back to me.`,
  };
  const row = await prisma.socialMention.create({
    data: {
      tenantId: req.auth!.tenantId,
      platform,
      externalId: `demo_${Date.now()}`,
      authorHandle: `@user_${Math.floor(Math.random() * 10000)}`,
      authorName: "Demo User",
      content: samples[sentiment],
      postedAt: new Date(),
      keyword: m.query,
      sentiment,
    },
  });
  res.status(201).json(row);
});

// ─── Mentions inbox ───────────────────────────────────────────────────

socialRouter.get("/mentions", pMn.read, async (req, res) => {
  const { sentiment, keyword, platform, unreplied } = req.query as Record<string, string | undefined>;
  const rows = await prisma.socialMention.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(sentiment ? { sentiment } : {}),
      ...(keyword ? { keyword } : {}),
      ...(platform ? { platform } : {}),
      ...(unreplied === "1" ? { isReplied: false } : {}),
    },
    orderBy: { postedAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

socialRouter.post("/mentions/:id/mark-replied", pMn.write, async (req, res) => {
  const row = await prisma.socialMention.updateMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    data: { isReplied: true },
  });
  res.json({ ok: true, updated: row.count });
});

// ─── Mock publisher ──────────────────────────────────────────────────

// Called by the scheduler tick for every Scheduled post whose scheduledFor
// has passed, AND by the /publish-now action. Real integration would call
// each platform's SDK here; MVP fakes it by generating plausible analytics
// per channel and marking everything Published.
async function mockPublishPost(postId: string): Promise<void> {
  await prisma.socialPost.update({
    where: { id: postId },
    data: { status: "Publishing" },
  });
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { results: { include: { account: true } } },
  });
  if (!post) return;

  const now = new Date();
  for (const r of post.results) {
    // Random plausible metrics scaled by platform reach.
    const scale =
      r.account.platform === "Twitter" ? 500 :
      r.account.platform === "LinkedIn" ? 300 :
      r.account.platform === "Instagram" ? 800 :
      r.account.platform === "Facebook" ? 1000 :
      100;
    const impressions = Math.floor(Math.random() * scale) + scale / 5;
    const likes  = Math.floor(impressions * (0.02 + Math.random() * 0.05));
    const shares = Math.floor(impressions * (0.005 + Math.random() * 0.015));
    const comments = Math.floor(impressions * (0.003 + Math.random() * 0.01));
    const clicks   = Math.floor(impressions * (0.01 + Math.random() * 0.03));
    await prisma.socialPostResult.update({
      where: { id: r.id },
      data: {
        status: "Published",
        publishedAt: now,
        platformPostId: `mock_${r.account.platform}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        impressions, likes, shares, comments, clicks,
        lastSyncedAt: now,
      },
    });
  }

  await prisma.socialPost.update({
    where: { id: postId },
    data: { status: "Published", publishedAt: now },
  });
}

// Scheduler entry point — walks Scheduled posts whose scheduledFor <= now,
// mock-publishes each. Callable from scheduler service via HTTP or wrapped
// as a direct-DB job.
// P3: honours per-tenant Tenant.requireMarketingApproval. A post that made
// it to Scheduled BEFORE the tenant flipped the flag will simply skip its
// publish tick with a failure reason ("Requires approval") — this leaves it
// discoverable in the failed feed rather than silently stuck.
export async function runSocialPublishTick(): Promise<{
  processed: number;
  published: number;
  failed: number;
  skippedForApproval: number;
}> {
  const due = await prisma.socialPost.findMany({
    where: { status: "Scheduled", scheduledFor: { lte: new Date() } },
    select: { id: true, tenantId: true },
    take: 200,
  });
  let published = 0;
  let failed = 0;
  let skippedForApproval = 0;
  for (const p of due) {
    try {
      const gate = await checkApprovalRequired(prisma, p.tenantId, "SocialPost", p.id);
      if (!gate.ok) {
        skippedForApproval++;
        await prisma.socialPost.update({
          where: { id: p.id },
          data: { status: "Failed", failureReason: gate.reason ?? "Requires approval" },
        }).catch(() => {});
        continue;
      }
      await mockPublishPost(p.id);
      published++;
    } catch {
      failed++;
      await prisma.socialPost.update({
        where: { id: p.id },
        data: { status: "Failed", failureReason: "Mock publisher error" },
      }).catch(() => {});
    }
  }
  return { processed: due.length, published, failed, skippedForApproval };
}

// ─── Real publisher (uses adapters) ──────────────────────────────────
//
// Called by /publish, /publish-now (opt-in via env), and the scheduler
// tick when SOCIAL_PUBLISH_ENABLE=1.
//
// State machine:
//   Post: (Draft|Scheduled) → Publishing → Published | Failed
//   Result: Pending → Published | Failed  (one row per channel)
//
// Per-channel failures leave the *other* channels' results intact. If
// EVERY channel fails, the Post is marked Failed with the joined error
// strings as failureReason. Partial failure ⇒ Post stays Published (some
// channels succeeded) but failureReason is set to the failing platform +
// message so operators can retry the individual channel.
export async function publishPostReal(
  postId: string,
  tenantId: string,
): Promise<{ status: "Published" | "Failed"; publishedCount: number; failedCount: number }> {
  const post = await prisma.socialPost.findFirst({
    where: { id: postId, tenantId },
    include: { results: { include: { account: true } } },
  });
  if (!post) throw new Error("Post not found");

  await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: "Publishing" },
  });

  const now = new Date();
  let publishedCount = 0;
  let failedCount = 0;
  const failureMessages: string[] = [];

  for (const r of post.results) {
    if (r.status === "Published") {
      publishedCount++;
      continue;
    }
    try {
      const loaded = await loadAccountWithFreshCreds(tenantId, r.accountId);
      if (!loaded) {
        throw new Error(`No OAuth credentials on file for ${r.account.platform} account`);
      }
      const adapter = getSocialAdapter(loaded.account.platform);
      const pubRes = await adapter.publish({
        content: post.content,
        mediaUrls: post.mediaUrls,
        linkUrl: post.linkUrl,
        account: {
          id: loaded.account.id,
          platform: loaded.account.platform,
          handle: loaded.account.handle,
          externalId: loaded.account.externalId,
          credentials: loaded.credentials,
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
      failureMessages.push(`${r.account.platform}: ${msg}`);
      failedCount++;
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

  // Roll-up rule: if any channel published, the Post is Published. Only
  // when *every* channel failed do we mark the Post as Failed.
  const finalStatus: "Published" | "Failed" =
    publishedCount > 0 ? "Published" : "Failed";
  await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      status: finalStatus,
      publishedAt: publishedCount > 0 ? now : null,
      failureReason: failureMessages.length ? failureMessages.join(" | ").slice(0, 1000) : null,
    },
  });

  return { status: finalStatus, publishedCount, failedCount };
}

// ─── Real engagement refresher ────────────────────────────────────────
//
// Called by the /engagement/refresh endpoint + the scheduler engagement
// tick. Walks every SocialPostResult that has a platformPostId + was
// published within `windowDays` and pulls current counters into the row.
// A failure per-account is logged but never bubbles — a dead account
// shouldn't stop the rest of the refresh.
export async function refreshEngagementBatch(
  tenantId: string,
  windowDays = 30,
  limit = 100,
): Promise<{ scanned: number; refreshed: number; errors: number }> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.socialPostResult.findMany({
    where: {
      status: "Published",
      publishedAt: { gte: since },
      platformPostId: { not: null },
      account: { tenantId },
    },
    include: { account: true },
    take: limit,
    orderBy: { lastSyncedAt: "asc" },
  });

  let refreshed = 0;
  let errors = 0;
  for (const r of rows) {
    if (!r.platformPostId) continue;
    try {
      const loaded = await loadAccountWithFreshCreds(tenantId, r.accountId);
      if (!loaded) throw new Error("No credentials on account");
      const adapter = getSocialAdapter(loaded.account.platform);
      const metrics = await adapter.refreshEngagement(r.platformPostId, {
        id: loaded.account.id,
        platform: loaded.account.platform,
        handle: loaded.account.handle,
        externalId: loaded.account.externalId,
        credentials: loaded.credentials,
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
      // Bump lastSyncedAt so the failing row rotates to the end of the
      // queue on the next tick — otherwise a permanently broken row would
      // hog the batch.
      await prisma.socialPostResult
        .update({ where: { id: r.id }, data: { lastSyncedAt: new Date() } })
        .catch(() => {});
    }
  }
  return { scanned: rows.length, refreshed, errors };
}
