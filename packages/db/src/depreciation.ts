// Depreciation schedule builders.
//
// Straight Line: monthlyAmount = (purchasePrice − salvageValue) / usefulLifeMonths.
// WDV (Written Down Value / declining balance): each month's depreciation
// is a percentage of the opening book value, so the amount decreases every
// period. Common in India (Companies Act) + many other tax regimes.
//
// Final row is adjusted in both methods so the schedule sums exactly to
// (purchasePrice − salvageValue) and balanceAfter of the last row is exactly
// salvageValue (no cumulative rounding drift).

export interface DepScheduleRow {
  installmentNo: number;
  dueDate: Date;
  amount: number;
  balanceAfter: number;
}

export type DepreciationMethod = "Straight Line" | "WDV";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function buildStraightLine(
  purchasePrice: number,
  salvageValue: number,
  usefulLifeMonths: number,
  startDate: Date,
): DepScheduleRow[] {
  const depreciableAmount = purchasePrice - salvageValue;
  const monthly = round4(depreciableAmount / usefulLifeMonths);
  const rows: DepScheduleRow[] = [];
  let booked = 0;
  for (let i = 1; i <= usefulLifeMonths; i++) {
    let amount = monthly;
    if (i === usefulLifeMonths) amount = round4(depreciableAmount - booked);
    booked = round4(booked + amount);
    rows.push({
      installmentNo: i,
      dueDate: addMonths(startDate, i),
      amount,
      balanceAfter: round4(purchasePrice - booked),
    });
  }
  return rows;
}

// WDV: monthly depreciation = openingBookValue × monthlyFactor.
//
// The monthly factor is derived one of three ways:
//   1. Caller supplies annualRatePct (e.g. 15% for a computer under Indian
//      Companies Act) → monthlyFactor = annualRatePct / 100 / 12.
//   2. No rate but salvage > 0 → auto-derive so book value hits salvage on
//      the last month: monthlyFactor = 1 - (salvage/cost)^(1/n).
//   3. No rate + salvage = 0 → double-declining fallback: 2/n.
//
// Because WDV asymptotes toward zero, method 3 never mathematically hits
// exactly 0 — the last row's amount is adjusted so balanceAfter lands on
// salvageValue (or 0). Same trick for methods 1 and 2 to defeat any float
// drift.
function buildWdv(
  purchasePrice: number,
  salvageValue: number,
  usefulLifeMonths: number,
  startDate: Date,
  annualRatePct: number | null,
): DepScheduleRow[] {
  let monthlyFactor: number;
  if (annualRatePct != null) {
    monthlyFactor = annualRatePct / 100 / 12;
  } else if (salvageValue > 0) {
    monthlyFactor = 1 - Math.pow(salvageValue / purchasePrice, 1 / usefulLifeMonths);
  } else {
    monthlyFactor = 2 / usefulLifeMonths;
  }

  const rows: DepScheduleRow[] = [];
  let book = purchasePrice;
  for (let i = 1; i <= usefulLifeMonths; i++) {
    // Never depreciate below salvage.
    let amount = round4(book * monthlyFactor);
    if (book - amount < salvageValue) amount = round4(book - salvageValue);
    if (amount < 0) amount = 0;
    book = round4(book - amount);
    rows.push({
      installmentNo: i,
      dueDate: addMonths(startDate, i),
      amount,
      balanceAfter: book,
    });
  }
  // Final adjustment so balanceAfter lands exactly on salvageValue.
  const last = rows[rows.length - 1];
  const residual = round4(last.balanceAfter - salvageValue);
  if (Math.abs(residual) > 0) {
    last.amount = round4(last.amount + residual);
    last.balanceAfter = salvageValue;
  }
  return rows;
}

export function buildDepreciationSchedule(
  purchasePrice: number,
  salvageValue: number,
  usefulLifeMonths: number,
  startDate: Date,
  method: DepreciationMethod = "Straight Line",
  wdvAnnualRatePct: number | null = null,
): DepScheduleRow[] {
  if (usefulLifeMonths <= 0) throw new Error("usefulLifeMonths must be > 0");
  if (purchasePrice <= 0) throw new Error("purchasePrice must be > 0");
  if (salvageValue < 0) throw new Error("salvageValue must be >= 0");
  if (salvageValue >= purchasePrice)
    throw new Error("salvageValue must be < purchasePrice");
  if (method === "WDV") {
    return buildWdv(
      purchasePrice,
      salvageValue,
      usefulLifeMonths,
      startDate,
      wdvAnnualRatePct,
    );
  }
  return buildStraightLine(purchasePrice, salvageValue, usefulLifeMonths, startDate);
}
