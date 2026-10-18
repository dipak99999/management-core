// AI extraction: receipt → expense-claim shape.
//
// Mirrors ai-invoice-extract.ts: pure module that takes an LLM provider +
// source content, returns a structured receipt. The route layer persists
// to AIExtractionJob + creates the Draft ExpenseClaim. Keep this file
// provider-agnostic so the model can be swapped per-tenant.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

export interface ExtractedReceipt {
  merchantName: string;
  // What the receipt is for — the LLM picks the best category it can
  // infer. Caller maps to the tenant's actual ExpenseCategory list.
  category:
    | "Travel"
    | "Meals"
    | "Lodging"
    | "Transportation"
    | "Office"
    | "Software"
    | "Equipment"
    | "Phone"
    | "Internet"
    | "Other";
  receiptDate: string | null; // ISO YYYY-MM-DD
  currency: string;           // 3-letter ISO
  // Line items where legible — one per food item at a restaurant, one
  // per leg of a flight, etc. If totally illegible the LLM returns [].
  lines: Array<{
    description: string;
    amount: number;
  }>;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  grandTotal: number;
  // Short free-form description the user can paste into the expense
  // claim's description field.
  description: string;
}

const RECEIPT_SYSTEM_PROMPT = `You are a receipt-extraction assistant for an expense-reporting system. Given a receipt (image, PDF, or OCR text) you must extract the fields into strict JSON matching the response schema.

Rules:
* merchantName: the business name on the receipt (not the chain parent — e.g. "Starbucks #1234" not "Starbucks Corporation").
* category: pick the single best match from the enum. "Other" ONLY if genuinely unclear.
* receiptDate: ISO YYYY-MM-DD. If multiple dates appear, use the transaction date (not the printed date).
* currency: 3-letter ISO code. Infer from symbol or location (₹→INR, $→USD, €→EUR, £→GBP, ¥→JPY).
* lines: itemised rows where visible. Leave empty if receipt is just a total.
* subtotal: amount before tax + tip. If only total is shown, estimate subtotal = total − tax − tip.
* tipAmount: tip/gratuity if shown (common on restaurant + rideshare receipts). Zero otherwise.
* grandTotal: the final amount the customer paid.
* description: 5-15 word summary suitable for an expense-claim description field (e.g. "Client lunch at Zuma Mumbai, 2 attendees").

Never invent fields. If the receipt is illegible, return reasonable defaults ("Unknown merchant", 0 amounts, empty lines, description "Receipt unreadable — please fill manually").

Return ONLY valid JSON matching the schema. No commentary.`;

const RECEIPT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    merchantName: { type: "string" },
    category: {
      type: "string",
      enum: ["Travel", "Meals", "Lodging", "Transportation", "Office", "Software", "Equipment", "Phone", "Internet", "Other"],
    },
    receiptDate: { type: ["string", "null"] },
    currency: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          amount: { type: "number" },
        },
        required: ["description", "amount"],
      },
    },
    subtotal: { type: "number" },
    taxAmount: { type: "number" },
    tipAmount: { type: "number" },
    grandTotal: { type: "number" },
    description: { type: "string" },
  },
  required: ["merchantName", "category", "currency", "lines", "subtotal", "taxAmount", "tipAmount", "grandTotal", "description"],
};

export interface ReceiptExtractInput {
  provider: LLMProvider;
  sourceText?: string;
  attachment?: { mimeType: string; base64Data: string };
  model?: string;
}

export async function extractReceiptFromLLM(input: ReceiptExtractInput): Promise<LLMCallResult<ExtractedReceipt>> {
  const call: LLMCallInput = {
    system: RECEIPT_SYSTEM_PROMPT,
    user: input.sourceText ?? "See attached receipt.",
    attachments: input.attachment ? [input.attachment] : undefined,
    responseSchema: RECEIPT_RESPONSE_SCHEMA,
    model: input.model,
    maxOutputTokens: 1200,
  };
  return input.provider.call<ExtractedReceipt>(call);
}

// Light validation: catch the common LLM drift (subtotal/tax/tip not
// summing to grandTotal). Returned warnings surface in the UI as a
// "check these before submit" banner rather than a hard error.
export function validateExtractedReceipt(r: ExtractedReceipt | Record<string, unknown>): string[] {
  const warnings: string[] = [];
  // Defensive: an empty object (no AI provider configured, stub returned
  // {}) means we can't validate at all — flag that + return.
  if (!r || typeof r !== "object" || !("grandTotal" in r)) {
    return ["Receipt could not be read. Configure an AI provider in Settings → AI, or fill the fields manually."];
  }
  const rec = r as ExtractedReceipt;
  const subtotal = Number(rec.subtotal ?? 0);
  const tax = Number(rec.taxAmount ?? 0);
  const tip = Number(rec.tipAmount ?? 0);
  const total = Number(rec.grandTotal ?? 0);
  const computed = subtotal + tax + tip;
  if (total > 0 && Math.abs(computed - total) > 0.5) {
    warnings.push(
      `subtotal + tax + tip (${computed.toFixed(2)}) doesn't match grand total ${total.toFixed(2)}`,
    );
  }
  if (Array.isArray(rec.lines) && rec.lines.length > 0) {
    const lineSum = rec.lines.reduce((s, l) => s + Number(l?.amount ?? 0), 0);
    if (Math.abs(lineSum - subtotal) > 0.5) {
      warnings.push(
        `Line-sum ${lineSum.toFixed(2)} doesn't match subtotal ${subtotal.toFixed(2)}`,
      );
    }
  }
  return warnings;
}
