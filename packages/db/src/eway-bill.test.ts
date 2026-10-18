import { describe, expect, it } from "vitest";
import {
  averageRates,
  buildEwayBillPayload,
  canCancelEwb,
  classifyTaxLine,
  computeEwbValidity,
  quoteEwbExtension,
  splitTaxes,
  type EwayInvoice,
  type EwayParty,
  type EwayTransport,
} from "./eway-bill";

// ---------------------------------------------------------------------
// Fixtures — reused across builder tests. Kept minimal so a spec change
// (e.g. new required field) only needs one edit.

const seller: EwayParty = {
  gstin: "27ABCDE1234F1Z5",
  legalName: "Acme Co Pvt Ltd",
  address: "1 Silver Rd",
  place: "Mumbai",
  pincode: "400001",
  stateCode: "27",
};

const buyerRegistered: EwayParty = {
  gstin: "29ABCDE5678G1Z9",
  legalName: "Buyer Enterprises",
  address: "2 Karnataka Ave",
  place: "Bengaluru",
  pincode: "560001",
  stateCode: "29",
};

const buyerB2C: EwayParty = {
  gstin: null,
  legalName: "Walk-in Customer",
  address: "Retail Counter",
  place: "Mumbai",
  pincode: "400001",
  stateCode: "27",
};

const invoice: EwayInvoice = {
  name: "SINV-0042",
  postingDate: new Date("2026-03-15T10:00:00.000Z"),
  netTotal: 10000,
  totalTaxes: 1800,
  grandTotal: 11800,
  items: [
    {
      itemName: "Widget A",
      itemDescription: "Premium widget",
      hsnCode: "8479",
      qty: 5,
      uom: "Nos",
      amount: 6000,
    },
    {
      itemName: "Widget B",
      itemDescription: null,
      hsnCode: "8480",
      qty: 4,
      uom: "Nos",
      amount: 4000,
    },
  ],
  taxes: [],
};

const roadTransport: EwayTransport = {
  transactionType: 1,
  subSupplyType: "1",
  transMode: 1,
  transDistance: 900,
  vehicleNo: "MH04AB1234",
};

// ---------------------------------------------------------------------

describe("classifyTaxLine", () => {
  it("recognizes IGST regardless of case + surrounding text", () => {
    expect(classifyTaxLine("IGST @ 18%")).toBe("igst");
    expect(classifyTaxLine("Integrated GST 12%")).toBe("cess"); // no 'igst' substring
    expect(classifyTaxLine("igst")).toBe("igst");
  });

  it("recognizes CGST", () => {
    expect(classifyTaxLine("CGST @ 9%")).toBe("cgst");
  });

  it("treats UTGST the same as SGST (both go in the sgst bucket)", () => {
    // Union-Territory GST substitutes for SGST when the destination is a UT.
    // NIC accepts them in the same field.
    expect(classifyTaxLine("UTGST @ 9%")).toBe("sgst");
    expect(classifyTaxLine("SGST @ 9%")).toBe("sgst");
  });

  it("defaults unknown descriptions to cess (safer than silently double-counting)", () => {
    expect(classifyTaxLine("Compensation cess 12%")).toBe("cess");
    expect(classifyTaxLine("Freight surcharge")).toBe("cess");
  });
});

describe("splitTaxes", () => {
  it("sums per-bucket across many rows", () => {
    const totals = splitTaxes([
      { description: "CGST @ 9%", rate: 9, taxAmount: 900 },
      { description: "SGST @ 9%", rate: 9, taxAmount: 900 },
      { description: "CGST @ 9%", rate: 9, taxAmount: 100 },
    ]);
    expect(totals).toEqual({ cgst: 1000, sgst: 900, igst: 0, cess: 0 });
  });

  it("keeps IGST separate from CGST/SGST (never doubles)", () => {
    const totals = splitTaxes([
      { description: "IGST @ 18%", rate: 18, taxAmount: 1800 },
    ]);
    expect(totals).toEqual({ cgst: 0, sgst: 0, igst: 1800, cess: 0 });
  });
});

describe("averageRates", () => {
  it("returns 0 for an empty bucket rather than NaN", () => {
    const rates = averageRates([]);
    expect(rates).toEqual({ cgstRate: 0, sgstRate: 0, igstRate: 0, cessRate: 0 });
  });

  it("averages within a bucket (two 9% rows still average to 9)", () => {
    const rates = averageRates([
      { description: "CGST @ 9%", rate: 9, taxAmount: 900 },
      { description: "CGST @ 9%", rate: 9, taxAmount: 100 },
    ]);
    expect(rates.cgstRate).toBe(9);
  });
});

