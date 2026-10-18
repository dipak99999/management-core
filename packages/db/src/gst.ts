import { PrismaClient } from "@prisma/client";

// O5 + O6: GST helpers. India-specific but structured so a different tax
// regime can extend them.
//
// gstr1 — GSTR-1: outward supplies summary. For each Submitted SI in
// the period, group its tax rows by rate and bucket into B2B (customer has
// GSTIN) vs B2C (no GSTIN). Returns per-rate totals of taxable value +
// tax amount.
//
// gstr3b — GSTR-3B: headline monthly summary. Section 3.1(a) = outward
// taxable supplies (excl. exempt), 4A = ITC available. Simplified: reads SI
// gross totals and PI tax rows, aggregated.

export interface Gstr1Row {
  rate: number;
  taxableValue: number;
  taxAmount: number;
  // Split populated when the tenant's homeStateCode is known:
  //  intra-state (customer.gstin.state === homeState) → CGST+SGST (equal halves)
  //  inter-state (else, including B2C exports) → IGST (full)
  igst: number;
  cgst: number;
  sgst: number;
  invoiceCount: number;
}

export interface Gstr1Result {
  from: string;
  to: string;
  b2b: Gstr1Row[];
  b2c: Gstr1Row[];
  totalTaxableValue: number;
  totalTax: number;
  totalIgst: number;
  totalCgst: number;
  totalSgst: number;
}

export interface Gstr1HsnRow {
  hsnCode: string;
  description: string;
  uom: string;
  totalQty: number;
  totalValue: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface Gstr1HsnResult {
  from: string;
  to: string;
  rows: Gstr1HsnRow[];
}

// State-code prefix on a 15-char GSTIN. Returns null for empty / malformed.
function stateCode(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const s = gstin.trim();
  if (s.length < 2) return null;
  return s.slice(0, 2);
}

export async function gstr1(
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Gstr1Result> {
  const [tenant, invoices] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { homeStateCode: true, companyGstin: true },
    }),
    prisma.salesInvoice.findMany({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        postingDate: { gte: from, lte: to },
        isReturn: false,
      },
      include: {
        customer: { select: { gstin: true } },
        taxes: true,
      },
    }),
  ]);

  const homeState = tenant?.homeStateCode ?? stateCode(tenant?.companyGstin);

  const b2bAgg = new Map<number, Gstr1Row>();
  const b2cAgg = new Map<number, Gstr1Row>();
  let totalTaxableValue = 0;
  let totalTax = 0;
  let totalIgst = 0;
  let totalCgst = 0;
  let totalSgst = 0;

  function emptyRow(rate: number): Gstr1Row {
    return {
      rate,
      taxableValue: 0,
      taxAmount: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      invoiceCount: 0,
    };
  }

  for (const inv of invoices) {
    const netTotal = Number(inv.netTotal);
    const bucket = inv.customer.gstin ? b2bAgg : b2cAgg;
    // Intra-state = tenant's home state matches customer state code AND we
    // know both. Missing metadata → default to inter-state (IGST) which is
    // safer for compliance since IGST fully replaces the CGST+SGST pair.
    const custState = stateCode(inv.customer.gstin);
    const isIntraState =
      !!homeState && !!custState && homeState === custState;

    if (inv.taxes.length === 0) {
      const cur = bucket.get(0) ?? emptyRow(0);
      cur.taxableValue += netTotal;
      cur.invoiceCount += 1;
      bucket.set(0, cur);
      totalTaxableValue += netTotal;
      continue;
    }
    for (const t of inv.taxes) {
      const rate = Number(t.rate);
      const taxAmt = Number(t.taxAmount);
      const cur = bucket.get(rate) ?? emptyRow(rate);
      cur.taxableValue += netTotal;
      cur.taxAmount += taxAmt;
      cur.invoiceCount += 1;
      if (isIntraState) {
        const half = taxAmt / 2;
        cur.cgst += half;
        cur.sgst += half;
        totalCgst += half;
        totalSgst += half;
      } else {
        cur.igst += taxAmt;
        totalIgst += taxAmt;
      }
      bucket.set(rate, cur);
      totalTaxableValue += netTotal;
      totalTax += taxAmt;
    }
  }

  const sortByRate = (a: Gstr1Row, b: Gstr1Row) => a.rate - b.rate;
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    b2b: [...b2bAgg.values()].sort(sortByRate),
    b2c: [...b2cAgg.values()].sort(sortByRate),
    totalTaxableValue,
    totalTax,
    totalIgst,
    totalCgst,
    totalSgst,
  };
}

