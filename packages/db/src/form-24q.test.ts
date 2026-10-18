import { describe, expect, it } from "vitest";
import { generateForm24Q, type Form24QInput } from "./form-24q";

const baseInput: Form24QInput = {
  deductor: {
    tan: "MUMA12345B",
    pan: "AAAAA1234A",
    name: "Acme Pvt Ltd",
    address: { town: "Mumbai", state: "Maharashtra", pinCode: "400001" },
    responsiblePersonName: "Alice",
    responsiblePersonDesignation: "CFO",
    email: "alice@example.com",
    phone: "+919999999999",
  },
  financialYear: "2026-27",
  quarter: "Q2",
  challans: [
    {
      challanSerialNo: "00001",
      bsrCode: "0002345",
      tenderedDate: new Date("2026-08-07T00:00:00Z"),
      tdsAmount: 50000,
      totalTax: 50000,
    },
  ],
  deductees: [
    {
      serial: 1,
      employeeCode: "EMP-0001",
      pan: "BBBBB1234B",
      name: "Bob",
      section: "192",
      paymentDate: new Date("2026-07-31T00:00:00Z"),
      amountPaid: 500000,
      tdsDeducted: 50000,
      challanSerialNo: "00001",
    },
  ],
};

describe("generateForm24Q", () => {
  it("emits FH, BH, CD, DD in order", () => {
    const r = generateForm24Q(baseInput);
    const lines = r.text.trim().split("\n");
    expect(lines[0].startsWith("FH")).toBe(true);
    expect(lines[1].startsWith("BH")).toBe(true);
    expect(lines[2].startsWith("CD")).toBe(true);
    expect(lines[3].startsWith("DD")).toBe(true);
  });

  it("uses ^ as delimiter", () => {
    const r = generateForm24Q(baseInput);
    expect(r.text.includes("^")).toBe(true);
  });

  it("returns totals + filename", () => {
    const r = generateForm24Q(baseInput);
    expect(r.challanCount).toBe(1);
    expect(r.deducteeCount).toBe(1);
    expect(r.totalTds).toBe(50000);
    expect(r.filename).toBe("24Q_MUMA12345B_202627_Q2.txt");
  });

  it("dates render as dd/MM/yyyy", () => {
    const r = generateForm24Q(baseInput);
    expect(r.text).toContain("07/08/2026"); // tendered date
    expect(r.text).toContain("31/07/2026"); // payment date
  });

  it("rejects invalid TAN", () => {
    expect(() =>
      generateForm24Q({ ...baseInput, deductor: { ...baseInput.deductor, tan: "BADTAN" } }),
    ).toThrow(/Invalid TAN/);
  });

  it("warns (does not throw) on invalid deductee PAN", () => {
    const r = generateForm24Q({
      ...baseInput,
      deductees: [{ ...baseInput.deductees[0], pan: "INVALID" }],
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("groups multiple deductees under one challan", () => {
    const r = generateForm24Q({
      ...baseInput,
      deductees: [
        { ...baseInput.deductees[0] },
        { ...baseInput.deductees[0], serial: 2, employeeCode: "EMP-0002", pan: "CCCCC1234C" },
      ],
    });
    const ddCount = (r.text.match(/^DD\^/gm) ?? []).length;
    expect(ddCount).toBe(2);
    // Only one CD row (all deductees share the same challan).
    const cdCount = (r.text.match(/^CD\^/gm) ?? []).length;
    expect(cdCount).toBe(1);
  });
});
