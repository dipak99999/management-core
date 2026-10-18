// Bulk stock-count CSV parser — turns a scanner or spreadsheet CSV into
// the shape the stock-reconciliation route expects. Kept pure so the
// tricky bits (header detection, item-code / warehouse-name resolution,
// per-row error accumulation) are exercised by vitest.
//
// Expected CSV columns (case-insensitive header match):
//   itemCode      - required
//   warehouse     - required (matched by warehouseName)
//   countedQty    - required, coerced to number
//   countedRate   - optional, coerced to number; blank/missing → null
//
// The route resolves itemCode → itemId + warehouseName → warehouseId
// against tenant-scoped lookup maps supplied here (both keyed lowercase).

import { parseCsv } from "./csv";

export interface StockCountRowRaw {
  rowIndex: number;              // 1-based, excluding header
  itemCode: string;
  warehouse: string;
  countedQty: number;
  countedRate: number | null;
}

export interface StockCountRowResolved {
  rowIndex: number;
  itemId: string;
  warehouseId: string;
  countedQty: number;
  countedValuationRate: number | null;
}

export interface StockCountParseResult {
  rows: StockCountRowResolved[];
  errors: string[];  // human-readable, "row N: reason"
}

/**
 * Parse the CSV text and resolve each row against the supplied
 * (lower-cased) lookup maps. Never throws — collects per-row errors so
 * the UI can show ALL problems at once instead of one-at-a-time.
 *
 * Rules:
 *   - Blank input → { rows: [], errors: [] } (no-op, no error).
 *   - First row is the header. Required columns: itemCode, warehouse,
 *     countedQty. Missing → hard error at the top of `errors`.
 *   - Empty rows (all-blank cells) are skipped silently.
 *   - Unknown itemCode / warehouse → per-row error, row dropped from
 *     `rows`.
 *   - Non-numeric countedQty → per-row error.
 *   - Negative countedQty → per-row error (physical count can't go negative).
 *   - countedRate blank or "0" → null (means "use current bin rate"; the
 *     route already treats null-rate as "no rate change").
 */
export function parseStockCountRows(
  csv: string,
  lookups: {
    itemCodeToId: Map<string, string>;      // keys must be lowercased
    warehouseNameToId: Map<string, string>; // keys must be lowercased
  },
): StockCountParseResult {
  const errors: string[] = [];
  const rows: StockCountRowResolved[] = [];
  const trimmed = csv?.trim() ?? "";
  if (!trimmed) return { rows, errors };

  const parsed = parseCsv(trimmed);
  if (parsed.length === 0) return { rows, errors };

  const header = parsed[0]!.map((h) => h.trim().toLowerCase());
  const idx = {
    itemCode: header.indexOf("itemcode"),
    warehouse: header.indexOf("warehouse"),
    countedQty: header.indexOf("countedqty"),
    countedRate: header.indexOf("countedrate"),
  };
  if (idx.itemCode < 0) errors.push("Header missing: itemCode");
  if (idx.warehouse < 0) errors.push("Header missing: warehouse");
  if (idx.countedQty < 0) errors.push("Header missing: countedQty");
  if (errors.length > 0) return { rows, errors };

  for (let i = 1; i < parsed.length; i++) {
    const cells = parsed[i]!;
    // Empty rows (all cells blank) — skip silently. Common when CSVs have
    // trailing blank lines from spreadsheet exports.
    if (cells.every((c) => c.trim() === "")) continue;

    const rowIndex = i; // 1-based body index (header is row 0)
    const itemCode = (cells[idx.itemCode] ?? "").trim();
    const warehouse = (cells[idx.warehouse] ?? "").trim();
    const qtyRaw = (cells[idx.countedQty] ?? "").trim();
    const rateRaw = idx.countedRate >= 0 ? (cells[idx.countedRate] ?? "").trim() : "";

    if (!itemCode) {
      errors.push(`row ${rowIndex}: itemCode is required`);
      continue;
    }
    if (!warehouse) {
      errors.push(`row ${rowIndex}: warehouse is required`);
      continue;
    }
    const itemId = lookups.itemCodeToId.get(itemCode.toLowerCase());
    if (!itemId) {
      errors.push(`row ${rowIndex}: unknown itemCode "${itemCode}"`);
      continue;
    }
    const warehouseId = lookups.warehouseNameToId.get(warehouse.toLowerCase());
    if (!warehouseId) {
      errors.push(`row ${rowIndex}: unknown warehouse "${warehouse}"`);
      continue;
    }
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty)) {
      errors.push(`row ${rowIndex}: countedQty "${qtyRaw}" is not a number`);
      continue;
    }
    if (qty < 0) {
      errors.push(`row ${rowIndex}: countedQty cannot be negative`);
      continue;
    }
    let rate: number | null = null;
    if (rateRaw !== "") {
      const r = Number(rateRaw);
      if (!Number.isFinite(r)) {
        errors.push(`row ${rowIndex}: countedRate "${rateRaw}" is not a number`);
        continue;
      }
      if (r < 0) {
        errors.push(`row ${rowIndex}: countedRate cannot be negative`);
        continue;
      }
      // Treat 0 as "no rate change" — matches the route's fallback
      // where countedValuationRate=null → use current bin rate.
      rate = r > 0 ? r : null;
    }

    rows.push({
      rowIndex,
      itemId,
      warehouseId,
      countedQty: qty,
      countedValuationRate: rate,
    });
  }
  return { rows, errors };
}
