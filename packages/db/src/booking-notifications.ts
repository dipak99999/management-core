// Meeting Scheduler — notification email body composers.
//
// Pure helpers. Each returns { subject, body } for a specific notification
// kind. The routes / tick call these and insert EmailMessage rows for the
// auth-service send loop to pick up.
//
// We keep the bodies as inline HTML + a minimal plain-ish structure —
// no template engine dependency, no MJML. If a tenant wants brand styling,
// applyBrandKit() over the resulting body will still fill `{{brand.*}}`
// tokens at send time.
//
// Timezone rendering: the invitee sees times in their own timezone (the
// value they stamped at booking time via Intl in the browser). The owner
// sees times in a fallback of "UTC" — we don't have a User.timezone
// field yet, so we spell out the UTC offset in the subject.

export interface BookingContext {
  meetingTypeTitle: string;
  ownerName: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimezone: string | null;
  startsAt: Date; // UTC
  endsAt: Date;   // UTC
  meetingUrl: string | null;
  cancellationToken: string;
  publicBookingBaseUrl: string; // e.g. https://portal.example.com
}

function fmtDate(d: Date, tz: string): string {
  return d.toLocaleString("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}

// Confirmation to the invitee at book time.
export function inviteeConfirmationEmail(ctx: BookingContext): { subject: string; body: string } {
  const tz = ctx.inviteeTimezone ?? "UTC";
  const when = fmtDate(ctx.startsAt, tz);
  const cancelUrl = `${ctx.publicBookingBaseUrl}/book/cancel/${encodeURIComponent(ctx.cancellationToken)}`;
  const subject = `Booking confirmed: ${ctx.meetingTypeTitle} on ${when}`;
  const body = [
    `<p>Hi ${esc(ctx.inviteeName)},</p>`,
    `<p>Your booking with <strong>${esc(ctx.ownerName)}</strong> is confirmed for <strong>${esc(when)}</strong>.</p>`,
    ctx.meetingUrl
      ? `<p>Join link: <a href="${esc(ctx.meetingUrl)}">${esc(ctx.meetingUrl)}</a></p>`
      : "",
    `<p>Need to cancel? <a href="${esc(cancelUrl)}">Use this link</a>.</p>`,
    `<p>— ${esc(ctx.ownerName)}</p>`,
  ].join("\n");
  return { subject, body };
}

// Notification to the owner at book time.
export function ownerNotificationEmail(ctx: BookingContext): { subject: string; body: string } {
  const tz = "UTC";
  const when = fmtDate(ctx.startsAt, tz);
  const subject = `New booking: ${ctx.inviteeName} for ${ctx.meetingTypeTitle}`;
  const body = [
    `<p>New booking for <strong>${esc(ctx.meetingTypeTitle)}</strong>.</p>`,
    `<ul>`,
    `<li><strong>Invitee:</strong> ${esc(ctx.inviteeName)} &lt;${esc(ctx.inviteeEmail)}&gt;</li>`,
    `<li><strong>When (UTC):</strong> ${esc(when)}</li>`,
    ctx.inviteeTimezone
      ? `<li><strong>Invitee timezone:</strong> ${esc(ctx.inviteeTimezone)}</li>`
      : "",
    `</ul>`,
    ctx.meetingUrl ? `<p>Join link: <a href="${esc(ctx.meetingUrl)}">${esc(ctx.meetingUrl)}</a></p>` : "",
  ].join("\n");
  return { subject, body };
}

// Reminder to the invitee, fired by the scheduler tick some hours before
// the meeting starts.
export function inviteeReminderEmail(ctx: BookingContext, hoursBefore: number): { subject: string; body: string } {
  const tz = ctx.inviteeTimezone ?? "UTC";
  const when = fmtDate(ctx.startsAt, tz);
  const cancelUrl = `${ctx.publicBookingBaseUrl}/book/cancel/${encodeURIComponent(ctx.cancellationToken)}`;
  const subject = `Reminder: ${ctx.meetingTypeTitle} in ~${hoursBefore}h`;
  const body = [
    `<p>Hi ${esc(ctx.inviteeName)},</p>`,
    `<p>Just a heads-up — your meeting with <strong>${esc(ctx.ownerName)}</strong> is coming up at <strong>${esc(when)}</strong>.</p>`,
    ctx.meetingUrl
      ? `<p>Join link: <a href="${esc(ctx.meetingUrl)}">${esc(ctx.meetingUrl)}</a></p>`
      : "",
    `<p>Need to cancel? <a href="${esc(cancelUrl)}">Use this link</a>.</p>`,
  ].join("\n");
  return { subject, body };
}

// Sent to the invitee when the owner (or the invitee themselves) cancels.
export function inviteeCancellationEmail(
  ctx: BookingContext,
  reason: string | null,
): { subject: string; body: string } {
  const tz = ctx.inviteeTimezone ?? "UTC";
  const when = fmtDate(ctx.startsAt, tz);
  const subject = `Cancelled: ${ctx.meetingTypeTitle} on ${when}`;
  const body = [
    `<p>Hi ${esc(ctx.inviteeName)},</p>`,
    `<p>Your booking with <strong>${esc(ctx.ownerName)}</strong> on <strong>${esc(when)}</strong> has been cancelled.</p>`,
    reason ? `<p><strong>Reason:</strong> ${esc(reason)}</p>` : "",
    `<p>You're welcome to book again at any time.</p>`,
  ].join("\n");
  return { subject, body };
}

// Sent to the owner when a booking is cancelled (via any channel).
export function ownerCancellationEmail(
  ctx: BookingContext,
  reason: string | null,
): { subject: string; body: string } {
  const when = fmtDate(ctx.startsAt, "UTC");
  const subject = `Cancelled: booking with ${ctx.inviteeName} on ${when}`;
  const body = [
    `<p>Booking for <strong>${esc(ctx.meetingTypeTitle)}</strong> with ${esc(ctx.inviteeName)} &lt;${esc(ctx.inviteeEmail)}&gt; has been cancelled.</p>`,
    `<p><strong>When (UTC):</strong> ${esc(when)}</p>`,
    reason ? `<p><strong>Reason:</strong> ${esc(reason)}</p>` : "",
  ].join("\n");
  return { subject, body };
}