// GSTR-1 HSN summary — one row per (hsnCode, uom). Aggregates qty +
// taxable value + tax split from SalesInvoiceItem + SalesInvoiceTax.
// Items without an hsnCode roll up under "UNCLASSIFIED".
export async function gstr1Hsn(
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Gstr1HsnResult> {
  const [tenant, invoices] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { homeStateCode: true, companyGstin: true },
    }),
    prisma.salesInvoice.findMany({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        postingDate: { gte: from, lte: to },
        isReturn: false,
      },
      include: {
        customer: { select: { gstin: true } },
        items: { include: { item: { select: { hsnCode: true, description: true, stockUom: true } } } },
        taxes: true,
      },
    }),
  ]);

  const homeState = tenant?.homeStateCode ?? stateCode(tenant?.companyGstin);
  const agg = new Map<string, Gstr1HsnRow>();

  for (const inv of invoices) {
    const netTotal = Number(inv.netTotal);
    if (netTotal === 0) continue;
    const custState = stateCode(inv.customer.gstin);
    const isIntraState =
      !!homeState && !!custState && homeState === custState;
    const invoiceTax = inv.taxes.reduce((s, t) => s + Number(t.taxAmount), 0);

    for (const line of inv.items) {
      const hsn = line.item.hsnCode ?? "UNCLASSIFIED";
      const uom = line.item.stockUom ?? "Nos";
      const key = `${hsn}|${uom}`;
      const cur =
        agg.get(key) ??
        {
          hsnCode: hsn,
          description: line.item.description ?? "",
          uom,
          totalQty: 0,
          totalValue: 0,
          taxableValue: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
        };
      const lineAmount = Number(line.amount);
      // Allocate the invoice's total tax to this line proportionally to its
      // share of the invoice's net total.
      const lineShare = netTotal > 0 ? lineAmount / netTotal : 0;
      const lineTax = invoiceTax * lineShare;
      cur.totalQty += Number(line.qty);
      cur.taxableValue += lineAmount;
      cur.totalValue += lineAmount + lineTax;
      if (isIntraState) {
        cur.cgst += lineTax / 2;
        cur.sgst += lineTax / 2;
      } else {
        cur.igst += lineTax;
      }
      agg.set(key, cur);
    }
  }

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    rows: [...agg.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode)),
  };
}

export interface Gstr3bResult {
  from: string;
  to: string;
  outward: {
    taxableSupplies: number; // 3.1(a)
    tax: number;
  };
  itc: {
    available: number; // 4A
  };
  liability: number; // outward.tax - itc.available (net)
}

// GSTR-9 annual return — mandatory yearly filing consolidating a full
// financial year of GSTR-1 + GSTR-3B. The government form has 19 tables;
// this MVP populates the ones that fall out of existing data:
//   Table 4  — Advances, inward, outward taxable supplies (per rate)
//   Table 5  — Exempt / nil-rated / non-GST outward supplies
//   Table 6  — ITC availed (per rate + type)
//   Table 9  — Tax paid (breakout by CGST/SGST/IGST/cess)
// Uses monthly GSTR-1 + GSTR-3B aggregators over the given FY window so
// the numbers reconcile exactly with the monthly filings.

export interface Gstr9MonthRow {
  monthLabel: string;    // "2026-04" (financial year month)
  outwardTaxable: number;
  outwardTax: number;
  itcAvailable: number;
  liability: number;
}

export interface Gstr9RateRow {
  rate: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoiceCount: number;
}

export interface Gstr9Result {
  fyLabel: string;         // "FY 2025-26"
  from: string;
  to: string;
  monthly: Gstr9MonthRow[];
  outwardByRate: Gstr9RateRow[];  // Table 4 (rolled-up B2B + B2C by rate)
  totals: {
    outwardTaxable: number;
    outwardTax: number;
    itcAvailable: number;
    liability: number;
    igst: number;
    cgst: number;
    sgst: number;
  };
}

// India FY runs Apr-1 to Mar-31. Given `from` = 2025-04-01, returns
// "FY 2025-26"; given the full window is one FY, both endpoints label
// correctly. Callers can pass any (from, to) — the label is best-effort
// display metadata, aggregation still respects the exact range.
function fyLabelFromRange(from: Date): string {
  const startYear = from.getUTCFullYear();
  const endYear = startYear + 1;
  return `FY ${startYear}-${String(endYear).slice(2)}`;
}

