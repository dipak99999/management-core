import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

// Zoho-Cliq-style internal chat. Auth: JWT (no perms gate — every user in
// the tenant may DM anyone else and browse Public channels).
//
// Endpoints:
//   Channels
//     GET  /cliq/channels                      → my channels (DMs + joined Public/Private)
//     GET  /cliq/channels/browse               → all Public channels I can join
//     POST /cliq/channels                      body { type: "Public"|"Private", name, description?, memberUserIds? }
//     POST /cliq/channels/dm                   body { userId } → creates or returns the DM
//     GET  /cliq/channels/:id                  → detail + members hydrated
//     POST /cliq/channels/:id/join             → self-join Public
//     POST /cliq/channels/:id/leave
//     POST /cliq/channels/:id/add-member       body { userId }
//     POST /cliq/channels/:id/mark-read        → sets lastReadAt = now for me
//   Messages
//     GET  /cliq/channels/:id/messages?after=<msgId>&limit=  paged newest-first
//     GET  /cliq/messages/:id/thread            replies to this message
//     POST /cliq/channels/:id/messages          body { body, threadParentId? }
//     PATCH /cliq/messages/:id                  body { body } (author only)
//     DELETE /cliq/messages/:id                 soft-delete → tombstone
//   Reactions
//     POST /cliq/messages/:id/react             body { emoji }
//     POST /cliq/messages/:id/unreact           body { emoji }
//   Unread counts
//     GET  /cliq/unread                         → per-channel unread count + last-msg-preview
//   Users (thin proxy, so the UI doesn't need to know about the auth-service)
//     GET  /cliq/users                          → tenant user list for pickers

export const cliqRouter = Router();

// Helper — is the current caller a member of this channel?
async function assertMember(channelId: string, userId: string): Promise<boolean> {
  const m = await prisma.cliqChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  return !!m;
}

// Hydrate: for a Direct channel, replace `name` with the OTHER user's name
// so the sidebar reads naturally.
async function hydrateChannel(
  channel: {
    id: string; type: string; name: string; description: string | null;
  },
  currentUserId: string,
) {
  if (channel.type !== "Direct") return channel;
  const members = await prisma.cliqChannelMember.findMany({
    where: { channelId: channel.id },
  });
  const other = members.find((m) => m.userId !== currentUserId);
  if (!other) return channel;
  const u = await prisma.user.findUnique({
    where: { id: other.userId },
    select: { email: true, fullName: true },
  });
  return {
    ...channel,
    name: u?.fullName || u?.email || "Direct message",
    otherUserId: other.userId,
    otherUserEmail: u?.email ?? null,
  };
}

// ─── Users (thin proxy so the chat UI has a picker) ───────────────────

