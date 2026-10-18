// AI extraction: vendor quote → supplier-quotation shape.
//
// Mirrors ai-invoice-extract.ts. A vendor emails a quote (PDF/image/text);
// we extract supplier identity + line items + totals so the Buying team can
// Supplier-Quotation it into the system without re-keying. The route layer
// persists to AIExtractionJob + creates a Draft SupplierQuotation.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

export interface ExtractedVendorQuoteLine {
  description: string;
  // Vendor's SKU/part number, when printed. Null if the quote is itemised
  // only by description (common for services).
  itemCode: string | null;
  qty: number;
  // UoM as printed — "Nos", "Kg", "Hrs", etc. Null if omitted.
  uom: string | null;
  rate: number;
  // Line total (qty * rate - lineDiscount). Preserved separately so the
  // UI can show the vendor's exact math even if rounding drifts.
  amount: number;
}

export interface ExtractedVendorQuote {
  // Supplier identity. Caller matches supplierName against existing
  // Supplier rows — if no match, offers "Create new supplier" in the UI.
  supplierName: string;
  supplierGstin: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierAddress: string | null;
  // Vendor's own reference numbers. quotationNo is their internal id;
  // rfqReference is their note of OUR RFQ number, if we sent one.
  quotationNo: string | null;
  rfqReference: string | null;
  quotationDate: string | null; // ISO YYYY-MM-DD
  validUntil: string | null;    // ISO YYYY-MM-DD; "Valid for 30 days"
  currency: string;             // 3-letter ISO
  // Payment / delivery terms as text so the UI can show them verbatim —
  // we don't try to parse "Net 30" into a payment-terms id.
  paymentTerms: string | null;
  deliveryTerms: string | null;
  // Lines
  lines: ExtractedVendorQuoteLine[];
  // Totals
  subtotal: number;
  taxAmount: number;
  shippingAmount: number;
  discountAmount: number;
  grandTotal: number;
  // Notes / caveats the vendor added — "Prices exclude GST", "FOB Mumbai",
  // etc. Appended to the SupplierQuotation.remarks field.
  notes: string;
}

const VENDOR_QUOTE_SYSTEM_PROMPT = `You are a procurement-document parser for an ERP system. Given a vendor quotation (image, PDF, OCR text, or email body) you must extract every field into strict JSON matching the response schema.

Rules:
* supplierName: the business entity on the vendor's letterhead. Not the chain parent — e.g. "Acme Steel Mumbai" not "Acme Steel Group Pvt Ltd" if both appear.
* supplierGstin: 15-char GSTIN if printed (format: 2 digits + 10 PAN chars + 1 digit + Z + 1 char). Null if the vendor is non-Indian or doesn't print one.
* quotationNo: the vendor's own quote id — "Q-2026/0042", "QT-21345", etc. Null if the quote has no id.
* rfqReference: our RFQ number if the vendor echoes it back ("Against your RFQ #..."). Null if the quote is unsolicited.
* quotationDate: ISO YYYY-MM-DD. Default to today if the quote is undated.
* validUntil: ISO YYYY-MM-DD. If the quote says "Valid for N days", compute from quotationDate.
* currency: 3-letter ISO. Infer from symbol or location (₹→INR, $→USD, €→EUR).
* paymentTerms: as-printed. "Net 30", "50% advance, 50% on delivery", "LC at sight", etc. Null if silent.
* deliveryTerms: as-printed. "FOB Mumbai", "Ex-works", "CIF Chennai", "7 days ARO", etc. Null if silent.
* lines: ONE object per lineitem row.
  - description: as-printed. Max 300 chars.
  - itemCode: vendor's part number if the row shows one. Null for description-only rows.
  - qty: numeric only. "10 Nos" → qty=10, uom="Nos".
  - uom: unit of measure as printed. "Nos", "Kg", "Meter", "Hrs", "Lot", etc. Null if the quote is unit-less.
  - rate: per-unit price.
  - amount: line total as printed (not qty*rate — the vendor may have applied a line-level discount).
* subtotal: sum of line amounts before tax/shipping/discount.
* taxAmount: total tax across all lines. 0 if tax-exempt.
* shippingAmount: freight / handling. 0 if not charged.
* discountAmount: invoice-level discount. 0 if none. (Line-level discounts are already baked into \`amount\`.)
* grandTotal: the final amount the buyer will pay.
* notes: anything else — "Prices exclude GST", lead-time notes, warranty terms, exclusions, assumptions. Max 500 chars. Empty string if nothing to add.

Never invent fields. For missing fields use null (strings) / 0 (numbers) / [] (lines) / "" (notes).

Return ONLY valid JSON matching the schema. No commentary.`;

