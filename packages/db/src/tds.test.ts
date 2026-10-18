import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  checkCumulativeYtdCrossed,
  checkCumulativeYtdSalesCrossed,
  computeMonthlyTdsDue,
  fiscalYearWindow,
  generate26q,
  generate27eq,
  isValidPan,
  loadForm16aData,
  tdsQuarter,
} from "./tds";

// Prevent the tenant-guard middleware from throwing on the fake prisma
// aggregates below — those queries pass `tenantId` so they'd survive the
// guard, but the fake prisma bypasses the middleware entirely anyway.

describe("fiscalYearWindow (India Apr→Mar)", () => {
  it("Aug date → same-year FY", () => {
    const w = fiscalYearWindow(new Date("2026-08-15T00:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(w.end.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("Jan date → previous-year FY", () => {
    const w = fiscalYearWindow(new Date("2027-01-15T00:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(w.end.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("Mar 31 → old FY (ending); Apr 1 → new FY (starting)", () => {
    const march = fiscalYearWindow(new Date("2027-03-31T23:00:00Z"));
    expect(march.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    const april = fiscalYearWindow(new Date("2027-04-01T00:00:00Z"));
    expect(april.start.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });
});

describe("tdsQuarter", () => {
  it("May → Q1 of same-year FY", () => {
    const q = tdsQuarter(new Date("2026-05-15T00:00:00Z"));
    expect(q.quarter).toBe(1);
    expect(q.fyLabel).toBe("2026-27");
  });

  it("Sep → Q2", () => {
    const q = tdsQuarter(new Date("2026-09-01T00:00:00Z"));
    expect(q.quarter).toBe(2);
    expect(q.fyLabel).toBe("2026-27");
  });

  it("Dec → Q3", () => {
    const q = tdsQuarter(new Date("2026-12-31T00:00:00Z"));
    expect(q.quarter).toBe(3);
    expect(q.fyLabel).toBe("2026-27");
  });

  it("Feb → Q4 of previous-year FY", () => {
    const q = tdsQuarter(new Date("2027-02-01T00:00:00Z"));
    expect(q.quarter).toBe(4);
    expect(q.fyLabel).toBe("2026-27");
  });
});

describe("isValidPan", () => {
  it("accepts a valid PAN", () => {
    expect(isValidPan("ABCDE1234F")).toBe(true);
  });
  it("rejects wrong length / wrong shape", () => {
    expect(isValidPan("ABCDE1234")).toBe(false);
    expect(isValidPan("ABCDE1234FG")).toBe(false);
    expect(isValidPan("12345ABCDE")).toBe(false);
    expect(isValidPan("abcde1234f")).toBe(false); // lower-case
  });
});

describe("checkCumulativeYtdCrossed", () => {
  function fakePrisma(priorSum: number) {
    return {
      paymentEntry: {
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { paidAmount: new Prisma.Decimal(priorSum) } }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("returns crossed=true when prior + current >= threshold", async () => {
    const prisma = fakePrisma(25_000);
    const r = await checkCumulativeYtdCrossed(prisma, {
      tenantId: "t1",
      supplierId: "s1",
      paymentDate: new Date("2026-08-15Z"),
      currentPaidAmount: 6_000,
      thresholdAmount: 30_000,
    });
    expect(r.crossed).toBe(true);
    expect(r.cumulative).toBe(31_000);
  });

  it("returns crossed=false when below threshold", async () => {
    const prisma = fakePrisma(10_000);
    const r = await checkCumulativeYtdCrossed(prisma, {
      tenantId: "t1",
      supplierId: "s1",
      paymentDate: new Date("2026-08-15Z"),
      currentPaidAmount: 5_000,
      thresholdAmount: 30_000,
    });
    expect(r.crossed).toBe(false);
    expect(r.cumulative).toBe(15_000);
  });

  it("passes excludePeId into the aggregate NOT clause on update path", async () => {
    const prisma = fakePrisma(0);
    await checkCumulativeYtdCrossed(prisma, {
      tenantId: "t1",
      supplierId: "s1",
      paymentDate: new Date("2026-08-15Z"),
      currentPaidAmount: 100,
      thresholdAmount: 30_000,
      excludePeId: "pe-under-edit",
    });
    const args = prisma.paymentEntry.aggregate.mock.calls[0][0];
    expect(args.where.NOT).toEqual({ id: "pe-under-edit" });
  });

  it("aggregate query filters to Submitted Pay-to-Supplier in the FY window", async () => {
    const prisma = fakePrisma(0);
    await checkCumulativeYtdCrossed(prisma, {
      tenantId: "t1",
      supplierId: "s1",
      paymentDate: new Date("2026-08-15Z"),
      currentPaidAmount: 100,
      thresholdAmount: 30_000,
    });
    const w = prisma.paymentEntry.aggregate.mock.calls[0][0].where;
    expect(w.tenantId).toBe("t1");
    expect(w.partyId).toBe("s1");
    expect(w.status).toBe("Submitted");
    expect(w.paymentType).toBe("Pay");
    expect(w.postingDate.gte.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("generate26q", () => {
  const pes = [
    {
      id: "pe1",
      partyId: "s1",
      paidAmount: new Prisma.Decimal(10_000),
      withholdingAmount: new Prisma.Decimal(100),
      withholdingRate: new Prisma.Decimal(1),
      withholdingSection: "194C",
      withholdingCategoryId: "cat1",
    },
    {
      id: "pe2",
      partyId: "s1",
      paidAmount: new Prisma.Decimal(20_000),
      withholdingAmount: new Prisma.Decimal(200),
      withholdingRate: new Prisma.Decimal(1),
      withholdingSection: "194C",
      withholdingCategoryId: "cat1",
    },
    {
      id: "pe3",
      partyId: "s2",
      paidAmount: new Prisma.Decimal(50_000),
      withholdingAmount: new Prisma.Decimal(5_000),
      withholdingRate: new Prisma.Decimal(10),
      withholdingSection: "194J",
      withholdingCategoryId: "cat2",
    },
    {
      id: "pe4",
      partyId: "s2",
      paidAmount: new Prisma.Decimal(15_000),
      withholdingAmount: new Prisma.Decimal(300),
      withholdingRate: new Prisma.Decimal(2),
      // No section snapshot — should fall through to category lookup
      withholdingSection: null,
      withholdingCategoryId: "cat3",
    },
  ];

  function fakePrisma() {
    return {
      paymentEntry: { findMany: vi.fn().mockResolvedValue(pes) },
      supplier: {
        findMany: vi.fn().mockResolvedValue([
          { id: "s1", supplierName: "Acme Vendors Ltd", pan: "AAAPL1234C" },
          { id: "s2", supplierName: "Beta Consultants", pan: null }, // no PAN
        ]),
      },
      taxWithholdingCategory: {
        findMany: vi.fn().mockResolvedValue([{ id: "cat3", sectionCode: "194H" }]),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("aggregates PE.withholdingAmount by (supplier, section) with correct totals", async () => {
    const r = await generate26q(fakePrisma(), "t1", new Date("2026-08-15Z"));
    expect(r.quarter).toBe(2);
    expect(r.fyLabel).toBe("2026-27");
    expect(r.rows).toHaveLength(3); // s1/194C, s2/194J, s2/194H
    expect(r.totals.supplierCount).toBe(2);
    expect(r.totals.totalPaidAmount).toBe(95_000);
    expect(r.totals.totalTdsAmount).toBe(5_600);
    expect(r.totals.rowsMissingPan).toBe(2); // s2 has no PAN → 2 rows flagged
  });

  it("s1/194C row sums both s1 PEs", async () => {
    const r = await generate26q(fakePrisma(), "t1", new Date("2026-08-15Z"));
    const row = r.rows.find(
      (x) => x.supplierId === "s1" && x.sectionCode === "194C",
    )!;
    expect(row.paymentCount).toBe(2);
    expect(row.totalPaidAmount).toBe(30_000);
    expect(row.totalTdsAmount).toBe(300);
    expect(row.effectiveRate).toBe(1);
    expect(row.pan).toBe("AAAPL1234C");
    expect(row.missingPan).toBe(false);
  });

  it("resolves missing withholdingSection via category lookup", async () => {
    const r = await generate26q(fakePrisma(), "t1", new Date("2026-08-15Z"));
    const row = r.rows.find(
      (x) => x.supplierId === "s2" && x.sectionCode === "194H",
    );
    expect(row).toBeDefined();
    expect(row!.totalTdsAmount).toBe(300);
  });

  it("flags rows without PAN as missingPan=true", async () => {
    const r = await generate26q(fakePrisma(), "t1", new Date("2026-08-15Z"));
    const missing = r.rows.filter((x) => x.missingPan);
    expect(missing.map((m) => m.supplierId)).toEqual(["s2", "s2"]);
    expect(missing.every((m) => m.pan === null)).toBe(true);
  });

  it("empty result when no PEs match the quarter", async () => {
    const empty = {
      paymentEntry: { findMany: vi.fn().mockResolvedValue([]) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await generate26q(empty, "t1", new Date("2026-08-15Z"));
    expect(r.rows).toEqual([]);
    expect(r.totals.totalTdsAmount).toBe(0);
  });
});

describe("checkCumulativeYtdSalesCrossed (TCS 206C(1H))", () => {
  function fakePrisma(priorSum: number) {
    return {
      salesInvoice: {
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { netTotal: new Prisma.Decimal(priorSum) } }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("crossed=true when prior + current ≥ threshold (₹50L 206C(1H))", async () => {
    const prisma = fakePrisma(4_500_000);
    const r = await checkCumulativeYtdSalesCrossed(prisma, {
      tenantId: "t1",
      customerId: "c1",
      invoiceDate: new Date("2026-08-15Z"),
      currentNetAmount: 600_000,
      thresholdAmount: 5_000_000,
    });
    expect(r.crossed).toBe(true);
    expect(r.cumulative).toBe(5_100_000);
  });

  it("crossed=false below threshold", async () => {
    const prisma = fakePrisma(1_000_000);
    const r = await checkCumulativeYtdSalesCrossed(prisma, {
      tenantId: "t1",
      customerId: "c1",
      invoiceDate: new Date("2026-08-15Z"),
      currentNetAmount: 500_000,
      thresholdAmount: 5_000_000,
    });
    expect(r.crossed).toBe(false);
  });

  it("aggregate query filters Submitted SI for customer in FY window", async () => {
    const prisma = fakePrisma(0);
    await checkCumulativeYtdSalesCrossed(prisma, {
      tenantId: "t1",
      customerId: "c1",
      invoiceDate: new Date("2026-08-15Z"),
      currentNetAmount: 100,
      thresholdAmount: 1000,
      excludeSiId: "si-under-edit",
    });
    const w = prisma.salesInvoice.aggregate.mock.calls[0][0].where;
    expect(w.tenantId).toBe("t1");
    expect(w.customerId).toBe("c1");
    expect(w.status).toBe("Submitted");
    expect(w.postingDate.gte.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(w.NOT).toEqual({ id: "si-under-edit" });
  });
});

describe("generate27eq (TCS Form 27EQ)", () => {
  const sis = [
    {
      id: "si1",
      customerId: "c1",
      netTotal: new Prisma.Decimal(600_000),
      tcsAmount: new Prisma.Decimal(600),
      tcsRate: new Prisma.Decimal(0.1),
      tcsSection: "206C-1H",
      tcsCategoryId: "cat1",
    },
    {
      id: "si2",
      customerId: "c1",
      netTotal: new Prisma.Decimal(400_000),
      tcsAmount: new Prisma.Decimal(400),
      tcsRate: new Prisma.Decimal(0.1),
      tcsSection: "206C-1H",
      tcsCategoryId: "cat1",
    },
    {
      id: "si3",
      customerId: "c2",
      netTotal: new Prisma.Decimal(200_000),
      tcsAmount: new Prisma.Decimal(200),
      tcsRate: new Prisma.Decimal(0.1),
      // No section snapshot — should fall back to category lookup
      tcsSection: null,
      tcsCategoryId: "cat2",
    },
  ];

  function fakePrisma() {
    return {
      salesInvoice: { findMany: vi.fn().mockResolvedValue(sis) },
      customer: {
        findMany: vi.fn().mockResolvedValue([
          { id: "c1", customerName: "Acme Retail", pan: "ACMEP1234R" },
          { id: "c2", customerName: "Beta Distributors", pan: null },
        ]),
      },
      taxCollectionCategory: {
        findMany: vi.fn().mockResolvedValue([{ id: "cat2", sectionCode: "206C-1H" }]),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("aggregates SI.tcsAmount by (customer, section)", async () => {
    const r = await generate27eq(fakePrisma(), "t1", new Date("2026-08-15Z"));
    expect(r.rows).toHaveLength(2);
    expect(r.totals.customerCount).toBe(2);
    expect(r.totals.totalNetAmount).toBe(1_200_000);
    expect(r.totals.totalTcsAmount).toBe(1200);
    expect(r.totals.rowsMissingPan).toBe(1);
  });

  it("c1/206C-1H sums both c1 SIs", async () => {
    const r = await generate27eq(fakePrisma(), "t1", new Date("2026-08-15Z"));
    const row = r.rows.find((x) => x.customerId === "c1")!;
    expect(row.invoiceCount).toBe(2);
    expect(row.totalNetAmount).toBe(1_000_000);
    expect(row.totalTcsAmount).toBe(1000);
    expect(row.effectiveRate).toBe(0.1);
    expect(row.pan).toBe("ACMEP1234R");
    expect(row.missingPan).toBe(false);
  });

  it("resolves missing tcsSection via category lookup", async () => {
    const r = await generate27eq(fakePrisma(), "t1", new Date("2026-08-15Z"));
    const c2Row = r.rows.find((x) => x.customerId === "c2")!;
    expect(c2Row.sectionCode).toBe("206C-1H");
    expect(c2Row.missingPan).toBe(true);
  });

  it("empty result when no SIs match", async () => {
    const empty = {
      salesInvoice: { findMany: vi.fn().mockResolvedValue([]) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await generate27eq(empty, "t1", new Date("2026-08-15Z"));
    expect(r.rows).toEqual([]);
    expect(r.totals.totalTcsAmount).toBe(0);
  });
});

describe("computeMonthlyTdsDue", () => {
  // Two PEs in July + one in August, all deducted TDS under section 194C.
  // One challan filed in August (covers July deductions per §200).
  const pes = [
    {
      postingDate: new Date("2026-07-05T00:00:00Z"),
      withholdingAmount: new Prisma.Decimal(300),
      withholdingCategoryId: "cat-194c",
    },
    {
      postingDate: new Date("2026-07-28T00:00:00Z"),
      withholdingAmount: new Prisma.Decimal(500),
      withholdingCategoryId: "cat-194c",
    },
    {
      postingDate: new Date("2026-08-10T00:00:00Z"),
      withholdingAmount: new Prisma.Decimal(1000),
      withholdingCategoryId: "cat-194c",
    },
  ];
  const challans = [
    {
      // Aug 5 deposit covers July deductions → 800 owed, 800 paid → balance 0
      id: "chal-1",
      categoryId: "cat-194c",
      bsrCode: "0510308",
      challanSerialNo: "12345",
      paidDate: new Date("2026-08-05T00:00:00Z"),
      amountPaid: new Prisma.Decimal(800),
    },
  ];

  function fakePrisma() {
    return {
      paymentEntry: { findMany: vi.fn().mockResolvedValue(pes) },
      tdsChallan: { findMany: vi.fn().mockResolvedValue(challans) },
      taxWithholdingCategory: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "cat-194c", name: "TDS 194C", sectionCode: "194C" }]),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("July fully settled by August challan (dueBalance = 0)", async () => {
    const rows = await computeMonthlyTdsDue(fakePrisma(), "t1", new Date("2026-08-15Z"));
    const jul = rows.find((r) => r.monthLabel === "2026-07")!;
    expect(jul.deducted).toBe(800);
    expect(jul.paid).toBe(800);
    expect(jul.dueBalance).toBe(0);
    expect(jul.challans).toHaveLength(1);
  });

  it("August still owes (1000 deducted, no Sep challan yet)", async () => {
    const rows = await computeMonthlyTdsDue(fakePrisma(), "t1", new Date("2026-08-15Z"));
    const aug = rows.find((r) => r.monthLabel === "2026-08")!;
    expect(aug.deducted).toBe(1000);
    expect(aug.paid).toBe(0);
    expect(aug.dueBalance).toBe(1000);
    expect(aug.challans).toHaveLength(0);
  });

  it("rows sorted chronologically by month then section", async () => {
    const rows = await computeMonthlyTdsDue(fakePrisma(), "t1", new Date("2026-08-15Z"));
    expect(rows.map((r) => r.monthLabel)).toEqual(["2026-07", "2026-08"]);
  });
});

describe("loadForm16aData", () => {
  it("attaches matching challan (next-month rule) to PE row", async () => {
    const prisma = {
      supplier: {
        findFirst: vi.fn().mockResolvedValue({
          supplierName: "Acme Vendors",
          pan: "AAAPL1234C",
          gstin: "27AAAPL1234C1ZV",
        }),
      },
      paymentEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            name: "PE-0042",
            postingDate: new Date("2026-07-15Z"),
            paidAmount: new Prisma.Decimal(30_000),
            withholdingAmount: new Prisma.Decimal(300),
            withholdingRate: new Prisma.Decimal(1),
            withholdingSection: "194C",
            withholdingCategoryId: "cat-194c",
          },
        ]),
      },
      tdsChallan: {
        findMany: vi.fn().mockResolvedValue([
          {
            categoryId: "cat-194c",
            bsrCode: "0510308",
            challanSerialNo: "12345",
            paidDate: new Date("2026-08-05T00:00:00Z"),
          },
        ]),
      },
      taxWithholdingCategory: { findMany: vi.fn().mockResolvedValue([]) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const d = await loadForm16aData(prisma, "t1", "supp-1", new Date("2026-08-15Z"));
    expect(d.quarter).toBe(2);
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0].challanNo).toBe("0510308-12345");
    expect(d.payments[0].section).toBe("194C");
    expect(d.totals.totalTds).toBe(300);
  });

  it("no matching challan → PE row has null challanNo", async () => {
    const prisma = {
      supplier: {
        findFirst: vi.fn().mockResolvedValue({
          supplierName: "Beta Consultants",
          pan: null,
          gstin: null,
        }),
      },
      paymentEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            name: "PE-0099",
            postingDate: new Date("2026-08-01Z"),
            paidAmount: new Prisma.Decimal(50_000),
            withholdingAmount: new Prisma.Decimal(5000),
            withholdingRate: new Prisma.Decimal(10),
            withholdingSection: "194J",
            withholdingCategoryId: "cat-194j",
          },
        ]),
      },
      tdsChallan: { findMany: vi.fn().mockResolvedValue([]) },
      taxWithholdingCategory: { findMany: vi.fn().mockResolvedValue([]) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const d = await loadForm16aData(prisma, "t1", "supp-2", new Date("2026-08-15Z"));
    expect(d.payments[0].challanNo).toBeNull();
    expect(d.supplier.pan).toBeNull();
  });

  it("throws when supplier not found", async () => {
    const prisma = {
      supplier: { findFirst: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(
      loadForm16aData(prisma, "t1", "nope", new Date("2026-08-15Z")),
    ).rejects.toThrow(/not found/);
  });
});