cliqRouter.get("/users", requireAuth, async (req, res) => {
  const rows = await prisma.user.findMany({
    where: { tenantId: req.auth!.tenantId },
    select: { id: true, email: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });
  res.json(rows);
});

// ─── Channels ─────────────────────────────────────────────────────────

cliqRouter.get("/channels", requireAuth, async (req, res) => {
  const memberships = await prisma.cliqChannelMember.findMany({
    where: { userId: req.auth!.userId },
    include: { channel: true },
    orderBy: [{ isPinned: "desc" }, { joinedAt: "desc" }],
  });
  const channels = await Promise.all(
    memberships.map(async (m) => {
      const hydrated = await hydrateChannel(m.channel, req.auth!.userId);
      // Compute unread count.
      const unread = await prisma.cliqMessage.count({
        where: {
          channelId: m.channelId,
          deletedAt: null,
          senderUserId: { not: req.auth!.userId },
          ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
        },
      });
      const lastMessage = await prisma.cliqMessage.findFirst({
        where: { channelId: m.channelId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      return {
        ...hydrated,
        joinedAt: m.joinedAt,
        lastReadAt: m.lastReadAt,
        isPinned: m.isPinned,
        isMuted: m.isMuted,
        unread,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              body: lastMessage.body.slice(0, 120),
              senderName: lastMessage.senderName,
              createdAt: lastMessage.createdAt,
            }
          : null,
      };
    }),
  );
  res.json(channels);
});

cliqRouter.get("/channels/browse", requireAuth, async (req, res) => {
  const rows = await prisma.cliqChannel.findMany({
    where: { tenantId: req.auth!.tenantId, type: "Public" },
    orderBy: { name: "asc" },
  });
  const joined = await prisma.cliqChannelMember.findMany({
    where: { userId: req.auth!.userId, channel: { tenantId: req.auth!.tenantId } },
    select: { channelId: true },
  });
  const joinedSet = new Set(joined.map((j) => j.channelId));
  res.json(
    await Promise.all(
      rows.map(async (c) => ({
        ...c,
        memberCount: await prisma.cliqChannelMember.count({ where: { channelId: c.id } }),
        joined: joinedSet.has(c.id),
      })),
    ),
  );
});

cliqRouter.post("/channels", requireAuth, async (req, res) => {
  const parsed = z
    .object({
      type: z.enum(["Public", "Private"]),
      name: z.string().min(1).regex(/^[a-z0-9-]+$/i, "letters, numbers, and dashes only"),
      description: z.string().nullable().optional(),
      memberUserIds: z.array(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const memberIds = new Set(parsed.data.memberUserIds ?? []);
    memberIds.add(req.auth!.userId); // creator is always a member
    const channel = await prisma.cliqChannel.create({
      data: {
        tenantId: req.auth!.tenantId,
        type: parsed.data.type,
        name: parsed.data.name.toLowerCase(),
        description: parsed.data.description ?? null,
        createdByUserId: req.auth!.userId,
        members: {
          create: [...memberIds].map((uid) => ({ userId: uid })),
        },
      },
    });
    res.status(201).json(channel);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Channel name taken" });
    throw e;
  }
});

// Idempotent DM helper — creates a Direct channel between the caller and
// `userId` if one doesn't exist, otherwise returns the existing.
cliqRouter.post("/channels/dm", requireAuth, async (req, res) => {
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "userId required" });
  if (parsed.data.userId === req.auth!.userId)
    return res.status(400).json({ error: "Cannot DM yourself" });
  const other = await prisma.user.findFirst({
    where: { id: parsed.data.userId, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!other) return res.status(404).json({ error: "User not found" });

  // Find existing DM between the two users.
  const existing = await prisma.cliqChannel.findFirst({
    where: {
      tenantId: req.auth!.tenantId,
      type: "Direct",
      members: {
        every: { userId: { in: [req.auth!.userId, parsed.data.userId] } },
      },
    },
    include: { members: true },
  });
  const isMatch = existing && existing.members.length === 2 &&
    existing.members.some((m) => m.userId === req.auth!.userId) &&
    existing.members.some((m) => m.userId === parsed.data.userId);

  if (isMatch) {
    return res.json({ ...(await hydrateChannel(existing!, req.auth!.userId)), created: false });
  }

  // Create fresh. Direct-channel names are just the sorted pair for
  // uniqueness — the display name is computed at read-time.
  const nameKey = [req.auth!.userId, parsed.data.userId].sort().join(":");
  const created = await prisma.cliqChannel.create({
    data: {
      tenantId: req.auth!.tenantId,
      type: "Direct",
      name: nameKey,
      createdByUserId: req.auth!.userId,
      members: {
        create: [{ userId: req.auth!.userId }, { userId: parsed.data.userId }],
      },
    },
  });
  res.status(201).json({ ...(await hydrateChannel(created, req.auth!.userId)), created: true });
});

cliqRouter.get("/channels/:id", requireAuth, async (req, res) => {
  const c = await prisma.cliqChannel.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { members: true },
  });
  if (!c) return res.status(404).json({ error: "Not found" });
  // Only members can view Private/Direct. Public is public.
  if (c.type !== "Public") {
    const isMember = c.members.some((m) => m.userId === req.auth!.userId);
    if (!isMember) return res.status(403).json({ error: "Not a member" });
  }
  const memberUsers = await prisma.user.findMany({
    where: { id: { in: c.members.map((m) => m.userId) } },
    select: { id: true, email: true, fullName: true },
  });
  const hydrated = await hydrateChannel(c, req.auth!.userId);
  res.json({ ...hydrated, members: memberUsers });
});

cliqRouter.post("/channels/:id/join", requireAuth, async (req, res) => {
  const c = await prisma.cliqChannel.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!c) return res.status(404).json({ error: "Not found" });
  if (c.type !== "Public") return res.status(403).json({ error: "Cannot self-join" });
  await prisma.cliqChannelMember.upsert({
    where: { channelId_userId: { channelId: c.id, userId: req.auth!.userId } },
    create: { channelId: c.id, userId: req.auth!.userId },
    update: {},
  });
  res.json({ ok: true });
});

cliqRouter.post("/channels/:id/leave", requireAuth, async (req, res) => {
  await prisma.cliqChannelMember.deleteMany({
    where: { channelId: req.params.id, userId: req.auth!.userId },
  });
  res.json({ ok: true });
});

cliqRouter.post("/channels/:id/add-member", requireAuth, async (req, res) => {
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "userId required" });
  const c = await prisma.cliqChannel.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!c) return res.status(404).json({ error: "Not found" });
  if (c.type === "Direct") return res.status(400).json({ error: "Cannot add to a DM" });
  if (!(await assertMember(c.id, req.auth!.userId)))
    return res.status(403).json({ error: "You're not a member" });
  await prisma.cliqChannelMember.upsert({
    where: { channelId_userId: { channelId: c.id, userId: parsed.data.userId } },
    create: { channelId: c.id, userId: parsed.data.userId },
    update: {},
  });
  res.json({ ok: true });
});

