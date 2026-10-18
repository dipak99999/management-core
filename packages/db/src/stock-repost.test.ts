import { describe, expect, it } from "vitest";
import { recomputeSleChain, type SleForRepost } from "./stock-repost";

const inflow = (id: string, qty: number, incomingRate: number): SleForRepost => ({
  id,
  actualQty: qty,
  incomingRate,
});
const outflow = (id: string, qty: number): SleForRepost => ({
  id,
  actualQty: -qty,
  incomingRate: 0,
});
const valueOnly = (id: string): SleForRepost => ({
  id,
  actualQty: 0,
  incomingRate: 0,
});

describe("recomputeSleChain — empty prior + fresh chain", () => {
  it("single inflow → rate = incomingRate", () => {
    const r = recomputeSleChain({
      priorQty: 0,
      priorRate: 0,
      priorValue: 0,
      activeSles: [inflow("a", 10, 100)],
    });
    expect(r.updates[0]).toEqual({
      id: "a",
      qtyAfterTransaction: 10,
      valuationRate: 100,
      stockValue: 1000,
    });
    expect(r.finalQty).toBe(10);
    expect(r.finalRate).toBe(100);
    expect(r.finalValue).toBe(1000);
  });

  it("two inflows at different rates → moving average", () => {
    const r = recomputeSleChain({
      priorQty: 0,
      priorRate: 0,
      priorValue: 0,
      activeSles: [inflow("a", 10, 100), inflow("b", 10, 200)],
    });
    // After a: qty=10, value=1000, rate=100
    // After b: qty=20, value=3000, rate=150
    expect(r.updates[0]?.valuationRate).toBe(100);
    expect(r.updates[1]?.valuationRate).toBe(150);
    expect(r.finalRate).toBe(150);
  });

  it("inflow then outflow → outflow at avg rate", () => {
    const r = recomputeSleChain({
      priorQty: 0,
      priorRate: 0,
      priorValue: 0,
      activeSles: [inflow("a", 10, 100), outflow("b", 4)],
    });
    // After a: qty=10, value=1000, rate=100
    // After b: qty=6, value=600 (consumed 4×100), rate=100
    expect(r.updates[1]?.qtyAfterTransaction).toBe(6);
    expect(r.updates[1]?.stockValue).toBe(600);
    expect(r.finalRate).toBe(100);
  });

  it("draw down to zero → rate clamps to 0", () => {
    const r = recomputeSleChain({
      priorQty: 0,
      priorRate: 0,
      priorValue: 0,
      activeSles: [inflow("a", 10, 100), outflow("b", 10)],
    });
    expect(r.finalQty).toBe(0);
    expect(r.finalValue).toBe(0);
    expect(r.finalRate).toBe(0);
  });
});

describe("recomputeSleChain — prior state", () => {
  it("uses priorQty/priorRate/priorValue as chain start", () => {
    const r = recomputeSleChain({
      priorQty: 20,
      priorRate: 50,
      priorValue: 1000,
      activeSles: [inflow("a", 20, 100)],
    });
    // After: qty=40, value=1000+2000=3000, rate=75
    expect(r.finalQty).toBe(40);
    expect(r.finalValue).toBe(3000);
    expect(r.finalRate).toBe(75);
  });

  it("outflow at avg uses PRIOR rate initially (no fresh inflow)", () => {
    const r = recomputeSleChain({
      priorQty: 10,
      priorRate: 100,
      priorValue: 1000,
      activeSles: [outflow("a", 5)],
    });
    // After: qty=5, value=500, rate=100
    expect(r.finalQty).toBe(5);
    expect(r.finalValue).toBe(500);
    expect(r.finalRate).toBe(100);
  });
});

describe("recomputeSleChain — value-only SLEs (from LCV / rate recon)", () => {
  it("actualQty=0 passes through — qty/rate/value unchanged", () => {
    const r = recomputeSleChain({
      priorQty: 10,
      priorRate: 100,
      priorValue: 1000,
      activeSles: [valueOnly("a"), inflow("b", 5, 200)],
    });
    // valueOnly stamps current state (10, 100, 1000)
    expect(r.updates[0]).toEqual({
      id: "a",
      qtyAfterTransaction: 10,
      valuationRate: 100,
      stockValue: 1000,
    });
    // Then inflow: qty=15, value=1000+1000=2000, rate=133.3333
    expect(r.updates[1]?.qtyAfterTransaction).toBe(15);
    expect(r.updates[1]?.valuationRate).toBeCloseTo(133.3333, 3);
  });
});

describe("recomputeSleChain — sequencing preserves per-row snapshots", () => {
  it("emits one update per SLE in the given order", () => {
    const r = recomputeSleChain({
      priorQty: 0,
      priorRate: 0,
      priorValue: 0,
      activeSles: [
        inflow("a", 100, 10),
        outflow("b", 40),
        inflow("c", 20, 15),
        outflow("d", 30),
      ],
    });
    expect(r.updates.map((u) => u.id)).toEqual(["a", "b", "c", "d"]);
    // a: qty=100 value=1000 rate=10
    expect(r.updates[0]?.valuationRate).toBe(10);
    // b: qty=60 value=600 rate=10 (outflow at avg)
    expect(r.updates[1]?.stockValue).toBe(600);
    // c: qty=80 value=900 rate=11.25
    expect(r.updates[2]?.valuationRate).toBe(11.25);
    // d: qty=50 value=900 - 30*11.25 = 562.50 rate=11.25
    expect(r.updates[3]?.stockValue).toBe(562.5);
  });
});
