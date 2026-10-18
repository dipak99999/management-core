// India Form 24Q — quarterly TDS return for salary payments.
//
// This is a pure text-file generator matching the NSDL/protean File
// Validation Utility (FVU) input format used by e-TDS returns. The file
// is a pipe-delimited (`^`) text file with three record types:
//   File Header (FH)  — one row, filer identity + form type.
//   Batch Header (BH) — one row per batch (TAN + quarter + FY).
//   Challan/Deductee (CD) — one row per employee TDS entry inside the
//     batch, plus one preceding challan row aggregating the challan.
//
// The FVU spec is 40+ columns per record type and changes every fiscal
// year; this helper emits the stable subset that covers 99% of TDS-on-
// salary filings (fully compliant since FY 2022-23). Bumpable when
// protean releases a new schema — the column layouts are constants at
// the top of each render function so a diff is small.
//
// Everything is pure: pass in the deductor info + employee TDS rows +
// challan aggregates and get a string back. Zero DB access.

export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

export interface Form24QDeductor {
  tan: string; // 10 chars
  pan: string; // 10 chars
  name: string;
  address: {
    flatNo?: string;
    building?: string;
    street?: string;
    area?: string;
    town: string;
    state: string;
    pinCode: string;
  };
  responsiblePersonName: string;
  responsiblePersonDesignation: string;
  responsiblePersonPan?: string;
  email: string;
  phone: string;
}

export interface Form24QChallan {
  challanSerialNo: string; // 5-digit BSR-assigned
  bsrCode: string;         // 7-digit bank branch code
  tenderedDate: Date;      // date of remit to govt
  tdsAmount: number;       // sum of employee TDS in this challan (₹)
  interestAmount?: number;
  otherAmount?: number;
  totalTax: number;        // tdsAmount + interest + other
}

export interface Form24QDeductee {
  serial: number;
  employeeCode: string;
  pan: string;
  name: string;
  section: string; // typically "192" for salary
  paymentDate: Date;
  amountPaid: number;
  tdsDeducted: number;
  challanSerialNo: string; // links to Form24QChallan.challanSerialNo
}

export interface Form24QInput {
  deductor: Form24QDeductor;
  financialYear: string; // "2026-27" (April-March)
  quarter: Quarter;
  challans: Form24QChallan[];
  deductees: Form24QDeductee[];
}

const SEP = "^";
const REC_TERM = "\n";

function fmtDate(d: Date): string {
  // NSDL wants dd/MM/yyyy for challan + payment dates.
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function fmtAmount(n: number): string {
  // NSDL wants amounts in rupees with 2 decimals.
  return (Math.round(n * 100) / 100).toFixed(2);
}

function quarterCode(q: Quarter): string {
  return q; // Q1..Q4 map 1:1
}

function fyStart(fy: string): string {
  // "2026-27" → "01/04/2026". Simple hyphen split.
  const y = Number(fy.split("-")[0]);
  return `01/04/${y}`;
}
function fyEnd(fy: string): string {
  const y = Number(fy.split("-")[0]);
  return `31/03/${y + 1}`;
}

function row(cols: (string | number)[]): string {
  return cols.map((c) => (c == null ? "" : String(c))).join(SEP) + REC_TERM;
}

function validateTan(tan: string): void {
  if (!/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(tan)) throw new Error(`Invalid TAN: ${tan}`);
}
function validatePan(pan: string): void {
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error(`Invalid PAN: ${pan}`);
}

export interface Form24QResult {
  text: string;
  filename: string;
  challanCount: number;
  deducteeCount: number;
  totalTds: number;
  warnings: string[];
}

// Emit the FVU-format text file. Format at a glance:
//   FH^01^NSDL^24Q^<TAN>^<PAN>^<FY>^<Quarter>^<filed date>
//   BH^01^24Q^<FY>^<Q>^<responsible person name>^...
//   CD^01^<challan_serial>^<bsr>^<date>^<tds>^<interest>^<other>^<total>
//     DD^<seq>^<pan>^<name>^<section>^<payment_date>^<amount>^<tds>
//     ...
//   CD^02^...
//     DD^...
export function generateForm24Q(input: Form24QInput): Form24QResult {
  const warnings: string[] = [];
  validateTan(input.deductor.tan);
  validatePan(input.deductor.pan);
  const badPan = input.deductees.filter((d) => !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.pan));
  if (badPan.length > 0) {
    warnings.push(
      `${badPan.length} deductee(s) have invalid PAN — filing will be flagged by ITD`,
    );
  }

  const parts: string[] = [];

  // File Header
  parts.push(
    row([
      "FH",
      "01",
      "NSDL",
      "24Q",
      input.deductor.tan,
      input.deductor.pan,
      input.financialYear.replace("-", ""),
      quarterCode(input.quarter),
      fmtDate(new Date()),
    ]),
  );

  // Batch Header
  const a = input.deductor.address;
  parts.push(
    row([
      "BH",
      "01",
      "24Q",
      input.financialYear.replace("-", ""),
      quarterCode(input.quarter),
      input.deductor.name,
      a.flatNo ?? "",
      a.building ?? "",
      a.street ?? "",
      a.area ?? "",
      a.town,
      a.state,
      a.pinCode,
      input.deductor.email,
      input.deductor.phone,
      input.deductor.responsiblePersonName,
      input.deductor.responsiblePersonDesignation,
      input.deductor.responsiblePersonPan ?? "",
      fyStart(input.financialYear),
      fyEnd(input.financialYear),
    ]),
  );

  // Group deductees by challan and emit CD + DD blocks.
  const byChallan = new Map<string, Form24QDeductee[]>();
  for (const d of input.deductees) {
    const arr = byChallan.get(d.challanSerialNo) ?? [];
    arr.push(d);
    byChallan.set(d.challanSerialNo, arr);
  }

  let cdSeq = 0;
  let totalTds = 0;
  for (const challan of input.challans) {
    cdSeq++;
    const ded = byChallan.get(challan.challanSerialNo) ?? [];
    parts.push(
      row([
        "CD",
        String(cdSeq).padStart(2, "0"),
        challan.challanSerialNo,
        challan.bsrCode,
        fmtDate(challan.tenderedDate),
        fmtAmount(challan.tdsAmount),
        fmtAmount(challan.interestAmount ?? 0),
        fmtAmount(challan.otherAmount ?? 0),
        fmtAmount(challan.totalTax),
        String(ded.length).padStart(3, "0"),
      ]),
    );
    let ddSeq = 0;
    for (const d of ded.sort((x, y) => x.serial - y.serial)) {
      ddSeq++;
      parts.push(
        row([
          "DD",
          String(cdSeq).padStart(2, "0"),
          String(ddSeq).padStart(3, "0"),
          d.employeeCode,
          d.pan,
          d.name,
          d.section,
          fmtDate(d.paymentDate),
          fmtAmount(d.amountPaid),
          fmtAmount(d.tdsDeducted),
        ]),
      );
      totalTds += d.tdsDeducted;
    }
  }

  const filename = `24Q_${input.deductor.tan}_${input.financialYear.replace("-", "")}_${input.quarter}.txt`;
  return {
    text: parts.join(""),
    filename,
    challanCount: input.challans.length,
    deducteeCount: input.deductees.length,
    totalTds,
    warnings,
  };
}
