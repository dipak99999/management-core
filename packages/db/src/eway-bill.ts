// E-way bill payload builder — India GST compliance.
//
// The e-way bill is a document required for the movement of goods worth
// more than ₹50,000 (₹100,000 in some states). The government e-way bill
// portal (ewaybillgst.gov.in) accepts a JSON payload with a fixed schema;
// GSPs (Cygnet, IRIS, Masters India, etc.) proxy submission via their
// APIs. This module builds the payload from a SalesInvoice + minimal
// transport details supplied by the operator at generation time.
//
// Live submission to the e-way bill portal via a GSP is out of scope
// (matches the IRP e-invoice pattern — the stub adapter satisfies the
// data-model contract; live wiring is per-tenant TenantIntegration config).
//
// Reference: NIC e-way bill JSON spec v1.03 (govt.gov.in). Field names
// are UpperCamelCase per that spec — do NOT rename to project convention.

// -----------------------------------------------------------------------
// Enums per the NIC e-way bill spec. Kept as string literals so callers
// can pass values from admin UI dropdowns without re-typing constants.

export type SupplyType = "O" | "I"; // Outward | Inward
export type EwayDocType = "INV" | "CHL" | "BIL" | "BOE" | "CNT" | "OTH";
export type SubSupplyType =
  | "1"  // Supply
  | "2"  // Import
  | "3"  // Export
  | "4"  // Job Work
  | "5"  // For Own Use
  | "6"  // Job Work Returns
  | "7"  // Sales Return
  | "8"  // Others
  | "9"  // SKD/CKD
  | "10" // Line Sales
  | "11" // Recipient Not Known
  | "12"; // Exhibition or Fairs
export type TransactionType =
  | 1 // Regular
  | 2 // Bill To - Ship To
  | 3 // Bill From - Dispatch From
  | 4; // Combination of 2 and 3
export type TransMode =
  | 1 // Road
  | 2 // Rail
  | 3 // Air
  | 4; // Ship

// -----------------------------------------------------------------------
// Input shapes — these mirror what a route handler has after joining
// SalesInvoice + Customer + Item + tenant defaults. Kept dependency-free
// (no Prisma types) so this module is testable in isolation.

export interface EwayInvoice {
  name: string;              // SI-0001 → maps to DocNo
  postingDate: Date | string; // → DocDate (YYYY-MM-DD in payload)
  netTotal: number;
  totalTaxes: number;
  grandTotal: number;
  items: EwayInvoiceLine[];
  taxes: EwayTaxLine[];
}

export interface EwayInvoiceLine {
  itemName: string;
  itemDescription?: string | null;
  hsnCode?: string | null;
  qty: number;
  uom: string;
  amount: number;             // line net (qty × rate)
}

export interface EwayTaxLine {
  description: string;   // "CGST @ 9%" — used to infer tax type
  rate: number;          // 9, 18, etc.
  taxAmount: number;
}

export interface EwayParty {
  gstin: string | null;
  legalName: string;
  address: string;
  place: string;
  pincode: string;
  stateCode: string;    // 2-digit numeric
}

export interface EwayTransport {
  transactionType: TransactionType;
  subSupplyType: SubSupplyType;
  transDistance: number;      // km
  transMode?: TransMode;
  transporterId?: string | null;    // 15-char GSTIN of the transporter
  transporterName?: string | null;
  vehicleNo?: string | null;        // for TransMode=1
  transDocNo?: string | null;       // LR number for rail/air/ship
  transDocDate?: Date | string | null;
}

// -----------------------------------------------------------------------
// Payload spec (subset) — the exact keys NIC accepts. UpperCamelCase.

export interface EwayBillPayload {
  supplyType: SupplyType;
  subSupplyType: SubSupplyType;
  docType: EwayDocType;
  docNo: string;
  docDate: string; // DD/MM/YYYY per NIC spec
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromPlace: string;
  fromPincode: string;
  fromStateCode: string;
  actualFromStateCode: string;
  toGstin: string;   // URP (unregistered person) if B2C
  toTrdName: string;
  toAddr1: string;
  toPlace: string;
  toPincode: string;
  toStateCode: string;
  actualToStateCode: string;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  totInvValue: number;
  transactionType: TransactionType;
  transMode?: TransMode;
  transDistance: number;
  transporterId?: string;
  transporterName?: string;
  vehicleNo?: string;
  transDocNo?: string;
  transDocDate?: string;
  itemList: {
    productName: string;
    productDesc: string;
    hsnCode: string;
    quantity: number;
    qtyUnit: string;
    taxableAmount: number;
    sgstRate: number;
    cgstRate: number;
    igstRate: number;
    cessRate: number;
  }[];
}

