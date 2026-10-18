import { Router } from "express";
import { z } from "zod";
import {
  generateSlots,
  isSlotAvailable,
  inviteeCancellationEmail,
  inviteeConfirmationEmail,
  ownerCancellationEmail,
  ownerNotificationEmail,
  prisma,
  type BookingContext,
} from "@lumaara/db";

// Public URL used in confirmation / cancel emails. Override with env
// NEXT_PUBLIC_PORTAL_URL (portal-web deployment).
const PORTAL_BASE_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? "";

// Build the context bag once — every notification composer takes the
// same shape, so we assemble it in one place per action.
interface FullContext extends BookingContext {
  tenantId: string;
  ownerUserId: string;
  ownerEmail: string | null;
  bookingId: string;
}

async function loadBookingContext(bookingId: string): Promise<FullContext | null> {
  const b = await prisma.bookedMeeting.findUnique({
    where: { id: bookingId },
    include: {
      meetingType: { select: { title: true } },
    },
  });
  if (!b) return null;
  const owner = await prisma.user.findUnique({
    where: { id: b.ownerUserId },
    select: { fullName: true, email: true },
  });
  return {
    tenantId: b.tenantId,
    ownerUserId: b.ownerUserId,
    bookingId: b.id,
    meetingTypeTitle: b.meetingType.title,
    ownerName: owner?.fullName ?? "your host",
    ownerEmail: owner?.email ?? null,
    inviteeName: b.inviteeName,
    inviteeEmail: b.inviteeEmail,
    inviteeTimezone: b.inviteeTimezone,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    meetingUrl: b.meetingUrl,
    cancellationToken: b.cancellationToken,
    publicBookingBaseUrl: PORTAL_BASE_URL,
  };
}

// Fire-and-forget: any email-queue failure MUST NOT bounce the booking
// or the cancel — the DB row is the source of truth.
async function queueBookingEmails(
  ctx: FullContext,
  variant: "confirm" | "cancel",
  reason: string | null = null,
): Promise<void> {
  try {
    const messages: Array<{ toEmail: string; subject: string; body: string }> = [];
    if (variant === "confirm") {
      const inv = inviteeConfirmationEmail(ctx);
      messages.push({ toEmail: ctx.inviteeEmail, ...inv });
      if (ctx.ownerEmail) {
        const own = ownerNotificationEmail(ctx);
        messages.push({ toEmail: ctx.ownerEmail, ...own });
      }
    } else {
      const inv = inviteeCancellationEmail(ctx, reason);
      messages.push({ toEmail: ctx.inviteeEmail, ...inv });
      if (ctx.ownerEmail) {
        const own = ownerCancellationEmail(ctx, reason);
        messages.push({ toEmail: ctx.ownerEmail, ...own });
      }
    }
    if (messages.length === 0) return;
    // Bulk insert — the auth-service send loop picks these up on its
    // next tick. Same pattern as broadcasts.
    await prisma.emailMessage.createMany({
      data: messages.map((m) => ({
        tenantId: ctx.tenantId,
        senderUserId: ctx.ownerUserId,
        toEmail: m.toEmail,
        subject: m.subject,
        body: m.body,
        linkedDoctype: "BookedMeeting",
        linkedId: ctx.bookingId,
      })),
    });
  } catch {
    // Swallow — see comment above.
  }
}

// Public booking flow — no auth. Mounted at /public/bookings.
//
// Endpoints:
//   GET  /:tenantId/:slug              → meeting type public info
//   GET  /:tenantId/:slug/slots        → available slot list
//   POST /:tenantId/:slug/book         → create BookedMeeting
//   POST /cancel/:token                → invitee-side cancellation
//
// The tenantId is in the URL because there's no session context. Slugs
// are unique per tenant, so /:tenantId/:slug is globally unique.

export const publicBookingRouter = Router();

// Trim what we surface publicly — never leak owner PII.
function publicMeetingTypeView(mt: {
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  locationType: string;
  colorHex: string | null;
  active: boolean;
}) {
  return {
    slug: mt.slug,
    title: mt.title,
    description: mt.description,
    durationMinutes: mt.durationMinutes,
    minNoticeMinutes: mt.minNoticeMinutes,
    maxAdvanceDays: mt.maxAdvanceDays,
    locationType: mt.locationType,
    colorHex: mt.colorHex,
  };
}

async function loadActiveMeetingType(tenantId: string, slug: string) {
  return prisma.meetingType.findFirst({
    where: { tenantId, slug, active: true },
  });
}

publicBookingRouter.get("/:tenantId/:slug", async (req, res) => {
  const mt = await loadActiveMeetingType(req.params.tenantId, req.params.slug);
  if (!mt) return res.status(404).json({ error: "Not found" });
  res.json(publicMeetingTypeView(mt));
});