describe("buildEwayBillPayload — inter-state B2B (IGST case)", () => {
  const withIgst: EwayInvoice = {
    ...invoice,
    taxes: [{ description: "IGST @ 18%", rate: 18, taxAmount: 1800 }],
  };

  it("stamps IGST bucket and leaves CGST/SGST at 0", () => {
    const payload = buildEwayBillPayload(withIgst, seller, buyerRegistered, roadTransport);
    expect(payload.igstValue).toBe(1800);
    expect(payload.cgstValue).toBe(0);
    expect(payload.sgstValue).toBe(0);
  });

  it("uses the buyer's real GSTIN when present (not URP)", () => {
    const payload = buildEwayBillPayload(withIgst, seller, buyerRegistered, roadTransport);
    expect(payload.toGstin).toBe("29ABCDE5678G1Z9");
  });

  it("formats docDate as DD/MM/YYYY per NIC spec (not ISO)", () => {
    const payload = buildEwayBillPayload(withIgst, seller, buyerRegistered, roadTransport);
    expect(payload.docDate).toBe("15/03/2026");
  });

  it("emits one ItemList entry per invoice line with hsnCode + qty", () => {
    const payload = buildEwayBillPayload(withIgst, seller, buyerRegistered, roadTransport);
    expect(payload.itemList).toHaveLength(2);
    expect(payload.itemList[0]).toMatchObject({
      productName: "Widget A",
      hsnCode: "8479",
      quantity: 5,
      taxableAmount: 6000,
    });
  });
});

describe("buildEwayBillPayload — intra-state B2C (CGST+SGST + URP)", () => {
  const withCgstSgst: EwayInvoice = {
    ...invoice,
    taxes: [
      { description: "CGST @ 9%", rate: 9, taxAmount: 900 },
      { description: "SGST @ 9%", rate: 9, taxAmount: 900 },
    ],
  };

  it("splits equally into CGST + SGST buckets", () => {
    const payload = buildEwayBillPayload(withCgstSgst, seller, buyerB2C, roadTransport);
    expect(payload.cgstValue).toBe(900);
    expect(payload.sgstValue).toBe(900);
    expect(payload.igstValue).toBe(0);
  });

  it("stamps URP as the toGstin when the buyer is unregistered", () => {
    const payload = buildEwayBillPayload(withCgstSgst, seller, buyerB2C, roadTransport);
    expect(payload.toGstin).toBe("URP");
  });
});

describe("buildEwayBillPayload — transport handling", () => {
  it("includes vehicleNo only when supplied (optional field, not empty string)", () => {
    const withVehicle = buildEwayBillPayload(invoice, seller, buyerRegistered, roadTransport);
    expect(withVehicle.vehicleNo).toBe("MH04AB1234");

    const noVehicle = buildEwayBillPayload(invoice, seller, buyerRegistered, {
      ...roadTransport,
      vehicleNo: null,
    });
    expect(noVehicle).not.toHaveProperty("vehicleNo");
  });

  it("preserves transDistance (required for portal-side rate calc)", () => {
    const payload = buildEwayBillPayload(invoice, seller, buyerRegistered, roadTransport);
    expect(payload.transDistance).toBe(900);
  });
});

describe("buildEwayBillPayload — value rounding", () => {
  it("rounds monetary fields to 2 decimals (portal rejects >2)", () => {
    const noisy: EwayInvoice = {
      ...invoice,
      netTotal: 9999.99999,
      grandTotal: 11799.9999,
      taxes: [{ description: "IGST @ 18%", rate: 18, taxAmount: 1799.9999 }],
    };
    const payload = buildEwayBillPayload(noisy, seller, buyerRegistered, roadTransport);
    expect(payload.totalValue).toBe(10000);
    expect(payload.igstValue).toBe(1800);
    expect(payload.totInvValue).toBe(11800);
  });
});

