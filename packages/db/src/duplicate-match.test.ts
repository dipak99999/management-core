import { describe, expect, it } from "vitest";
import {
  findDuplicatePairs,
  normalizeName,
  scoreCandidatePair,
} from "./duplicate-match";

describe("normalizeName", () => {
  it("lowercases + strips punctuation + drops legal suffixes", () => {
    expect(normalizeName("Acme Corp.")).toBe("acme");
    expect(normalizeName("ACME Corporation")).toBe("acme");
    expect(normalizeName("Acme Pvt Ltd")).toBe("acme");
    expect(normalizeName("Acme (India) Private Limited")).toBe("acme india");
  });
  it("collapses whitespace", () => {
    expect(normalizeName("Acme   \t Widgets")).toBe("acme widgets");
  });
});

describe("scoreCandidatePair — name variants", () => {
  it("scores identical normalized names at 100 on the name component", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "Acme Corp" },
      { id: "b", name: "ACME Corporation" },
    );
    expect(r.breakdown.name).toBe(100);
  });

  it("gives partial credit for token overlap", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "Acme Widgets Ltd" },
      { id: "b", name: "Acme Gadgets Ltd" },
    );
    // shared: "acme"; union: {acme, widgets, gadgets} → 1/3 = 33
    expect(r.breakdown.name).toBeGreaterThan(20);
    expect(r.breakdown.name).toBeLessThan(50);
  });

  it("applies prefix bonus for subset names", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "Acme" },
      { id: "b", name: "Acme Widgets" },
    );
    // Jaccard is 1/2=0.5 → 50; prefix bonus adds 15 → 65
    expect(r.breakdown.name).toBe(65);
  });

  it("returns 0 for wholly different names", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "Acme" },
      { id: "b", name: "Zenith" },
    );
    expect(r.breakdown.name).toBe(0);
  });
});

describe("scoreCandidatePair — ID field matching", () => {
  it("boosts on GSTIN exact match", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "A", gstin: "29ABCDE1234F1Z5" },
      { id: "b", name: "B", gstin: "29ABCDE1234F1Z5" },
    );
    expect(r.breakdown.gstin).toBe(100);
    // GSTIN weight 25 → 25% of total from this field alone.
    expect(r.score).toBeGreaterThanOrEqual(25);
  });

  it("email match is case-insensitive", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "A", email: "Foo@Example.com" },
      { id: "b", name: "B", email: "foo@example.com" },
    );
    expect(r.breakdown.email).toBe(100);
  });

  it("phone match ignores formatting", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "A", phone: "+91 98765 43210" },
      { id: "b", name: "B", phone: "(098765) 43210" },
    );
    expect(r.breakdown.phone).toBe(100);
  });

  it("phone match requires 10 digits (no partials)", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "A", phone: "1234" },
      { id: "b", name: "B", phone: "1234" },
    );
    expect(r.breakdown.phone).toBe(0);
  });
});

describe("scoreCandidatePair — composite scoring", () => {
  it("near-certain duplicate: matching name + email + GSTIN scores near 100", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "Acme Corp", email: "ap@acme.com", gstin: "29ABCDE1234F1Z5" },
      { id: "b", name: "Acme Corporation", email: "AP@acme.com", gstin: "29ABCDE1234F1Z5" },
    );
    expect(r.score).toBeGreaterThan(85);
  });

  it("weak match: only name partial → below threshold", () => {
    const r = scoreCandidatePair(
      { id: "a", name: "Acme Widgets" },
      { id: "b", name: "Zenith Widgets" },
    );
    expect(r.score).toBeLessThan(50);
  });
});

describe("findDuplicatePairs", () => {
  it("returns pairs above threshold sorted by score desc", () => {
    const pairs = findDuplicatePairs(
      [
        { id: "a", name: "Acme Corp", email: "x@acme.com" },
        { id: "b", name: "Acme Corporation", email: "x@acme.com" }, // strong dup with a
        { id: "c", name: "Acme Widgets" }, // partial name match with a
        { id: "d", name: "Zenith" }, // no matches
      ],
      50,
    );
    expect(pairs.length).toBeGreaterThan(0);
    // First pair should be the strongest (a<->b; name-exact + email-exact).
    expect(pairs[0].a.id === "a" || pairs[0].b.id === "a").toBe(true);
    expect(pairs[0].result.score).toBeGreaterThanOrEqual(60);
    // d shouldn't appear in any pair.
    expect(pairs.some((p) => p.a.id === "d" || p.b.id === "d")).toBe(false);
  });

  it("returns empty when no pair crosses the threshold", () => {
    const pairs = findDuplicatePairs(
      [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
        { id: "c", name: "Gamma" },
      ],
      70,
    );
    expect(pairs).toEqual([]);
  });
});
