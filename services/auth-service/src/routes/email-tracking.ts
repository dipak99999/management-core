import { Router } from "express";
import { Prisma, prisma, recordTouchpoint } from "@lumaara/db";
import { requireAuth } from "../middleware/require-auth";

// Public email tracking — no auth for pixel/click. Called by user's email client:
//
//   GET /email/track/open/:trackingId.png
//     Returns a 1×1 transparent GIF and bumps the recipient's openedAt +
//     openCount. First open also bumps campaign.totalOpened. Also writes a
//     TrackingEvent row for the per-open timeline.
//
//   GET /email/track/click/:trackingId?url=<encoded>
//     Bumps clickedAt + clickCount, then 302's to the target URL. If url is
//     missing we bounce to /. Also writes a TrackingEvent row.
//
// Both lookups now cover two paths:
//   1. CampaignRecipient.trackingId (campaign send) — bumps rolled-up counters
//      + writes a TrackingEvent with campaignId + recipientId set.
//   2. EmailMessage.trackingId (transactional opt-in via trackingEnabled=true) —
//      no counter bump (there is no campaign) but still writes a TrackingEvent
//      with emailMessageId set.
//
// The trackingId is opaque and per-recipient (not the recipient id) so the
// URL is safe to expose. Never log the URL as-is in audit — it's the
// recipient's inbox link.
//
// Admin read endpoint:
//   GET /email/track/events?campaignId=&recipientId=&emailMessageId=&type=&limit=
//     Tenant-scoped, requireAuth. Backs the admin marketing "tracking events"
//     table.

export const emailTrackingRouter = Router();

// 1×1 transparent GIF — the standard "web bug" byte sequence.
const PIXEL_GIF = Buffer.from(
  "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b",
  "hex",
);

