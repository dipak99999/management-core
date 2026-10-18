import { describe, expect, it } from "vitest";
import {
  normalizeCouponCode,
  validateCoupon,
  type CouponCodeLike,
} from "./coupons";

function coupon(over: Partial<CouponCodeLike>): CouponCodeLike {
  return {
    code: "TEST10",
    maxUses: null,
    usedCount: 0,
    validFrom: null,
    validUpto: null,
    disabled: false,
    ...over,
  };
}

const now = new Date("2026-06-15T12:00:00Z");

describe("validateCoupon", () => {
  it("clean coupon → ok", () => {
    expect(validateCoupon(coupon({}), now)).toEqual({ ok: true });
  });

  it("disabled → reject", () => {
    expect(validateCoupon(coupon({ disabled: true }), now)).toEqual({
      ok: false,
      reason: "Coupon disabled",
    });
  });

  it("before validFrom → not yet valid", () => {
    expect(
      validateCoupon(coupon({ validFrom: new Date("2026-07-01") }), now),
    ).toEqual({ ok: false, reason: "Coupon not yet valid" });
  });

  it("after validUpto → expired", () => {
    expect(
      validateCoupon(coupon({ validUpto: new Date("2026-06-01") }), now),
    ).toEqual({ ok: false, reason: "Coupon expired" });
  });

  it("inside validity window → ok", () => {
    expect(
      validateCoupon(
        coupon({
          validFrom: new Date("2026-06-01"),
          validUpto: new Date("2026-06-30"),
        }),
        now,
      ),
    ).toEqual({ ok: true });
  });

  it("maxUses reached → fully redeemed", () => {
    expect(
      validateCoupon(coupon({ maxUses: 100, usedCount: 100 }), now),
    ).toEqual({ ok: false, reason: "Coupon fully redeemed" });
  });

  it("maxUses over-drawn (data drift) → still rejects", () => {
    expect(
      validateCoupon(coupon({ maxUses: 5, usedCount: 12 }), now),
    ).toEqual({ ok: false, reason: "Coupon fully redeemed" });
  });

  it("maxUses null → no cap", () => {
    expect(
      validateCoupon(coupon({ maxUses: null, usedCount: 999_999 }), now),
    ).toEqual({ ok: true });
  });

  it("failure order: disabled beats validity", () => {
    // If we ever want to show both, we'd need to change the return shape;
    // for now, disabled is the most useful message for admins.
    expect(
      validateCoupon(
        coupon({
          disabled: true,
          validFrom: new Date("2027-01-01"),
        }),
        now,
      ).reason,
    ).toBe("Coupon disabled");
  });

  it("failure order: validity beats maxUses", () => {
    expect(
      validateCoupon(
        coupon({
          validUpto: new Date("2026-06-01"),
          maxUses: 5,
          usedCount: 10,
        }),
        now,
      ).reason,
    ).toBe("Coupon expired");
  });
});

describe("normalizeCouponCode", () => {
  it("trims + uppercases", () => {
    expect(normalizeCouponCode(" summer25 ")).toBe("SUMMER25");
  });
  it("empty stays empty", () => {
    expect(normalizeCouponCode("   ")).toBe("");
  });
  it("already-normal stays same", () => {
    expect(normalizeCouponCode("BLACKFRIDAY")).toBe("BLACKFRIDAY");
  });
});
