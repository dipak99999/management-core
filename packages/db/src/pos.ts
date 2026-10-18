// POS pure helpers — the small pieces of the cashier / closing flow that
// don't need Prisma. Kept here so vitest can exercise them without a DB.

export interface PaymentMethodConfig {
  mode: string;
  accountId: string;
  isDefault?: boolean;
  integrationId?: string | null;
}

export interface OpeningBalance {
  mode: string;
  amount: number;
}

export interface ExpectedRow {
  mode: string;
  opening: number;
  sales: number;
  expected: number;
}

/**
 * Given opening floats + a per-mode sales total, produce the reconciliation
 * rows the cashier sees at session close.
 */
export function computeExpectedRows(
  opening: OpeningBalance[],
  salesByMode: Record<string, number>,
): ExpectedRow[] {
  return opening.map((o) => {
    const sales = salesByMode[o.mode] ?? 0;
    return { mode: o.mode, opening: o.amount, sales, expected: o.amount + sales };
  });
}

export interface CountedByMode {
  mode: string;
  counted: number;
}

export interface DifferenceRow {
  mode: string;
  difference: number;
}

export function computeDifferences(
  expected: ExpectedRow[],
  counted: CountedByMode[],
): DifferenceRow[] {
  return expected.map((e) => {
    const c = counted.find((x) => x.mode === e.mode)?.counted ?? 0;
    return { mode: e.mode, difference: c - e.expected };
  });
}

export interface GLLineShape {
  accountId: string;
  debit: number;
  credit: number;
  remarks?: string;
}

/**
 * Build the balanced GL lines for the reconciliation JE. For each nonzero
 * difference:
 *   surplus (>0): Dr <mode account>  d ; Cr Round Off  d
 *   shortage (<0): Dr Round Off  |d| ; Cr <mode account>  |d|
 * Modes with zero difference produce no lines.
 */
export function buildClosingReconciliationLines(
  differences: DifferenceRow[],
  methods: PaymentMethodConfig[],
  roundOffAccountId: string,
  closingName: string,
): GLLineShape[] {
  const modeToAccount = new Map(methods.map((m) => [m.mode, m.accountId]));
  const lines: GLLineShape[] = [];
  for (const d of differences) {
    if (Math.abs(d.difference) < 0.0001) continue;
    const modeAccount = modeToAccount.get(d.mode);
    if (!modeAccount)
      throw new Error(
        `Mode "${d.mode}" no longer on profile — cannot reconcile ${closingName}`,
      );
    const abs = Math.abs(d.difference);
    if (d.difference > 0) {
      lines.push({
        accountId: modeAccount,
        debit: abs,
        credit: 0,
        remarks: `POS ${closingName} surplus (${d.mode})`,
      });
      lines.push({
        accountId: roundOffAccountId,
        debit: 0,
        credit: abs,
        remarks: `POS ${closingName} surplus (${d.mode})`,
      });
    } else {
      lines.push({
        accountId: roundOffAccountId,
        debit: abs,
        credit: 0,
        remarks: `POS ${closingName} shortage (${d.mode})`,
      });
      lines.push({
        accountId: modeAccount,
        debit: 0,
        credit: abs,
        remarks: `POS ${closingName} shortage (${d.mode})`,
      });
    }
  }
  return lines;
}

/**
 * Split tender must exactly cover the rounded total. Returns null when OK,
 * an error string otherwise. Same 0.01 tolerance the checkout route uses.
 */
export function validateTenderTotal(
  tenders: { amount: number }[],
  roundedTotal: number,
): string | null {
  const tendered = tenders.reduce((s, t) => s + t.amount, 0);
  if (Math.abs(tendered - roundedTotal) > 0.01) {
    return `Tendered ${tendered.toFixed(2)} does not match total ${roundedTotal.toFixed(2)}`;
  }
  return null;
}
