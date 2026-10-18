"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  Toast,
  dateShort,
} from "../../../components/ui";
import { useCompanyScope } from "../../../components/company-scope";

interface ForecastLine {
  dueDate: string;
  amount: number;
  sourceDoc: string;
  sourceKind: string;
}

interface Bucket {
  fromDate: string;
  toDate: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  runningBalance: number;
  receipts: ForecastLine[];
  payments: ForecastLine[];
}

interface Forecast {
  asOfDate: string;
  horizonDays: number;
  granularity: "daily" | "weekly";
  openingBalance: number;
  buckets: Bucket[];
  runoutBucket: { index: number; label: string; runningBalance: number } | null;
}

// Module 56 — Cash forecast dashboard.
// Shows opening balance, per-bucket net + running balance, and flags
// the first bucket where cash goes negative. Clicking a bucket reveals
// the underlying receipts/payments.
export default function CashForecastPage() {
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [horizon, setHorizon] = useState<30 | 60 | 90>(90);
  const [granularity, setGranularity] = useState<"daily" | "weekly">("weekly");
  const [expanded, setExpanded] = useState<number | null>(null);
  const { qs } = useCompanyScope();

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const sep = qs ? "&" : "?";
      const r = await api.get<Forecast>(
        `/reports/cash-forecast${qs}${sep}horizon=${horizon}&granularity=${granularity}`,
      );
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, horizon, granularity]);

  useListPageCommands({
    singular: "Cash Forecast",
    plural: "Cash Forecast",
    refresh: load,
  });

  const maxAbsNet = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.buckets.map((b) => Math.abs(b.net)));
  }, [data]);

  function money(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Cash Forecast" },
        ]}
        title="Cash Forecast"
        subtitle="Rolls up AR + AP payment schedules + subscriptions into a projected cash position."
      />

      {error && <div><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <Card className="p-3 flex items-end gap-3">
        <FormField label="Horizon">
          <select className="input" value={horizon} onChange={(e) => setHorizon(Number(e.target.value) as 30 | 60 | 90)}>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </FormField>
        <FormField label="Granularity">
          <select className="input" value={granularity} onChange={(e) => setGranularity(e.target.value as "daily" | "weekly")}>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
          </select>
        </FormField>
        <Button variant="primary" onClick={load} disabled={busy}>{busy ? "Loading…" : "Refresh"}</Button>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-ink-muted uppercase tracking-wide">Opening cash</div>
              <div className="text-2xl font-mono mt-1">{money(data.openingBalance)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-ink-muted uppercase tracking-wide">Projected ({data.horizonDays}d)</div>
              <div className="text-2xl font-mono mt-1">
                {money(data.buckets[data.buckets.length - 1]?.runningBalance ?? data.openingBalance)}
              </div>
            </Card>
            <Card className={`p-4 ${data.runoutBucket ? "border-red-200 bg-red-50" : ""}`}>
              <div className="text-xs uppercase tracking-wide text-ink-muted">Cash runout</div>
              <div className={`text-lg font-medium mt-1 ${data.runoutBucket ? "text-red-700" : "text-green-700"}`}>
                {data.runoutBucket
                  ? `${data.runoutBucket.label} · ${money(data.runoutBucket.runningBalance)}`
                  : "No runout in horizon ✓"}
              </div>
            </Card>
          </div>

          <Card className="p-0 overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th className="text-end">Inflow</th>
                  <th className="text-end">Outflow</th>
                  <th className="text-end">Net</th>
                  <th className="text-end">Running balance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map((b, i) => (
                  <>
                    <tr
                      key={`b-${i}`}
                      className={`${b.runningBalance < 0 ? "bg-red-50" : ""} ${expanded === i ? "bg-brand-50" : "hover:bg-surface-sunken cursor-pointer"}`}
                      onClick={() => setExpanded(expanded === i ? null : i)}
                    >
                      <td className="text-sm">{b.label}</td>
                      <td className="text-end font-mono text-green-700">{b.inflow > 0 ? money(b.inflow) : "—"}</td>
                      <td className="text-end font-mono text-red-700">{b.outflow > 0 ? money(b.outflow) : "—"}</td>
                      <td className="text-end font-mono">
                        <div className="inline-flex items-center gap-2">
                          <span className={b.net < 0 ? "text-red-700" : b.net > 0 ? "text-green-700" : ""}>
                            {b.net === 0 ? "—" : (b.net > 0 ? "+" : "") + money(b.net)}
                          </span>
                          <div className="w-16 h-1.5 bg-surface-sunken rounded overflow-hidden">
                            <div
                              className={b.net >= 0 ? "bg-green-500" : "bg-red-500"}
                              style={{ width: `${Math.min(100, (Math.abs(b.net) / maxAbsNet) * 100)}%`, height: "100%" }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className={`text-end font-mono font-medium ${b.runningBalance < 0 ? "text-red-700" : ""}`}>
                        {money(b.runningBalance)}
                      </td>
                      <td className="text-end text-xs text-ink-muted">
                        {b.receipts.length + b.payments.length > 0
                          ? `${b.receipts.length + b.payments.length} tx`
                          : ""}
                      </td>
                    </tr>
                    {expanded === i && (b.receipts.length > 0 || b.payments.length > 0) && (
                      <tr key={`e-${i}`}>
                        <td colSpan={6} className="bg-brand-50/50 p-3">
                          {b.receipts.length > 0 && (
                            <div className="mb-2">
                              <div className="text-xs font-medium text-green-700 mb-1">Inflows</div>
                              {b.receipts.map((r, ri) => (
                                <div key={ri} className="text-xs flex items-center justify-between py-0.5">
                                  <span className="font-mono">{r.sourceDoc}</span>
                                  <span className="text-ink-muted">{r.sourceKind}</span>
                                  <span>{dateShort(r.dueDate)}</span>
                                  <span className="font-mono">{money(r.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {b.payments.length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-red-700 mb-1">Outflows</div>
                              {b.payments.map((p, pi) => (
                                <div key={pi} className="text-xs flex items-center justify-between py-0.5">
                                  <span className="font-mono">{p.sourceDoc}</span>
                                  <span className="text-ink-muted">{p.sourceKind}</span>
                                  <span>{dateShort(p.dueDate)}</span>
                                  <span className="font-mono">{money(p.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </main>
  );
}
