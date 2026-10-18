import { Prisma, type PrismaClient } from "@prisma/client";

// India TDS (Tax Deducted at Source) helpers.
//
// Two pieces live here:
//   * Cumulative-YTD threshold check — Section 194C, 194J etc. treat
//     thresholds as "TDS applies once cumulative payments to a party in
//     the same financial year cross this amount". This helper computes
//     whether a given payment crosses the threshold given prior PE
//     history in the current FY.
//   * 26Q return generator — quarterly aggregation of TDS deducted per
//     party per section, in the row shape a CA needs for NSDL filing.

// India FY runs 1 April → 31 March. Given a date, return [fyStart, fyEnd].
export function fiscalYearWindow(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-indexed
  // If date is Jan-Mar, FY started previous calendar year.
  const startYear = m < 3 ? y - 1 : y;
  const start = new Date(Date.UTC(startYear, 3, 1)); // Apr 1
  const end = new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999)); // Mar 31
  return { start, end };
}

// Given a date, return the TDS quarter number (Q1 Apr-Jun, Q2 Jul-Sep,
// Q3 Oct-Dec, Q4 Jan-Mar) and its start/end. Matches NSDL 26Q quarters.
export function tdsQuarter(d: Date): {
  quarter: 1 | 2 | 3 | 4;
  start: Date;
  end: Date;
  fyLabel: string; // "2026-27"
} {
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  let quarter: 1 | 2 | 3 | 4;
  let startMonth: number;
  let startYear: number;
  let fyStartYear: number;
  if (m >= 3 && m <= 5) {
    quarter = 1;
    startMonth = 3;
    startYear = y;
    fyStartYear = y;
  } else if (m >= 6 && m <= 8) {
    quarter = 2;
    startMonth = 6;
    startYear = y;
    fyStartYear = y;
  } else if (m >= 9 && m <= 11) {
    quarter = 3;
    startMonth = 9;
    startYear = y;
    fyStartYear = y;
  } else {
    // Jan-Feb-Mar: Q4 of FY that started previous April
    quarter = 4;
    startMonth = 0;
    startYear = y;
    fyStartYear = y - 1;
  }
  const start = new Date(Date.UTC(startYear, startMonth, 1));
  const end = new Date(Date.UTC(startYear, startMonth + 3, 0, 23, 59, 59, 999));
  const fyLabel = `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
  return { quarter, start, end, fyLabel };
}

// Cumulative-YTD check: has this supplier crossed the threshold in the FY
// that contains `paymentDate`? Sums prior Submitted PE.paidAmount to the
// supplier + the current payment's amount.
//
// Returns:
//   { crossed: true } — TDS applies on current payment
//   { crossed: false, cumulative, threshold } — no TDS (below threshold)
export async function checkCumulativeYtdCrossed(
  prisma: PrismaClient | Prisma.TransactionClient,
  args: {
    tenantId: string;
    supplierId: string;
    paymentDate: Date;
    currentPaidAmount: number;
    thresholdAmount: number;
    excludePeId?: string; // when updating an existing PE, exclude its own prior amount
  },
): Promise<{ crossed: boolean; cumulative: number; threshold: number }> {
  const { start, end } = fiscalYearWindow(args.paymentDate);
  const priorAgg = await prisma.paymentEntry.aggregate({
    _sum: { paidAmount: true },
    where: {
      tenantId: args.tenantId,
      partyType: "Supplier",
      partyId: args.supplierId,
      paymentType: "Pay",
      status: "Submitted",
      postingDate: { gte: start, lte: end },
      ...(args.excludePeId ? { NOT: { id: args.excludePeId } } : {}),
    },
  });
  const prior = Number(priorAgg._sum.paidAmount ?? 0);
  const cumulative = prior + args.currentPaidAmount;
  return {
    crossed: cumulative >= args.thresholdAmount,
    cumulative,
    threshold: args.thresholdAmount,
  };
}

// --- 26Q quarterly return ---

export interface Tds26qRow {
  // Deductee (supplier) identity
  supplierId: string;
  supplierName: string;
  pan: string | null; // null → filer must use PAN-not-available flow at higher rate
  panAvailable: boolean;
  // Aggregation keys
  sectionCode: string; // e.g. "194C"; falls back to "OTHER" when category has none
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string;
  // Amounts (across all PEs in the quarter for this supplier + section)
  paymentCount: number;
  totalPaidAmount: number;
  totalTdsAmount: number;
  effectiveRate: number; // totalTdsAmount / totalPaidAmount * 100
  // Warning flags surfaced by the report
  missingPan: boolean; // true when pan is null (line files at higher no-PAN rate)
}

export interface Tds26qResult {
  tenantId: string;
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string;
  windowStart: Date;
  windowEnd: Date;
  rows: Tds26qRow[];
  totals: {
    supplierCount: number;
    totalPaidAmount: number;
    totalTdsAmount: number;
    rowsMissingPan: number;
  };
}

// Generate a 26Q return dataset for the given (tenant, FY-quarter). Includes
// every Submitted PE with withholdingAmount > 0 whose postingDate falls in
// the quarter. Rows aggregate by (supplier, section).
export async function generate26q(
  prisma: PrismaClient,
  tenantId: string,
  quarterOf: Date,
): Promise<Tds26qResult> {
  const { quarter, start, end, fyLabel } = tdsQuarter(quarterOf);

  const pes = await prisma.paymentEntry.findMany({
    where: {
      tenantId,
      status: "Submitted",
      paymentType: "Pay",
      partyType: "Supplier",
      postingDate: { gte: start, lte: end },
      withholdingAmount: { gt: 0 },
    },
    select: {
      id: true,
      partyId: true,
      paidAmount: true,
      withholdingAmount: true,
      withholdingRate: true,
      withholdingSection: true,
      withholdingCategoryId: true,
    },
  });

  if (pes.length === 0) {
    return {
      tenantId,
      quarter,
      fyLabel,
      windowStart: start,
      windowEnd: end,
      rows: [],
      totals: {
        supplierCount: 0,
        totalPaidAmount: 0,
        totalTdsAmount: 0,
        rowsMissingPan: 0,
      },
    };
  }

  // Resolve supplier PAN + name.
  const supplierIds = Array.from(new Set(pes.map((p) => p.partyId)));
  const suppliers = await prisma.supplier.findMany({
    where: { tenantId, id: { in: supplierIds } },
    select: { id: true, supplierName: true, pan: true },
  });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  // Section-code fallback: PE snapshots sectionCode at create time. For PEs
  // created before the snapshot column existed, look up the category directly.
  const missingSectionCategoryIds = Array.from(
    new Set(
      pes
        .filter((p) => !p.withholdingSection && p.withholdingCategoryId)
        .map((p) => p.withholdingCategoryId!),
    ),
  );
  let sectionByCategoryId = new Map<string, string | null>();
  if (missingSectionCategoryIds.length > 0) {
    const cats = await prisma.taxWithholdingCategory.findMany({
      where: { tenantId, id: { in: missingSectionCategoryIds } },
      select: { id: true, sectionCode: true },
    });
    sectionByCategoryId = new Map(
      cats.map((c) => [c.id, c.sectionCode ?? null] as const),
    );
  }

  // Aggregate by (supplierId, sectionCode).
  const bucketKey = (sid: string, sec: string) => `${sid}::${sec}`;
  const buckets = new Map<
    string,
    {
      supplierId: string;
      sectionCode: string;
      paymentCount: number;
      totalPaidAmount: number;
      totalTdsAmount: number;
    }
  >();

  for (const pe of pes) {
    const section =
      pe.withholdingSection ??
      (pe.withholdingCategoryId
        ? sectionByCategoryId.get(pe.withholdingCategoryId) ?? "OTHER"
        : "OTHER");
    const k = bucketKey(pe.partyId, section);
    const b = buckets.get(k);
    const paid = Number(pe.paidAmount);
    const tds = Number(pe.withholdingAmount);
    if (b) {
      b.paymentCount += 1;
      b.totalPaidAmount += paid;
      b.totalTdsAmount += tds;
    } else {
      buckets.set(k, {
        supplierId: pe.partyId,
        sectionCode: section,
        paymentCount: 1,
        totalPaidAmount: paid,
        totalTdsAmount: tds,
      });
    }
  }

  const rows: Tds26qRow[] = [];
  let grandPaid = 0;
  let grandTds = 0;
  let missingPanCount = 0;

  for (const b of buckets.values()) {
    const supplier = supplierById.get(b.supplierId);
    const pan = supplier?.pan ?? null;
    const panAvailable = !!pan;
    if (!panAvailable) missingPanCount += 1;
    const effectiveRate =
      b.totalPaidAmount > 0 ? (b.totalTdsAmount / b.totalPaidAmount) * 100 : 0;
    rows.push({
      supplierId: b.supplierId,
      supplierName: supplier?.supplierName ?? "(unknown)",
      pan,
      panAvailable,
      sectionCode: b.sectionCode,
      quarter,
      fyLabel,
      paymentCount: b.paymentCount,
      totalPaidAmount: round2(b.totalPaidAmount),
      totalTdsAmount: round2(b.totalTdsAmount),
      effectiveRate: round2(effectiveRate),
      missingPan: !panAvailable,
    });
    grandPaid += b.totalPaidAmount;
    grandTds += b.totalTdsAmount;
  }

  // Deterministic sort: section, then supplier name.
  rows.sort(
    (a, b) =>
      a.sectionCode.localeCompare(b.sectionCode) ||
      a.supplierName.localeCompare(b.supplierName),
  );

  return {
    tenantId,
    quarter,
    fyLabel,
    windowStart: start,
    windowEnd: end,
    rows,
    totals: {
      supplierCount: new Set(rows.map((r) => r.supplierId)).size,
      totalPaidAmount: round2(grandPaid),
      totalTdsAmount: round2(grandTds),
      rowsMissingPan: missingPanCount,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// India PAN: [A-Z]{5}[0-9]{4}[A-Z]. Length 10. 4th char encodes entity type
// (P=Individual, C=Company, H=HUF, F=Firm, A=AOP, T=Trust, B=BOI, L=LOP,
// J=Artificial Judicial Person, G=Govt). We don't validate 4th char strictly
// because CA-supplied PANs occasionally use non-standard codes.
export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
}

// ---------- TCS (Tax Collected at Source) ----------
//
// Symmetric to TDS but on the sales side. Section 206C(1H) requires
// collecting TCS on sales to a customer once cumulative annual sales cross
// ₹50L. Quarterly Form 27EQ mirrors 26Q shape.

// Cumulative-YTD check for TCS: has this customer's Submitted SI.netTotal
// in the current FY crossed the threshold? Excludes cancelled invoices.
// Optional `excludeSiId` prevents double-counting on SI update.
export async function checkCumulativeYtdSalesCrossed(
  prisma: PrismaClient | Prisma.TransactionClient,
  args: {
    tenantId: string;
    customerId: string;
    invoiceDate: Date;
    currentNetAmount: number;
    thresholdAmount: number;
    excludeSiId?: string;
  },
): Promise<{ crossed: boolean; cumulative: number; threshold: number }> {
  const { start, end } = fiscalYearWindow(args.invoiceDate);
  const priorAgg = await prisma.salesInvoice.aggregate({
    _sum: { netTotal: true },
    where: {
      tenantId: args.tenantId,
      customerId: args.customerId,
      status: "Submitted",
      postingDate: { gte: start, lte: end },
      ...(args.excludeSiId ? { NOT: { id: args.excludeSiId } } : {}),
    },
  });
  const prior = Number(priorAgg._sum.netTotal ?? 0);
  const cumulative = prior + args.currentNetAmount;
  return {
    crossed: cumulative >= args.thresholdAmount,
    cumulative,
    threshold: args.thresholdAmount,
  };
}

export interface Tcs27eqRow {
  customerId: string;
  customerName: string;
  pan: string | null;
  panAvailable: boolean;
  sectionCode: string;
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string;
  invoiceCount: number;
  totalNetAmount: number;
  totalTcsAmount: number;
  effectiveRate: number;
  missingPan: boolean;
}

export interface Tcs27eqResult {
  tenantId: string;
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string;
  windowStart: Date;
  windowEnd: Date;
  rows: Tcs27eqRow[];
  totals: {
    customerCount: number;
    totalNetAmount: number;
    totalTcsAmount: number;
    rowsMissingPan: number;
  };
}

// Form 27EQ generator — mirror of generate26q for TCS. Includes every
// Submitted SI (excluding returns) in the quarter with tcsAmount > 0.
// Aggregation grouped by (customer, section).
export async function generate27eq(
  prisma: PrismaClient,
  tenantId: string,
  quarterOf: Date,
): Promise<Tcs27eqResult> {
  const { quarter, start, end, fyLabel } = tdsQuarter(quarterOf);

  const sis = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      status: "Submitted",
      postingDate: { gte: start, lte: end },
      tcsAmount: { gt: 0 },
      isReturn: false,
    },
    select: {
      id: true,
      customerId: true,
      netTotal: true,
      tcsAmount: true,
      tcsRate: true,
      tcsSection: true,
      tcsCategoryId: true,
    },
  });

  if (sis.length === 0) {
    return {
      tenantId,
      quarter,
      fyLabel,
      windowStart: start,
      windowEnd: end,
      rows: [],
      totals: {
        customerCount: 0,
        totalNetAmount: 0,
        totalTcsAmount: 0,
        rowsMissingPan: 0,
      },
    };
  }

  const customerIds = Array.from(new Set(sis.map((s) => s.customerId)));
  const customers = await prisma.customer.findMany({
    where: { tenantId, id: { in: customerIds } },
    select: { id: true, customerName: true, pan: true },
  });
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const missingSectionCategoryIds = Array.from(
    new Set(
      sis
        .filter((s) => !s.tcsSection && s.tcsCategoryId)
        .map((s) => s.tcsCategoryId!),
    ),
  );
  let sectionByCategoryId = new Map<string, string | null>();
  if (missingSectionCategoryIds.length > 0) {
    const cats = await prisma.taxCollectionCategory.findMany({
      where: { tenantId, id: { in: missingSectionCategoryIds } },
      select: { id: true, sectionCode: true },
    });
    sectionByCategoryId = new Map(
      cats.map((c) => [c.id, c.sectionCode ?? null] as const),
    );
  }

  const bucketKey = (cid: string, sec: string) => `${cid}::${sec}`;
  const buckets = new Map<
    string,
    {
      customerId: string;
      sectionCode: string;
      invoiceCount: number;
      totalNetAmount: number;
      totalTcsAmount: number;
    }
  >();

  for (const si of sis) {
    const section =
      si.tcsSection ??
      (si.tcsCategoryId
        ? sectionByCategoryId.get(si.tcsCategoryId) ?? "OTHER"
        : "OTHER");
    const k = bucketKey(si.customerId, section);
    const b = buckets.get(k);
    const net = Number(si.netTotal);
    const tcs = Number(si.tcsAmount);
    if (b) {
      b.invoiceCount += 1;
      b.totalNetAmount += net;
      b.totalTcsAmount += tcs;
    } else {
      buckets.set(k, {
        customerId: si.customerId,
        sectionCode: section,
        invoiceCount: 1,
        totalNetAmount: net,
        totalTcsAmount: tcs,
      });
    }
  }

  const rows: Tcs27eqRow[] = [];
  let grandNet = 0;
  let grandTcs = 0;
  let missingPanCount = 0;

  for (const b of buckets.values()) {
    const customer = customerById.get(b.customerId);
    const pan = customer?.pan ?? null;
    const panAvailable = !!pan;
    if (!panAvailable) missingPanCount += 1;
    const effectiveRate =
      b.totalNetAmount > 0 ? (b.totalTcsAmount / b.totalNetAmount) * 100 : 0;
    rows.push({
      customerId: b.customerId,
      customerName: customer?.customerName ?? "(unknown)",
      pan,
      panAvailable,
      sectionCode: b.sectionCode,
      quarter,
      fyLabel,
      invoiceCount: b.invoiceCount,
      totalNetAmount: round2(b.totalNetAmount),
      totalTcsAmount: round2(b.totalTcsAmount),
      effectiveRate: round2(effectiveRate),
      missingPan: !panAvailable,
    });
    grandNet += b.totalNetAmount;
    grandTcs += b.totalTcsAmount;
  }

  rows.sort(
    (a, b) =>
      a.sectionCode.localeCompare(b.sectionCode) ||
      a.customerName.localeCompare(b.customerName),
  );

  return {
    tenantId,
    quarter,
    fyLabel,
    windowStart: start,
    windowEnd: end,
    rows,
    totals: {
      customerCount: new Set(rows.map((r) => r.customerId)).size,
      totalNetAmount: round2(grandNet),
      totalTcsAmount: round2(grandTcs),
      rowsMissingPan: missingPanCount,
    },
  };
}

// ---------- TDS challan tracking ----------

// India TDS deposit rule (§200): tax deducted in month M must be deposited
// by the 7th of month M+1 (April deposits by 7 May, etc). April+May+... run
// monthly; February deposits by 30 April of the next FY as a year-end reset.
// This helper computes what's DUE per (section, month) vs what's already
// been PAID via TdsChallan rows.

export interface TdsMonthlyDueRow {
  fyLabel: string;
  monthLabel: string; // "2026-08" (YYYY-MM)
  monthStart: Date;
  monthEnd: Date;
  categoryId: string;
  categoryName: string;
  sectionCode: string;
  deducted: number;
  paid: number;
  dueBalance: number; // deducted - paid; 0 or positive means fully paid
  challans: {
    id: string;
    bsrCode: string;
    challanSerialNo: string;
    paidDate: Date;
    amountPaid: number;
  }[];
}

/**
 * Monthly TDS due summary. For every (category, calendar-month) pair in the
 * requested FY window, sums deducted-TDS from Submitted Pay-to-Supplier PEs
 * and subtracts the TdsChallan deposits recorded against that category for
 * the matching quarter+month.
 *
 * The `dueBalance` field is what the tenant still owes the govt. Negative
 * = they overpaid (rare — usually a data-entry error).
 */
export async function computeMonthlyTdsDue(
  prisma: PrismaClient,
  tenantId: string,
  fyDate: Date,
): Promise<TdsMonthlyDueRow[]> {
  const { start, end } = fiscalYearWindow(fyDate);

  // All deducted TDS in the FY.
  const pes = await prisma.paymentEntry.findMany({
    where: {
      tenantId,
      status: "Submitted",
      paymentType: "Pay",
      partyType: "Supplier",
      postingDate: { gte: start, lte: end },
      withholdingAmount: { gt: 0 },
      withholdingCategoryId: { not: null },
    },
    select: {
      postingDate: true,
      withholdingAmount: true,
      withholdingCategoryId: true,
    },
  });

  // All challans in the FY (grouped by category + month via paidDate → month
  // logic below). Load once.
  const challans = await prisma.tdsChallan.findMany({
    where: { tenantId, paidDate: { gte: start, lte: end } },
    orderBy: { paidDate: "asc" },
  });

  const catIds = Array.from(
    new Set([
      ...pes.map((p) => p.withholdingCategoryId!).filter(Boolean),
      ...challans.map((c) => c.categoryId),
    ]),
  );
  const cats = await prisma.taxWithholdingCategory.findMany({
    where: { tenantId, id: { in: catIds } },
    select: { id: true, name: true, sectionCode: true },
  });
  const catById = new Map(cats.map((c) => [c.id, c]));

  // Group PEs by (categoryId, calendar-month).
  interface Bucket {
    fyLabel: string;
    monthLabel: string;
    monthStart: Date;
    monthEnd: Date;
    categoryId: string;
    deducted: number;
    challans: TdsMonthlyDueRow["challans"];
  }
  const buckets = new Map<string, Bucket>();
  const monthKey = (d: Date, categoryId: string) => {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return `${y}-${String(m + 1).padStart(2, "0")}::${categoryId}`;
  };

  for (const pe of pes) {
    if (!pe.withholdingCategoryId) continue;
    const d = pe.postingDate;
    const k = monthKey(d, pe.withholdingCategoryId);
    let b = buckets.get(k);
    if (!b) {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      b = {
        fyLabel: tdsQuarter(d).fyLabel,
        monthLabel: `${y}-${String(m + 1).padStart(2, "0")}`,
        monthStart: new Date(Date.UTC(y, m, 1)),
        monthEnd: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
        categoryId: pe.withholdingCategoryId,
        deducted: 0,
        challans: [],
      };
      buckets.set(k, b);
    }
    b.deducted += Number(pe.withholdingAmount);
  }

  // Attach challans to matching (category, calendar-month-of-paidDate) buckets.
  // Rationale: the deposit is meant to cover deductions of the PRIOR month
  // (M-1 deposit by 7 of M). But CAs commonly enter challan paidDate = 5th
  // of month, so we bucket by paidDate's calendar-month for the summary
  // view. The 26Q return uses the FY-quarter that contains the challan.
  for (const c of challans) {
    const d = c.paidDate;
    // A challan deposited on 5 Aug covers July deductions — so bucket it
    // against the PREVIOUS month for the due-balance view. Handles the
    // Apr 1 wrap correctly (Jan is prev-year in the same FY per
    // fiscalYearWindow, so no special-case needed).
    const priorMonth = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15),
    );
    const k = monthKey(priorMonth, c.categoryId);
    const b = buckets.get(k);
    if (b) {
      b.challans.push({
        id: c.id,
        bsrCode: c.bsrCode,
        challanSerialNo: c.challanSerialNo,
        paidDate: c.paidDate,
        amountPaid: Number(c.amountPaid),
      });
    }
    // If no matching deducted bucket, the challan is either misdated or the
    // deductions were reversed after payment — surface as an orphan in a
    // future report. Not modeled here.
  }

  const rows: TdsMonthlyDueRow[] = [];
  for (const b of buckets.values()) {
    const cat = catById.get(b.categoryId);
    const paid = b.challans.reduce((s, c) => s + c.amountPaid, 0);
    rows.push({
      fyLabel: b.fyLabel,
      monthLabel: b.monthLabel,
      monthStart: b.monthStart,
      monthEnd: b.monthEnd,
      categoryId: b.categoryId,
      categoryName: cat?.name ?? "(deleted category)",
      sectionCode: cat?.sectionCode ?? "OTHER",
      deducted: round2(b.deducted),
      paid: round2(paid),
      dueBalance: round2(b.deducted - paid),
      challans: b.challans,
    });
  }
  // Chronological by month, then by section within a month.
  rows.sort(
    (a, b) =>
      a.monthLabel.localeCompare(b.monthLabel) ||
      a.sectionCode.localeCompare(b.sectionCode),
  );
  return rows;
}

// ---------- Form 16A data loader ----------

export interface Form16aPayment {
  peName: string;
  paidDate: Date;
  paidAmount: number;
  tdsAmount: number;
  tdsRate: number;
  section: string;
  challanNo: string | null;
  challanDate: Date | null;
}

export interface Form16aData {
  supplier: { supplierName: string; pan: string | null; gstin: string | null };
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string;
  windowStart: Date;
  windowEnd: Date;
  payments: Form16aPayment[];
  totals: { totalPaid: number; totalTds: number };
}

/**
 * Loads the payments + linked challans needed to render Form 16A for a
 * specific (supplier, FY-quarter). Challan matching: challan.paidDate falls
 * within (month-after-payment) window for the same section. When no matching
 * challan is found, that PE row's challan fields stay null and the PDF
 * disclaimer surfaces "TDS has not yet been deposited to the government".
 */
export async function loadForm16aData(
  prisma: PrismaClient,
  tenantId: string,
  supplierId: string,
  quarterOf: Date,
): Promise<Form16aData> {
  const { quarter, start, end, fyLabel } = tdsQuarter(quarterOf);

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, tenantId },
    select: { supplierName: true, pan: true, gstin: true },
  });
  if (!supplier) throw new Error(`Supplier ${supplierId} not found`);

  const pes = await prisma.paymentEntry.findMany({
    where: {
      tenantId,
      partyType: "Supplier",
      partyId: supplierId,
      paymentType: "Pay",
      status: "Submitted",
      postingDate: { gte: start, lte: end },
      withholdingAmount: { gt: 0 },
    },
    orderBy: { postingDate: "asc" },
    select: {
      name: true,
      postingDate: true,
      paidAmount: true,
      withholdingAmount: true,
      withholdingRate: true,
      withholdingSection: true,
      withholdingCategoryId: true,
    },
  });

  // Load challans for the quarter+FY so we can attach to each PE row.
  const challans = await prisma.tdsChallan.findMany({
    where: { tenantId, fyLabel, quarter },
    orderBy: { paidDate: "asc" },
  });

  // For legacy PEs missing withholdingSection, look up categories.
  const missingSectionCatIds = Array.from(
    new Set(
      pes.filter((p) => !p.withholdingSection && p.withholdingCategoryId).map(
        (p) => p.withholdingCategoryId!,
      ),
    ),
  );
  const sectionByCat = new Map<string, string | null>();
  if (missingSectionCatIds.length > 0) {
    const cats = await prisma.taxWithholdingCategory.findMany({
      where: { tenantId, id: { in: missingSectionCatIds } },
      select: { id: true, sectionCode: true },
    });
    for (const c of cats) sectionByCat.set(c.id, c.sectionCode ?? null);
  }

  // Simple matcher: challan.categoryId === pe.withholdingCategoryId AND
  // challan.paidDate is in the month AFTER pe.postingDate (§200 rule).
  // First matching challan wins per PE.
  function findChallan(
    pePostingDate: Date,
    peCategoryId: string | null,
  ): { challanNo: string | null; challanDate: Date | null } {
    if (!peCategoryId) return { challanNo: null, challanDate: null };
    const targetMonth = pePostingDate.getUTCMonth() + 1;
    const targetYear = pePostingDate.getUTCFullYear() + (targetMonth > 11 ? 1 : 0);
    const normMonth = targetMonth > 11 ? 0 : targetMonth;
    const monthStart = new Date(Date.UTC(targetYear, normMonth, 1));
    const monthEnd = new Date(
      Date.UTC(targetYear, normMonth + 1, 0, 23, 59, 59, 999),
    );
    const match = challans.find(
      (c) =>
        c.categoryId === peCategoryId &&
        c.paidDate >= monthStart &&
        c.paidDate <= monthEnd,
    );
    return match
      ? {
          challanNo: `${match.bsrCode}-${match.challanSerialNo}`,
          challanDate: match.paidDate,
        }
      : { challanNo: null, challanDate: null };
  }

  const payments: Form16aPayment[] = pes.map((pe) => {
    const section =
      pe.withholdingSection ??
      (pe.withholdingCategoryId
        ? sectionByCat.get(pe.withholdingCategoryId) ?? "OTHER"
        : "OTHER");
    const challan = findChallan(pe.postingDate, pe.withholdingCategoryId);
    return {
      peName: pe.name,
      paidDate: pe.postingDate,
      paidAmount: Number(pe.paidAmount),
      tdsAmount: Number(pe.withholdingAmount),
      tdsRate: Number(pe.withholdingRate),
      section,
      challanNo: challan.challanNo,
      challanDate: challan.challanDate,
    };
  });

  const totalPaid = payments.reduce((s, p) => s + p.paidAmount, 0);
  const totalTds = payments.reduce((s, p) => s + p.tdsAmount, 0);

  return {
    supplier,
    quarter,
    fyLabel,
    windowStart: start,
    windowEnd: end,
    payments,
    totals: { totalPaid: round2(totalPaid), totalTds: round2(totalTds) },
  };
}
