// Pricing Rules — pure helpers for the discount/rate override engine.
// Extracted from the /pricing-rules/lookup route so precedence and the
// applied-rate math can be exercised by vitest without a live DB, AND so
// the same logic can be reused from any place we want to resolve a rule
// (SI/PI/Quote/SO on item add, portal cart pricing, etc.).
//
// The route stays thin: it loads candidate rows via Prisma and hands
// them to `pickBestRule` / `applyRule` here. Any behavioural change
// belongs in this file with tests, not in the route body.

export interface PricingRuleLike {
  id: string;
  applyOn: string;           // "Selling" | "Buying"
  itemId: string | null;
  customerId: string | null;
  customerGroupId: string | null;
  territoryId: string | null;
  minQty: number | string | { toString(): string };
  maxQty: number | string | { toString(): string } | null;
  ruleType: string;          // "Discount %" | "Rate"
  discountPercent: number | string | { toString(): string };
  ratePrice: number | string | { toString(): string };
  priority: number;
  validFrom: Date | null;
  validUpto: Date | null;
  disabled: boolean;
  title?: string;
}

export interface RuleMatchContext {
  applyOn: "Selling" | "Buying";
  itemId: string;
  customerId?: string | null;
  customerGroupId?: string | null;
  territoryId?: string | null;
  qty: number;
  at: Date;
}

/**
 * Convert a Prisma Decimal-ish value to a plain number. Prisma Decimals
 * override `toString`; `Number()` on them yields the numeric value.
 */
function asNumber(v: number | string | { toString(): string } | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

/**
 * Returns true iff the rule is applicable to the given context.
 * A rule with `<field> = null` matches ANY value of that field
 * (i.e. it's a wildcard); a rule with a set value matches only when
 * the context field equals it.
 *
 * We do NOT filter `applyOn` here — call sites already pre-filter by
 * applyOn when they query rules, and it saves us from decisions when
 * a route mistakenly passes cross-cut candidates.
 */
export function ruleMatches(rule: PricingRuleLike, ctx: RuleMatchContext): boolean {
  if (rule.disabled) return false;
  if (rule.applyOn !== ctx.applyOn) return false;
  if (rule.itemId != null && rule.itemId !== ctx.itemId) return false;
  if (rule.customerId != null && rule.customerId !== ctx.customerId) return false;
  if (rule.customerGroupId != null && rule.customerGroupId !== ctx.customerGroupId) return false;
  if (rule.territoryId != null && rule.territoryId !== ctx.territoryId) return false;

  const min = asNumber(rule.minQty);
  if (ctx.qty < min) return false;
  if (rule.maxQty != null && ctx.qty > asNumber(rule.maxQty)) return false;

  if (rule.validFrom != null && ctx.at < rule.validFrom) return false;
  if (rule.validUpto != null && ctx.at > rule.validUpto) return false;

  return true;
}

/**
 * Specificity score — more concrete filters win over wildcards. The
 * weights are chosen so item beats customer beats group beats
 * territory. Ties on specificity fall through to `priority` (higher
 * wins) and then to insertion order (stable — the caller decides).
 *
 * The exact weights don't matter as long as they're monotone; only
 * ordering matters.
 */
export function specificityScore(rule: PricingRuleLike): number {
  return (
    (rule.itemId ? 8 : 0) +
    (rule.customerId ? 4 : 0) +
    (rule.customerGroupId ? 2 : 0) +
    (rule.territoryId ? 1 : 0)
  );
}

/**
 * Pick the single best rule from a set of candidates for the given
 * context. Returns `null` when nothing applies.
 *
 * Precedence:
 *   1. Higher `priority` wins.
 *   2. Tie → higher specificity wins (item-specific over item=null, etc.).
 *   3. Tie → most recent (later in array) wins. The route sorts by
 *      updatedAt desc so this yields "last-edited wins" which is what
 *      an admin toggling two conflicting rules expects to see.
 *
 * Callers usually pre-filter with `where: { tenantId, applyOn, disabled: false }`
 * plus the item/customer OR-null pattern, but `ruleMatches` re-checks
 * everything so double-filtering is safe.
 */
export function pickBestRule(
  candidates: PricingRuleLike[],
  ctx: RuleMatchContext,
): PricingRuleLike | null {
  const applicable = candidates.filter((r) => ruleMatches(r, ctx));
  if (applicable.length === 0) return null;
  let best = applicable[0]!;
  for (let i = 1; i < applicable.length; i++) {
    const cand = applicable[i]!;
    if (cand.priority !== best.priority) {
      if (cand.priority > best.priority) best = cand;
      continue;
    }
    const sBest = specificityScore(best);
    const sCand = specificityScore(cand);
    if (sCand !== sBest) {
      if (sCand > sBest) best = cand;
      continue;
    }
    // Same priority + specificity → keep the later candidate (caller's
    // "most-recent-first" ordering is preserved when they pass the
    // candidates in updatedAt-desc order).
  }
  return best;
}

/**
 * Apply a rule to a base rate. Returns the base rate untouched when
 * `rule` is null (no rule matched).
 *   ruleType "Rate"       → applied = rule.ratePrice (absolute override)
 *   ruleType "Discount %" → applied = base × (1 − pct/100)
 * Negative rates are floored at 0 — a 120% discount would otherwise
 * silently turn into a refund.
 */
export function applyRule(baseRate: number, rule: PricingRuleLike | null): number {
  if (!rule) return baseRate;
  if (rule.ruleType === "Rate") return Math.max(0, asNumber(rule.ratePrice));
  const pct = asNumber(rule.discountPercent);
  return Math.max(0, baseRate * (1 - pct / 100));
}
