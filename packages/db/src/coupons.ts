// Coupon Code — pure helpers for the code-gated PricingRule flow.
// A CouponCode is an opt-in wrapper around a PricingRule: without the
// code, the rule doesn't fire; with the code, it applies like any other
// rule (see pricing-rules.ts). This file only owns the code-gating
// concerns: validity window, disabled flag, and the maxUses cap.
//
// Rate-computation logic stays in pricing-rules.ts — coupons resolve to
// their PricingRule and reuse `applyRule` there.

export interface CouponCodeLike {
  code: string;
  maxUses: number | null;
  usedCount: number;
  validFrom: Date | null;
  validUpto: Date | null;
  disabled: boolean;
}

export interface CouponValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Check whether a coupon can be redeemed RIGHT NOW.
 *
 * Rules (in order — first failure wins so the reason is meaningful):
 *   1. disabled → "Coupon disabled"
 *   2. validFrom > now → "Coupon not yet valid"
 *   3. validUpto < now → "Coupon expired"
 *   4. usedCount >= maxUses (when maxUses set) → "Coupon fully redeemed"
 *
 * The route treats a null coupon (not-found) as a separate failure with
 * status 400 + "Coupon not found" — we don't emit that here since the
 * helper takes a coupon by value (nothing to null-check).
 */
export function validateCoupon(
  coupon: CouponCodeLike,
  now: Date = new Date(),
): CouponValidation {
  if (coupon.disabled) return { ok: false, reason: "Coupon disabled" };
  if (coupon.validFrom && coupon.validFrom > now)
    return { ok: false, reason: "Coupon not yet valid" };
  if (coupon.validUpto && coupon.validUpto < now)
    return { ok: false, reason: "Coupon expired" };
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses)
    return { ok: false, reason: "Coupon fully redeemed" };
  return { ok: true };
}

/**
 * Normalise a code the way lookups should be done — trimmed + uppercased.
 * ERPNext-style codes are case-insensitive and typo-friendly ("SUMMER "
 * pastes still resolve). Callers that want strict matching should skip
 * this helper.
 */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}
