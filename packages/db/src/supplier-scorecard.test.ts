import { describe, expect, it } from "vitest";
import {
  combineWeighted,
  scoreFulfillment,
  scoreOnTimeDelivery,
  scoreResponseRate,
  standingForScore,
} from "./supplier-scorecard";

describe("standingForScore", () => {
  it("maps score bands", () => {
    expect(standingForScore(100)).toBe("Very Good");
    expect(standingForScore(90)).toBe("Very Good");
    expect(standingForScore(89.9)).toBe("Good");
    expect(standingForScore(75)).toBe("Good");
    expect(standingForScore(74.9)).toBe("Average");
    expect(standingForScore(50)).toBe("Average");
    expect(standingForScore(25)).toBe("Poor");
    expect(standingForScore(24.9)).toBe("Very Poor");
    expect(standingForScore(0)).toBe("Very Poor");
  });
});

describe("scoreOnTimeDelivery", () => {
  it("returns 100 when no receipts have a target date (no signal)", () => {
    expect(
      scoreOnTimeDelivery({
        receipts: [
          { postingDate: new Date("2026-01-15"), deliveryDate: null },
          { postingDate: new Date("2026-01-20"), deliveryDate: null },
        ],
      }),
    ).toBe(100);
  });

  it("counts on-time as ≤ deliveryDate", () => {
    const s = scoreOnTimeDelivery({
      receipts: [
        { postingDate: new Date("2026-01-10"), deliveryDate: new Date("2026-01-15") }, // on-time
        { postingDate: new Date("2026-01-15"), deliveryDate: new Date("2026-01-15") }, // on-time (equal)
        { postingDate: new Date("2026-01-20"), deliveryDate: new Date("2026-01-15") }, // late
      ],
    });
    expect(s).toBeCloseTo((2 / 3) * 100, 2);
  });

  it("excludes null-target rows from both numerator and denominator", () => {
    const s = scoreOnTimeDelivery({
      receipts: [
        { postingDate: new Date("2026-01-10"), deliveryDate: new Date("2026-01-15") }, // on-time
        { postingDate: new Date("2026-01-30"), deliveryDate: null }, // excluded
      ],
    });
    expect(s).toBe(100);
  });
});

describe("scoreFulfillment", () => {
  it("returns 100 when there are no POs (no signal)", () => {
    expect(scoreFulfillment({ poItems: [] })).toBe(100);
  });

  it("caps at 100 for over-delivery", () => {
    expect(
      scoreFulfillment({
        poItems: [{ orderedQty: 10, receivedQty: 15 }],
      }),
    ).toBe(100);
  });

  it("computes weighted-by-qty ratio", () => {
    // 5/10 + 8/10 = 13/20 = 65%
    expect(
      scoreFulfillment({
        poItems: [
          { orderedQty: 10, receivedQty: 5 },
          { orderedQty: 10, receivedQty: 8 },
        ],
      }),
    ).toBe(65);
  });
});

describe("scoreResponseRate", () => {
  it("returns 100 when supplier had no invitations", () => {
    expect(scoreResponseRate({ invitations: [] })).toBe(100);
  });

  it("counts Quoted vs total", () => {
    expect(
      scoreResponseRate({
        invitations: [
          { responseStatus: "Quoted" },
          { responseStatus: "Invited" },
          { responseStatus: "Quoted" },
          { responseStatus: "Declined" },
        ],
      }),
    ).toBe(50);
  });
});

describe("combineWeighted", () => {
  it("returns 0 when no criteria configured", () => {
    expect(
      combineWeighted({
        criteria: [],
        scores: { OnTimeDelivery: 90 },
      }),
    ).toEqual({ total: 0, breakdown: {} });
  });

  it("renormalizes weights that don't sum to 100", () => {
    const r = combineWeighted({
      criteria: [
        { formula: "OnTimeDelivery", weight: 2 },
        { formula: "Fulfillment", weight: 3 },
      ],
      scores: { OnTimeDelivery: 100, Fulfillment: 50 },
    });
    // (100 * 2 + 50 * 3) / (2 + 3) = 350 / 5 = 70
    expect(r.total).toBe(70);
    expect(r.breakdown).toEqual({ OnTimeDelivery: 100, Fulfillment: 50 });
  });

  it("uses zero for missing criterion scores", () => {
    const r = combineWeighted({
      criteria: [
        { formula: "OnTimeDelivery", weight: 50 },
        { formula: "Fulfillment", weight: 50 },
      ],
      scores: { OnTimeDelivery: 100 },
    });
    // Fulfillment missing → 0; total = 50/2 = 50
    expect(r.total).toBe(50);
    expect(r.breakdown.Fulfillment).toBe(0);
  });
});
