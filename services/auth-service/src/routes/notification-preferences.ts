import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// F6: Per-user notification preferences by (category × channel). Rows are
// upserted; absent = default (inapp: on, email/sms: off).

export const notificationPreferenceRouter = Router();
notificationPreferenceRouter.use(requireAuth);

const p = perms("NotificationPreference");

const CATEGORIES = ["workflow", "mentions", "digests", "direct", "updates", "broadcast"] as const;
const CHANNELS = ["inapp", "email", "sms"] as const;

const upsertSchema = z.object({
  category: z.enum(CATEGORIES),
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
});

// Get *current user's* preferences. Missing rows are backfilled with defaults
// so the UI always renders a complete grid.
notificationPreferenceRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.notificationPreference.findMany({
    where: { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
  });
  const map = new Map(rows.map((r) => [`${r.category}::${r.channel}`, r.enabled]));
  const grid = CATEGORIES.flatMap((c) =>
    CHANNELS.map((ch) => ({
      category: c,
      channel: ch,
      enabled: map.get(`${c}::${ch}`) ?? ch === "inapp",
    })),
  );
  res.json(grid);
});

notificationPreferenceRouter.post("/", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const row = await prisma.notificationPreference.upsert({
    where: {
      tenantId_userId_category_channel: {
        tenantId,
        userId,
        category: parsed.data.category,
        channel: parsed.data.channel,
      },
    },
    update: { enabled: parsed.data.enabled },
    create: {
      tenantId,
      userId,
      category: parsed.data.category,
      channel: parsed.data.channel,
      enabled: parsed.data.enabled,
    },
  });
  res.json(row);
});
