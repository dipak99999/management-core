// Self-service BI — pivot helper.
//
// Takes a rectangular dataset (rows of objects) + a pivot spec:
//   { rowKeys: string[], columnKeys: string[], measures: [{ field, agg }] }
// and returns a materialized pivot table:
//   {
//     rowHeaders: [{ label, key }],
//     columnHeaders: [{ label, key }],
//     cells: { "rowKey|colKey": { measure: value } },
//     rowTotals, columnTotals, grandTotal
//   }
//
// Supports agg = sum | avg | count | min | max. Pure — the report
// builder calls it after fetching data through the existing generic
// query builder.

export type AggKind = "sum" | "avg" | "count" | "min" | "max";

export interface Measure {
  field: string;
  agg: AggKind;
  label?: string;
}

export interface PivotSpec {
  rowKeys: string[];
  columnKeys: string[];
  measures: Measure[];
}

export interface PivotAxis {
  label: string; // human-readable "value1 | value2 | ..."
  key: string;   // stable composite key for cell lookup
  values: string[];
}

export interface PivotCell {
  [measureLabel: string]: number;
}

export interface PivotResult {
  rowHeaders: PivotAxis[];
  columnHeaders: PivotAxis[];
  cells: Record<string, PivotCell>; // key = rowKey + "|" + colKey
  rowTotals: Record<string, PivotCell>;
  columnTotals: Record<string, PivotCell>;
  grandTotal: PivotCell;
  measureLabels: string[];
}

function keyOf(row: Record<string, unknown>, cols: string[]): { label: string; key: string; values: string[] } {
  const values = cols.map((c) => (row[c] == null ? "(blank)" : String(row[c])));
  return { label: values.join(" · "), key: values.join("␟"), values };
}

function aggregate(nums: number[], agg: AggKind): number {
  if (nums.length === 0) return 0;
  switch (agg) {
    case "sum":
      return nums.reduce((s, n) => s + n, 0);
    case "avg":
      return nums.reduce((s, n) => s + n, 0) / nums.length;
    case "count":
      return nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

const measureLabel = (m: Measure) => m.label ?? `${m.agg}(${m.field})`;

export function pivot(rows: Record<string, unknown>[], spec: PivotSpec): PivotResult {
  const cellBuckets = new Map<string, Map<string, number[]>>(); // "row|col" → measureLabel → nums
  const rowAxes = new Map<string, PivotAxis>();
  const colAxes = new Map<string, PivotAxis>();

  for (const row of rows) {
    const r = keyOf(row, spec.rowKeys);
    const c = keyOf(row, spec.columnKeys);
    rowAxes.set(r.key, { label: r.label, key: r.key, values: r.values });
    colAxes.set(c.key, { label: c.label, key: c.key, values: c.values });
    const cellKey = `${r.key}|${c.key}`;
    let bucket = cellBuckets.get(cellKey);
    if (!bucket) {
      bucket = new Map();
      cellBuckets.set(cellKey, bucket);
    }
    for (const m of spec.measures) {
      const raw = row[m.field];
      const num = raw == null ? 0 : Number(raw);
      if (!Number.isFinite(num)) continue;
      const label = measureLabel(m);
      const arr = bucket.get(label) ?? [];
      arr.push(num);
      bucket.set(label, arr);
    }
  }

  const cells: Record<string, PivotCell> = {};
  for (const [cellKey, bucket] of cellBuckets) {
    const cell: PivotCell = {};
    for (const m of spec.measures) {
      const label = measureLabel(m);
      cell[label] = aggregate(bucket.get(label) ?? [], m.agg);
    }
    cells[cellKey] = cell;
  }

  // Row totals: for each row key, aggregate across its columns.
  const rowTotals: Record<string, PivotCell> = {};
  for (const rKey of rowAxes.keys()) {
    const cell: PivotCell = {};
    for (const m of spec.measures) {
      const label = measureLabel(m);
      const combined: number[] = [];
      for (const cKey of colAxes.keys()) {
        const bucket = cellBuckets.get(`${rKey}|${cKey}`);
        if (bucket) combined.push(...(bucket.get(label) ?? []));
      }
      cell[label] = aggregate(combined, m.agg);
    }
    rowTotals[rKey] = cell;
  }
  const columnTotals: Record<string, PivotCell> = {};
  for (const cKey of colAxes.keys()) {
    const cell: PivotCell = {};
    for (const m of spec.measures) {
      const label = measureLabel(m);
      const combined: number[] = [];
      for (const rKey of rowAxes.keys()) {
        const bucket = cellBuckets.get(`${rKey}|${cKey}`);
        if (bucket) combined.push(...(bucket.get(label) ?? []));
      }
      cell[label] = aggregate(combined, m.agg);
    }
    columnTotals[cKey] = cell;
  }
  const grandTotal: PivotCell = {};
  for (const m of spec.measures) {
    const label = measureLabel(m);
    const combined: number[] = [];
    for (const bucket of cellBuckets.values()) combined.push(...(bucket.get(label) ?? []));
    grandTotal[label] = aggregate(combined, m.agg);
  }
  return {
    rowHeaders: Array.from(rowAxes.values()).sort((a, b) => a.label.localeCompare(b.label)),
    columnHeaders: Array.from(colAxes.values()).sort((a, b) => a.label.localeCompare(b.label)),
    cells,
    rowTotals,
    columnTotals,
    grandTotal,
    measureLabels: spec.measures.map(measureLabel),
  };
}
