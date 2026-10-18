import { describe, expect, it } from "vitest";
import { classifyRecon } from "./stock-reconciliation";

describe("classifyRecon", () => {
  it("no change → mode='none', all zeros", () => {
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 100,
      countedRate: 10,
    });
    expect(r.mode).toBe("none");
    expect(r.valueDelta).toBe(0);
  });

  it("countedRate null → treated as oldRate (no rate change)", () => {
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 100,
      countedRate: null,
    });
    expect(r.mode).toBe("none");
  });

  it("qty gain only → mode='qty', valueDelta at countedRate", () => {
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 120,
      countedRate: 10,
    });
    expect(r.mode).toBe("qty");
    expect(r.qtyDelta).toBe(20);
    expect(r.rateDelta).toBe(0);
    expect(r.valueDelta).toBe(200); // 20 × 10
  });

  it("qty loss only → mode='qty', valueDelta at oldRate (negative)", () => {
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 80,
      countedRate: 10,
    });
    expect(r.mode).toBe("qty");
    expect(r.qtyDelta).toBe(-20);
    expect(r.valueDelta).toBe(-200);
  });

  it("rate-only bump → mode='rate' with newStockValue/newValuationRate", () => {
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 100,
      countedRate: 12,
    });
    expect(r.mode).toBe("rate");
    expect(r.qtyDelta).toBe(0);
    expect(r.rateDelta).toBe(2);
    expect(r.valueDelta).toBe(200); // 100 × +2
    expect(r.newStockValue).toBe(1200); // 100 × 12
    expect(r.newValuationRate).toBe(12);
  });

  it("rate-only reduction → mode='rate' with negative valueDelta", () => {
    const r = classifyRecon({
      oldQty: 50,
      oldRate: 20,
      countedQty: 50,
      countedRate: 15,
    });
    expect(r.mode).toBe("rate");
    expect(r.valueDelta).toBe(-250); // 50 × -5
    expect(r.newStockValue).toBe(750); // 50 × 15
    expect(r.newValuationRate).toBe(15);
  });

  it("both changed (gain + rate up) → mode='both', qty valued at counted rate + rate applied to oldQty", () => {
    // oldQty=100 @ 10 → oldValue=1000
    // counted 120 @ 12 → target value=1440, delta=440
    //   qty part: +20 × 12 = 240
    //   rate part: 100 × +2 = 200
    //   sum = 440
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 120,
      countedRate: 12,
    });
    expect(r.mode).toBe("both");
    expect(r.qtyDelta).toBe(20);
    expect(r.rateDelta).toBe(2);
    expect(r.valueDelta).toBe(440);
  });

  it("both changed (loss + rate down)", () => {
    // oldQty=100 @ 10 → oldValue=1000
    // counted 80 @ 8 → target value=640, delta=-360
    //   qty part: -20 × 10 = -200
    //   rate part: 100 × -2 = -200
    //   sum = -400 (NOT -360 — this is the acknowledged approximation
    //   from mixing moving-average outflow with rate revaluation)
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 80,
      countedRate: 8,
    });
    expect(r.mode).toBe("both");
    expect(r.valueDelta).toBe(-400);
  });

  it("qty gain + rate down", () => {
    // oldQty=100 @ 10, counted 110 @ 9
    //   qty part: +10 × 9 = 90
    //   rate part: 100 × -1 = -100
    //   sum = -10
    const r = classifyRecon({
      oldQty: 100,
      oldRate: 10,
      countedQty: 110,
      countedRate: 9,
    });
    expect(r.mode).toBe("both");
    expect(r.valueDelta).toBe(-10);
  });

  it("empty bin → qty gain works from zero", () => {
    const r = classifyRecon({
      oldQty: 0,
      oldRate: 0,
      countedQty: 50,
      countedRate: 20,
    });
    expect(r.mode).toBe("both"); // qty AND rate changed vs zero baseline
    expect(r.qtyDelta).toBe(50);
    expect(r.rateDelta).toBe(20);
    // qty part: 50 × 20 = 1000; rate part: 0 × 20 = 0 → total 1000
    expect(r.valueDelta).toBe(1000);
  });

  it("tiny qty float noise (< 0.0001) → not counted as change", () => {
    const r = classifyRecon({
      oldQty: 100.00003,
      oldRate: 10,
      countedQty: 100,
      countedRate: 10,
    });
    expect(r.mode).toBe("none");
  });
});
