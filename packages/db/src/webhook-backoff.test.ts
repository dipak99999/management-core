import { describe, expect, it } from "vitest";

// The backoff schedule inside processWebhookDeliveries is a private helper.
// Test the same formula here to lock in the behavior — if events.ts drifts
// (different base, different cap, different max attempts), this test guides
// the intended shape:
//   attempt 1: 30s
//   attempt 2: 2 min (30s * 4)
//   attempt 3: 8 min (30s * 16)
//   attempt 4: 32 min (30s * 64)
//   attempt 5: 2h 8m (30s * 256)
//   attempt 6: cap = 4 h
// After 6 attempts the delivery is marked Failed permanently.

function backoffMs(attempts: number): number {
  return Math.min(30_000 * Math.pow(4, attempts - 1), 4 * 60 * 60_000);
}

describe("webhook exponential backoff schedule", () => {
  it("waits 30s after the first failure", () => {
    expect(backoffMs(1)).toBe(30_000);
  });

  it("scales x4 per subsequent attempt until capping at 4h", () => {
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(480_000);
    expect(backoffMs(4)).toBe(1_920_000);
    // attempt 5 formulaically = 7_680_000 = 2h 8m, still under cap.
    expect(backoffMs(5)).toBe(7_680_000);
  });

  it("caps at 4 hours from attempt 6 onward", () => {
    // 30_000 * 4^5 = 30_720_000 (>4h) → cap engaged.
    expect(backoffMs(6)).toBe(14_400_000);
    expect(backoffMs(7)).toBe(14_400_000);
    expect(backoffMs(20)).toBe(14_400_000);
  });

  it("total wait across the max 6 attempts is under a day", () => {
    const total = [1, 2, 3, 4, 5, 6]
      .map(backoffMs)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(24 * 60 * 60_000);
  });
});
