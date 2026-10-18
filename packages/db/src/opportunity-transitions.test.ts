import { describe, expect, it } from "vitest";
import {
  appendOppNote,
  nextOppStatusForQuoteEvent,
} from "./opportunity-transitions";

describe("nextOppStatusForQuoteEvent — QuoteWon", () => {
  it("Open → Converted", () => {
    const r = nextOppStatusForQuoteEvent({
      currentStatus: "Open",
      event: "QuoteWon",
      quoteName: "QTN-001",
    });
    expect(r.shouldUpdate).toBe(true);
    expect(r.newStatus).toBe("Converted");
    expect(r.auditNote).toContain("QTN-001");
  });

  it("Quotation → Converted", () => {
    const r = nextOppStatusForQuoteEvent({
      currentStatus: "Quotation",
      event: "QuoteWon",
      quoteName: "QTN-002",
    });
    expect(r.shouldUpdate).toBe(true);
    expect(r.newStatus).toBe("Converted");
  });

  it("Converted → no-op (idempotent)", () => {
    const r = nextOppStatusForQuoteEvent({
      currentStatus: "Converted",
      event: "QuoteWon",
      quoteName: "QTN-003",
    });
    expect(r.shouldUpdate).toBe(false);
    expect(r.newStatus).toBe("Converted");
    expect(r.auditNote).toMatch(/no change/);
  });

  it("Lost → no-op (never regresses a decided opp)", () => {
    const r = nextOppStatusForQuoteEvent({
      currentStatus: "Lost",
      event: "QuoteWon",
      quoteName: "QTN-004",
    });
    expect(r.shouldUpdate).toBe(false);
    expect(r.newStatus).toBe("Lost");
  });
});

describe("nextOppStatusForQuoteEvent — QuoteLost", () => {
  it("never flips opp status (multiple quotes may exist)", () => {
    for (const status of ["Open", "Quotation", "Converted", "Lost"] as const) {
      const r = nextOppStatusForQuoteEvent({
        currentStatus: status,
        event: "QuoteLost",
        quoteName: "QTN-x",
      });
      expect(r.shouldUpdate).toBe(false);
      expect(r.newStatus).toBe(status);
    }
  });

  it("audit note includes lostReason when provided", () => {
    const r = nextOppStatusForQuoteEvent({
      currentStatus: "Quotation",
      event: "QuoteLost",
      quoteName: "QTN-1",
      lostReason: "Price too high",
    });
    expect(r.auditNote).toContain("QTN-1");
    expect(r.auditNote).toContain("Price too high");
  });

  it("audit note falls back cleanly without lostReason", () => {
    const r = nextOppStatusForQuoteEvent({
      currentStatus: "Quotation",
      event: "QuoteLost",
      quoteName: "QTN-1",
    });
    expect(r.auditNote).toBe("Quote QTN-1 lost");
  });
});

describe("appendOppNote", () => {
  const at = new Date(Date.UTC(2026, 5, 15));

  it("empty existing → just the stamped note", () => {
    expect(appendOppNote(null, "Converted by QTN-1", at)).toBe(
      "[2026-06-15] Converted by QTN-1",
    );
  });

  it("blank existing → same", () => {
    expect(appendOppNote("   ", "Converted by QTN-1", at)).toBe(
      "[2026-06-15] Converted by QTN-1",
    );
  });

  it("appends on a new line", () => {
    const r = appendOppNote("Prior context.", "Converted by QTN-1", at);
    expect(r).toBe("Prior context.\n[2026-06-15] Converted by QTN-1");
  });

  it("trims trailing whitespace before appending", () => {
    const r = appendOppNote("Prior context.  \n\n", "New note", at);
    expect(r).toBe("Prior context.\n[2026-06-15] New note");
  });
});
