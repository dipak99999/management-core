// Minimal RFC 4180-ish CSV parser. Handles:
//   - quoted fields ("hello,world" → one field)
//   - escaped quotes ("she said ""hi""" → she said "hi")
//   - CR/LF and LF-only line endings
//   - trailing newline (ignored)
// Does NOT handle: streaming, gigantic files, funky BOMs. Fine for bank
// statements up to a few thousand rows.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM if present
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && src[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Build a header-name → column-index map from the first row. Header matching
// is case-insensitive + trim + strip common punctuation, so "Amount", "amount",
// "AMOUNT ", "Amount ($)" all resolve to "amount".
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function headerMap(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    map[normalizeHeader(h)] = i;
  });
  return map;
}
