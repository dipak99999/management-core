"use client";

import { useCallback, useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../../lib/dashboards";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../../components/ui";

const ACC = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

// India TDS Form 26Q — quarterly return. CA takes this CSV into their
// filing tool. Renders the same JSON dataset the API exposes; the
// "Download CSV" button hits the ?format=csv variant with the JWT header
// (localStorage session — can't ride along a plain <a href>).

interface Row {
  supplierId: string;
  supplierName: string;
  pan: string | null;
  panAvailable: boolean;
  sectionCode: string;
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string;
  paymentCount: number;
  totalPaidAmount: number;
  totalTdsAmount: number;
  effectiveRate: number;
  missingPan: boolean;
}
interface Report {
  tenantId: string;
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string;
  windowStart: string;
  windowEnd: string;
  rows: Row[];
  totals: {
    supplierCount: number;
    totalPaidAmount: number;
    totalTdsAmount: number;
    rowsMissingPan: number;
  };
}

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

export default function Tds26qPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await dashboardApi.get<Report>(`/reports/tds-26q?date=${date}`);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [date]);

  // Load on first mount so the page isn't empty. Subsequent changes require
  // the "Run" button — keeps the user in control of the query.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useListPageCommands({
    singular: "Tds 26q",
    plural: "Tds 26q",
    refresh: load,
  });

  async function downloadCsv() {
    const r = await fetch(`${ACC}/reports/tds-26q?date=${date}&format=csv`, {
      headers: { authorization: `Bearer ${loadToken()}` },
    });
    if (!r.ok) {
      setError(`Download failed (${r.status})`);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = report ? `26Q-${report.fyLabel}-Q${report.quarter}.csv` : "26Q.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Reports" },
          { label: "TDS 26Q" },
        ]}
        title="TDS 26Q — quarterly return"
        subtitle="Aggregates deducted TDS by (supplier, IT section) for the fiscal quarter containing the selected date. CSV is NSDL-friendly for CA filing."
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

      <div className="max-w-5xl space-y-6">
      <div className="card p-4 flex gap-3 items-end flex-wrap">
        <div>
          <label className="text-xs uppercase text-gray-500 block">Any date in quarter</label>
          <input
            type="date"
            className="border rounded px-2 py-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {busy ? "Loading…" : "Run"}
        </button>
        <button
          onClick={downloadCsv}
          disabled={!report}
          className="border border-brand-600 text-brand-600 px-4 py-2 rounded disabled:opacity-50"
        >
          Download CSV
        </button>
        {report && (
          <div className="text-sm text-gray-500 ms-auto">
            <span className="font-medium">
              Q{report.quarter} FY {report.fyLabel}
            </span>{" "}
            · {report.windowStart.slice(0, 10)} → {report.windowEnd.slice(0, 10)}
          </div>
        )}
      </div>

      {report && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded shadow">
              <div className="text-xs uppercase text-gray-500">Suppliers</div>
              <div className="text-2xl font-semibold">{report.totals.supplierCount}</div>
            </div>
            <div className="bg-white p-4 rounded shadow">
              <div className="text-xs uppercase text-gray-500">Total paid</div>
              <div className="text-2xl font-semibold">
                ₹{report.totals.totalPaidAmount.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="bg-white p-4 rounded shadow">
              <div className="text-xs uppercase text-gray-500">Total TDS</div>
              <div className="text-2xl font-semibold">
                ₹{report.totals.totalTdsAmount.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="bg-white p-4 rounded shadow">
              <div className="text-xs uppercase text-gray-500">Rows missing PAN</div>
              <div
                className={`text-2xl font-semibold ${
                  report.totals.rowsMissingPan > 0 ? "text-red-600" : ""
                }`}
              >
                {report.totals.rowsMissingPan}
              </div>
              {report.totals.rowsMissingPan > 0 && (
                <div className="text-xs text-red-600 mt-1">
                  File at no-PAN higher rate (usually 20%).
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600 text-start">
                <tr>
                  <th className="px-3 py-2">Section</th>
                  <th className="px-3 py-2">Deductee</th>
                  <th className="px-3 py-2">PAN</th>
                  <th className="px-3 py-2 text-end">Payments</th>
                  <th className="px-3 py-2 text-end">Total paid</th>
                  <th className="px-3 py-2 text-end">TDS</th>
                  <th className="px-3 py-2 text-end">Rate %</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr
                    key={`${r.supplierId}-${r.sectionCode}`}
                    className={`border-t ${r.missingPan ? "bg-red-50" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.sectionCode}</td>
                    <td className="px-3 py-2">{r.supplierName}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.pan ?? (
                        <span className="text-red-600">— missing —</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-end">{r.paymentCount}</td>
                    <td className="px-3 py-2 text-end">
                      ₹{r.totalPaidAmount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-end">
                      ₹{r.totalTdsAmount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-end">{r.effectiveRate.toFixed(2)}</td>
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                      No TDS deducted in this quarter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>
    </AppShell>
  );
}
