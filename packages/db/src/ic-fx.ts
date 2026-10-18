// Multi-company Phase 5: pure helpers for intercompany multi-currency
// FX math. Kept in @lumaara/db so services can share the same logic if
// we later grow more IC posting paths (e.g., IC payment entries).
//
// The helpers are TINY — the reason they live here rather than inline in
// the route is testability: FX math is easy to get sign-wrong, so having
// a battery of unit tests around it saves an afternoon of ledger-
// debugging later.

export interface ICSideInput {
  currency: string;
  conversionRate: number;
  nativeAmount?: number;
}

export interface ICSideComputed {
  currency: string;
  conversionRate: number;
  nativeAmount: number;
  cashBase: number;
  fxDelta: number; // cashBase - amount (positive = over-recognized in base)
}

// Compute the derived native/base values for one side of an IC JE given
// the canonical base-currency `amount`. When `nativeAmount` is omitted,
// derives it as `amount / conversionRate` (implies user just wants a
// simple base-currency posting with an FX rate applied for display).
export function computeICSide(amount: number, side: ICSideInput): ICSideComputed {
  const nativeAmount = side.nativeAmount ?? amount / side.conversionRate;
  const cashBase = nativeAmount * side.conversionRate;
  const fxDelta = cashBase - amount;
  return {
    currency: side.currency,
    conversionRate: side.conversionRate,
    nativeAmount,
    cashBase,
    fxDelta,
  };
}

// Build the from-side JE lines. IC leg is base amount; cash leg is
// cashBase; FX line absorbs residual. Returns lines in [account, debit,
// credit] tuples so the caller can adapt to whatever line shape their
// createMany takes.
export function buildFromLines(params: {
  amount: number;
  fxDelta: number;
  cashBase: number;
  icAccountId: string;
  cashAccountId: string;
  fxAccountId: string | null;
}): Array<{ accountId: string; debit: number; credit: number }> {
  const { amount, fxDelta, cashBase, icAccountId, cashAccountId, fxAccountId } = params;
  const lines = [
    { accountId: icAccountId, debit: amount, credit: 0 },
    { accountId: cashAccountId, debit: 0, credit: cashBase },
  ];
  if (Math.abs(fxDelta) > 0.0001) {
    if (!fxAccountId) throw new Error("FX gain/loss account required when currencies differ");
    lines.push(
      fxDelta > 0
        ? { accountId: fxAccountId, debit: fxDelta, credit: 0 }
        : { accountId: fxAccountId, debit: 0, credit: -fxDelta },
    );
  }
  return lines;
}

// Build the to-side JE lines. Cash leg receives cashBase; IC leg credits
// base amount. FX line absorbs residual (mirror sign of from side).
export function buildToLines(params: {
  amount: number;
  fxDelta: number;
  cashBase: number;
  icAccountId: string;
  cashAccountId: string;
  fxAccountId: string | null;
}): Array<{ accountId: string; debit: number; credit: number }> {
  const { amount, fxDelta, cashBase, icAccountId, cashAccountId, fxAccountId } = params;
  const lines = [
    { accountId: cashAccountId, debit: cashBase, credit: 0 },
    { accountId: icAccountId, debit: 0, credit: amount },
  ];
  if (Math.abs(fxDelta) > 0.0001) {
    if (!fxAccountId) throw new Error("FX gain/loss account required when currencies differ");
    lines.push(
      fxDelta > 0
        ? { accountId: fxAccountId, debit: 0, credit: fxDelta }
        : { accountId: fxAccountId, debit: -fxDelta, credit: 0 },
    );
  }
  return lines;
}
