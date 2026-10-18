"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { showToast } from "../../../lib/toast";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
} from "../../../components/ui";

interface ColumnMeta {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "enum";
  choices?: string[];
}
interface DoctypeMeta {
  doctype: string;
  label: string;
  columns: ColumnMeta[];
  filterableFields: string[];
  sortableFields: string[];
  defaultColumns: string[];
}
interface AllMeta {
  doctypes: DoctypeMeta[];
}

type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
interface Filter {
  field: string;
  op: FilterOp;
  value: string; // captured as string, coerced server-side
}
interface Sort {
  field: string;
  dir: "asc" | "desc";
}

interface ReportResult {
  columns: { key: string; label: string; type: string }[];
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}

interface SavedReport {
  id: string;
  name: string;
  doctype: string;
  isShared: boolean;
  definition: {
    columns: string[];
    filters: Filter[];
    sortBy: Sort[];
    limit?: number;
  };
}

function opsForType(type: string): FilterOp[] {
  if (type === "string" || type === "enum") return ["eq", "neq", "in", "contains"];
  if (type === "number" || type === "date") return ["eq", "neq", "gt", "gte", "lt", "lte"];
  if (type === "boolean") return ["eq"];
  return ["eq"];
}

function InnerReportBuilderPage() {
  const searchParams = useSearchParams();
  const loadId = searchParams.get("load");

  const [allMeta, setAllMeta] = useState<AllMeta | null>(null);
  const [doctype, setDoctype] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sortBy, setSortBy] = useState<Sort[]>([]);
  const [limit, setLimit] = useState<number>(200);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedName, setSavedName] = useState("");
  const [savedIsShared, setSavedIsShared] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AllMeta>("/reports-builder/meta")
      .then(setAllMeta)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  useEffect(() => {
    if (!loadId) return;
    api
      .get<SavedReport>(`/reports-builder/saved/${loadId}`)
      .then((r) => {
        setDoctype(r.doctype);
        setColumns(r.definition.columns);
        setFilters(r.definition.filters ?? []);
        setSortBy(r.definition.sortBy ?? []);
        if (r.definition.limit) setLimit(r.definition.limit);
        setSavedName(r.name);
        setSavedIsShared(r.isShared);
        setLoadedId(r.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [loadId]);

  const meta = useMemo(
    () => allMeta?.doctypes.find((d) => d.doctype === doctype) ?? null,
    [allMeta, doctype],
  );

  function onDoctypeChange(dt: string) {
    setDoctype(dt);
    const m = allMeta?.doctypes.find((d) => d.doctype === dt);
    setColumns(m?.defaultColumns ?? []);
    setFilters([]);
    setSortBy([]);
    setResult(null);
  }

  function toggleColumn(key: string) {
    setColumns((cs) => (cs.includes(key) ? cs.filter((k) => k !== key) : [...cs, key]));
  }

  async function run() {
    if (!doctype) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        doctype,
        columns,
        filters: filters
          .filter((f) => f.field && f.value !== "")
          .map((f) => ({
            field: f.field,
            op: f.op,
            value:
              f.op === "in"
                ? f.value.split(",").map((s) => s.trim()).filter(Boolean)
                : f.value,
          })),
        sortBy: sortBy.filter((s) => s.field),
        limit,
      };
      setResult(await api.post<ReportResult>("/reports-builder/run", body));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!doctype || !savedName) return;
    setError(null);
    try {
      const body = {
        name: savedName,
        doctype,
        isShared: savedIsShared,
        definition: {
          columns,
          filters,
          sortBy,
          limit,
        },
      };
      if (loadedId) {
        await api.put(`/reports-builder/saved/${loadedId}`, {
          name: savedName,
          isShared: savedIsShared,
          definition: body.definition,
        });
      } else {
        const created = await api.post<SavedReport>("/reports-builder/saved", body);
        setLoadedId(created.id);
      }
      showToast(loadedId ? "Report updated." : "Report saved.", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  function fmtCell(v: unknown, type: string): string {
    if (v == null) return "—";
    if (type === "number") return Number(v).toFixed(2);
    if (type === "date") return typeof v === "string" ? v.slice(0, 10) : String(v);
    if (type === "boolean") return v ? "Yes" : "No";
    return String(v);
  }

  return (
    <main className="p-8 space-y-4 max-w-7xl">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Builder" },
        ]}
        title="Report Builder"
        actions={
          <a href="/accounting/reports/saved">
            <Button variant="secondary" type="button">Saved reports →</Button>
          </a>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* Left column: builder */}
        <Card className="col-span-1 p-4 space-y-3">
          <FormField label="Data source">
            <select
              className="input"
              value={doctype}
              onChange={(e) => onDoctypeChange(e.target.value)}
            >
              <option value="">Select doctype...</option>
              {allMeta?.doctypes.map((d) => (
                <option key={d.doctype} value={d.doctype}>
                  {d.label}
                </option>
              ))}
            </select>
          </FormField>

          {meta && (
            <>
              <div>
                <div className="label mb-1">Columns</div>
                <div className="border border-ink-muted/10 rounded p-2 max-h-56 overflow-auto space-y-1 text-sm">
                  {meta.columns.map((c) => (
                    <label key={c.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={columns.includes(c.key)}
                        onChange={() => toggleColumn(c.key)}
                      />
                      <span>{c.label}</span>
                      <span className="text-xs text-ink-muted font-mono ms-auto">
                        {c.type}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <div className="label">Filters (AND)</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() =>
                      setFilters([
                        ...filters,
                        { field: meta.filterableFields[0] ?? "", op: "eq", value: "" },
                      ])
                    }
                    disabled={meta.filterableFields.length === 0}
                  >
                    + Add
                  </Button>
                </div>
                {filters.map((f, i) => {
                  const col = meta.columns.find((c) => c.key === f.field);
                  const ops = opsForType(col?.type ?? "string");
                  return (
                    <div key={i} className="flex items-center gap-1 mt-1 text-xs">
                      <select
                        className="input flex-1"
                        value={f.field}
                        onChange={(e) => {
                          const next = [...filters];
                          next[i] = { ...next[i], field: e.target.value };
                          setFilters(next);
                        }}
                      >
                        {meta.filterableFields.map((k) => {
                          const cc = meta.columns.find((x) => x.key === k);
                          return (
                            <option key={k} value={k}>
                              {cc?.label ?? k}
                            </option>
                          );
                        })}
                      </select>
                      <select
                        className="input w-20"
                        value={f.op}
                        onChange={(e) => {
                          const next = [...filters];
                          next[i] = { ...next[i], op: e.target.value as FilterOp };
                          setFilters(next);
                        }}
                      >
                        {ops.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                      {col?.type === "enum" && f.op !== "in" ? (
                        <select
                          className="input flex-1"
                          value={f.value}
                          onChange={(e) => {
                            const next = [...filters];
                            next[i] = { ...next[i], value: e.target.value };
                            setFilters(next);
                          }}
                        >
                          <option value="">…</option>
                          {col.choices?.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="input flex-1"
                          type={col?.type === "date" ? "date" : col?.type === "number" ? "number" : "text"}
                          value={f.value}
                          placeholder={f.op === "in" ? "a,b,c" : ""}
                          onChange={(e) => {
                            const next = [...filters];
                            next[i] = { ...next[i], value: e.target.value };
                            setFilters(next);
                          }}
                        />
                      )}
                      <button
                        onClick={() => setFilters(filters.filter((_, idx) => idx !== i))}
                        className="text-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <div className="label">Sort</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() =>
                      setSortBy([
                        ...sortBy,
                        { field: meta.sortableFields[0] ?? "", dir: "desc" },
                      ])
                    }
                    disabled={meta.sortableFields.length === 0}
                  >
                    + Add
                  </Button>
                </div>
                {sortBy.map((s, i) => (
                  <div key={i} className="flex items-center gap-1 mt-1 text-xs">
                    <select
                      className="input flex-1"
                      value={s.field}
                      onChange={(e) => {
                        const next = [...sortBy];
                        next[i] = { ...next[i], field: e.target.value };
                        setSortBy(next);
                      }}
                    >
                      {meta.sortableFields.map((k) => {
                        const cc = meta.columns.find((x) => x.key === k);
                        return (
                          <option key={k} value={k}>
                            {cc?.label ?? k}
                          </option>
                        );
                      })}
                    </select>
                    <select
                      className="input w-20"
                      value={s.dir}
                      onChange={(e) => {
                        const next = [...sortBy];
                        next[i] = { ...next[i], dir: e.target.value as "asc" | "desc" };
                        setSortBy(next);
                      }}
                    >
                      <option>asc</option>
                      <option>desc</option>
                    </select>
                    <button
                      onClick={() => setSortBy(sortBy.filter((_, idx) => idx !== i))}
                      className="text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-end gap-2">
                <FormField label="Limit">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    className="input w-20 tabular-nums"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  />
                </FormField>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={run}
                  disabled={busy || columns.length === 0}
                  type="button"
                  className="ms-auto"
                >
                  {busy ? "Running..." : "Run"}
                </Button>
              </div>

              <div className="border-t border-ink-muted/10 pt-3 space-y-2">
                <div className="label">Save this report</div>
                <input
                  className="input"
                  placeholder="Name"
                  value={savedName}
                  onChange={(e) => setSavedName(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={savedIsShared}
                    onChange={(e) => setSavedIsShared(e.target.checked)}
                  />
                  Share with tenant
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={save}
                  disabled={!savedName || columns.length === 0}
                  type="button"
                >
                  {loadedId ? "Update" : "Save"}
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* Right column: results */}
        <section className="col-span-2">
          {!result ? (
            <Card className="p-8 text-center text-ink-muted text-sm">
              {doctype
                ? "Pick columns + filters and Run to see results."
                : "Pick a data source to start."}
            </Card>
          ) : (
            <Card>
              <div className="px-4 py-2 bg-surface-sunken text-xs text-ink-soft flex justify-between border-b border-ink-muted/10">
                <span>
                  <b>{result.total}</b> row{result.total !== 1 ? "s" : ""}
                  {result.truncated && " (truncated — increase limit)"}
                </span>
              </div>
              <div className="overflow-auto max-h-[calc(100vh-16rem)]">
                <table className="table">
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c.key} className="whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r, i) => (
                      <tr key={i}>
                        {result.columns.map((c) => (
                          <td
                            key={c.key}
                            className={
                              c.type === "number" ? "text-end font-mono tabular-nums" : ""
                            }
                          >
                            {fmtCell(r[c.key], c.type)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {result.rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={result.columns.length}
                          className="p-6 text-center text-ink-muted"
                        >
                          No rows match
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

export default function ReportBuilderPage() {
  return (
    <Suspense fallback={null}>
      <InnerReportBuilderPage />
    </Suspense>
  );
}
