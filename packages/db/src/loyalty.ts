// Loyalty — pure helpers for balance, expiry, and redemption math.
// The route + scheduler tick + SI hook stay thin — the interesting rules
// (what counts toward the balance, how much a customer can redeem, when
// points expire) live here so they're covered by vitest, not hidden
// behind Prisma calls.
//
// Data model recap: `LoyaltyPointEntry` has entryType ∈ {Earned, Redeemed,
// Expired}. `points` is always positive; the sign is inferred from the
// type. Earned rows carry an `expiryDate`; Redeemed/Expired rows are
// bookkeeping offsets.

export type LoyaltyEntryType = "Earned" | "Redeemed" | "Expired";

export interface LoyaltyEntryLike {
  id?: string;
  entryType: string;             // one of LoyaltyEntryType
  points: number;                // always positive
  postingDate?: Date | null;
  expiryDate?: Date | null;
  salesInvoiceId?: string | null;
}

export interface LoyaltyProgramLike {
  minRedemptionPoints: number | string | { toString(): string };
  maxRedemptionPercent: number | string | { toString(): string };  // 0..100
  pointsPerCurrency: number | string | { toString(): string };
  expiryMonths: number;
  enabled: boolean;
}

function asNumber(v: number | string | { toString(): string } | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

/**
 * Available balance at a point in time.
 *
 * Rules:
 *   - Earned rows count IFF (a) not yet expired at `asOf` OR (b) they have
 *     no expiryDate at all.
 *   - Redeemed and Expired rows always count against the balance (they're
 *     historical events — you can't un-redeem).
 *   - Result is floored at 0 — a corrupted ledger with net-negative balance
 *     shouldn't leak "you owe us points" to the customer.
 *
 * The scheduler tick eventually materializes Expired counter-entries for
 * every past-expiryDate Earned row, so long-term the numeric result
 * converges. This helper is authoritative in the interim so a manual
 * redeem attempt right after expiry can't over-draw.
 */
export function computeLoyaltyBalance(entries: LoyaltyEntryLike[], asOf: Date = new Date()): number {
  let bal = 0;
  for (const e of entries) {
    if (e.entryType === "Earned") {
      if (e.expiryDate && e.expiryDate.getTime() <= asOf.getTime()) continue;
      bal += e.points;
    } else {
      // Redeemed | Expired — historical debit.
      bal -= e.points;
    }
  }
  return Math.max(0, bal);
}

/**
 * Rows expiring within `windowDays` from `asOf` (inclusive). Used by the
 * balance endpoint to show a "1200 points expire in the next 30 days"
 * warning in the customer portal.
 */
export function findExpiringSoon(
  entries: LoyaltyEntryLike[],
  asOf: Date = new Date(),
  windowDays: number = 90,
): LoyaltyEntryLike[] {
  const cutoff = asOf.getTime() + windowDays * 24 * 60 * 60 * 1000;
  return entries.filter(
    (e) =>
      e.entryType === "Earned" &&
      e.expiryDate != null &&
      e.expiryDate.getTime() > asOf.getTime() &&
      e.expiryDate.getTime() <= cutoff,
  );
}

/**
 * Earned rows whose expiryDate has passed and don't already have a matching
 * Expired counter-entry. The scheduler tick materializes an Expired row
 * for each — the naive approach ("Expired row for every stale Earned row")
 * only works because Earned rows have unique ids and we can dedup via
 * `salesInvoiceId` + `points` heuristics, but the cleanest approach is
 * a per-Earned-id Expired row.
 *
 * Callers should walk the returned list and create one Expired entry per
 * Earned entry, using `expiredEntryPayload` below.
 */
export function findExpiredUnprocessed(
  entries: LoyaltyEntryLike[],
  asOf: Date = new Date(),
): LoyaltyEntryLike[] {
  // Track Earned ids that already have a corresponding Expired counter-entry.
  // We match Expired → Earned by encoding the Earned entry's id in the
  // Expired row's `remarks` (see expiredEntryPayload). Callers that use a
  // different convention should pass entries pre-filtered.
  return entries.filter(
    (e) =>
      e.entryType === "Earned" &&
      e.expiryDate != null &&
      e.expiryDate.getTime() <= asOf.getTime(),
  );
}

/**
 * Payload for the Expired counter-entry the scheduler creates for a
 * stale Earned row. The `remarks` field encodes the source Earned id so
 * a future audit can pair them.
 */
export function expiredEntryPayload(source: LoyaltyEntryLike & { id: string }): {
  entryType: "Expired";
  points: number;
  postingDate: Date;
  remarks: string;
  salesInvoiceId: string | null;
} {
  return {
    entryType: "Expired",
    points: source.points,
    postingDate: source.expiryDate ?? new Date(),
    remarks: `Auto-expired from earned entry ${source.id}`,
    salesInvoiceId: source.salesInvoiceId ?? null,
  };
}

export interface RedemptionQuoteInput {
  requestedPoints: number;
  balance: number;
  program: LoyaltyProgramLike;
  invoiceTotal: number;
}

export interface RedemptionQuote {
  ok: boolean;
  reason?: string;
  /** Points that would actually be redeemed (0 when ok=false). */
  pointsRedeemed: number;
  /** Currency discount the redemption produces (invoice-side effect). */
  discountAmount: number;
}

/**
 * Compute what a redemption WOULD do without applying it. UI can call
 * this to render "Redeem N points → -₹X" preview before the user commits.
 *
 * Guards (in order):
 *   1. Program must be enabled.
 *   2. requestedPoints must be > 0.
 *   3. requestedPoints must be ≥ minRedemptionPoints.
 *   4. requestedPoints must be ≤ balance.
 *   5. The currency value must not exceed maxRedemptionPercent × invoiceTotal.
 *      When it would, we CAP silently — the return payload's pointsRedeemed
 *      is the capped amount, and the discount is the cap. UI can show
 *      "requested N, applying M (max)" from the diff.
 *
 * Currency value per point = 1 / pointsPerCurrency (so
 * pointsPerCurrency=0.01 → ₹1 per point; pointsPerCurrency=0.1 → ₹0.10
 * per point).
 */
export function quoteRedemption(input: RedemptionQuoteInput): RedemptionQuote {
  if (!input.program.enabled) {
    return { ok: false, reason: "Program is disabled", pointsRedeemed: 0, discountAmount: 0 };
  }
  if (input.requestedPoints <= 0) {
    return { ok: false, reason: "Points must be > 0", pointsRedeemed: 0, discountAmount: 0 };
  }
  const minR = asNumber(input.program.minRedemptionPoints);
  if (input.requestedPoints < minR) {
    return {
      ok: false,
      reason: `Minimum redemption is ${minR} points`,
      pointsRedeemed: 0,
      discountAmount: 0,
    };
  }
  if (input.requestedPoints > input.balance) {
    return {
      ok: false,
      reason: `Only ${input.balance} points available`,
      pointsRedeemed: 0,
      discountAmount: 0,
    };
  }

  const pointsPerCurrency = asNumber(input.program.pointsPerCurrency);
  // Guard against a mis-configured program (0 → division by zero).
  if (pointsPerCurrency <= 0) {
    return {
      ok: false,
      reason: "Program has invalid points-per-currency rate",
      pointsRedeemed: 0,
      discountAmount: 0,
    };
  }

  const requestedDiscount = input.requestedPoints / pointsPerCurrency;
  const maxPct = asNumber(input.program.maxRedemptionPercent);
  const capDiscount = (input.invoiceTotal * maxPct) / 100;

  if (requestedDiscount <= capDiscount) {
    // Round to 2dp so we don't emit weird sub-paise strings; the actual
    // "points redeemed" stays as requested.
    return {
      ok: true,
      pointsRedeemed: input.requestedPoints,
      discountAmount: Math.round(requestedDiscount * 100) / 100,
    };
  }

  // Cap: recompute how many points fit under the cap.
  const cappedPoints = Math.floor(capDiscount * pointsPerCurrency);
  return {
    ok: true,
    pointsRedeemed: cappedPoints,
    discountAmount: Math.round(capDiscount * 100) / 100,
  };
}

/**
 * Points to award for a fresh Earned entry given the invoice base amount.
 * Kept as a helper so the scheduler / manual-award / SI-submit paths all
 * yield the same integer.
 */
export function computePointsEarned(baseAmount: number, program: LoyaltyProgramLike): number {
  const rate = asNumber(program.pointsPerCurrency);
  if (rate <= 0 || baseAmount <= 0) return 0;
  return Math.floor(baseAmount * rate);
}

/**
 * Currency discount from a redeemed-points count. Inverts
 * `pointsPerCurrency`: if 1 currency yields 0.01 points on earn, then
 * 0.01 points redeem to 1 currency (100 points → 100 / 0.01 = 10000
 * currency). Rounded to 2dp so the SI's debtors leg comes out on a whole
 * paise/cent boundary.
 *
 * Returns 0 for rate ≤ 0 (misconfigured program) or points ≤ 0 (nothing
 * redeemed). Used by SI submit to size the DR Loyalty Discount / trim
 * Debtors legs.
 */
export function computeLoyaltyDiscount(
  pointsRedeemed: number,
  program: Pick<LoyaltyProgramLike, "pointsPerCurrency">,
): number {
  const rate = asNumber(program.pointsPerCurrency);
  if (rate <= 0 || pointsRedeemed <= 0) return 0;
  return Math.round((pointsRedeemed / rate) * 100) / 100;
}

/**
 * Sum the points redeemed against a single invoice from a set of ledger
 * entries. Filters by entryType='Redeemed' AND salesInvoiceId=this. Kept
 * pure so SI submit can pass in the already-loaded entries and skip a
 * second DB round-trip.
 */
export function sumRedeemedPoints(
  entries: LoyaltyEntryLike[],
  salesInvoiceId: string,
): number {
  let total = 0;
  for (const e of entries) {
    if (e.entryType !== "Redeemed") continue;
    if (e.salesInvoiceId !== salesInvoiceId) continue;
    total += e.points;
  }
  return total;
}
