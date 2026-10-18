"use client";

// Read-only list page for doctypes that have a sidebar link + a working
// list API but no hand-built page yet. Columns are derived from the rows:
// internal fields (ids, tenantId, timestamps) are hidden, linked records
// render by their display name, and dates / numbers / booleans are
// formatted. Mounted by app/[doctype]/page.tsx, which only accepts slugs
// that appear in this app's MODULE_NAV.
//
// Identical copy lives in hr-web, crm-web and stock-web (same convention
// as components/ui.tsx).

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../lib/api";
import { Card, DataTable, PageHeader, type Column } from "./ui";

type Row = Record<string, unknown>;

const HIDDEN = new Set(["id", "tenantId", "createdAt", "updatedAt"]);
const MAX_COLUMNS = 9;
const NAME_KEYS = [
  "employeeName", "customerName", "supplierName", "itemName", "warehouseName",
  "workstationName", "projectName", "name", "title", "fullName", "email",
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

function isPlainObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Display name for a related record (`employee`, `item`, `supplier`…).
function nameOf(obj: Row): string | null {
  for (const k of NAME_KEYS) if (typeof obj[k] === "string" && obj[k]) return obj[k] as string;
  const k = Object.keys(obj).find((key) => key.endsWith("Name") && typeof obj[key] === "string");
  return k ? (obj[k] as string) : null;
}

function headerOf(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof v === "string") {
    if (ISO_DATE.test(v)) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return v;
      return v.includes("T00:00:00") ? d.toLocaleDateString() : d.toLocaleString();
    }
    // Prisma Decimals serialise as strings (whole values drop the ".00").
    if (NUMERIC.test(v)) {
      return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return v;
  }
  if (isPlainObject(v)) return nameOf(v) ?? "—";
  return String(v);
}

interface ColumnSpec {
  key: string;
  numeric: boolean;
}

function deriveColumns(rows: Row[]): ColumnSpec[] {
  const sample = rows.slice(0, 25);
  const keys: string[] = [];
  for (const r of sample) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);

  const relations = new Set(keys.filter((k) => sample.some((r) => isPlainObject(r[k]))));
  const specs: ColumnSpec[] = [];
  for (const k of keys) {
    if (HIDDEN.has(k)) continue;
    if (sample.every((r) => Array.isArray(r[k]))) continue; // child tables
    // Foreign keys: show the related record's name instead (if included),
    // otherwise drop the opaque id.
    if (k.endsWith("Id") && !relations.has(k)) continue;
    const vals = sample.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) continue;
    const numeric = vals.every(
      (v) => typeof v === "number" || (typeof v === "string" && NUMERIC.test(v) && !ISO_DATE.test(v)),
    );
    specs.push({ key: k, numeric });
  }
  // Linked records (employee, item, supplier…) first — they say whose row it is.
  const ordered = [
    ...specs.filter((s) => relations.has(s.key)),
    ...specs.filter((s) => !relations.has(s.key)),
  ];
  return ordered.slice(0, MAX_COLUMNS);
}

export function GenericDoctypeList({
  moduleName,
  slug,
  label,
}: {
  moduleName: string;
  slug: string;
  label: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get<Row[] | { data?: Row[]; rows?: Row[] }>(`/${slug}`);
      setRows(Array.isArray(data) ? data : data.data ?? data.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useListPageCommands({ singular: label, plural: label, refresh: load });

  const specs = useMemo(() => deriveColumns(rows), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      specs.some((s) => formatValue(r[s.key]).toLowerCase().includes(needle)),
    );
  }, [rows, specs, q]);

  const columns: Column<Row>[] = specs.map((s) => ({
    header: headerOf(s.key),
    align: s.numeric ? "right" : "left",
    cell: (r) => formatValue(r[s.key]),
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: moduleName, href: "/" }, { label }]}
        title={label}
        subtitle={loading ? "Loading…" : `${filtered.length} of ${rows.length} records`}
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      <div className="mb-4">
        <input
          className="input max-w-sm"
          placeholder={`Search ${label.toLowerCase()}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Card className="p-0 overflow-hidden">
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(r) => String(r.id)}
          loading={loading}
          empty={{ title: q ? "No matching records." : `No ${label.toLowerCase()} yet.` }}
        />
      </Card>
    </>
  );
}
