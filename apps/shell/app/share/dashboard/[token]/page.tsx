"use client";

// Public shared dashboard view — no auth. Loads via the AnalyticsShareLink
// token. If the link is password-protected, prompts for the password before
// hitting the /data endpoint.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

interface KpiData { value: number; deltaPercent?: number }
interface ChartRow { key: string; value: number }
interface TableCol { key: string; label: string; type: string }
interface TableResult { columns: TableCol[]; rows: Record<string, unknown>[]; total: number; truncated: boolean }
interface TextData { body: string }

interface CardResult {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  data: KpiData | ChartRow[] | TableResult | TextData | null;
  error?: string;
}

interface DashboardData {
  dashboard: { id: string; name: string; description: string | null };
  cards: CardResult[];
}

interface Meta {
  dashboardName: string;
  dashboardDescription: string | null;
  isPasswordProtected: boolean;
  expiresAt: string | null;
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function PublicDashboardPage() {
  const params = useParams<{ token: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${ACC}/public/analytics/shares/${params.token}`);
        if (!r.ok) throw new Error((await r.json()).error ?? "Not available");
        const m = (await r.json()) as Meta;
        setMeta(m);
        if (!m.isPasswordProtected) await loadData("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  const loadData = async (pw: string) => {
    setErr(null);
    const r = await fetch(`${ACC}/public/analytics/shares/${params.token}/data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (!r.ok) {
      setErr((await r.json()).error ?? "Failed");
      return;
    }
    setData((await r.json()) as DashboardData);
  };

  if (err)
    return (
      <main className="p-8 max-w-3xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {err}
        </div>
      </main>
    );
  if (!meta)
    return <main className="p-8 max-w-3xl mx-auto text-sm text-ink-muted">Loading…</main>;

  if (meta.isPasswordProtected && !data) {
    return (
      <main className="p-8 max-w-md mx-auto">
        <h1 className="text-xl font-semibold mb-4">{meta.dashboardName}</h1>
        <p className="text-sm text-gray-600 mb-4">
          This dashboard is password-protected.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadData(password);
          }}
          className="space-y-2"
        >
          <input
            type="password"
            placeholder="Password"
            className="w-full border rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button className="w-full bg-brand-600 text-white py-2 rounded">View</button>
        </form>
      </main>
    );
  }

  if (!data) return <main className="p-8 max-w-3xl mx-auto text-gray-500">Loading…</main>;

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-brand-600">Shared dashboard</div>
        <h1 className="text-2xl font-semibold mt-1">{data.dashboard.name}</h1>
        {data.dashboard.description && (
          <p className="text-sm text-gray-600">{data.dashboard.description}</p>
        )}
      </div>
      <div className="grid grid-cols-12 gap-4">
        {data.cards.map((c) => (
          <div key={c.id} className="col-span-6 bg-white rounded shadow p-4">
            <div className="text-xs uppercase text-gray-500">{c.title}</div>
            {c.subtitle && <div className="text-xs text-gray-400 mb-2">{c.subtitle}</div>}
            {c.error && <div className="text-red-600 text-sm">{c.error}</div>}
            {c.kind === "KPI" && c.data && (
              <div className="text-3xl font-semibold mt-1">{fmt((c.data as KpiData).value)}</div>
            )}
            {(c.kind === "BarChart" || c.kind === "LineChart" || c.kind === "PieChart") &&
              c.data && (
                <div className="space-y-1 mt-2">
                  {(c.data as ChartRow[]).map((r) => {
                    const max = Math.max(...(c.data as ChartRow[]).map((x) => x.value), 1);
                    return (
                      <div key={r.key} className="text-xs flex items-center gap-2">
                        <div className="w-24 truncate">{r.key}</div>
                        <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
                          <div
                            className="bg-brand-600 h-3"
                            style={{ width: `${(r.value / max) * 100}%` }}
                          />
                        </div>
                        <div className="w-20 text-end font-mono">{fmt(r.value)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            {c.kind === "Text" && c.data && (
              <div className="text-sm whitespace-pre-wrap mt-2">
                {(c.data as TextData).body}
              </div>
            )}
            {c.kind === "SavedReport" && c.data && (
              <div className="text-xs mt-2 overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      {(c.data as TableResult).columns.map((col) => (
                        <th key={col.key} className="text-start px-2 py-1">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(c.data as TableResult).rows.slice(0, 25).map((row, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        {(c.data as TableResult).columns.map((col) => (
                          <td key={col.key} className="px-2 py-1">
                            {String(row[col.key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        {data.cards.length === 0 && (
          <div className="col-span-12 text-center text-gray-500 py-12 bg-white rounded shadow">
            No cards on this dashboard.
          </div>
        )}
      </div>
      <div className="text-xs text-gray-400 text-center pt-4">Powered by Lumaara Analytics</div>
    </main>
  );
}
