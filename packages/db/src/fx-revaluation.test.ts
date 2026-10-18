import { describe, expect, it } from "vitest";
import {
  buildRevaluationJE,
  computeRevaluation,
} from "./fx-revaluation";

const RATES = [
  { currency: "USD", rate: 85 },
  { currency: "EUR", rate: 92 },
];

describe("computeRevaluation", () => {
  it("returns zero lines when everything is in base currency", () => {
    const r = computeRevaluation(
      [{ id: "si1", name: "SI-1", customerId: "c1", currency: "INR", outstandingAmt: 5000, originalRate: 1 }],
      [],
      RATES,
      "INR",
    );
    expect(r.lines).toHaveLength(0);
    expect(r.skipped.baseCurrencyDocs).toBe(1);
    expect(r.totals.netFxGainLoss).toBe(0);
  });

  it("catches AR upside: USD strengthened → Debtors up, net gain", () => {
    const r = computeRevaluation(
      [
        {
          id: "si1", name: "SI-1", customerId: "c1",
          currency: "USD", outstandingAmt: 1000, originalRate: 82,
        },
      ],
      [],
      RATES,
      "INR",
    );
    // 1000 × 85 = 85,000; 1000 × 82 = 82,000; delta = +3,000
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].delta).toBe(3000);
    expect(r.totals.arDelta).toBe(3000);
    expect(r.totals.netFxGainLoss).toBe(3000);
  });

  it("catches AP downside: USD weakened → Creditors down, net gain", () => {
    // Original AP at rate 88, now at 85 → Creditors owe less in base.
    const r = computeRevaluation(
      [],
      [
        {
          id: "pi1", name: "PI-1", supplierId: "s1",
          currency: "USD", outstandingAmt: 500, originalRate: 88,
        },
      ],
      RATES,
      "INR",
    );
    // 500 × 85 = 42,500; 500 × 88 = 44,000; delta = -1,500
    expect(r.lines[0].delta).toBe(-1500);
    expect(r.totals.apDelta).toBe(-1500);
    // netFxGainLoss = arDelta - apDelta = 0 - (-1500) = +1500 (gain)
    expect(r.totals.netFxGainLoss).toBe(1500);
  });

  it("records currencies with no rate as skipped", () => {
    const r = computeRevaluation(
      [{ id: "si1", name: "SI-1", customerId: "c1", currency: "JPY", outstandingAmt: 100, originalRate: 0.5 }],
      [],
      RATES,
      "INR",
    );
    expect(r.lines).toHaveLength(0);
    expect(r.skipped.missingRate).toEqual(["JPY"]);
  });

  it("ignores docs whose delta rounds to zero", () => {
    // Same rate now and then → delta = 0.
    const r = computeRevaluation(
      [{ id: "si1", name: "SI-1", customerId: "c1", currency: "USD", outstandingAmt: 100, originalRate: 85 }],
      [],
      RATES,
      "INR",
    );
    expect(r.lines).toHaveLength(0);
  });

  it("aggregates net across AR and AP", () => {
    const r = computeRevaluation(
      [{ id: "si1", name: "SI-1", customerId: "c1", currency: "USD", outstandingAmt: 1000, originalRate: 82 }], // +3000
      [{ id: "pi1", name: "PI-1", supplierId: "s1", currency: "USD", outstandingAmt: 500, originalRate: 82 }], // +1500 (Creditors up = loss)
      RATES,
      "INR",
    );
    expect(r.totals.arDelta).toBe(3000);
    expect(r.totals.apDelta).toBe(1500);
    // Net = 3000 - 1500 = +1500 gain
    expect(r.totals.netFxGainLoss).toBe(1500);
  });
});

describe("buildRevaluationJE", () => {
  it("posts DR Debtors + CR FX Gain when AR grows", () => {
    const summary = computeRevaluation(
      [{ id: "si1", name: "SI-1", customerId: "c1", currency: "USD", outstandingAmt: 1000, originalRate: 82 }],
      [],
      RATES,
      "INR",
    );
    const je = buildRevaluationJE({
      summary,
      debtorsAccountId: "acc-debtors",
      creditorsAccountId: "acc-creditors",
      fxGainLossAccountId: "acc-fx",
    });
    expect(je).toHaveLength(2);
    expect(je[0]).toEqual({ accountId: "acc-debtors", debit: 3000, credit: 0, remarks: "FX reval — Debtors up" });
    expect(je[1]).toEqual({ accountId: "acc-fx", debit: 0, credit: 3000, remarks: "FX reval offset — net gain" });
    // Balanced.
    const dr = je.reduce((s, l) => s + l.debit, 0);
    const cr = je.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it("posts DR FX Loss + CR Debtors when AR shrinks", () => {
    // Original rate 85, now 82 (weakened) → AR down
    const summary = computeRevaluation(
      [{ id: "si1", name: "SI-1", customerId: "c1", currency: "USD", outstandingAmt: 1000, originalRate: 85 }],
      [],
      [{ currency: "USD", rate: 82 }],
      "INR",
    );
    const je = buildRevaluationJE({
      summary,
      debtorsAccountId: "acc-debtors",
      creditorsAccountId: "acc-creditors",
      fxGainLossAccountId: "acc-fx",
    });
    expect(je).toHaveLength(2);
    expect(je[0]).toEqual({ accountId: "acc-debtors", debit: 0, credit: 3000, remarks: "FX reval — Debtors down" });
    expect(je[1]).toEqual({ accountId: "acc-fx", debit: 3000, credit: 0, remarks: "FX reval offset — net loss" });
  });

  it("balances a combined AR-up + AP-up posting", () => {
    const summary = computeRevaluation(
      [{ id: "si1", name: "SI-1", customerId: "c1", currency: "USD", outstandingAmt: 1000, originalRate: 82 }], // AR +3000
      [{ id: "pi1", name: "PI-1", supplierId: "s1", currency: "USD", outstandingAmt: 500, originalRate: 82 }], // AP +1500
      RATES,
      "INR",
    );
    const je = buildRevaluationJE({
      summary,
      debtorsAccountId: "acc-debtors",
      creditorsAccountId: "acc-creditors",
      fxGainLossAccountId: "acc-fx",
    });
    // 3 lines: Debtors DR 3000, Creditors CR 1500, FX offset CR net 1500 (gain)
    expect(je).toHaveLength(3);
    const dr = je.reduce((s, l) => s + l.debit, 0);
    const cr = je.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(3000);
  });

  it("returns empty when there's nothing to post", () => {
    const summary = computeRevaluation([], [], RATES, "INR");
    const je = buildRevaluationJE({
      summary,
      debtorsAccountId: "d",
      creditorsAccountId: "c",
      fxGainLossAccountId: "fx",
    });
    expect(je).toEqual([]);
  });
});