// -----------------------------------------------------------------------
// Formatting helpers (spec-mandated DD/MM/YYYY for dates; "URP" for
// unregistered buyers).

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// -----------------------------------------------------------------------
// Tax split. The NIC portal expects the invoice-level CGST/SGST/IGST
// values already computed — the invoice's SalesInvoiceTax rows carry a
// `description` like "CGST @ 9%" that we pattern-match.
//
// classifyTaxLine returns which bucket the tax amount belongs to. Lines
// that don't match any known pattern fall through to `cess` (safer than
// silently double-counting into GST).

export type TaxBucket = "cgst" | "sgst" | "igst" | "cess";

export function classifyTaxLine(description: string): TaxBucket {
  const d = description.toLowerCase();
  if (d.includes("igst")) return "igst";
  if (d.includes("cgst")) return "cgst";
  if (d.includes("sgst") || d.includes("utgst")) return "sgst";
  return "cess";
}

/**
 * Roll up per-tax-row amounts into the four e-way bill buckets. Returns a
 * plain object; empty buckets stay at 0.
 */
export function splitTaxes(
  taxes: EwayTaxLine[],
): { cgst: number; sgst: number; igst: number; cess: number } {
  const totals = { cgst: 0, sgst: 0, igst: 0, cess: 0 };
  for (const t of taxes) totals[classifyTaxLine(t.description)] += t.taxAmount;
  return totals;
}

/**
 * Item-level tax rates for the ItemList. We can't recover the exact per-
 * line rate from an invoice-level tax row without knowing which lines it
 * applied to — but for the e-way bill portal, per-item rates only need to
 * be *representative*, not perfectly reconstructed. We use the average
 * rate of each bucket across all taxes on the invoice.
 */
export function averageRates(taxes: EwayTaxLine[]): {
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
} {
  const buckets: Record<TaxBucket, { rateSum: number; count: number }> = {
    cgst: { rateSum: 0, count: 0 },
    sgst: { rateSum: 0, count: 0 },
    igst: { rateSum: 0, count: 0 },
    cess: { rateSum: 0, count: 0 },
  };
  for (const t of taxes) {
    const b = buckets[classifyTaxLine(t.description)];
    b.rateSum += t.rate;
    b.count += 1;
  }
  const rate = (b: { rateSum: number; count: number }) =>
    b.count > 0 ? b.rateSum / b.count : 0;
  return {
    cgstRate: rate(buckets.cgst),
    sgstRate: rate(buckets.sgst),
    igstRate: rate(buckets.igst),
    cessRate: rate(buckets.cess),
  };
}

// -----------------------------------------------------------------------
// Main builder.

/**
 * Assemble the full NIC-spec payload for an outward supply e-way bill.
 * Route handler is responsible for loading the invoice + parties + tenant
 * defaults; this function only assembles the payload.
 */
