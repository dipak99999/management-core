// Bank advice / NEFT file generator.
//
// A "bank advice" is the file HR uploads to the bank portal to actually
// pay the employees at the end of the payroll cycle. Every bank has its
// own column format, but the fields are always some permutation of:
//   beneficiary name, account no, IFSC, amount, transaction type,
//   remarks (usually payroll month + slip name).
//
// v1 supports:
//   * Generic — bank-neutral CSV with every field, safe default.
//   * HDFC   — HDFC Corporate NetBanking bulk-upload format.
//   * SBI    — SBI Vyapaar bulk-upload format.
//
// This helper is pure — given a list of {employee, net} rows it emits
// the CSV text. The route layer reads DB rows and calls this. Extend by
// adding another format handler + column list.

export interface BankAdviceRow {
  employeeName: string;
  employeeCode: string;
  bankAccountNo: string | null;
  ifscCode: string | null;
  bankName: string | null;
  netAmount: number;
  reference: string; // e.g. "Salary <SS-name>"
}

export interface BankAdviceValidationIssue {
  employeeCode: string;
  reason: string;
}

export interface BankAdviceResult {
  csv: string;
  filename: string;
  rowCount: number;
  totalAmount: number;
  skipped: BankAdviceValidationIssue[];
}

export type BankAdviceFormat = "Generic" | "HDFC" | "SBI" | "ICICI" | "Axis" | "YesBank";

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// CSV escaping: double-quotes wrap fields containing commas / quotes /
// newlines; internal quotes are doubled.
function esc(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtAmount(n: number): string {
  // 2 decimals, no thousands separator (banks reject those).
  return n.toFixed(2);
}

function validate(rows: BankAdviceRow[]): { valid: BankAdviceRow[]; skipped: BankAdviceValidationIssue[] } {
  const valid: BankAdviceRow[] = [];
  const skipped: BankAdviceValidationIssue[] = [];
  for (const r of rows) {
    if (!r.bankAccountNo || !r.bankAccountNo.trim()) {
      skipped.push({ employeeCode: r.employeeCode, reason: "missing bank account" });
      continue;
    }
    if (!r.ifscCode || !IFSC_RE.test(r.ifscCode.toUpperCase())) {
      skipped.push({ employeeCode: r.employeeCode, reason: "missing or invalid IFSC" });
      continue;
    }
    if (r.netAmount <= 0) {
      skipped.push({ employeeCode: r.employeeCode, reason: "net amount is zero or negative" });
      continue;
    }
    valid.push(r);
  }
  return { valid, skipped };
}

function genericCsv(rows: BankAdviceRow[]): string {
  const header = ["Employee Code", "Beneficiary Name", "Account No", "IFSC", "Bank Name", "Amount", "Reference"].join(",");
  const body = rows.map((r) => [
    r.employeeCode,
    r.employeeName,
    r.bankAccountNo,
    (r.ifscCode ?? "").toUpperCase(),
    r.bankName ?? "",
    fmtAmount(r.netAmount),
    r.reference,
  ].map(esc).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

// HDFC Corporate NetBanking (H2H) bulk-upload — pipe-delimited, no header.
// Format (positional):
//   PYMT_PROD_TYPE_CODE | PYMT_MODE | DEBIT_ACC_NO | BNF_NAME | BNF_ACC_NO |
//   BNF_BANK_IFSC | AMOUNT | DEBIT_NARR | CREDIT_NARR | MOBILE_NUM |
//   EMAIL_ID | REMARKS | PYMT_DATE (yyyyMMdd) | REF_NO
//
// We fill in `PAY` / `NEFT` and leave the debit account blank (bank
// pre-fills it from the uploader's profile).
function hdfcCsv(rows: BankAdviceRow[], pymtDate: string): string {
  return rows.map((r) => [
    "PAY", "NEFT", "", r.employeeName, r.bankAccountNo,
    (r.ifscCode ?? "").toUpperCase(), fmtAmount(r.netAmount),
    `Salary ${r.employeeCode}`, r.reference, "", "", r.reference,
    pymtDate, r.employeeCode,
  ].map(esc).join("|")).join("\r\n") + "\r\n";
}

// SBI Vyapaar bulk-upload — comma-delimited, header row, positional:
//   S.No, Beneficiary Account No, Beneficiary Name, IFSC Code, Amount,
//   Payment Reference, Beneficiary Bank Name
function sbiCsv(rows: BankAdviceRow[]): string {
  const header = ["S.No", "Beneficiary A/C No", "Beneficiary Name", "IFSC Code", "Amount", "Payment Reference", "Beneficiary Bank Name"].join(",");
  const body = rows.map((r, i) => [
    i + 1,
    r.bankAccountNo,
    r.employeeName,
    (r.ifscCode ?? "").toUpperCase(),
    fmtAmount(r.netAmount),
    r.reference,
    r.bankName ?? "",
  ].map(esc).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

// ICICI Corporate Internet Banking (CIB) bulk-upload — CSV with header.
// Format:
//   Beneficiary Name, Beneficiary Account No, Beneficiary IFSC,
//   Amount, Payment Date (dd/MM/yyyy), Payment Type (NEFT),
//   Beneficiary Bank Name, Remarks
function iciciCsv(rows: BankAdviceRow[], postingDate: Date): string {
  const dd = String(postingDate.getUTCDate()).padStart(2, "0");
  const mm = String(postingDate.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = postingDate.getUTCFullYear();
  const payDate = `${dd}/${mm}/${yyyy}`;
  const header = [
    "Beneficiary Name", "Beneficiary Account No", "Beneficiary IFSC",
    "Amount", "Payment Date", "Payment Type", "Beneficiary Bank Name", "Remarks",
  ].join(",");
  const body = rows.map((r) => [
    r.employeeName,
    r.bankAccountNo,
    (r.ifscCode ?? "").toUpperCase(),
    fmtAmount(r.netAmount),
    payDate,
    "NEFT",
    r.bankName ?? "",
    r.reference,
  ].map(esc).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

// Axis Bank CorpConnect bulk-upload — pipe-delimited, no header.
// Positional (per Axis spec):
//   Transaction Type | Beneficiary Code | Beneficiary Account No |
//   Beneficiary Name | Amount | Payment Date (yyyyMMdd) |
//   Beneficiary IFSC | Beneficiary Bank Name | Narration
function axisTxt(rows: BankAdviceRow[], postingDate: Date): string {
  const yyyymmdd = postingDate.toISOString().slice(0, 10).replace(/-/g, "");
  return rows.map((r) => [
    "NEFT",
    r.employeeCode,
    r.bankAccountNo,
    r.employeeName,
    fmtAmount(r.netAmount),
    yyyymmdd,
    (r.ifscCode ?? "").toUpperCase(),
    r.bankName ?? "",
    r.reference,
  ].map(esc).join("|")).join("\r\n") + "\r\n";
}

// Yes Bank Yes-Connect bulk-upload — CSV with header.
// Format:
//   Sr No, Amount, Beneficiary Name, Beneficiary Account No, IFSC Code,
//   Payment Type (N=NEFT), Remarks
function yesBankCsv(rows: BankAdviceRow[]): string {
  const header = ["Sr No", "Amount", "Beneficiary Name", "Beneficiary Account No", "IFSC Code", "Payment Type", "Remarks"].join(",");
  const body = rows.map((r, i) => [
    i + 1,
    fmtAmount(r.netAmount),
    r.employeeName,
    r.bankAccountNo,
    (r.ifscCode ?? "").toUpperCase(),
    "N",
    r.reference,
  ].map(esc).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

export function generateBankAdvice(
  rows: BankAdviceRow[],
  format: BankAdviceFormat,
  opts: { entryName: string; postingDate: Date },
): BankAdviceResult {
  const { valid, skipped } = validate(rows);
  const yyyymmdd = opts.postingDate.toISOString().slice(0, 10).replace(/-/g, "");
  let csv: string;
  let extension: string;
  switch (format) {
    case "HDFC":
      csv = hdfcCsv(valid, yyyymmdd);
      extension = "txt";
      break;
    case "SBI":
      csv = sbiCsv(valid);
      extension = "csv";
      break;
    case "ICICI":
      csv = iciciCsv(valid, opts.postingDate);
      extension = "csv";
      break;
    case "Axis":
      csv = axisTxt(valid, opts.postingDate);
      extension = "txt";
      break;
    case "YesBank":
      csv = yesBankCsv(valid);
      extension = "csv";
      break;
    case "Generic":
    default:
      csv = genericCsv(valid);
      extension = "csv";
      break;
  }
  return {
    csv,
    filename: `${opts.entryName}-bank-advice-${format.toLowerCase()}.${extension}`,
    rowCount: valid.length,
    totalAmount: valid.reduce((s, r) => s + r.netAmount, 0),
    skipped,
  };
}
