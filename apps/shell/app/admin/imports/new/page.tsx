"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardApi } from "../../../../lib/dashboards";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../../components/ui";

interface DoctypeSpec {
  doctype: string;
  supportedKeys: string[];
  parentKey: string | null;
  columns: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    scope: "parent" | "line";
  }[];
}

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

function loadToken(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

interface JobResp {
  job: {
    id: string;
    name: string;
    totalRows: number;
    succeededRows: number;
    failedRows: number;
    status: string;
  };
  // Present only in the sync-fallback path (no Redis). When the request was
  // queued to BullMQ the response is 202 with just `job` + `queued=true`.
  rowResults?: {
    rowNumber: number;
    status: string;
    action?: string;
    error?: string;
    raw: Record<string, string>;
  }[];
  queued?: boolean;
}

interface DetectResp {
  header: string[];
  previewRows: string[][];
  rowCount: number;
}

// Convert a File to a base64 string without the data-URL prefix.
async function fileToBase64(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function NewImportPage() {
  const [meta, setMeta] = useState<DoctypeSpec[]>([]);
  const [doctype, setDoctype] = useState("");
  const [mode, setMode] = useState<"create" | "upsert" | "update">("create");
  const [keyField, setKeyField] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [format, setFormat] = useState<"csv" | "xlsx" | null>(null);
  const [csv, setCsv] = useState("");
  const [xlsxBase64, setXlsxBase64] = useState("");
  const [detected, setDetected] = useState<DetectResp | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<JobResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const r = await dashboardApi.get<{ doctypes: DoctypeSpec[] }>(
          "/imports/doctypes",
        );
        setMeta(r.doctypes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, []);

  const spec = meta.find((m) => m.doctype === doctype);

  // Auto-map exact matches (case-insensitive) after headers are detected.
  useEffect(() => {
    if (!detected || !spec) return;
    const auto: Record<string, string> = {};
    for (const src of detected.header) {
      const norm = src.trim().toLowerCase();
      const match = spec.columns.find(
        (c) => c.key.toLowerCase() === norm || (c.label ?? "").toLowerCase() === norm,
      );
      if (match) auto[src] = match.key;
    }
    setColumnMap(auto);
  }, [detected, spec]);

  const requiredMissing = useMemo(() => {
    if (!spec) return [] as string[];
    const mappedTargets = new Set(Object.values(columnMap).filter(Boolean));
    return spec.columns.filter((c) => c.required && !mappedTargets.has(c.key)).map((c) => c.key);
  }, [spec, columnMap]);

  async function onFile(f: File) {
    if (f.size > 4_000_000) {
      setError("File must be < 4 MB");
      return;
    }
    setError(null);
    setFileName(f.name);
    setResult(null);
    setDetected(null);
    setColumnMap({});
    const isXlsx = /\.(xlsx|xls|xlsm)$/i.test(f.name);
    if (isXlsx) {
      const b64 = await fileToBase64(f);
      setFormat("xlsx");
      setXlsxBase64(b64);
      setCsv("");
      await detect({ xlsxBase64: b64 });
    } else {
      const text = await f.text();
      setFormat("csv");
      setCsv(text);
      setXlsxBase64("");
      await detect({ csv: text });
    }
  }

  async function detect(body: { csv?: string; xlsxBase64?: string }) {
    try {
      const r = await dashboardApi.post<DetectResp>("/imports/detect-headers", body);
      setDetected(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detect failed");
    }
  }

  async function downloadTemplate() {
    if (!doctype) return;
    const r = await fetch(`${ACC}/imports/template/${doctype}`, {
      headers: { authorization: `Bearer ${loadToken()}` },
    });
    if (!r.ok) {
      setError(`Template download failed (${r.status})`);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doctype}-template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        doctype,
        mode,
        keyField: mode === "create" ? null : keyField || null,
        dryRun,
        fileName,
        columnMap: Object.keys(columnMap).length ? columnMap : undefined,
      };
      if (format === "xlsx") body.xlsxBase64 = xlsxBase64;
      else body.csv = csv;
      const r = await dashboardApi.post<JobResp>("/imports", body);
      // Queued path (BullMQ available): navigate to the detail page which
      // polls until the worker finishes. Sync-fallback path returns the full
      // rowResults inline — render them below.
      if (r.queued) {
        router.push(`/admin/imports/${r.job.id}`);
        return;
      }
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Imports", href: "/admin/imports" },
          { label: "New" },
        ]}
        title="New import"
        subtitle="Upload CSV or Excel, map columns, dry-run for validation, then commit."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">

      <div className="bg-white p-4 rounded shadow space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <select
            className="border rounded px-3 py-2"
            value={doctype}
            onChange={(e) => {
              setDoctype(e.target.value);
              setKeyField("");
              setColumnMap({});
            }}
          >
            <option value="">Doctype…</option>
            {meta.map((m) => (
              <option key={m.doctype}>{m.doctype}</option>
            ))}
          </select>
          <select
            className="border rounded px-3 py-2"
            value={mode}
            onChange={(e) => setMode(e.target.value as "create" | "upsert" | "update")}
          >
            <option value="create">Create only</option>
            <option value="upsert">Upsert (create or update)</option>
            <option value="update">Update existing only</option>
          </select>
          {mode !== "create" && spec && (
            <select
              className="border rounded px-3 py-2"
              value={keyField}
              onChange={(e) => setKeyField(e.target.value)}
              required
            >
              <option value="">Key field…</option>
              {spec.supportedKeys.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          )}
        </div>

        {spec && (
          <div className="text-xs text-gray-600 space-y-1">
            <div>
              <button
                onClick={downloadTemplate}
                className="text-brand-600 hover:underline me-3"
              >
                Download {spec.doctype} template CSV
              </button>
            </div>
            {spec.parentKey && (
              <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                This doctype supports line items. Repeat the same{" "}
                <span className="font-mono">{spec.parentKey}</span> (or leave it
                blank) on continuation rows to attach more lines to the same
                parent record.
              </div>
            )}
            <div>
              Columns:{" "}
              {spec.columns.map((c) => (
                <span
                  key={c.key}
                  className={`inline-block me-2 px-2 py-0.5 rounded ${
                    c.required
                      ? "bg-red-50 text-red-700"
                      : c.scope === "line"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-gray-100"
                  }`}
                >
                  {c.key} <span className="text-gray-500">({c.type})</span>
                  {c.scope === "line" && (
                    <span className="text-gray-400"> · line</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs uppercase text-gray-500">
            CSV or Excel file
          </label>
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          {fileName && (
            <div className="text-xs text-gray-500 mt-1">
              Loaded: {fileName}{" "}
              {format && (
                <span className="ms-1 uppercase text-brand-600">[{format}]</span>
              )}
              {detected && (
                <span className="ms-2 text-gray-400">
                  · {detected.rowCount} data row(s)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {detected && spec && (
        <div className="bg-white p-4 rounded shadow space-y-3">
          <div className="text-sm font-semibold">Column mapping</div>
          <div className="text-xs text-gray-500">
            Match each column from your file to a target field. Auto-matched
            columns are pre-filled — override any as needed. Leave a mapping
            blank to skip the column.
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 text-start">
              <tr>
                <th className="py-2 px-2">Source column</th>
                <th className="py-2 px-2">Preview</th>
                <th className="py-2 px-2">→ Target field</th>
              </tr>
            </thead>
            <tbody>
              {detected.header.map((src) => {
                const preview = detected.previewRows
                  .map((r) => r[detected.header.indexOf(src)] ?? "")
                  .filter((v) => v !== "")
                  .slice(0, 2)
                  .join(" · ");
                return (
                  <tr key={src} className="border-t">
                    <td className="py-1 px-2 font-mono text-xs">{src || "(blank)"}</td>
                    <td className="py-1 px-2 text-xs text-gray-500 truncate max-w-xs">
                      {preview || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-1 px-2">
                      <select
                        value={columnMap[src] ?? ""}
                        onChange={(e) =>
                          setColumnMap((m) => ({ ...m, [src]: e.target.value }))
                        }
                        className="border rounded px-2 py-1 text-sm w-full"
                      >
                        <option value="">— skip —</option>
                        {(spec?.columns ?? []).filter((c) => c.scope === "parent").length > 0 && (
                          <optgroup label="Parent fields">
                            {(spec?.columns ?? [])
                              .filter((c) => c.scope === "parent")
                              .map((c) => (
                                <option key={c.key} value={c.key}>
                                  {c.key}
                                </option>
                              ))}
                          </optgroup>
                        )}
                        {(spec?.columns ?? []).some((c) => c.scope === "line") && (
                          <optgroup label="Line-item fields">
                            {(spec?.columns ?? [])
                              .filter((c) => c.scope === "line")
                              .map((c) => (
                                <option key={c.key} value={c.key}>
                                  {c.key}
                                </option>
                              ))}
                          </optgroup>
                        )}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {requiredMissing.length > 0 && (
            <div className="text-xs text-red-600">
              Required fields not mapped: {requiredMissing.join(", ")}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => run(true)}
          disabled={
            !doctype ||
            (!csv && !xlsxBase64) ||
            busy ||
            requiredMissing.length > 0
          }
          className="border border-brand-600 text-brand-600 px-4 py-2 rounded disabled:opacity-50"
        >
          {busy ? "Running…" : "Dry Run"}
        </button>
        <button
          onClick={() => run(false)}
          disabled={
            !doctype ||
            (!csv && !xlsxBase64) ||
            busy ||
            requiredMissing.length > 0
          }
          className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {busy ? "Importing…" : "Commit Import"}
        </button>
      </div>

      {result && (
        <div className="bg-white p-4 rounded shadow space-y-2">
          <div className="text-sm">
            <a
              href={`/admin/imports/${result.job.id}`}
              className="text-brand-600 hover:underline font-mono"
            >
              {result.job.name}
            </a>{" "}
            · {result.job.totalRows} rows ·{" "}
            <span className="text-green-700">{result.job.succeededRows} ok</span>{" "}
            · <span className="text-red-600">{result.job.failedRows} failed</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 text-start">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Action</th>
                <th className="px-2 py-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(result.rowResults ?? []).slice(0, 100).map((r) => (
                <tr
                  key={r.rowNumber}
                  className={`border-t ${
                    r.status === "Failed" ? "text-red-600" : ""
                  }`}
                >
                  <td className="px-2 py-1">{r.rowNumber}</td>
                  <td className="px-2 py-1">{r.status}</td>
                  <td className="px-2 py-1">{r.action ?? "—"}</td>
                  <td className="px-2 py-1">
                    {r.error ?? Object.values(r.raw).slice(0, 3).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(result.rowResults?.length ?? 0) > 100 && (
            <div className="text-xs text-ink-muted">
              Showing first 100 of {result.rowResults?.length ?? 0} rows.{" "}
              <a
                href={`/admin/imports/${result.job.id}`}
                className="text-brand-600 hover:underline"
              >
                Open job →
              </a>
            </div>
          )}
        </div>
      )}
      </div>
    </AppShell>
  );
}