// Best-effort AttributionTouchpoint write. Sibling to recordTrackingEvent so
// each campaign open/click also feeds the revenue-attribution engine.
// Skipped when we lack contactType/contactId (transactional EmailMessage
// path has no campaignRecipient linkage).
async function recordAttributionTouchpoint(input: {
  tenantId: string;
  type: "Open" | "Click";
  campaignId: string | null;
  contactType: string | null;
  contactId: string | null;
}): Promise<void> {
  if (!input.campaignId || !input.contactType || !input.contactId) return;
  try {
    await recordTouchpoint(prisma, {
      tenantId: input.tenantId,
      contactType: input.contactType,
      contactId: input.contactId,
      sourceType: "Campaign",
      sourceId: input.campaignId,
      event: input.type,
    });
  } catch (err) {
    console.warn(
      `[email-tracking] AttributionTouchpoint write failed type=${input.type} ` +
        `tenant=${input.tenantId} campaign=${input.campaignId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
  }
}

// Best-effort TrackingEvent write. Failures are logged but never thrown — the
// pixel / redirect response must not depend on this succeeding.
async function recordTrackingEvent(input: {
  tenantId: string;
  type: "Open" | "Click";
  campaignId?: string | null;
  recipientId?: string | null;
  emailMessageId?: string | null;
  targetUrl?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.trackingEvent.create({
      data: {
        tenantId: input.tenantId,
        type: input.type,
        campaignId: input.campaignId ?? null,
        recipientId: input.recipientId ?? null,
        emailMessageId: input.emailMessageId ?? null,
        targetUrl: input.targetUrl ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    // Never fail the caller — but ops needs visibility. Do NOT swallow silently.
    console.warn(
      `[email-tracking] TrackingEvent write failed type=${input.type} ` +
        `tenant=${input.tenantId} campaign=${input.campaignId ?? "-"} ` +
        `recipient=${input.recipientId ?? "-"} message=${input.emailMessageId ?? "-"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
  }
}

emailTrackingRouter.get("/open/:trackingId.png", async (req, res) => {
  const ip = req.ip ?? null;
  const userAgent = req.get("user-agent") ?? null;
  try {
    // Match either "abc.png" or "abc" prefix — Express already strips the
    // .png suffix in the param when the route pattern includes it.
    const tid = req.params.trackingId;

    // Path 1: campaign recipient
    const rec = await prisma.campaignRecipient.findUnique({
      where: { trackingId: tid },
    });
    if (rec) {
      const isFirst = !rec.openedAt;
      await prisma.campaignRecipient.update({
        where: { id: rec.id },
        data: {
          openedAt: rec.openedAt ?? new Date(),
          openCount: { increment: 1 },
        },
      });
      if (isFirst) {
        await prisma.campaign
          .update({
            where: { id: rec.campaignId },
            data: { totalOpened: { increment: 1 } },
          })
          .catch(() => {});
      }
      await recordTrackingEvent({
        tenantId: rec.tenantId,
        type: "Open",
        campaignId: rec.campaignId,
        recipientId: rec.id,
        ip,
        userAgent,
      });
      // Marketing P3 — sibling AttributionTouchpoint write so campaign opens
      // feed revenue attribution.
      await recordAttributionTouchpoint({
        tenantId: rec.tenantId,
        type: "Open",
        campaignId: rec.campaignId,
        contactType: rec.contactType,
        contactId: rec.contactId,
      });
    } else {
      // Path 2: transactional EmailMessage
      const msg = await prisma.emailMessage.findUnique({
        where: { trackingId: tid },
      });
      if (msg) {
        await recordTrackingEvent({
          tenantId: msg.tenantId,
          type: "Open",
          emailMessageId: msg.id,
          ip,
          userAgent,
        });
      }
    }
  } catch {
    // Never fail the pixel — the whole point is silent tracking.
  }
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.status(200).send(PIXEL_GIF);
});

emailTrackingRouter.get("/click/:trackingId", async (req, res) => {
  const rawTarget = typeof req.query.url === "string" ? req.query.url : null;
  const target = rawTarget ?? "/";
  const ip = req.ip ?? null;
  const userAgent = req.get("user-agent") ?? null;
  try {
    const tid = req.params.trackingId;

    // Path 1: campaign recipient
    const rec = await prisma.campaignRecipient.findUnique({
      where: { trackingId: tid },
    });
    if (rec) {
      const isFirst = !rec.clickedAt;
      await prisma.campaignRecipient.update({
        where: { id: rec.id },
        data: {
          clickedAt: rec.clickedAt ?? new Date(),
          clickCount: { increment: 1 },
        },
      });
      if (isFirst) {
        await prisma.campaign
          .update({
            where: { id: rec.campaignId },
            data: { totalClicked: { increment: 1 } },
          })
          .catch(() => {});
      }
      await recordTrackingEvent({
        tenantId: rec.tenantId,
        type: "Click",
        campaignId: rec.campaignId,
        recipientId: rec.id,
        targetUrl: rawTarget,
        ip,
        userAgent,
      });
      // Marketing P3 — sibling AttributionTouchpoint write.
      await recordAttributionTouchpoint({
        tenantId: rec.tenantId,
        type: "Click",
        campaignId: rec.campaignId,
        contactType: rec.contactType,
        contactId: rec.contactId,
      });
    } else {
      // Path 2: transactional EmailMessage
      const msg = await prisma.emailMessage.findUnique({
        where: { trackingId: tid },
      });
      if (msg) {
        await recordTrackingEvent({
          tenantId: msg.tenantId,
          type: "Click",
          emailMessageId: msg.id,
          targetUrl: rawTarget,
          ip,
          userAgent,
        });
      }
    }
  } catch {
    // fall through to redirect — tracking failure shouldn't break the user
  }
  res.redirect(302, target);
});

// Admin read: paginated TrackingEvent rows, tenant-scoped. Backs the admin
// marketing "tracking events" table. Filterable by campaign / recipient /
// message / type. Newest first.
emailTrackingRouter.get("/events", requireAuth, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const q = req.query;

  const where: Prisma.TrackingEventWhereInput = { tenantId };
  if (typeof q.campaignId === "string" && q.campaignId) where.campaignId = q.campaignId;
  if (typeof q.recipientId === "string" && q.recipientId) where.recipientId = q.recipientId;
  if (typeof q.emailMessageId === "string" && q.emailMessageId)
    where.emailMessageId = q.emailMessageId;
  if (typeof q.type === "string" && q.type) where.type = q.type;

  // Cap at 500 to keep responses bounded; default 100.
  const rawLimit = Number.parseInt(typeof q.limit === "string" ? q.limit : "", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;

  const rows = await prisma.trackingEvent.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  res.json(rows);
});