cliqRouter.post("/channels/:id/mark-read", requireAuth, async (req, res) => {
  await prisma.cliqChannelMember.updateMany({
    where: { channelId: req.params.id, userId: req.auth!.userId },
    data: { lastReadAt: new Date() },
  });
  res.json({ ok: true });
});

// ─── Messages ─────────────────────────────────────────────────────────

cliqRouter.get("/channels/:id/messages", requireAuth, async (req, res) => {
  const c = await prisma.cliqChannel.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!c) return res.status(404).json({ error: "Not found" });
  if (c.type !== "Public" && !(await assertMember(c.id, req.auth!.userId)))
    return res.status(403).json({ error: "Not a member" });

  const after = typeof req.query.after === "string" ? req.query.after : null;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const rows = await prisma.cliqMessage.findMany({
    where: {
      channelId: c.id,
      threadParentId: null,
      ...(after ? { id: { gt: after } } : {}),
    },
    include: {
      reactions: true,
      _count: { select: { threadReplies: true } },
    },
    orderBy: { createdAt: after ? "asc" : "desc" },
    take: limit,
  });
  res.json(rows.map((m) => ({
    ...m,
    // Group reactions for the UI: [{ emoji, count, userIds }]
    reactionSummary: summarizeReactions(m.reactions),
    threadReplyCount: m._count.threadReplies,
  })));
});

