import { describe, expect, it, vi } from "vitest";
import { backfillLegacyCompanyIds } from "./legacy-companyid-backfill";

function makeDb(defaultCompany: { id: string } | null, counts: number[]) {
  const [siN, piN, peN, jeN, glN] = counts;
  return {
    company: { findFirst: vi.fn().mockResolvedValue(defaultCompany) },
    salesInvoice: { updateMany: vi.fn().mockResolvedValue({ count: siN }) },
    purchaseInvoice: { updateMany: vi.fn().mockResolvedValue({ count: piN }) },
    paymentEntry: { updateMany: vi.fn().mockResolvedValue({ count: peN }) },
    journalEntry: { updateMany: vi.fn().mockResolvedValue({ count: jeN }) },
    gLEntry: { updateMany: vi.fn().mockResolvedValue({ count: glN }) },
  } as unknown as Parameters<typeof backfillLegacyCompanyIds>[0];
}

describe("backfillLegacyCompanyIds", () => {
  it("returns per-model counts and stamps default company", async () => {
    const db = makeDb({ id: "def" }, [3, 2, 5, 1, 40]);
    const r = await backfillLegacyCompanyIds(db, "t1");
    expect(r).toEqual({
      companyId: "def",
      salesInvoices: 3,
      purchaseInvoices: 2,
      paymentEntries: 5,
      journalEntries: 1,
      glEntries: 40,
    });
  });

  it("skips gracefully when tenant has no default company", async () => {
    const db = makeDb(null, [0, 0, 0, 0, 0]);
    const r = await backfillLegacyCompanyIds(db, "t1");
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/no default Company/);
    // Confirm we didn't touch any of the doctype tables.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((db as any).salesInvoice.updateMany).not.toHaveBeenCalled();
  });

  it("returns zero counts on a second run (idempotent)", async () => {
    const db = makeDb({ id: "def" }, [0, 0, 0, 0, 0]);
    const r = await backfillLegacyCompanyIds(db, "t1");
    expect(r.salesInvoices).toBe(0);
    expect(r.glEntries).toBe(0);
    expect(r.skipped).toBeUndefined();
  });
});