describe("computeEwbValidity", () => {
  const generated = new Date("2026-06-01T10:00:00Z");

  it("≤ 200 km → 1 day", () => {
    const r = computeEwbValidity(150, generated);
    expect(r.validityDays).toBe(1);
    expect(r.validFrom).toBe(generated);
    expect(r.validTo.toISOString()).toBe("2026-06-02T10:00:00.000Z");
  });

  it("exactly 200 km → 1 day", () => {
    expect(computeEwbValidity(200, generated).validityDays).toBe(1);
  });

  it("201 km → 2 days (next bucket)", () => {
    expect(computeEwbValidity(201, generated).validityDays).toBe(2);
  });

  it("500 km → 3 days (ceil 500/200 = 3)", () => {
    expect(computeEwbValidity(500, generated).validityDays).toBe(3);
  });

  it("0 km → 1 day (min-1 floor)", () => {
    expect(computeEwbValidity(0, generated).validityDays).toBe(1);
  });

  it("fractional km ceils up", () => {
    expect(computeEwbValidity(50.5, generated).validityDays).toBe(1);
    expect(computeEwbValidity(199.9, generated).validityDays).toBe(1);
    expect(computeEwbValidity(200.1, generated).validityDays).toBe(2);
  });

  it("ODC cargo: 20 km/day (rule 138(10) multi-modal / ODC)", () => {
    // 20 km → 1 day; 21 km → 2 days; 500 km → 25 days.
    expect(computeEwbValidity(20, generated, "ODC").validityDays).toBe(1);
    expect(computeEwbValidity(21, generated, "ODC").validityDays).toBe(2);
    expect(computeEwbValidity(500, generated, "ODC").validityDays).toBe(25);
  });

  it("ODC defaults to Normal when cargoType omitted (backwards-compat)", () => {
    expect(computeEwbValidity(500, generated).validityDays).toBe(3);
  });
});

describe("quoteEwbExtension", () => {
  const currentValidTo = new Date("2026-06-05T10:00:00Z");
  it("too early → reject with reason", () => {
    const r = quoteEwbExtension({
      currentValidTo,
      additionalDistanceKm: 100,
      now: new Date("2026-06-04T00:00:00Z"), // 34h before expiry
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/opens 8 hours before/);
  });
  it("within 8h before expiry → ok", () => {
    const r = quoteEwbExtension({
      currentValidTo,
      additionalDistanceKm: 100,
      now: new Date("2026-06-05T05:00:00Z"), // 5h before expiry
    });
    expect(r.ok).toBe(true);
    expect(r.additionalDays).toBe(1);
    // Anchor = currentValidTo (still valid), + 1 day
    expect(r.newValidTo.toISOString()).toBe("2026-06-06T10:00:00.000Z");
  });
  it("within 8h AFTER expiry → ok, anchor = now", () => {
    const r = quoteEwbExtension({
      currentValidTo,
      additionalDistanceKm: 100,
      now: new Date("2026-06-05T15:00:00Z"), // 5h after expiry
    });
    expect(r.ok).toBe(true);
    // Anchor = now, + 1 day
    expect(r.newValidTo.toISOString()).toBe("2026-06-06T15:00:00.000Z");
  });
  it("more than 8h AFTER expiry → reject", () => {
    const r = quoteEwbExtension({
      currentValidTo,
      additionalDistanceKm: 100,
      now: new Date("2026-06-05T20:00:00Z"), // 10h past expiry
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/closed/);
  });
  it("additional distance follows same 200km/day rule", () => {
    const r = quoteEwbExtension({
      currentValidTo,
      additionalDistanceKm: 500,
      now: new Date("2026-06-05T09:00:00Z"), // 1h before expiry
    });
    expect(r.additionalDays).toBe(3);
  });

  it("ODC extension uses 20 km/day", () => {
    const r = quoteEwbExtension({
      currentValidTo,
      additionalDistanceKm: 100,
      now: new Date("2026-06-05T09:00:00Z"),
      cargoType: "ODC",
    });
    expect(r.additionalDays).toBe(5);
  });
});

describe("canCancelEwb", () => {
  const ewbDate = new Date("2026-06-01T10:00:00Z");
  it("within 24h → ok", () => {
    expect(
      canCancelEwb({ ewbDate, now: new Date("2026-06-02T05:00:00Z") }).ok,
    ).toBe(true);
  });
  it("exactly at 24h → still ok (boundary inclusive)", () => {
    expect(
      canCancelEwb({ ewbDate, now: new Date("2026-06-02T10:00:00Z") }).ok,
    ).toBe(true);
  });
  it("past 24h → reject", () => {
    const r = canCancelEwb({
      ewbDate,
      now: new Date("2026-06-02T10:00:01Z"),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/24h/);
  });
});
