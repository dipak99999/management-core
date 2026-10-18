// Module 54 — Invoice extraction prompt + response parser.
//
// Pure module: takes an LLMProvider + source content, returns a
// structured invoice shape. The route persists to AIExtractionJob +
// creates the Draft PurchaseInvoice.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

// Structured response shape the LLM must fill in.
export interface ExtractedInvoice {
  supplierName: string;
  supplierInvoiceNo: string | null;
  invoiceDate: string | null; // ISO date
  currency: string; // 3-letter code
  lines: Array<{
    description: string;
    qty: number;
    rate: number;
    amount: number;
  }>;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
}

const INVOICE_SYSTEM_PROMPT = `You are an invoice-extraction assistant for an ERP system. Given a supplier invoice (as PDF, image, or OCR text), extract the structured fields into strict JSON matching the schema. Rules:

* supplierName: the vendor/supplier name from the invoice header.
* supplierInvoiceNo: the vendor's own invoice number (not our PO number).
* invoiceDate: ISO YYYY-MM-DD.
* currency: 3-letter ISO code (INR/USD/EUR/…); if missing, infer from context (₹ → INR, $ → USD, € → EUR).
* lines: one row per line item. qty × rate should equal amount to within 0.01 rounding.
* subtotal: sum of line amounts before tax.
* taxAmount: total tax (GST/VAT/…). Zero if none shown.
* grandTotal: subtotal + taxAmount. Should equal the invoice's "total due".

Never invent line items. If a field is genuinely missing, use null (or 0 for numeric totals). Return ONLY valid JSON conforming to the response_format schema. No commentary.`;

const INVOICE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    supplierName: { type: "string" },
    supplierInvoiceNo: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"] },
    currency: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          qty: { type: "number" },
          rate: { type: "number" },
          amount: { type: "number" },
        },
        required: ["description", "qty", "rate", "amount"],
      },
    },
    subtotal: { type: "number" },
    taxAmount: { type: "number" },
    grandTotal: { type: "number" },
  },
  required: ["supplierName", "currency", "lines", "subtotal", "taxAmount", "grandTotal"],
};

export interface InvoiceExtractInput {
  provider: LLMProvider;
  // Either provide OCR text OR an attachment (base64 PDF/image).
  sourceText?: string;
  attachment?: { mimeType: string; base64Data: string };
  // For stub-driven tests, pass sourceText="STUB_INVOICE:" to force
  // the canned response.
  model?: string;
}

export async function extractInvoiceFromLLM(input: InvoiceExtractInput): Promise<LLMCallResult<ExtractedInvoice>> {
  const userContent = input.sourceText ?? "See attached invoice.";
  const call: LLMCallInput = {
    system: INVOICE_SYSTEM_PROMPT,
    user: userContent,
    attachments: input.attachment ? [input.attachment] : undefined,
    responseSchema: INVOICE_RESPONSE_SCHEMA,
    model: input.model,
    maxOutputTokens: 2000,
  };
  return input.provider.call<ExtractedInvoice>(call);
}

// Post-extraction sanity checks. The LLM sometimes drifts on totals —
// verify + optionally auto-correct rather than trusting blindly. Returns
// a list of warnings the UI can surface so the operator reviews before
// submit.
export function validateExtractedInvoice(inv: ExtractedInvoice): string[] {
  const warnings: string[] = [];
  const computedSubtotal = inv.lines.reduce((s, l) => s + l.amount, 0);
  if (Math.abs(computedSubtotal - inv.subtotal) > 0.5) {
    warnings.push(
      `Line-sum ${computedSubtotal.toFixed(2)} doesn't match extracted subtotal ${inv.subtotal.toFixed(2)}`,
    );
  }
  if (Math.abs(inv.subtotal + inv.taxAmount - inv.grandTotal) > 0.5) {
    warnings.push(
      `subtotal + tax (${(inv.subtotal + inv.taxAmount).toFixed(2)}) doesn't match grand total ${inv.grandTotal.toFixed(2)}`,
    );
  }
  for (const line of inv.lines) {
    const computed = line.qty * line.rate;
    if (Math.abs(computed - line.amount) > 0.5) {
      warnings.push(
        `Line "${line.description}": qty×rate (${computed.toFixed(2)}) doesn't match amount (${line.amount.toFixed(2)})`,
      );
    }
  }
  return warnings;
}