export function buildEwayBillPayload(
  invoice: EwayInvoice,
  from: EwayParty,
  to: EwayParty,
  transport: EwayTransport,
): EwayBillPayload {
  const split = splitTaxes(invoice.taxes);
  const rates = averageRates(invoice.taxes);

  // URP ("Unregistered Person") is the placeholder for B2C when the buyer
  // has no GSTIN. Some fields on the payload are still required so we
  // stamp "URP" per NIC guidance.
  const toGstin = to.gstin && to.gstin.length === 15 ? to.gstin : "URP";

  return {
    supplyType: "O",
    subSupplyType: transport.subSupplyType,
    docType: "INV",
    docNo: invoice.name,
    docDate: fmtDate(invoice.postingDate),
    fromGstin: from.gstin ?? "",
    fromTrdName: from.legalName,
    fromAddr1: from.address,
    fromPlace: from.place,
    fromPincode: from.pincode,
    fromStateCode: from.stateCode,
    actualFromStateCode: from.stateCode,
    toGstin,
    toTrdName: to.legalName,
    toAddr1: to.address,
    toPlace: to.place,
    toPincode: to.pincode,
    toStateCode: to.stateCode,
    actualToStateCode: to.stateCode,
    totalValue: round2(invoice.netTotal),
    cgstValue: round2(split.cgst),
    sgstValue: round2(split.sgst),
    igstValue: round2(split.igst),
    cessValue: round2(split.cess),
    totInvValue: round2(invoice.grandTotal),
    transactionType: transport.transactionType,
    transMode: transport.transMode,
    transDistance: transport.transDistance,
    ...(transport.transporterId ? { transporterId: transport.transporterId } : {}),
    ...(transport.transporterName ? { transporterName: transport.transporterName } : {}),
    ...(transport.vehicleNo ? { vehicleNo: transport.vehicleNo } : {}),
    ...(transport.transDocNo ? { transDocNo: transport.transDocNo } : {}),
    ...(transport.transDocDate
      ? { transDocDate: fmtDate(transport.transDocDate) }
      : {}),
    itemList: invoice.items.map((line) => ({
      productName: line.itemName,
      productDesc: line.itemDescription ?? line.itemName,
      hsnCode: line.hsnCode ?? "",
      quantity: line.qty,
      qtyUnit: line.uom,
      taxableAmount: round2(line.amount),
      sgstRate: round2(rates.sgstRate),
      cgstRate: round2(rates.cgstRate),
      igstRate: round2(rates.igstRate),
      cessRate: round2(rates.cessRate),
    })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// -----------------------------------------------------------------------
// EWayBill lifecycle helpers — the schema model `EWayBill` records what
// the NIC portal returned; these compute derived values (validity end,
// extension day-count) that the routes stamp on the row.

export type EwbCargoType = "Normal" | "ODC";

// Km-per-day denominator by cargo type. NIC rule 138(10):
//   Normal → 200 km/day
//   ODC / multi-modal → 20 km/day
const KM_PER_DAY: Record<EwbCargoType, number> = { Normal: 200, ODC: 20 };

/**
 * NIC validity rule (rule 138(10)):
 *   Normal cargo: distance ≤ 200 km → 1 day; every additional 200 km → +1 day.
 *   ODC / multi-modal: same ceiling logic but 20 km/day.
 *
 * Day here is a 24-hour window starting at generation.
 */
export function computeEwbValidity(
  distanceKm: number,
  generatedAt: Date,
  cargoType: EwbCargoType = "Normal",
): { validFrom: Date; validTo: Date; validityDays: number } {
  const km = Math.max(1, Math.ceil(distanceKm));
  const denom = KM_PER_DAY[cargoType] ?? KM_PER_DAY.Normal;
  const days = Math.max(1, Math.ceil(km / denom));
  const validTo = new Date(generatedAt.getTime() + days * 24 * 60 * 60 * 1000);
  return { validFrom: generatedAt, validTo, validityDays: days };
}

/**
 * Extension quote — the portal permits extension in the last 8 hours of
 * current validity, or within 8 hours after expiry. `additionalDistanceKm`
 * uses the SAME per-cargo-type multiplier as the original EWB (caller
 * passes cargoType from the persisted row).
 *
 * Returns:
 *   ok=false when the current time is outside the extension window
 *   ok=true with a new `validTo` computed as the LATE of (now, previous validTo)
 *   plus additional days.
 */
export function quoteEwbExtension(input: {
  currentValidTo: Date;
  additionalDistanceKm: number;
  now: Date;
  cargoType?: EwbCargoType;
}): {
  ok: boolean;
  reason?: string;
  newValidTo: Date;
  additionalDays: number;
} {
  const eightHoursMs = 8 * 60 * 60 * 1000;
  const windowStart = new Date(input.currentValidTo.getTime() - eightHoursMs);
  const windowEnd = new Date(input.currentValidTo.getTime() + eightHoursMs);
  if (input.now < windowStart) {
    return {
      ok: false,
      reason:
        "Extension window opens 8 hours before current validity ends",
      newValidTo: input.currentValidTo,
      additionalDays: 0,
    };
  }
  if (input.now > windowEnd) {
    return {
      ok: false,
      reason:
        "Extension window closed (already 8 hours past expiry)",
      newValidTo: input.currentValidTo,
      additionalDays: 0,
    };
  }
  const km = Math.max(1, Math.ceil(input.additionalDistanceKm));
  const denom = KM_PER_DAY[input.cargoType ?? "Normal"] ?? KM_PER_DAY.Normal;
  const additionalDays = Math.max(1, Math.ceil(km / denom));
  // If already past validity, extension starts from `now`. Otherwise it
  // ADDS to the existing validity end.
  const anchor =
    input.now > input.currentValidTo ? input.now : input.currentValidTo;
  const newValidTo = new Date(
    anchor.getTime() + additionalDays * 24 * 60 * 60 * 1000,
  );
  return { ok: true, newValidTo, additionalDays };
}

/**
 * Cancel window — 24 hours from generation, per NIC rule 138(9).
 * Returns whether the EWB can still be cancelled.
 */
export function canCancelEwb(input: { ewbDate: Date; now: Date }): {
  ok: boolean;
  reason?: string;
} {
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = new Date(input.ewbDate.getTime() + dayMs);
  if (input.now > cutoff) {
    return {
      ok: false,
      reason: "Cancel window closed (must cancel within 24h of generation)",
    };
  }
  return { ok: true };
}
