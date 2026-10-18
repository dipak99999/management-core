// J2: minimal RFC-4180 CSV parser + writer. Zero dependencies.
//
// - parseCsv splits into rows honoring double-quote escaping.
// - toCsv escapes cells that contain commas, quotes, or newlines.
// - coerceCell converts a raw string to a typed JS value based on a schema.

export type CsvValueType = "string" | "number" | "date" | "boolean";

export interface CsvColumnSpec {
  key: string; // machine name
  label?: string; // display name (used as CSV header when writing)
  type?: CsvValueType; // defaults to "string"
  required?: boolean;
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  const text = input.replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === ",") {
        cur.push(cell);
        cell = "";
      } else if (ch === "\n") {
        cur.push(cell);
        rows.push(cur);
        cur = [];
        cell = "";
      } else if (ch === '"' && cell === "") {
        inQuotes = true;
      } else {
        cell += ch;
      }
    }
  }
  // trailing cell / row
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell);
    rows.push(cur);
  }
  // trim trailing empty row (common with trailing newline)
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

export function toCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      if (c == null) return "";
      const s = String(c);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(",");
}

// Coerce a raw CSV cell string into a typed value. Empty strings become
// null for optional columns; throws for required ones. Numbers and dates
// use standard JS parsing; booleans accept true/false/1/0/yes/no.
export function coerceCell(
  spec: CsvColumnSpec,
  raw: string,
): unknown {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    if (spec.required) throw new Error(`"${spec.key}" is required`);
    return null;
  }
  switch (spec.type ?? "string") {
    case "string":
      return trimmed;
    case "number": {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) throw new Error(`"${spec.key}" must be a number`);
      return n;
    }
    case "date": {
      const d = new Date(trimmed);
      if (Number.isNaN(d.getTime())) throw new Error(`"${spec.key}" invalid date`);
      return d;
    }
    case "boolean": {
      const lower = trimmed.toLowerCase();
      if (["true", "1", "yes", "y"].includes(lower)) return true;
      if (["false", "0", "no", "n"].includes(lower)) return false;
      throw new Error(`"${spec.key}" invalid boolean`);
    }
  }
}

// Build a header→index map so callers can look cells up by column name.
export function headerIndex(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => m.set(h.trim(), i));
  return m;
}

export interface ImportRowContext {
  index: (col: string) => number | undefined;
  cell: (col: string) => string;
  raw: string[]; // whole row as strings
  rowNumber: number; // 1-based, header excluded
}

// Given a parsed CSV, yield one context per data row. First row is treated
// as the header. Returns { header, iter, rowCount }.
export function csvIterator(parsed: string[][]): {
  header: string[];
  rowCount: number;
  iter: ImportRowContext[];
} {
  if (parsed.length === 0) return { header: [], rowCount: 0, iter: [] };
  const header = parsed[0].map((h) => h.trim());
  const map = headerIndex(header);
  const iter: ImportRowContext[] = parsed.slice(1).map((row, i) => ({
    index: (col: string) => map.get(col),
    cell: (col: string) => {
      const idx = map.get(col);
      return idx === undefined ? "" : row[idx] ?? "";
    },
    raw: row,
    rowNumber: i + 1,
  }));
  return { header, rowCount: iter.length, iter };
}
