// Meeting Scheduler — invitee reminder tick.
//
// Runs hourly. Finds every Booked meeting starting within the next
// REMINDER_LEAD_HOURS window that hasn't been reminded yet, queues one
// EmailMessage per invitee, stamps `reminderSentAt` to prevent
// double-sends.
//
// Cross-tenant scan by design — same pattern as the other ticks. Bounded
// to MAX_PER_TICK so a huge backlog doesn't stall the tick.

import { inviteeReminderEmail, prisma } from "@lumaara/db";

const REMINDER_LEAD_HOURS = Number(process.env.BOOKING_REMINDER_LEAD_HOURS ?? 24);
const MAX_PER_TICK = 500;
const PORTAL_BASE_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? "";

export interface BookingReminderTickResult {
  reminded: number;
}

export async function runBookingRemindersTick(
  now: Date = new Date(),
): Promise<BookingReminderTickResult> {
  const windowEnd = new Date(now.getTime() + REMINDER_LEAD_HOURS * 60 * 60 * 1000);

  const due = await prisma.bookedMeeting.findMany({
    where: {
      status: "Booked",
      reminderSentAt: null,
      startsAt: { gt: now, lte: windowEnd },
    },
    include: {
      meetingType: { select: { title: true } },
    },
    orderBy: { startsAt: "asc" },
    take: MAX_PER_TICK,
  });

  if (due.length === 0) return { reminded: 0 };

  // Batch owner lookups per unique userId.
  const ownerIds = Array.from(new Set(due.map((b) => b.ownerUserId)));
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, fullName: true },
  });
  const ownerNameById = new Map(owners.map((u) => [u.id, u.fullName]));

  let reminded = 0;
  for (const b of due) {
    try {
      const ownerName = ownerNameById.get(b.ownerUserId) ?? "your host";
      const { subject, body } = inviteeReminderEmail(
        {
          meetingTypeTitle: b.meetingType.title,
          ownerName,
          inviteeName: b.inviteeName,
          inviteeEmail: b.inviteeEmail,
          inviteeTimezone: b.inviteeTimezone,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          meetingUrl: b.meetingUrl,
          cancellationToken: b.cancellationToken,
          publicBookingBaseUrl: PORTAL_BASE_URL,
        },
        REMINDER_LEAD_HOURS,
      );
      await prisma.$transaction(async (tx) => {
        await tx.emailMessage.create({
          data: {
            tenantId: b.tenantId,
            senderUserId: b.ownerUserId,
            toEmail: b.inviteeEmail,
            subject,
            body,
            linkedDoctype: "BookedMeeting",
            linkedId: b.id,
          },
        });
        await tx.bookedMeeting.update({
          where: { id: b.id },
          data: { reminderSentAt: new Date() },
        });
      });
      reminded++;
    } catch {
      // Skip this booking — the null reminderSentAt keeps it queued
      // for the next tick.
    }
  }
  return { reminded };
}
