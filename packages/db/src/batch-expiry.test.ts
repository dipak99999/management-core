import { describe, expect, it } from "vitest";
import {
  classifyBatchExpiry,
  pickBatchesForAlert,
  type BatchExpiryLike,
} from "./batch-expiry";

function batch(over: Partial<BatchExpiryLike> & { id: string }): BatchExpiryLike {
  return {
    expiryDate: null,
    batchQty: 10,
    disabled: false,
    lastExpiryAlertAt: null,
    ...over,
  };
}

const today = new Date(Date.UTC(2026, 5, 15));

describe("classifyBatchExpiry", () => {
  it("no expiryDate → no-expiry", () => {
    const r = classifyBatchExpiry(batch({ id: "a", expiryDate: null }), today, 30);
    expect(r.status).toBe("no-expiry");
    expect(r.daysUntilExpiry).toBeNull();
  });
  it("already past → expired with negative days", () => {
    const r = classifyBatchExpiry(
      batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 5, 10)) }),
      today,
      30,
    );
    expect(r.status).toBe("expired");
    expect(r.daysUntilExpiry).toBe(-5);
  });
  it("expiring today (0 days) → expiring", () => {
    const r = classifyBatchExpiry(
      batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 5, 15)) }),
      today,
      30,
    );
    expect(r.status).toBe("expiring");
    expect(r.daysUntilExpiry).toBe(0);
  });
  it("within window → expiring", () => {
    const r = classifyBatchExpiry(
      batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 5, 30)) }),
      today,
      30,
    );
    expect(r.status).toBe("expiring");
    expect(r.daysUntilExpiry).toBe(15);
  });
  it("at edge of window → expiring", () => {
    const r = classifyBatchExpiry(
      batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 6, 15)) }),
      today,
      30,
    );
    expect(r.status).toBe("expiring");
    expect(r.daysUntilExpiry).toBe(30);
  });
  it("beyond window → ok", () => {
    const r = classifyBatchExpiry(
      batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 6, 16)) }),
      today,
      30,
    );
    expect(r.status).toBe("ok");
    expect(r.daysUntilExpiry).toBe(31);
  });
  it("UTC-midnight compare — expiring same-day late doesn't flip early", () => {
    // Batch expires 2026-06-15 (today). Even if `today` is set with a
    // late-day hour, the compare uses UTC midnight so days=0 not -1.
    const r = classifyBatchExpiry(
      batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 5, 15)) }),
      new Date(Date.UTC(2026, 5, 15, 23, 59, 59)),
      30,
    );
    expect(r.status).toBe("expiring");
    expect(r.daysUntilExpiry).toBe(0);
  });
});

describe("pickBatchesForAlert", () => {
  it("empty → empty", () => {
    expect(
      pickBatchesForAlert([], { today, windowDays: 30, reAlertAfterDays: 7 }),
    ).toEqual([]);
  });

  it("skips disabled batches", () => {
    const r = pickBatchesForAlert(
      [batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 5, 20)), disabled: true })],
      { today, windowDays: 30, reAlertAfterDays: 7 },
    );
    expect(r).toEqual([]);
  });

  it("skips zero-qty batches", () => {
    const r = pickBatchesForAlert(
      [batch({ id: "a", expiryDate: new Date(Date.UTC(2026, 5, 20)), batchQty: 0 })],
      { today, windowDays: 30, reAlertAfterDays: 7 },
    );
    expect(r).toEqual([]);
  });

  it("skips ok batches (beyond window)", () => {
    const r = pickBatchesForAlert(
      [batch({ id: "a", expiryDate: new Date(Date.UTC(2027, 0, 1)) })],
      { today, windowDays: 30, reAlertAfterDays: 7 },
    );
    expect(r).toEqual([]);
  });

  it("skips no-expiry batches", () => {
    const r = pickBatchesForAlert(
      [batch({ id: "a", expiryDate: null })],
      { today, windowDays: 30, reAlertAfterDays: 7 },
    );
    expect(r).toEqual([]);
  });

  it("expired first, then expiring by soonest expiry", () => {
    const r = pickBatchesForAlert(
      [
        batch({ id: "later-exp", expiryDate: new Date(Date.UTC(2026, 6, 5)) }),
        batch({ id: "already-gone", expiryDate: new Date(Date.UTC(2026, 5, 1)) }),
        batch({ id: "soonest-exp", expiryDate: new Date(Date.UTC(2026, 5, 20)) }),
      ],
      { today, windowDays: 30, reAlertAfterDays: 7 },
    );
    expect(r.map((x) => x.batch.id)).toEqual([
      "already-gone",
      "soonest-exp",
      "later-exp",
    ]);
  });

  it("dedup — skips batches alerted within reAlertAfterDays", () => {
    const r = pickBatchesForAlert(
      [
        batch({
          id: "recent-alert",
          expiryDate: new Date(Date.UTC(2026, 5, 20)),
          lastExpiryAlertAt: new Date(Date.UTC(2026, 5, 14)), // 1 day ago
        }),
        batch({
          id: "stale-alert",
          expiryDate: new Date(Date.UTC(2026, 5, 20)),
          lastExpiryAlertAt: new Date(Date.UTC(2026, 5, 1)), // 14 days ago
        }),
      ],
      { today, windowDays: 30, reAlertAfterDays: 7 },
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.batch.id).toBe("stale-alert");
  });

  it("never-alerted batch always qualifies (nullish lastExpiryAlertAt)", () => {
    const r = pickBatchesForAlert(
      [batch({ id: "fresh", expiryDate: new Date(Date.UTC(2026, 5, 20)) })],
      { today, windowDays: 30, reAlertAfterDays: 7 },
    );
    expect(r).toHaveLength(1);
  });
});