cliqRouter.get("/messages/:id/thread", requireAuth, async (req, res) => {
  const parent = await prisma.cliqMessage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      reactions: true,
      threadReplies: {
        include: { reactions: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!parent) return res.status(404).json({ error: "Not found" });
  const channel = await prisma.cliqChannel.findUnique({ where: { id: parent.channelId } });
  if (channel && channel.type !== "Public" && !(await assertMember(channel.id, req.auth!.userId)))
    return res.status(403).json({ error: "Not a member" });
  res.json({
    parent: {
      ...parent,
      reactionSummary: summarizeReactions(parent.reactions),
    },
    replies: parent.threadReplies.map((r) => ({
      ...r,
      reactionSummary: summarizeReactions(r.reactions),
    })),
  });
});

cliqRouter.post("/channels/:id/messages", requireAuth, async (req, res) => {
  const parsed = z
    .object({
      body: z.string().min(1),
      threadParentId: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const c = await prisma.cliqChannel.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!c) return res.status(404).json({ error: "Not found" });
  if (c.type !== "Public" && !(await assertMember(c.id, req.auth!.userId)))
    return res.status(403).json({ error: "Not a member" });

  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { email: true, fullName: true },
  });
  const senderName = user?.fullName || user?.email || "Unknown";

  const msg = await prisma.cliqMessage.create({
    data: {
      tenantId: req.auth!.tenantId,
      channelId: c.id,
      senderUserId: req.auth!.userId,
      senderName,
      body: parsed.data.body,
      threadParentId: parsed.data.threadParentId ?? null,
    },
    include: { reactions: true },
  });
  // Sender has seen their own message — bump lastReadAt.
  await prisma.cliqChannelMember.updateMany({
    where: { channelId: c.id, userId: req.auth!.userId },
    data: { lastReadAt: new Date() },
  });
  res.status(201).json({ ...msg, reactionSummary: [] });
});

cliqRouter.patch("/messages/:id", requireAuth, async (req, res) => {
  const parsed = z.object({ body: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "body required" });
  const m = await prisma.cliqMessage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.senderUserId !== req.auth!.userId)
    return res.status(403).json({ error: "Only the author can edit" });
  const updated = await prisma.cliqMessage.update({
    where: { id: m.id },
    data: { body: parsed.data.body, editedAt: new Date() },
  });
  res.json(updated);
});

cliqRouter.delete("/messages/:id", requireAuth, async (req, res) => {
  const m = await prisma.cliqMessage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.senderUserId !== req.auth!.userId)
    return res.status(403).json({ error: "Only the author can delete" });
  await prisma.cliqMessage.update({
    where: { id: m.id },
    data: { deletedAt: new Date(), body: "[deleted]" },
  });
  res.json({ ok: true });
});

// ─── Reactions ───────────────────────────────────────────────────────

cliqRouter.post("/messages/:id/react", requireAuth, async (req, res) => {
  const parsed = z.object({ emoji: z.string().min(1).max(16) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "emoji required" });
  const m = await prisma.cliqMessage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!m) return res.status(404).json({ error: "Not found" });
  await prisma.cliqReaction.upsert({
    where: {
      messageId_userId_emoji: {
        messageId: m.id, userId: req.auth!.userId, emoji: parsed.data.emoji,
      },
    },
    create: { messageId: m.id, userId: req.auth!.userId, emoji: parsed.data.emoji },
    update: {},
  });
  res.json({ ok: true });
});

cliqRouter.post("/messages/:id/unreact", requireAuth, async (req, res) => {
  const parsed = z.object({ emoji: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "emoji required" });
  await prisma.cliqReaction.deleteMany({
    where: {
      messageId: req.params.id,
      userId: req.auth!.userId,
      emoji: parsed.data.emoji,
    },
  });
  res.json({ ok: true });
});

// ─── Unread counts ───────────────────────────────────────────────────

cliqRouter.get("/unread", requireAuth, async (req, res) => {
  const memberships = await prisma.cliqChannelMember.findMany({
    where: { userId: req.auth!.userId },
    select: { channelId: true, lastReadAt: true },
  });
  const counts = await Promise.all(
    memberships.map(async (m) => ({
      channelId: m.channelId,
      unread: await prisma.cliqMessage.count({
        where: {
          channelId: m.channelId,
          deletedAt: null,
          senderUserId: { not: req.auth!.userId },
          ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
        },
      }),
    })),
  );
  const total = counts.reduce((s, c) => s + c.unread, 0);
  res.json({ total, byChannel: counts });
});

// ─── Helpers ─────────────────────────────────────────────────────────

function summarizeReactions(rows: { emoji: string; userId: string }[]): Array<{ emoji: string; count: number; userIds: string[] }> {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.emoji) ?? [];
    arr.push(r.userId);
    map.set(r.emoji, arr);
  }
  return [...map.entries()].map(([emoji, userIds]) => ({
    emoji, count: userIds.length, userIds,
  }));
}