// Yields [start, end] pairs — one per calendar month between `from` and
// `to` (inclusive on both ends). Used to slice GSTR-9 into monthly rows
// so the sum-of-months matches each monthly GSTR-3B filing.
function monthWindows(from: Date, to: Date): { start: Date; end: Date }[] {
  const windows: { start: Date; end: Date }[] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= stop) {
    const monthEnd = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0, 23, 59, 59),
    );
    // Clip to the caller-supplied range on the first + last month.
    const start = cursor < from ? from : cursor;
    const end = monthEnd > to ? to : monthEnd;
    windows.push({ start, end });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return windows;
}

export async function gstr9(
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Gstr9Result> {
  const months = monthWindows(from, to);
  // Parallelise the per-month aggregation. Every helper is a Promise so
  // Promise.all lets us fan out the whole year in one round of queries.
  const [monthlyRaw, rateBucketed] = await Promise.all([
    Promise.all(
      months.map(async (w) => {
        const [m3b] = await Promise.all([gstr3b(prisma, tenantId, w.start, w.end)]);
        return {
          monthLabel: `${w.start.getUTCFullYear()}-${String(
            w.start.getUTCMonth() + 1,
          ).padStart(2, "0")}`,
          outwardTaxable: m3b.outward.taxableSupplies,
          outwardTax: m3b.outward.tax,
          itcAvailable: m3b.itc.available,
          liability: m3b.liability,
        };
      }),
    ),
    // One GSTR-1 over the whole FY gives us the by-rate roll-up (Table 4).
    // Rolling twelve monthly GSTR-1s + reducing produces the same numbers
    // but with 11x more DB round-trips.
    gstr1(prisma, tenantId, from, to),
  ]);

  const totals = monthlyRaw.reduce(
    (acc, m) => ({
      outwardTaxable: acc.outwardTaxable + m.outwardTaxable,
      outwardTax: acc.outwardTax + m.outwardTax,
      itcAvailable: acc.itcAvailable + m.itcAvailable,
      liability: acc.liability + m.liability,
    }),
    { outwardTaxable: 0, outwardTax: 0, itcAvailable: 0, liability: 0 },
  );

  const byRate = new Map<number, Gstr9RateRow>();
  for (const row of [...rateBucketed.b2b, ...rateBucketed.b2c]) {
    const cur =
      byRate.get(row.rate) ??
      { rate: row.rate, taxableValue: 0, igst: 0, cgst: 0, sgst: 0, invoiceCount: 0 };
    cur.taxableValue += row.taxableValue;
    cur.igst += row.igst;
    cur.cgst += row.cgst;
    cur.sgst += row.sgst;
    cur.invoiceCount += row.invoiceCount;
    byRate.set(row.rate, cur);
  }

  return {
    fyLabel: fyLabelFromRange(from),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    monthly: monthlyRaw,
    outwardByRate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    totals: {
      ...totals,
      igst: rateBucketed.totalIgst,
      cgst: rateBucketed.totalCgst,
      sgst: rateBucketed.totalSgst,
    },
  };
}

export async function gstr3b(
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Gstr3bResult> {
  const [outAgg, outTaxes, inTaxes] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        postingDate: { gte: from, lte: to },
        isReturn: false,
      },
      _sum: { netTotal: true, totalTaxes: true },
    }),
    prisma.salesInvoiceTax.aggregate({
      where: {
        salesInvoice: {
          tenantId,
          status: { in: ["Submitted", "Paid"] },
          postingDate: { gte: from, lte: to },
          isReturn: false,
        },
      },
      _sum: { taxAmount: true },
    }),
    prisma.purchaseInvoiceTax.aggregate({
      where: {
        purchaseInvoice: {
          tenantId,
          status: { in: ["Submitted", "Paid"] },
          postingDate: { gte: from, lte: to },
          isReturn: false,
        },
      },
      _sum: { taxAmount: true },
    }),
  ]);
  const outwardTaxable = Number(outAgg._sum.netTotal ?? 0);
  const outwardTax = Number(outTaxes._sum.taxAmount ?? Number(outAgg._sum.totalTaxes ?? 0));
  const itcAvailable = Number(inTaxes._sum.taxAmount ?? 0);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    outward: {
      taxableSupplies: outwardTaxable,
      tax: outwardTax,
    },
    itc: { available: itcAvailable },
    liability: outwardTax - itcAvailable,
  };
}
