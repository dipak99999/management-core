import { describe, expect, it } from "vitest";
import {
  rankCandidates,
  scoreAmount,
  scoreDate,
  scoreDescription,
  scoreMatch,
  scoreReference,
  type BankTxnLike,
  type GlEntryLike,
} from "./bank-match";

function txn(overrides: Partial<BankTxnLike> = {}): BankTxnLike {
  return {
    amount: 1000,
    transactionDate: "2026-03-15",
    description: null,
    referenceNumber: null,
    ...overrides,
  };
}

function gl(
  overrides: Partial<GlEntryLike> & { id: string; kind?: "dr" | "cr" },
): GlEntryLike {
  const { kind: _kind, ...rest } = overrides;
  const kind = _kind ?? "cr";
  return {
    postingDate: "2026-03-15",
    debit: kind === "dr" ? 1000 : 0,
    credit: kind === "cr" ? 1000 : 0,
    remarks: null,
    voucherName: null,
    ...rest,
  };
}

describe("scoreAmount", () => {
  it("1.0 for exact match (Cr entry vs positive bank credit)", () => {
    expect(scoreAmount(txn({ amount: 1000 }), gl({ id: "a" }))).toBe(1);
  });

  it("1.0 for exact match ignoring sign (Dr entry vs negative bank debit)", () => {
    // Bank outflow = -500 pairs with a Dr entry of 500.
    expect(
      scoreAmount(txn({ amount: -500 }), gl({ id: "a", kind: "dr", debit: 500, credit: 0 })),
    ).toBe(1);
  });

  it("1.0 within a 0.01 rounding tolerance", () => {
    expect(scoreAmount(txn({ amount: 1000.005 }), gl({ id: "a" }))).toBe(1);
  });

  it("grades down linearly inside the 5% band", () => {
    // 25 delta / 1025 max = 2.44% → score ≈ 0.51. The scorer uses the
    // larger side as the denominator so it's symmetric under swapping
    // txn/gl amounts (a symmetric relative distance).
    const s = scoreAmount(txn({ amount: 1025 }), gl({ id: "a" }));
    expect(s).toBeGreaterThan(0.45);
    expect(s).toBeLessThan(0.55);
  });

  it("0 beyond ±5%", () => {
    expect(scoreAmount(txn({ amount: 1100 }), gl({ id: "a" }))).toBe(0);
  });

  it("0 when either side is zero (not both)", () => {
    expect(scoreAmount(txn({ amount: 0 }), gl({ id: "a" }))).toBe(0);
    expect(
      scoreAmount(txn({ amount: 1000 }), gl({ id: "a", debit: 0, credit: 0 })),
    ).toBe(0);
  });
});

describe("scoreDate", () => {
  it("1.0 same day", () => {
    expect(scoreDate(txn({ transactionDate: "2026-03-15" }), gl({ id: "a" }))).toBe(1);
  });

  it("grades linearly to 0 at 14 days", () => {
    expect(scoreDate(txn({ transactionDate: "2026-03-22" }), gl({ id: "a" }))).toBeCloseTo(0.5, 2);
    expect(scoreDate(txn({ transactionDate: "2026-03-29" }), gl({ id: "a" }))).toBe(0);
  });

  it("0 beyond 14 days in either direction", () => {
    expect(scoreDate(txn({ transactionDate: "2026-04-15" }), gl({ id: "a" }))).toBe(0);
    expect(scoreDate(txn({ transactionDate: "2026-02-15" }), gl({ id: "a" }))).toBe(0);
  });
});

describe("scoreReference", () => {
  it("1.0 when voucherName appears in referenceNumber", () => {
    expect(
      scoreReference(txn({ referenceNumber: "NEFT/SINV-0042/UTR12345" }), gl({ id: "a", voucherName: "SINV-0042" })),
    ).toBe(1);
  });

  it("1.0 when voucherName appears in description (case-insensitive)", () => {
    expect(
      scoreReference(txn({ description: "Payment for sinv-0042" }), gl({ id: "a", voucherName: "SINV-0042" })),
    ).toBe(1);
  });

  it("0 when voucher name is absent from both fields", () => {
    expect(
      scoreReference(txn({ description: "salary" }), gl({ id: "a", voucherName: "SINV-0042" })),
    ).toBe(0);
  });

  it("0 when GL has no voucherName at all", () => {
    expect(scoreReference(txn({ description: "anything" }), gl({ id: "a" }))).toBe(0);
  });
});