publicBookingRouter.get("/:tenantId/:slug/slots", async (req, res) => {
  const mt = await loadActiveMeetingType(req.params.tenantId, req.params.slug);
  if (!mt) return res.status(404).json({ error: "Not found" });

  const now = new Date();
  const fromRaw = typeof req.query.from === "string" ? req.query.from : "";
  const toRaw = typeof req.query.to === "string" ? req.query.to : "";
  const rangeStart = fromRaw ? new Date(fromRaw) : new Date(now.getTime() + mt.minNoticeMinutes * 60000);
  const defaultDays = Math.min(mt.maxAdvanceDays, 14);
  const rangeEnd = toRaw
    ? new Date(toRaw)
    : new Date(now.getTime() + defaultDays * 24 * 60 * 60000);

  // Owner-level windows apply to all types; type-specific windows override.
  const windows = await prisma.availabilityWindow.findMany({
    where: {
      tenantId: mt.tenantId,
      ownerUserId: mt.ownerUserId,
      OR: [{ meetingTypeId: null }, { meetingTypeId: mt.id }],
    },
  });
  // Only pull bookings inside the range (plus a duration cushion) that
  // could conflict with a candidate slot. Any status !== Cancelled blocks.
  const cushionMs = (mt.durationMinutes + mt.bufferMinutes) * 60000;
  const bookings = await prisma.bookedMeeting.findMany({
    where: {
      tenantId: mt.tenantId,
      ownerUserId: mt.ownerUserId,
      status: { not: "Cancelled" },
      startsAt: {
        gte: new Date(rangeStart.getTime() - cushionMs),
        lte: new Date(rangeEnd.getTime() + cushionMs),
      },
    },
    select: { startsAt: true, endsAt: true },
  });

  const slots = generateSlots(
    {
      durationMinutes: mt.durationMinutes,
      bufferMinutes: mt.bufferMinutes,
      minNoticeMinutes: mt.minNoticeMinutes,
      maxAdvanceDays: mt.maxAdvanceDays,
    },
    windows,
    bookings,
    now,
    rangeStart,
    rangeEnd,
  );
  res.json({ slots });
});

const bookSchema = z.object({
  startsAt: z.string().datetime(),
  inviteeName: z.string().min(1).max(120),
  inviteeEmail: z.string().email(),
  inviteePhone: z.string().max(40).optional().nullable(),
  inviteeNotes: z.string().max(2000).optional().nullable(),
  inviteeTimezone: z.string().max(60).optional().nullable(),
});

publicBookingRouter.post("/:tenantId/:slug/book", async (req, res) => {
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;

  const mt = await loadActiveMeetingType(req.params.tenantId, req.params.slug);
  if (!mt) return res.status(404).json({ error: "Not found" });

  const startsAt = new Date(b.startsAt);
  const endsAt = new Date(startsAt.getTime() + mt.durationMinutes * 60000);
  const now = new Date();

  // Server-side re-validate — the client-shown slot list can be stale.
  const windows = await prisma.availabilityWindow.findMany({
    where: {
      tenantId: mt.tenantId,
      ownerUserId: mt.ownerUserId,
      OR: [{ meetingTypeId: null }, { meetingTypeId: mt.id }],
    },
  });
  const cushionMs = (mt.durationMinutes + mt.bufferMinutes) * 60000;
  const bookings = await prisma.bookedMeeting.findMany({
    where: {
      tenantId: mt.tenantId,
      ownerUserId: mt.ownerUserId,
      status: { not: "Cancelled" },
      startsAt: {
        gte: new Date(startsAt.getTime() - cushionMs),
        lte: new Date(endsAt.getTime() + cushionMs),
      },
    },
    select: { startsAt: true, endsAt: true },
  });
  const ok = isSlotAvailable(
    {
      durationMinutes: mt.durationMinutes,
      bufferMinutes: mt.bufferMinutes,
      minNoticeMinutes: mt.minNoticeMinutes,
      maxAdvanceDays: mt.maxAdvanceDays,
    },
    windows,
    bookings,
    now,
    startsAt,
  );
  if (!ok) {
    return res.status(409).json({ error: "Slot no longer available" });
  }

  const booking = await prisma.bookedMeeting.create({
    data: {
      tenantId: mt.tenantId,
      meetingTypeId: mt.id,
      ownerUserId: mt.ownerUserId,
      startsAt,
      endsAt,
      inviteeName: b.inviteeName,
      inviteeEmail: b.inviteeEmail.toLowerCase(),
      inviteePhone: b.inviteePhone ?? null,
      inviteeNotes: b.inviteeNotes ?? null,
      inviteeTimezone: b.inviteeTimezone ?? null,
      meetingUrl: mt.locationDetails, // owner-configured Zoom/Meet link
      status: "Booked",
    },
  });

  // Queue confirmation email to invitee + notification to owner.
  const ctx = await loadBookingContext(booking.id);
  if (ctx) void queueBookingEmails(ctx, "confirm");

  res.status(201).json({
    id: booking.id,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    cancellationToken: booking.cancellationToken,
    meetingUrl: booking.meetingUrl,
    redirectUrl: mt.redirectUrl ?? null,
  });
});

const cancelSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

publicBookingRouter.post("/cancel/:token", async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.bookedMeeting.findUnique({
    where: { cancellationToken: req.params.token },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "Cancelled") return res.json({ ok: true, alreadyCancelled: true });
  const reason = parsed.data.reason ?? "Cancelled by invitee";
  const updated = await prisma.bookedMeeting.update({
    where: { id: row.id },
    data: {
      status: "Cancelled",
      cancellationReason: reason,
    },
  });
  const ctx = await loadBookingContext(updated.id);
  if (ctx) void queueBookingEmails(ctx, "cancel", reason);
  res.json({ ok: true, id: updated.id, status: updated.status });
});

// Exported so the owner-side status-change route (booked-meetings.ts)
// can also queue cancellation emails when the owner cancels.
export { loadBookingContext, queueBookingEmails };
