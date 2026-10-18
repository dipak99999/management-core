import { Router } from "express";
import { z } from "zod";
import { prisma, runAiInboxScan } from "@lumaara/db";

const INBOX_CATEGORIES = ["Revenue", "AR", "Pipeline", "Cash", "Inventory", "HR", "Operations"] as const;
const SEVERITIES = ["info", "watch", "critical"] as const;

// AI Inbox — the proactive-insight stream populated by the scheduler.
// This router is read + simple-mutation only; the generator logic lives
// in packages/db/src/ai-inbox-generators.ts.
//
// Routes:
//   GET  /ai/inbox?filter=open|all&limit=50  — list (newest first)
//   GET  /ai/inbox/unread-count              — small badge payload
//   POST /ai/inbox/scan                      — trigger scan now (admin)
//   POST /ai/inbox/:id/acknowledge           — mark acknowledged
//   POST /ai/inbox/:id/dismiss               — soft-hide for ?days=7

export const aiInboxRouter = Router();

aiInboxRouter.get("/inbox", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const filter = typeof req.query.filter === "string" ? req.query.filter : "open";
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

  // Load user prefs for the category mute list. A missing row = default
  // (nothing muted). Keep it a single lookup inside the same request so
  // the inbox always reflects the user's current preferences.
  const prefs = await prisma.aiInboxPreference.findUnique({ where: { userId } });
  const muted = prefs?.mutedCategories ?? [];

  const where: Record<string, unknown> = { tenantId };
  if (muted.length > 0) where.category = { notIn: muted };
  if (filter !== "all") {
    const now = new Date();
    where.acknowledgedAt = null;
    where.OR = [
      { dismissedUntil: null },
      { dismissedUntil: { lt: now } },
    ];
  }
  const rows = await prisma.aiInsightInbox.findMany({
    where,
    orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
    take: limit,
  });
  res.json(rows);
});

aiInboxRouter.get("/inbox/unread-count", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const now = new Date();
  const prefs = await prisma.aiInboxPreference.findUnique({ where: { userId } });
  const muted = prefs?.mutedCategories ?? [];
  const base: Record<string, unknown> = {
    tenantId,
    acknowledgedAt: null,
    OR: [{ dismissedUntil: null }, { dismissedUntil: { lt: now } }],
  };
  if (muted.length > 0) base.category = { notIn: muted };
  const [open, critical] = await Promise.all([
    prisma.aiInsightInbox.count({ where: base }),
    prisma.aiInsightInbox.count({ where: { ...base, severity: "critical" } }),
  ]);
  res.json({ open, critical });
});

// ── Per-user preferences ──────────────────────────────────────────────

aiInboxRouter.get("/inbox/preferences", async (req, res) => {
  const userId = req.auth!.userId;
  const row = await prisma.aiInboxPreference.findUnique({ where: { userId } });
  res.json({
    mutedCategories: row?.mutedCategories ?? [],
    dailyDigest: row?.dailyDigest ?? false,
    digestMinSeverity: row?.digestMinSeverity ?? "watch",
    categoryFrequency: (row?.categoryFrequency as Record<string, string> | null) ?? {},
    webhookUrl: row?.webhookUrl ?? null,
    webhookType: row?.webhookType ?? null,
    availableCategories: INBOX_CATEGORIES,
  });
});

const CATEGORY_FREQS = ["daily", "weekly", "never"] as const;
const prefsSchema = z.object({
  mutedCategories: z.array(z.enum(INBOX_CATEGORIES)).max(INBOX_CATEGORIES.length).optional(),
  dailyDigest: z.boolean().optional(),
  digestMinSeverity: z.enum(SEVERITIES).optional(),
  categoryFrequency: z.record(z.enum(INBOX_CATEGORIES), z.enum(CATEGORY_FREQS)).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  webhookType: z.enum(["slack", "teams", "generic"]).nullable().optional(),
});

aiInboxRouter.put("/inbox/preferences", async (req, res) => {
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const d = parsed.data;
  const row = await prisma.aiInboxPreference.upsert({
    where: { userId },
    update: {
      ...(d.mutedCategories   !== undefined ? { mutedCategories:   d.mutedCategories } : {}),
      ...(d.dailyDigest       !== undefined ? { dailyDigest:       d.dailyDigest } : {}),
      ...(d.digestMinSeverity !== undefined ? { digestMinSeverity: d.digestMinSeverity } : {}),
      ...(d.categoryFrequency !== undefined ? { categoryFrequency: d.categoryFrequency as object } : {}),
      ...(d.webhookUrl        !== undefined ? { webhookUrl:        d.webhookUrl } : {}),
      ...(d.webhookType       !== undefined ? { webhookType:       d.webhookType } : {}),
    },
    create: {
      tenantId,
      userId,
      mutedCategories:   d.mutedCategories ?? [],
      dailyDigest:       d.dailyDigest ?? false,
      digestMinSeverity: d.digestMinSeverity ?? "watch",
      categoryFrequency: (d.categoryFrequency as object) ?? undefined,
      webhookUrl:        d.webhookUrl ?? null,
      webhookType:       d.webhookType ?? null,
    },
  });
  res.json({
    mutedCategories: row.mutedCategories,
    dailyDigest: row.dailyDigest,
    digestMinSeverity: row.digestMinSeverity,
    categoryFrequency: row.categoryFrequency ?? {},
    webhookUrl: row.webhookUrl,
    webhookType: row.webhookType,
    availableCategories: INBOX_CATEGORIES,
  });
});

// Tenant-level inbox config (currently just the LLM prompt override).
// Requires admin — reuses the AgentTask perms since this governs AI
// agent behavior and we don't want a regular user editing the prompt
// that drives system-wide findings.
import { perms } from "@lumaara/service-auth";
const pAdmin = perms("AgentTask");

aiInboxRouter.get("/inbox/tenant-config", pAdmin.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.aiInboxTenantConfig.findUnique({ where: { tenantId } });
  res.json({ llmSystemPrompt: row?.llmSystemPrompt ?? null });
});

const tenantConfigSchema = z.object({
  llmSystemPrompt: z.string().min(0).max(10_000).nullable(),
});

aiInboxRouter.put("/inbox/tenant-config", pAdmin.submit, async (req, res) => {
  const parsed = tenantConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const row = await prisma.aiInboxTenantConfig.upsert({
    where: { tenantId },
    update: { llmSystemPrompt: parsed.data.llmSystemPrompt },
    create: { tenantId, llmSystemPrompt: parsed.data.llmSystemPrompt },
  });
  res.json({ llmSystemPrompt: row.llmSystemPrompt });
});

aiInboxRouter.post("/inbox/scan", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  // No perm gate — any logged-in user can trigger a scan for their own
  // tenant. Scan is read-mostly against the tenant's own data.
  const r = await runAiInboxScan(tenantId);
  res.json(r);
});

aiInboxRouter.post("/inbox/:id/acknowledge", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.aiInsightInbox.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.aiInsightInbox.update({
    where: { id: row.id },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedBy: req.auth!.email ?? null,
    },
  });
  res.json(updated);
});

aiInboxRouter.post("/inbox/:id/dismiss", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const days = Math.min(90, Math.max(1, parseInt(String(req.body?.days ?? "7"), 10) || 7));
  const row = await prisma.aiInsightInbox.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.aiInsightInbox.update({
    where: { id: row.id },
    data: {
      dismissedAt: new Date(),
      dismissedBy: req.auth!.email ?? null,
      dismissedUntil: new Date(Date.now() + days * 86_400_000),
    },
  });
  res.json(updated);
});