describe("scoreDescription (jaccard on 3+ char tokens)", () => {
  it("returns something > 0 when tokens overlap", () => {
    const s = scoreDescription(
      txn({ description: "acme corp office rent march" }),
      gl({ id: "a", remarks: "office rent acme" }),
    );
    expect(s).toBeGreaterThan(0);
  });

  it("returns 0 for disjoint token sets", () => {
    expect(
      scoreDescription(
        txn({ description: "electricity board" }),
        gl({ id: "a", remarks: "office supplies" }),
      ),
    ).toBe(0);
  });

  it("ignores <3-char noise (to, of, at) when computing overlap", () => {
    const s = scoreDescription(
      txn({ description: "to acme of" }),
      gl({ id: "a", remarks: "of at" }),
    );
    // Only "acme" survives on the left; nothing on the right.
    expect(s).toBe(0);
  });
});

describe("scoreMatch — weighted total + reasons", () => {
  it("perfect signals produce a near-1.0 score", () => {
    const s = scoreMatch(
      txn({
        amount: 5000,
        transactionDate: "2026-03-15",
        description: "office rent acme",
        referenceNumber: "SINV-0042",
      }),
      gl({
        id: "a",
        postingDate: "2026-03-15",
        credit: 5000,
        remarks: "office rent acme",
        voucherName: "SINV-0042",
      }),
    );
    expect(s.score).toBeCloseTo(1, 2);
    expect(s.reasons).toContain("Exact amount");
    expect(s.reasons).toContain("Same day");
    expect(s.reasons).toContain("Reference matches SINV-0042");
  });

  it("weight ordering: amount + date alone (no ref) still comfortably above min", () => {
    // W_AMOUNT + W_DATE = 0.80 → both perfect → 0.80 total.
    const s = scoreMatch(
      txn({ amount: 5000, transactionDate: "2026-03-15" }),
      gl({ id: "a", postingDate: "2026-03-15", credit: 5000 }),
    );
    expect(s.score).toBeCloseTo(0.8, 2);
  });

  it("reference-hit alone doesn't rescue a wildly-wrong amount", () => {
    // Amount is 50% off → scoreAmount = 0 → contribution 0.
    // Date perfect, reference perfect → 0.25 + 0.15 = 0.40.
    const s = scoreMatch(
      txn({ amount: 500, transactionDate: "2026-03-15", referenceNumber: "SINV-0042" }),
      gl({
        id: "a",
        postingDate: "2026-03-15",
        credit: 1000,
        voucherName: "SINV-0042",
      }),
    );
    expect(s.score).toBeCloseTo(0.4, 2);
  });
});

describe("rankCandidates", () => {
  const t = txn({
    amount: 1000,
    transactionDate: "2026-03-15",
    referenceNumber: "SINV-0042",
  });

  it("returns top matches sorted by score descending", () => {
    const cands: GlEntryLike[] = [
      gl({ id: "wrong-amount", credit: 999, postingDate: "2026-03-15" }), // amount 0.1% off → 0.98 amount
      gl({ id: "distant-date", credit: 1000, postingDate: "2026-03-22" }), // -50% date
      gl({
        id: "smoking-gun",
        credit: 1000,
        postingDate: "2026-03-15",
        voucherName: "SINV-0042",
      }),
    ];
    const ranked = rankCandidates(t, cands);
    expect(ranked[0].glEntry.id).toBe("smoking-gun");
  });

  it("filters out entries below the minScore floor", () => {
    // A single candidate whose only match is a stale date + wrong ref should
    // fall below 0.4 minScore and be dropped entirely.
    const cands: GlEntryLike[] = [
      gl({ id: "stale", credit: 900, postingDate: "2026-03-01" }),
    ];
    expect(rankCandidates(t, cands)).toEqual([]);
  });

  it("respects topN cap", () => {
    const cands: GlEntryLike[] = Array.from({ length: 20 }, (_, i) =>
      gl({ id: `a${i}`, credit: 1000, postingDate: "2026-03-15" }),
    );
    expect(rankCandidates(t, cands, { topN: 3 })).toHaveLength(3);
  });

  it("drops candidates with zero amount score even if reference matches", () => {
    // Amount wildly off but reference matches — the amount is definitive.
    const cands: GlEntryLike[] = [
      gl({
        id: "a",
        credit: 99999,
        postingDate: "2026-03-15",
        voucherName: "SINV-0042",
      }),
    ];
    expect(rankCandidates(t, cands)).toEqual([]);
  });
});
