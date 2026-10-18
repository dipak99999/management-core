import * as XLSX from "xlsx";
import { toCsvRow } from "./csv";

// J2b: minimal .xlsx bridge. Reads the first sheet of an xlsx workbook,
// coerces every cell to a string, and returns the same string[][] shape
// `parseCsv` produces so the rest of the importer pipeline is format-agnostic.
//
// Everything downstream (csvIterator, coerceCell, runImport) operates on the
// row grid, so wiring a new format is just this one adapter + a content-type
// branch in the route handler.
//
// SECURITY: xlsx@0.18.5 carries two unpatched high CVEs on npm — prototype
// pollution + ReDoS. SheetJS's fixed builds live on their paid CDN, not npm.
// Until a migration off xlsx is done we mitigate at the input layer:
//   (a) hard cap on decoded byte size — a malicious file that inflates
//       enormously past its base64 envelope is rejected before parse.
//   (b) magic-byte check — must be a ZIP (PK\x03\x04, .xlsx) or OLE
//       compound file (.xls), which stops non-workbook payloads at the door.
// Neither eliminates the CVE class entirely; upload endpoints remain behind
// auth + per-tenant scoping, which raises the bar to "attacker has already
// compromised a legitimate account".

const MAX_XLSX_BYTES = 10 * 1024 * 1024; // 10 MB decoded ceiling.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 — xlsx
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]); // legacy .xls

function assertLooksLikeXlsx(buffer: Buffer): void {
  if (buffer.length > MAX_XLSX_BYTES) {
    throw new Error(`xlsx too large: ${buffer.length} bytes (max ${MAX_XLSX_BYTES})`);
  }
  if (buffer.length < 8) {
    throw new Error("xlsx too small to be a valid workbook");
  }
  const head = buffer.subarray(0, 4);
  if (!head.equals(ZIP_MAGIC) && !head.equals(OLE_MAGIC)) {
    throw new Error(
      "xlsx magic bytes mismatch — file is not a valid workbook (rejecting to avoid parser CVEs)",
    );
  }
}

export function parseXlsxToRows(buffer: Buffer | ArrayBuffer): string[][] {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  assertLooksLikeXlsx(buf);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = wb.Sheets[firstSheetName];
  // header:1 → array-of-arrays. defval:"" ensures ragged rows are padded.
  // raw:false forces value formatting (dates as ISO strings via dateNF).
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    dateNF: "yyyy-mm-dd",
  });
  return rows.map((row) =>
    row.map((cell) => (cell == null ? "" : String(cell))),
  );
}

// Convert an xlsx workbook to a CSV string. Handy when we want to reuse the
// existing CSV-string-based helpers (parseCsv → csvIterator) without adding
// a second path.
export function xlsxToCsv(buffer: Buffer | ArrayBuffer): string {
  const rows = parseXlsxToRows(buffer);
  return rows.map((r) => toCsvRow(r)).join("\n");
}

// Detect an .xlsx (or .xls / .xlsm) upload by MIME type or filename.
export function isXlsxContent(
  contentType: string | undefined,
  filename: string | undefined,
): boolean {
  if (contentType) {
    if (
      contentType.includes("spreadsheetml") ||
      contentType === "application/vnd.ms-excel" ||
      contentType === "application/octet-stream"
    ) {
      // octet-stream is ambiguous — fall through to filename check.
      if (contentType !== "application/octet-stream") return true;
    }
  }
  if (filename) {
    const lower = filename.toLowerCase();
    return lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm");
  }
  return false;
}
