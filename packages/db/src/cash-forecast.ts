// Module 56 — Cash forecast projection.
//
// Given the current cash+bank balance and lists of upcoming AR
// (Sales Invoice payment schedules), AP (Purchase Invoice due
// dates), and recurring subscriptions, project the daily / weekly
// cash position out N days.
//
// Pure module — takes pre-fetched arrays and returns bucketed
// projections. The route does the fetching + Prisma queries.
//
// Buckets: caller chooses granularity. Common uses:
//   * Daily for 30 days ("liquidity dashboard")
//   * Weekly for 90 days ("runway view")

export interface UpcomingReceipt {
  dueDate: Date;
  amount: number; // base currency
  sourceDoc: string; // e.g. "SI-0042"
  sourceKind: "SalesInvoice" | "Subscription" | "Loan" | "Other";
}

export interface UpcomingPayment {
  dueDate: Date;
  amount: number;
  sourceDoc: string;
  sourceKind: "PurchaseInvoice" | "PayrollEntry" | "Loan" | "Subscription" | "Other";
}

export interface ForecastBucket {
  fromDate: Date;
  toDate: Date;
  label: string; // e.g. "2026-03-15" (day) or "Week of 2026-03-15"
  inflow: number;
  outflow: number;
  net: number;
  runningBalance: number;
  // Line-level breakdowns for drill-down UI.
  receipts: UpcomingReceipt[];
  payments: UpcomingPayment[];
}

export interface CashForecastInput {
  openingBalance: number;
  asOfDate: Date;
  horizonDays: number;
  granularity: "daily" | "weekly";
  receipts: UpcomingReceipt[];
  payments: UpcomingPayment[];
}

export function forecastCashPosition(input: CashForecastInput): ForecastBucket[] {
  const buckets: ForecastBucket[] = [];
  const bucketSize = input.granularity === "daily" ? 1 : 7;
  const bucketCount = Math.ceil(input.horizonDays / bucketSize);

  let runningBalance = input.openingBalance;

  for (let i = 0; i < bucketCount; i++) {
    const fromDate = addDays(input.asOfDate, i * bucketSize);
    const toDate = addDays(input.asOfDate, (i + 1) * bucketSize - 1);
    // toDate at end-of-day UTC so a receipt dated ...23:59Z lands in that
    // day's bucket, not the next.
    toDate.setUTCHours(23, 59, 59, 999);

    const bReceipts = input.receipts.filter((r) => r.dueDate >= fromDate && r.dueDate <= toDate);
    const bPayments = input.payments.filter((p) => p.dueDate >= fromDate && p.dueDate <= toDate);

    const inflow = bReceipts.reduce((s, r) => s + r.amount, 0);
    const outflow = bPayments.reduce((s, p) => s + p.amount, 0);
    const net = inflow - outflow;
    runningBalance += net;

    buckets.push({
      fromDate,
      toDate,
      label:
        input.granularity === "daily"
          ? isoDate(fromDate)
          : `Week of ${isoDate(fromDate)}`,
      inflow,
      outflow,
      net,
      runningBalance,
      receipts: bReceipts,
      payments: bPayments,
    });
  }

  return buckets;
}

// Callers may want to know at which bucket the projection turns
// negative (running out of cash). Returns the index or -1 if never.
export function firstNegativeBucket(buckets: ForecastBucket[]): number {
  return buckets.findIndex((b) => b.runningBalance < 0);
}

// UTC-only date math so forecast buckets stay stable across server /
// client timezones. Business "day" in a forecast is a calendar day —
// no timezone semantics needed.
function addDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
