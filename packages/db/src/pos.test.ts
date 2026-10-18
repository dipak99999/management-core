import { describe, expect, it } from "vitest";
import {
  buildClosingReconciliationLines,
  computeDifferences,
  computeExpectedRows,
  validateTenderTotal,
} from "./pos";

describe("computeExpectedRows", () => {
  it("adds sales-by-mode to opening floats", () => {
    const rows = computeExpectedRows(
      [
        { mode: "Cash", amount: 500 },
        { mode: "Card", amount: 0 },
      ],
      { Cash: 1200, Card: 800 },
    );
    expect(rows).toEqual([
      { mode: "Cash", opening: 500, sales: 1200, expected: 1700 },
      { mode: "Card", opening: 0, sales: 800, expected: 800 },
    ]);
  });

  it("treats missing modes as zero sales", () => {
    const rows = computeExpectedRows([{ mode: "UPI", amount: 0 }], {});
    expect(rows).toEqual([{ mode: "UPI", opening: 0, sales: 0, expected: 0 }]);
  });
});

describe("computeDifferences", () => {
  it("returns counted minus expected per mode", () => {
    const diffs = computeDifferences(
      [
        { mode: "Cash", opening: 500, sales: 1200, expected: 1700 },
        { mode: "Card", opening: 0, sales: 800, expected: 800 },
      ],
      [
        { mode: "Cash", counted: 1650 }, // shortage 50
        { mode: "Card", counted: 800 }, // exact
      ],
    );
    expect(diffs).toEqual([
      { mode: "Cash", difference: -50 },
      { mode: "Card", difference: 0 },
    ]);
  });

  it("defaults uncounted modes to zero", () => {
    const diffs = computeDifferences(
      [{ mode: "UPI", opening: 0, sales: 100, expected: 100 }],
      [],
    );
    expect(diffs).toEqual([{ mode: "UPI", difference: -100 }]);
  });
});

describe("buildClosingReconciliationLines — balanced-books invariant", () => {
  const methods = [
    { mode: "Cash", accountId: "acc-cash" },
    { mode: "Card", accountId: "acc-card" },
  ];

  it("emits zero lines when everything reconciles", () => {
    const lines = buildClosingReconciliationLines(
      [
        { mode: "Cash", difference: 0 },
        { mode: "Card", difference: 0 },
      ],
      methods,
      "acc-roundoff",
      "POS-CLOSE-0001",
    );
    expect(lines).toEqual([]);
  });

  it("shortage: debits Round Off, credits the mode account", () => {
    const lines = buildClosingReconciliationLines(
      [{ mode: "Cash", difference: -50 }],
      methods,
      "acc-roundoff",
      "POS-CLOSE-0002",
    );
    // Dr Round Off 50 ; Cr Cash 50  → balanced
    expect(lines).toHaveLength(2);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBeCloseTo(50);
    expect(totalCredit).toBeCloseTo(50);
    expect(lines[0].accountId).toBe("acc-roundoff");
    expect(lines[0].debit).toBe(50);
    expect(lines[1].accountId).toBe("acc-cash");
    expect(lines[1].credit).toBe(50);
  });

  it("surplus: debits the mode account, credits Round Off", () => {
    const lines = buildClosingReconciliationLines(
      [{ mode: "Card", difference: 25 }],
      methods,
      "acc-roundoff",
      "POS-CLOSE-0003",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].accountId).toBe("acc-card");
    expect(lines[0].debit).toBe(25);
    expect(lines[1].accountId).toBe("acc-roundoff");
    expect(lines[1].credit).toBe(25);
  });

  it("mixed differences produce a balanced multi-line entry", () => {
    const lines = buildClosingReconciliationLines(
      [
        { mode: "Cash", difference: -50 }, // shortage
        { mode: "Card", difference: 25 }, // surplus
      ],
      methods,
      "acc-roundoff",
      "POS-CLOSE-0004",
    );
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    // Every pair (2 lines) balances internally → aggregated debit == credit.
    expect(totalDebit).toBeCloseTo(totalCredit);
    expect(totalDebit).toBeCloseTo(75);
  });

  it("throws when a mode has no configured account", () => {
    expect(() =>
      buildClosingReconciliationLines(
        [{ mode: "UPI", difference: -10 }],
        methods,
        "acc-roundoff",
        "POS-CLOSE-0005",
      ),
    ).toThrow(/UPI/);
  });
});

describe("validateTenderTotal — split-tender must match invoice total", () => {
  it("passes when tenders sum exactly to total", () => {
    expect(validateTenderTotal([{ amount: 40 }, { amount: 60 }], 100)).toBeNull();
  });

  it("passes within 0.01 rounding tolerance", () => {
    expect(validateTenderTotal([{ amount: 99.995 }], 100)).toBeNull();
  });

  it("rejects when total is not covered", () => {
    const err = validateTenderTotal([{ amount: 90 }], 100);
    expect(err).toMatch(/does not match/);
  });

  it("rejects when tendered exceeds total by more than tolerance", () => {
    const err = validateTenderTotal([{ amount: 110 }], 100);
    expect(err).toMatch(/does not match/);
  });
});
