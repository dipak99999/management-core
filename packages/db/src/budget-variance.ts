// Module 56 — Budget vs Actuals variance math.
//
// Budget rows carry per-account annual amounts + optional cost-center
// scope. Actuals come from GLEntry sums against the same accounts in
// the same period. Variance is (actual - budget) / budget, capped
// display-side at ±999% so a divide-by-tiny-budget doesn't blow the
// UI.
//
// Interpretation:
//   * Expense/COGS accounts: actual > budget = OVER (bad).
//   * Income accounts: actual > budget = OVER (good — beat forecast).
//     Sign convention in `variance` is always (actual - budget); the
//     UI colors green/red based on rootType.

export interface BudgetRow {
  accountId: string;
  accountName: string;
  rootType: string; // Asset | Liability | Equity | Income | Expense
  budgetAmount: number;
  actualAmount: number;
  costCenterId: string | null;
  costCenterName: string | null;
}

export interface BudgetVariance extends BudgetRow {
  variance: number; // actual - budget (in currency)
  variancePct: number; // (actual - budget) / |budget| × 100, capped at ±999
  utilization: number; // actual / budget × 100 (for progress bars)
  status: "OnTrack" | "Warning" | "Over"; // 0-80 OnTrack, 80-100 Warning, 100+ Over
}

export function computeVariance(row: BudgetRow): BudgetVariance {
  const variance = row.actualAmount - row.budgetAmount;
  let variancePct = 0;
  let utilization = 0;
  if (row.budgetAmount !== 0) {
    variancePct = (variance / Math.abs(row.budgetAmount)) * 100;
    utilization = (row.actualAmount / row.budgetAmount) * 100;
  } else if (row.actualAmount !== 0) {
    variancePct = 999; // infinite variance display
    utilization = 999;
  }
  // Cap display values.
  variancePct = Math.max(-999, Math.min(999, variancePct));

  let status: "OnTrack" | "Warning" | "Over";
  if (utilization >= 100) status = "Over";
  else if (utilization >= 80) status = "Warning";
  else status = "OnTrack";

  return {
    ...row,
    variance,
    variancePct,
    utilization,
    status,
  };
}

// Aggregate a list of budget rows into rootType-level totals for
// summary cards ("Total Income: budget 10M / actual 8.2M / -18%").
export interface RootTypeTotal {
  rootType: string;
  totalBudget: number;
  totalActual: number;
  variance: number;
  variancePct: number;
  rowCount: number;
}

export function summarizeByRootType(rows: BudgetVariance[]): RootTypeTotal[] {
  const byType = new Map<string, RootTypeTotal>();
  for (const r of rows) {
    const cur = byType.get(r.rootType) ?? {
      rootType: r.rootType,
      totalBudget: 0,
      totalActual: 0,
      variance: 0,
      variancePct: 0,
      rowCount: 0,
    };
    cur.totalBudget += r.budgetAmount;
    cur.totalActual += r.actualAmount;
    cur.rowCount += 1;
    byType.set(r.rootType, cur);
  }
  const totals = [...byType.values()];
  for (const t of totals) {
    t.variance = t.totalActual - t.totalBudget;
    if (t.totalBudget !== 0) {
      t.variancePct = Math.max(-999, Math.min(999, (t.variance / Math.abs(t.totalBudget)) * 100));
    } else if (t.totalActual !== 0) {
      t.variancePct = 999;
    }
  }
  // Consistent display order.
  const order = ["Income", "Expense", "Asset", "Liability", "Equity"];
  totals.sort((a, b) => order.indexOf(a.rootType) - order.indexOf(b.rootType));
  return totals;
}