const VENDOR_QUOTE_LINE_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
    itemCode:    { type: ["string", "null"] },
    qty:         { type: "number" },
    uom:         { type: ["string", "null"] },
    rate:        { type: "number" },
    amount:      { type: "number" },
  },
  required: ["description", "qty", "rate", "amount"],
} as const;

const VENDOR_QUOTE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    supplierName:     { type: "string" },
    supplierGstin:    { type: ["string", "null"] },
    supplierEmail:    { type: ["string", "null"] },
    supplierPhone:    { type: ["string", "null"] },
    supplierAddress:  { type: ["string", "null"] },
    quotationNo:      { type: ["string", "null"] },
    rfqReference:     { type: ["string", "null"] },
    quotationDate:    { type: ["string", "null"] },
    validUntil:       { type: ["string", "null"] },
    currency:         { type: "string" },
    paymentTerms:     { type: ["string", "null"] },
    deliveryTerms:    { type: ["string", "null"] },
    lines:            { type: "array", items: VENDOR_QUOTE_LINE_SCHEMA },
    subtotal:         { type: "number" },
    taxAmount:        { type: "number" },
    shippingAmount:   { type: "number" },
    discountAmount:   { type: "number" },
    grandTotal:       { type: "number" },
    notes:            { type: "string" },
  },
  required: [
    "supplierName", "currency", "lines",
    "subtotal", "taxAmount", "shippingAmount", "discountAmount", "grandTotal",
    "notes",
  ],
};

export interface VendorQuoteExtractInput {
  provider: LLMProvider;
  sourceText?: string;
  attachment?: { mimeType: string; base64Data: string };
  model?: string;
}

export async function extractVendorQuoteFromLLM(
  input: VendorQuoteExtractInput,
): Promise<LLMCallResult<ExtractedVendorQuote>> {
  const call: LLMCallInput = {
    system: VENDOR_QUOTE_SYSTEM_PROMPT,
    user: input.sourceText ?? "See attached vendor quotation.",
    attachments: input.attachment ? [input.attachment] : undefined,
    responseSchema: VENDOR_QUOTE_RESPONSE_SCHEMA,
    model: input.model,
    maxOutputTokens: 2500,
  };
  return input.provider.call<ExtractedVendorQuote>(call);
}

// Validation: catch the common LLM drift (subtotal vs line sum, grand total
// arithmetic, missing supplier identity). Returned warnings surface in the
// UI as a "check these before saving" banner rather than a hard error.
export function validateExtractedVendorQuote(
  q: ExtractedVendorQuote | Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  if (!q || typeof q !== "object" || !("grandTotal" in q)) {
    return [
      "Vendor quote could not be read. Configure an AI provider in Settings → AI, or enter the quote manually.",
    ];
  }
  const quote = q as ExtractedVendorQuote;
  if (!quote.supplierName || quote.supplierName.trim() === "") {
    warnings.push("Supplier name is blank — review before saving so this doesn't attach to the wrong vendor.");
  }
  // GSTIN format sanity. Spec: 2-digit state + 10-char PAN + 1 entity digit +
  // literal Z + 1 check character (A-Z or 0-9). Last position is alphanumeric,
  // not digit-only — a previous version used \d there and rejected valid
  // GSTINs ending in a letter.
  if (quote.supplierGstin && !/^\d{2}[A-Z0-9]{10}\d[A-Z][A-Z0-9]$/.test(quote.supplierGstin)) {
    warnings.push(`Extracted GSTIN "${quote.supplierGstin}" doesn't look valid — double-check before saving.`);
  }
  if (!Array.isArray(quote.lines) || quote.lines.length === 0) {
    warnings.push("No line items were extracted — the quote may be an image we couldn't OCR, or a cover letter.");
    return warnings;
  }
  // Subtotal vs line sum
  const lineSum = quote.lines.reduce((s, l) => s + Number(l?.amount ?? 0), 0);
  const subtotal = Number(quote.subtotal ?? 0);
  if (Math.abs(lineSum - subtotal) > 0.5) {
    warnings.push(
      `Line-sum ${lineSum.toFixed(2)} doesn't match extracted subtotal ${subtotal.toFixed(2)}.`,
    );
  }
  // Grand total check: subtotal + tax + shipping - discount
  const tax = Number(quote.taxAmount ?? 0);
  const ship = Number(quote.shippingAmount ?? 0);
  const disc = Number(quote.discountAmount ?? 0);
  const total = Number(quote.grandTotal ?? 0);
  const computed = subtotal + tax + ship - disc;
  if (total > 0 && Math.abs(computed - total) > 0.5) {
    warnings.push(
      `subtotal + tax + shipping − discount (${computed.toFixed(2)}) doesn't match grand total ${total.toFixed(2)}.`,
    );
  }
  return warnings;
}
