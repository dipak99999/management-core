import { describe, expect, it } from "vitest";
import {
  composeReminderSubject,
  daysBetween,
  parseReminderThresholds,
  pickReminderKind,
} from "./reminders";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ---------------------------------------------------------------------
// parseReminderThresholds

describe("parseReminderThresholds", () => {
  it("returns a full triple when all three keys are set", () => {
    expect(parseReminderThresholds({ first: 7, second: 30, final: 60 })).toEqual({
      first: 7,
      second: 30,
      final: 60,
    });
  });

  it("returns null when no threshold is set (reminders disabled)", () => {
    expect(parseReminderThresholds({})).toBeNull();
    expect(parseReminderThresholds(null)).toBeNull();
    expect(parseReminderThresholds(undefined)).toBeNull();
  });

  it("returns null for non-object shapes (arrays, strings)", () => {
    expect(parseReminderThresholds([7, 30, 60])).toBeNull();
    expect(parseReminderThresholds("7,30,60")).toBeNull();
  });

  it("keeps set thresholds and drops others independently", () => {
    // Common pattern: only send a final reminder at 60 days.
    expect(parseReminderThresholds({ final: 60 })).toEqual({
      first: undefined,
      second: undefined,
      final: 60,
    });
  });

  it("drops non-positive numbers (0, negative) — those aren't reminder-worthy", () => {
    expect(parseReminderThresholds({ first: 0, second: -5, final: 60 })).toEqual({
      first: undefined,
      second: undefined,
      final: 60,
    });
  });

  it("coerces string numbers (config forms often submit strings)", () => {
    expect(parseReminderThresholds({ first: "7", second: "30", final: "60" })).toEqual({
      first: 7,
      second: 30,
      final: 60,
    });
  });
});

// ---------------------------------------------------------------------
// pickReminderKind

describe("pickReminderKind", () => {
  const t = { first: 7, second: 30, final: 60 };

  it("returns null when invoice isn't yet overdue", () => {
    expect(pickReminderKind(-1, t, [])).toBeNull();
    expect(pickReminderKind(0, t, [])).toBeNull();
    expect(pickReminderKind(6, t, [])).toBeNull();
  });

  it("fires First when crossing the first threshold", () => {
    expect(pickReminderKind(7, t, [])).toBe("First");
    expect(pickReminderKind(15, t, [])).toBe("First");
    expect(pickReminderKind(29, t, [])).toBe("First");
  });

  it("fires Second once past the second threshold + First was sent", () => {
    expect(pickReminderKind(30, t, ["First"])).toBe("Second");
    expect(pickReminderKind(45, t, ["First"])).toBe("Second");
  });

  it("skips First entirely on a 90-day-old invoice imported today (highest unfired wins)", () => {
    // Multi-tier catch-up rule: never spam the customer with 3 emails at
    // once. Pick the highest crossable-and-unfired.
    expect(pickReminderKind(90, t, [])).toBe("Final");
  });

  it("returns null when everything applicable has already been sent", () => {
    expect(pickReminderKind(100, t, ["First", "Second", "Final"])).toBeNull();
    // Same 100-days but Final not sent yet — still fires.
    expect(pickReminderKind(100, t, ["First", "Second"])).toBe("Final");
  });

  it("fires nothing when the applicable tier has no threshold configured", () => {
    // Tenant only wants the final: {final: 60}. 30 days overdue → nothing.
    expect(pickReminderKind(30, { final: 60 }, [])).toBeNull();
    expect(pickReminderKind(60, { final: 60 }, [])).toBe("Final");
  });

  it("Final never re-fires even if daysOverdue keeps growing", () => {
    expect(pickReminderKind(200, t, ["Final"])).toBeNull();
    expect(pickReminderKind(200, t, ["First", "Second", "Final"])).toBeNull();
  });
});

// ---------------------------------------------------------------------
// composeReminderSubject

describe("composeReminderSubject", () => {
  it("uses 'Payment reminder' phrasing for First (least urgent)", () => {
    const s = composeReminderSubject({
      kind: "First",
      invoiceName: "SINV-0042",
      daysOverdue: 10,
    });
    expect(s).toBe("Payment reminder: SINV-0042 — 10 days overdue");
  });

  it("uses 'Second reminder' for the middle tier", () => {
    expect(
      composeReminderSubject({ kind: "Second", invoiceName: "SINV-0042", daysOverdue: 35 }),
    ).toBe("Second reminder: SINV-0042 — 35 days overdue");
  });

  it("uses 'Final reminder' for the escalated tier", () => {
    expect(
      composeReminderSubject({ kind: "Final", invoiceName: "SINV-0042", daysOverdue: 90 }),
    ).toBe("Final reminder: SINV-0042 — 90 days overdue");
  });

  it("singularises 'day' at exactly 1 day", () => {
    expect(
      composeReminderSubject({ kind: "First", invoiceName: "SINV-0042", daysOverdue: 1 }),
    ).toBe("Payment reminder: SINV-0042 — 1 day overdue");
  });

  it("prefixes the tenant name when supplied", () => {
    const s = composeReminderSubject({
      kind: "First",
      invoiceName: "SINV-0042",
      daysOverdue: 10,
      tenantName: "Acme Co",
    });
    expect(s).toBe("Acme Co · Payment reminder: SINV-0042 — 10 days overdue");
  });
});

// ---------------------------------------------------------------------
// daysBetween

describe("daysBetween", () => {
  it("returns positive N for future dates", () => {
    expect(daysBetween(utc("2026-03-15"), utc("2026-03-22"))).toBe(7);
  });

  it("returns 0 for the same UTC day (time-of-day ignored)", () => {
    const morning = new Date("2026-03-15T08:00:00.000Z");
    const evening = new Date("2026-03-15T20:00:00.000Z");
    expect(daysBetween(morning, evening)).toBe(0);
  });

  it("returns negative N when 'to' is before 'from' (invoice not yet overdue)", () => {
    expect(daysBetween(utc("2026-03-22"), utc("2026-03-15"))).toBe(-7);
  });

  it("handles month boundaries correctly", () => {
    expect(daysBetween(utc("2026-02-27"), utc("2026-03-03"))).toBe(4);
  });
});
