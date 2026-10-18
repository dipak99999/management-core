import { describe, expect, it } from "vitest";
import {
  applyRule,
  pickBestRule,
  ruleMatches,
  specificityScore,
  type PricingRuleLike,
  type RuleMatchContext,
} from "./pricing-rules";

function rule(over: Partial<PricingRuleLike>): PricingRuleLike {
  return {
    id: "r1",
    applyOn: "Selling",
    itemId: null,
    customerId: null,
    customerGroupId: null,
    territoryId: null,
    minQty: 0,
    maxQty: null,
    ruleType: "Discount %",
    discountPercent: 0,
    ratePrice: 0,
    priority: 0,
    validFrom: null,
    validUpto: null,
    disabled: false,
    title: "test",
    ...over,
  };
}

function ctx(over: Partial<RuleMatchContext>): RuleMatchContext {
  return {
    applyOn: "Selling",
    itemId: "item-A",
    customerId: "cust-1",
    customerGroupId: "grp-1",
    territoryId: "terr-1",
    qty: 1,
    at: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

describe("ruleMatches", () => {
  it("wildcard rule matches any context", () => {
    expect(ruleMatches(rule({}), ctx({}))).toBe(true);
  });

  it("disabled rule never matches", () => {
    expect(ruleMatches(rule({ disabled: true }), ctx({}))).toBe(false);
  });

  it("applyOn mismatch rejects", () => {
    expect(ruleMatches(rule({ applyOn: "Buying" }), ctx({ applyOn: "Selling" }))).toBe(false);
  });

  it("item filter matches when equal", () => {
    expect(ruleMatches(rule({ itemId: "item-A" }), ctx({ itemId: "item-A" }))).toBe(true);
  });

  it("item filter rejects when different", () => {
    expect(ruleMatches(rule({ itemId: "item-A" }), ctx({ itemId: "item-B" }))).toBe(false);
  });

  it("customer/group/territory work the same way", () => {
    expect(ruleMatches(rule({ customerId: "cust-1" }), ctx({ customerId: "cust-2" }))).toBe(false);
    expect(ruleMatches(rule({ customerGroupId: "grp-1" }), ctx({ customerGroupId: "grp-1" }))).toBe(true);
    expect(ruleMatches(rule({ territoryId: "terr-1" }), ctx({ territoryId: "other" }))).toBe(false);
  });

  it("minQty gate — qty below → reject", () => {
    expect(ruleMatches(rule({ minQty: 10 }), ctx({ qty: 5 }))).toBe(false);
  });

  it("minQty gate — qty at or above → allow", () => {
    expect(ruleMatches(rule({ minQty: 10 }), ctx({ qty: 10 }))).toBe(true);
    expect(ruleMatches(rule({ minQty: 10 }), ctx({ qty: 11 }))).toBe(true);
  });

  it("maxQty gate — qty above ceiling → reject", () => {
    expect(ruleMatches(rule({ maxQty: 100 }), ctx({ qty: 101 }))).toBe(false);
    expect(ruleMatches(rule({ maxQty: 100 }), ctx({ qty: 100 }))).toBe(true);
  });

  it("validFrom gate — before window → reject", () => {
    const r = rule({ validFrom: new Date("2026-07-01") });
    expect(ruleMatches(r, ctx({ at: new Date("2026-06-15") }))).toBe(false);
    expect(ruleMatches(r, ctx({ at: new Date("2026-07-15") }))).toBe(true);
  });

  it("validUpto gate — after window → reject", () => {
    const r = rule({ validUpto: new Date("2026-05-31") });
    expect(ruleMatches(r, ctx({ at: new Date("2026-06-01T00:00:01Z") }))).toBe(false);
    expect(ruleMatches(r, ctx({ at: new Date("2026-05-15") }))).toBe(true);
  });

  it("customerId=null in context still matches wildcard rule", () => {
    expect(ruleMatches(rule({}), ctx({ customerId: null }))).toBe(true);
  });
});

describe("specificityScore", () => {
  it("wildcard scores 0", () => {
    expect(specificityScore(rule({}))).toBe(0);
  });
  it("item beats customer beats group beats territory", () => {
    expect(specificityScore(rule({ territoryId: "t" }))).toBeLessThan(
      specificityScore(rule({ customerGroupId: "g" })),
    );
    expect(specificityScore(rule({ customerGroupId: "g" }))).toBeLessThan(
      specificityScore(rule({ customerId: "c" })),
    );
    expect(specificityScore(rule({ customerId: "c" }))).toBeLessThan(
      specificityScore(rule({ itemId: "i" })),
    );
  });
  it("multiple filters stack", () => {
    const r = rule({ itemId: "i", customerId: "c", customerGroupId: "g", territoryId: "t" });
    expect(specificityScore(r)).toBe(8 + 4 + 2 + 1);
  });
});

describe("pickBestRule", () => {
  it("returns null on empty", () => {
    expect(pickBestRule([], ctx({}))).toBeNull();
  });

  it("returns null when no rule applicable", () => {
    const r = rule({ itemId: "item-Z" });
    expect(pickBestRule([r], ctx({ itemId: "item-A" }))).toBeNull();
  });

  it("higher priority wins over lower even if less specific", () => {
    const generic = rule({ id: "g", priority: 10, discountPercent: 20 });
    const specific = rule({ id: "s", itemId: "item-A", priority: 5, discountPercent: 5 });
    expect(pickBestRule([specific, generic], ctx({ itemId: "item-A" }))?.id).toBe("g");
  });

  it("on priority tie, more specific wins", () => {
    const generic = rule({ id: "g", priority: 10, discountPercent: 20 });
    const specific = rule({ id: "s", itemId: "item-A", priority: 10, discountPercent: 5 });
    expect(pickBestRule([generic, specific], ctx({ itemId: "item-A" }))?.id).toBe("s");
  });

  it("customer-specific beats group-specific at same priority", () => {
    const grp = rule({ id: "grp", customerGroupId: "grp-1", priority: 5 });
    const cust = rule({ id: "cust", customerId: "cust-1", priority: 5 });
    expect(pickBestRule([grp, cust], ctx({}))?.id).toBe("cust");
  });

  it("filters disabled rules", () => {
    const only = rule({ id: "only", disabled: true });
    expect(pickBestRule([only], ctx({}))).toBeNull();
  });
});

describe("applyRule", () => {
  it("null rule → returns base unchanged", () => {
    expect(applyRule(100, null)).toBe(100);
  });

  it("Rate type → returns rule rate regardless of base", () => {
    const r = rule({ ruleType: "Rate", ratePrice: 42 });
    expect(applyRule(100, r)).toBe(42);
    expect(applyRule(0, r)).toBe(42);
  });

  it("Discount % type → base × (1 − pct/100)", () => {
    const r = rule({ ruleType: "Discount %", discountPercent: 10 });
    expect(applyRule(100, r)).toBe(90);
  });

  it("Discount % of 0 → no change", () => {
    const r = rule({ ruleType: "Discount %", discountPercent: 0 });
    expect(applyRule(50, r)).toBe(50);
  });

  it("Discount % greater than 100 → floored at 0", () => {
    const r = rule({ ruleType: "Discount %", discountPercent: 120 });
    expect(applyRule(100, r)).toBe(0);
  });

  it("negative Rate → floored at 0", () => {
    const r = rule({ ruleType: "Rate", ratePrice: -5 });
    expect(applyRule(100, r)).toBe(0);
  });

  it("handles Decimal-like objects via toString", () => {
    const decimalLike = { toString: () => "15" };
    const r = rule({ ruleType: "Discount %", discountPercent: decimalLike });
    expect(applyRule(200, r)).toBe(170); // 200 * 0.85
  });
});
