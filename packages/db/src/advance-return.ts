// Employee Advance return — pure helpers for validating and computing a
// return-of-unused-advance transaction. Called from the hr-service
// /employee-advances/:id/return route.
//
// Contract:
//   The route holds the DB session; this helper takes only numbers +
//   returns numbers. Cumulative accounting: multiple partial returns
//   against the same advance are additive, and each is validated against
//   `paidAmount - existingReturnAmount` (the remaining outflow).

export interface AdvanceReturnInput {
  /** Amount originally paid out on the advance. */
  paidAmount: number;
  /** Sum of all prior returns against this advance (starts at 0). */
  existingReturnAmount: number;
  /** How much the operator is returning right now. */
  requestedReturn: number;
}

export interface AdvanceReturnQuote {
  ok: boolean;
  reason?: string;
  /** New cumulative `returnAmount` (existingReturnAmount + requestedReturn) when ok. */
  newReturnAmount: number;
  /** paidAmount − newReturnAmount when ok; 0 when the return closes the advance. */
  remaining: number;
  /** True when the return fully settles the advance (remaining <= EPSILON). */
  fullyReturned: boolean;
}

const EPSILON = 0.0001;

/**
 * Validate + compute a return quote.
 *
 * Rules (checked in order — first failure wins):
 *   1. paidAmount must be > 0 (can't return against an unpaid advance).
 *   2. requestedReturn must be > 0.
 *   3. requestedReturn must not exceed the remaining outflow
 *      (paidAmount − existingReturnAmount). Over-return is a data-integrity
 *      error — a stronger signal than silently clamping.
 *
 * Successful quote → newReturnAmount + remaining computed with EPSILON
 * tolerance so a full return of 100.00 against a paid 100.00 doesn't
 * fall on the wrong side of a floating-point comparison.
 */
export function computeAdvanceReturn(input: AdvanceReturnInput): AdvanceReturnQuote {
  if (input.paidAmount <= 0) {
    return {
      ok: false,
      reason: "Advance has no paid amount to return against",
      newReturnAmount: input.existingReturnAmount,
      remaining: 0,
      fullyReturned: false,
    };
  }
  if (input.requestedReturn <= 0) {
    return {
      ok: false,
      reason: "Return amount must be > 0",
      newReturnAmount: input.existingReturnAmount,
      remaining: input.paidAmount - input.existingReturnAmount,
      fullyReturned: false,
    };
  }
  const currentRemaining = round4(
    input.paidAmount - input.existingReturnAmount,
  );
  if (input.requestedReturn > currentRemaining + EPSILON) {
    return {
      ok: false,
      reason: `Return exceeds remaining advance (${currentRemaining.toFixed(2)} available)`,
      newReturnAmount: input.existingReturnAmount,
      remaining: currentRemaining,
      fullyReturned: false,
    };
  }
  const newReturnAmount = round4(
    input.existingReturnAmount + input.requestedReturn,
  );
  const remaining = round4(input.paidAmount - newReturnAmount);
  return {
    ok: true,
    newReturnAmount,
    remaining: remaining < EPSILON ? 0 : remaining,
    fullyReturned: remaining < EPSILON,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
