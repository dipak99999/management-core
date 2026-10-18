import { describe, expect, it } from "vitest";
import {
  MICR_SYMBOLS,
  amountToWordsINR,
  fmtAmountINR,
  renderCheque,
  renderMicrBand,
} from "./cheque-print";

describe("fmtAmountINR", () => {
  it("Indian grouping: last 3 then every 2", () => {
    expect(fmtAmountINR(12345678.9)).toBe("1,23,45,678.90");
    expect(fmtAmountINR(1000)).toBe("1,000.00");
    expect(fmtAmountINR(100)).toBe("100.00");
    expect(fmtAmountINR(999999)).toBe("9,99,999.00");
  });
});

describe("amountToWordsINR", () => {
  it("small integers", () => {
    expect(amountToWordsINR(0)).toBe("Rupees Zero Only");
    expect(amountToWordsINR(1)).toBe("Rupees One Only");
    expect(amountToWordsINR(21)).toBe("Rupees Twenty One Only");
    expect(amountToWordsINR(100)).toBe("Rupees One Hundred Only");
  });

  it("Indian numbering (lakh/crore)", () => {
    expect(amountToWordsINR(100000)).toBe("Rupees One Lakh Only");
    expect(amountToWordsINR(12345)).toBe("Rupees Twelve Thousand Three Hundred and Forty Five Only");
    expect(amountToWordsINR(1234567)).toBe("Rupees Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven Only");
    expect(amountToWordsINR(10000000)).toBe("Rupees One Crore Only");
  });

  it("appends paise when non-zero", () => {
    expect(amountToWordsINR(100.5)).toBe("Rupees One Hundred and Fifty Paise Only");
    expect(amountToWordsINR(0.75)).toBe("Rupees Zero and Seventy Five Paise Only");
  });
});

describe("renderMicrBand", () => {
  it("wraps segments with E-13B symbols + pads cheque/micr", () => {
    const band = renderMicrBand({
      chequeNumber: "12",
      micrCode: "123456",
      accountNumber: "9876543210",
      transactionCode: "10",
    });
    expect(band).toBe(`${MICR_SYMBOLS.ON_US}000012${MICR_SYMBOLS.ON_US} ${MICR_SYMBOLS.TRANSIT}000123456${MICR_SYMBOLS.TRANSIT} 9876543210${MICR_SYMBOLS.DASH} 10`);
  });

  it("strips non-digits from the cheque number + MICR code", () => {
    const band = renderMicrBand({
      chequeNumber: "123-456",
      micrCode: "400 002 001",
      accountNumber: "12345",
    });
    expect(band).toContain("123456");
    expect(band).toContain("400002001");
  });

  it("defaults transaction code to 10 (savings/current)", () => {
    const band = renderMicrBand({
      chequeNumber: "1",
      micrCode: "0",
      accountNumber: "1",
    });
    expect(band.endsWith(" 10")).toBe(true);
  });
});

describe("renderCheque", () => {
  it("assembles all fields", () => {
    const r = renderCheque({
      payeeName: "Alice Smith",
      amount: 12345.67,
      postingDate: new Date("2026-09-25T00:00:00Z"),
      chequeNumber: "000042",
      micrCode: "400002001",
      accountNumber: "9876543210",
    });
    expect(r.payeeName).toBe("Alice Smith");
    expect(r.amountNumeric).toBe("12,345.67");
    expect(r.amountInWords).toContain("Twelve Thousand");
    expect(r.dateDDMMYYYY).toBe("25092026");
    expect(r.micrBand).toContain("000042");
    expect(r.micrBand).toContain("400002001");
  });
});
