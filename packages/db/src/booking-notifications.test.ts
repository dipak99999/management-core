import { describe, expect, it } from "vitest";
import {
  inviteeCancellationEmail,
  inviteeConfirmationEmail,
  inviteeReminderEmail,
  ownerCancellationEmail,
  ownerNotificationEmail,
  type BookingContext,
} from "./booking-notifications";

const ctx: BookingContext = {
  meetingTypeTitle: "30-min discovery",
  ownerName: "Alice Smith",
  inviteeName: "Bob <O'Malley>", // exercises HTML escaping
  inviteeEmail: "bob@example.com",
  inviteeTimezone: "Asia/Kolkata",
  startsAt: new Date("2026-10-05T04:30:00Z"), // 10:00 IST
  endsAt: new Date("2026-10-05T05:00:00Z"),
  meetingUrl: "https://meet.example.com/xyz",
  cancellationToken: "tok-abc",
  publicBookingBaseUrl: "https://portal.example.com",
};

describe("inviteeConfirmationEmail", () => {
  it("renders IST time in subject + body", () => {
    const { subject, body } = inviteeConfirmationEmail(ctx);
    expect(subject).toContain("30-min discovery");
    expect(subject).toMatch(/10:00 AM|10:00\s?AM|10:00 GMT\+5:30/);
    expect(body).toContain("Alice Smith");
    expect(body).toContain("https://meet.example.com/xyz");
    expect(body).toContain("https://portal.example.com/book/cancel/tok-abc");
  });

  it("escapes HTML in invitee name", () => {
    const { body } = inviteeConfirmationEmail(ctx);
    expect(body).toContain("Bob &lt;O&#39;Malley&gt;");
    expect(body).not.toContain("<O'Malley>");
  });

  it("falls back to UTC when invitee has no timezone", () => {
    const { subject } = inviteeConfirmationEmail({ ...ctx, inviteeTimezone: null });
    expect(subject).toContain("UTC");
  });
});

describe("ownerNotificationEmail", () => {
  it("shows invitee timezone alongside the UTC time", () => {
    const { subject, body } = ownerNotificationEmail(ctx);
    expect(subject).toContain("Bob <O'Malley>"); // subject is not escaped
    expect(body).toContain("Asia/Kolkata");
    expect(body).toContain("UTC");
  });

  it("omits invitee timezone bullet when null", () => {
    const { body } = ownerNotificationEmail({ ...ctx, inviteeTimezone: null });
    expect(body).not.toContain("Invitee timezone");
  });
});

describe("inviteeReminderEmail", () => {
  it("names the hoursBefore in the subject", () => {
    const { subject, body } = inviteeReminderEmail(ctx, 24);
    expect(subject).toContain("in ~24h");
    expect(body).toContain("coming up");
  });
});

describe("cancellation emails", () => {
  it("invitee variant includes the reason when provided", () => {
    const { subject, body } = inviteeCancellationEmail(ctx, "Conflict came up");
    expect(subject.startsWith("Cancelled")).toBe(true);
    expect(body).toContain("Conflict came up");
  });

  it("invitee variant omits reason paragraph when null", () => {
    const { body } = inviteeCancellationEmail(ctx, null);
    expect(body).not.toContain("Reason");
  });

  it("owner variant carries invitee email + name", () => {
    const { body } = ownerCancellationEmail(ctx, null);
    expect(body).toContain("bob@example.com");
    expect(body).toContain("Bob &lt;O&#39;Malley&gt;");
  });
});
