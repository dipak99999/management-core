import { describe, expect, it } from "vitest";
import { extractInvoiceFromLLM, validateExtractedInvoice } from "./ai-invoice-extract";
import { AUTO_APPLY_THRESHOLD, shouldAutoApply, triageTicketFromLLM } from "./ai-ticket-triage";
import { stubProvider } from "./llm";

describe("extractInvoiceFromLLM (stub)", () => {
  it("returns the canned invoice for STUB_INVOICE: sentinel", async () => {
    const r = await extractInvoiceFromLLM({
      provider: stubProvider,
      sourceText: "STUB_INVOICE: any content",
    });
    expect(r.parsed.supplierName).toBe("Acme Widgets Ltd");
    expect(r.parsed.lines).toHaveLength(2);
    expect(r.parsed.grandTotal).toBe(5900);
    expect(r.provider).toBe("stub");
    expect(r.inputTokens).toBeGreaterThan(0);
  });

  it("returns empty object for unrecognized prompts (real-provider fallback)", async () => {
    const r = await extractInvoiceFromLLM({
      provider: stubProvider,
      sourceText: "random invoice text",
    });
    // Stub returns {} — parsing would fail downstream but that's the
    // route's job to handle. We're just verifying the stub is a
    // no-op for real content.
    expect(r.parsed).toEqual({});
  });
});

describe("validateExtractedInvoice", () => {
  it("returns no warnings for a self-consistent invoice", () => {
    const w = validateExtractedInvoice({
      supplierName: "X",
      supplierInvoiceNo: "1",
      invoiceDate: "2026-01-01",
      currency: "INR",
      lines: [{ description: "A", qty: 2, rate: 100, amount: 200 }],
      subtotal: 200,
      taxAmount: 36,
      grandTotal: 236,
    });
    expect(w).toEqual([]);
  });

  it("catches line-sum mismatch", () => {
    const w = validateExtractedInvoice({
      supplierName: "X",
      supplierInvoiceNo: null,
      invoiceDate: null,
      currency: "INR",
      lines: [{ description: "A", qty: 2, rate: 100, amount: 200 }],
      subtotal: 250, // wrong — should be 200
      taxAmount: 0,
      grandTotal: 250,
    });
    expect(w.some((x) => x.includes("Line-sum"))).toBe(true);
  });

  it("catches per-line qty×rate ≠ amount", () => {
    const w = validateExtractedInvoice({
      supplierName: "X",
      supplierInvoiceNo: null,
      invoiceDate: null,
      currency: "INR",
      lines: [{ description: "A", qty: 2, rate: 100, amount: 250 }],
      subtotal: 250,
      taxAmount: 0,
      grandTotal: 250,
    });
    expect(w.some((x) => x.includes('Line "A"'))).toBe(true);
  });

  it("catches subtotal+tax ≠ grand total", () => {
    const w = validateExtractedInvoice({
      supplierName: "X",
      supplierInvoiceNo: null,
      invoiceDate: null,
      currency: "INR",
      lines: [{ description: "A", qty: 1, rate: 100, amount: 100 }],
      subtotal: 100,
      taxAmount: 18,
      grandTotal: 999, // wrong
    });
    expect(w.some((x) => x.includes("grand total"))).toBe(true);
  });
});

describe("triageTicketFromLLM (stub)", () => {
  it("returns the canned triage for STUB_TRIAGE: sentinel", async () => {
    const r = await triageTicketFromLLM({
      provider: stubProvider,
      subject: "STUB_TRIAGE: sample",
      body: "any",
      categories: ["Billing", "Technical"],
      candidateArticles: [],
    });
    expect(r.parsed.priority).toBe("Medium");
    expect(r.parsed.category).toBe("Billing");
    expect(r.parsed.confidence).toBe(65);
  });
});

describe("shouldAutoApply", () => {
  it("auto-applies above threshold", () => {
    expect(
      shouldAutoApply({
        priority: "High",
        category: "Billing",
        matchingArticleSlugs: [],
        suggestedResponse: null,
        confidence: 85,
      }),
    ).toBe(true);
  });
  it("does not auto-apply below threshold", () => {
    expect(
      shouldAutoApply({
        priority: "High",
        category: "Billing",
        matchingArticleSlugs: [],
        suggestedResponse: null,
        confidence: 60,
      }),
    ).toBe(false);
  });
  it("respects custom threshold", () => {
    expect(
      shouldAutoApply(
        {
          priority: "High",
          category: "Billing",
          matchingArticleSlugs: [],
          suggestedResponse: null,
          confidence: 60,
        },
        50,
      ),
    ).toBe(true);
  });
  it("matches AUTO_APPLY_THRESHOLD constant", () => {
    expect(AUTO_APPLY_THRESHOLD).toBe(80);
  });
});
