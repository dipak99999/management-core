import { describe, expect, it } from "vitest";
import { generateBankAdvice, type BankAdviceRow } from "./bank-advice";

const opts = { entryName: "PYE-0001", postingDate: new Date("2026-09-25") };

function mkRow(overrides: Partial<BankAdviceRow> = {}): BankAdviceRow {
  return {
    employeeName: "Alice Smith",
    employeeCode: "EMP-0001",
    bankAccountNo: "1234567890",
    ifscCode: "HDFC0000001",
    bankName: "HDFC Bank",
    netAmount: 50000,
    reference: "Salary PYE-0001 EMP-0001",
    ...overrides,
  };
}

describe("generateBankAdvice", () => {
  it("Generic: emits header + row + CRLF, escapes commas in name", () => {
    const r = generateBankAdvice(
      [mkRow(), mkRow({ employeeName: "Doe, John", employeeCode: "EMP-0002" })],
      "Generic",
      opts,
    );
    expect(r.rowCount).toBe(2);
    expect(r.totalAmount).toBe(100000);
    expect(r.skipped).toEqual([]);
    expect(r.filename).toBe("PYE-0001-bank-advice-generic.csv");
    const lines = r.csv.split("\r\n");
    expect(lines[0]).toBe("Employee Code,Beneficiary Name,Account No,IFSC,Bank Name,Amount,Reference");
    expect(lines[1]).toContain("Alice Smith");
    expect(lines[2]).toContain('"Doe, John"');
  });

  it("skips rows with missing bank account", () => {
    const r = generateBankAdvice(
      [mkRow(), mkRow({ employeeCode: "EMP-0002", bankAccountNo: null })],
      "Generic",
      opts,
    );
    expect(r.rowCount).toBe(1);
    expect(r.skipped).toEqual([{ employeeCode: "EMP-0002", reason: "missing bank account" }]);
  });

  it("skips rows with invalid IFSC", () => {
    const r = generateBankAdvice(
      [mkRow({ ifscCode: "BADCODE" })],
      "Generic",
      opts,
    );
    expect(r.rowCount).toBe(0);
    expect(r.skipped[0].reason).toBe("missing or invalid IFSC");
  });

  it("skips zero-amount rows", () => {
    const r = generateBankAdvice(
      [mkRow({ netAmount: 0 })],
      "Generic",
      opts,
    );
    expect(r.rowCount).toBe(0);
    expect(r.skipped[0].reason).toBe("net amount is zero or negative");
  });

  it("HDFC: pipe-delimited, no header, correct positional layout, date", () => {
    const r = generateBankAdvice([mkRow()], "HDFC", opts);
    expect(r.filename).toBe("PYE-0001-bank-advice-hdfc.txt");
    const cols = r.csv.trim().split("|");
    expect(cols[0]).toBe("PAY");
    expect(cols[1]).toBe("NEFT");
    expect(cols[4]).toBe("1234567890"); // bnf acc
    expect(cols[5]).toBe("HDFC0000001"); // IFSC
    expect(cols[6]).toBe("50000.00");
    expect(cols[12]).toBe("20260925");
    expect(cols[13]).toBe("EMP-0001");
  });

  it("SBI: header + row numbers", () => {
    const r = generateBankAdvice([mkRow(), mkRow({ employeeCode: "EMP-0002" })], "SBI", opts);
    const lines = r.csv.split("\r\n");
    expect(lines[0]).toBe("S.No,Beneficiary A/C No,Beneficiary Name,IFSC Code,Amount,Payment Reference,Beneficiary Bank Name");
    expect(lines[1].split(",")[0]).toBe("1");
    expect(lines[2].split(",")[0]).toBe("2");
  });

  it("normalizes IFSC to uppercase", () => {
    const r = generateBankAdvice([mkRow({ ifscCode: "hdfc0000001" })], "Generic", opts);
    expect(r.rowCount).toBe(1);
    expect(r.csv).toContain("HDFC0000001");
  });

  it("returns 2-decimal amounts", () => {
    const r = generateBankAdvice([mkRow({ netAmount: 12345.6 })], "Generic", opts);
    expect(r.csv).toContain("12345.60");
  });

  it("ICICI: CSV with dd/MM/yyyy payment date", () => {
    const r = generateBankAdvice([mkRow()], "ICICI", opts);
    expect(r.filename).toBe("PYE-0001-bank-advice-icici.csv");
    expect(r.csv).toContain("25/09/2026");
    expect(r.csv).toContain("NEFT");
    expect(r.csv).toContain("HDFC0000001");
  });

  it("Axis: pipe-delimited, no header, yyyymmdd date", () => {
    const r = generateBankAdvice([mkRow()], "Axis", opts);
    expect(r.filename).toBe("PYE-0001-bank-advice-axis.txt");
    const cols = r.csv.trim().split("|");
    expect(cols[0]).toBe("NEFT");
    expect(cols[5]).toBe("20260925");
    expect(cols[6]).toBe("HDFC0000001");
  });

  it("Yes Bank: CSV with Sr No + 'N' payment type", () => {
    const r = generateBankAdvice([mkRow(), mkRow({ employeeCode: "EMP-0002" })], "YesBank", opts);
    expect(r.filename).toBe("PYE-0001-bank-advice-yesbank.csv");
    const lines = r.csv.split("\r\n");
    expect(lines[0]).toBe("Sr No,Amount,Beneficiary Name,Beneficiary Account No,IFSC Code,Payment Type,Remarks");
    expect(lines[1].split(",")[0]).toBe("1");
    expect(lines[1].split(",")[5]).toBe("N");
    expect(lines[2].split(",")[0]).toBe("2");
  });
});
