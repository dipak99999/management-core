import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import { loadBookingContext, queueBookingEmails } from "./public-bookings";

// Meeting Scheduler — owner-side list + status transitions.
// Booking creation lives on the public router; owners cancel/complete
// here.

export const bookedMeetingRouter = Router();
const p = perms("BookedMeeting");

bookedMeetingRouter.get("/", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
  const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
  const rows = await prisma.bookedMeeting.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
      ...(fromRaw || toRaw
        ? {
            startsAt: {
              ...(fromRaw ? { gte: new Date(fromRaw) } : {}),
              ...(toRaw ? { lte: new Date(toRaw) } : {}),
            },
          }
        : {}),
    },
    include: { meetingType: { select: { title: true, slug: true, colorHex: true } } },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

bookedMeetingRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.bookedMeeting.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { meetingType: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

const statusSchema = z.object({
  status: z.enum(["Booked", "Cancelled", "Completed", "NoShow"]),
  cancellationReason: z.string().optional().nullable(),
});

bookedMeetingRouter.patch("/:id/status", p.write, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.bookedMeeting.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.bookedMeeting.update({
    where: { id: row.id },
    data: {
      status: parsed.data.status,
      cancellationReason: parsed.data.cancellationReason ?? null,
    },
  });
  // Fire cancellation emails when the owner transitions to Cancelled from
  // any prior state. Skips Completed / NoShow — those don't warrant an
  // email since the meeting already happened.
  if (parsed.data.status === "Cancelled" && row.status !== "Cancelled") {
    const ctx = await loadBookingContext(updated.id);
    if (ctx) void queueBookingEmails(ctx, "cancel", parsed.data.cancellationReason ?? "Cancelled by host");
  }
  res.json(updated);
});
