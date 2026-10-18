"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Card,
  PageHeader,
  Toast,
} from "../../../components/ui";
import { useCompanyScope } from "../../../components/company-scope";

interface Row {
  accountId: string;
  accountName: string;
  rootType: string;
  budgetAmount: number;
  actualAmount: number;
  variance: number;
  variancePct: number;
  utilization: number;
  status: "OnTrack" | "Warning" | "Over";
}
interface Total {
  rootType: string;
  totalBudget: number;
  totalActual: number;
  variance: number;
  variancePct: number;
  rowCount: number;
}
interface BvA {
  fiscalYear: { id: string; name: string; startDate: string; endDate: string };
  rows: Row[];
  totals: Total[];
}

// Module 56 — Budget vs Actuals dashboard.
// Progress bars per account colored by rootType semantics: for Expense
// the bar goes green→amber→red as utilization climbs; for Income
// it's the opposite (green means beating budget).
export default function BudgetVsActualsPage() {
  const [data, setData] = useState<BvA | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { qs } = useCompanyScope();

  useEffect(() => {
    api
      .get<BvA>(`/reports/budget-vs-actuals${qs}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [qs]);

  function money(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  // For Expense rows: high utilization is bad (red). For Income: high
  // is good (green). Sign flips the color scale.
  function barColor(row: Row): string {
    const highIsBad = row.rootType === "Expense" || row.rootType === "Asset";
    if (highIsBad) {
      if (row.utilization >= 100) return "bg-red-500";
      if (row.utilization >= 80) return "bg-amber-500";
      return "bg-green-500";
    }
    if (row.utilization >= 100) return "bg-green-500";
    if (row.utilization >= 80) return "bg-amber-500";
    return "bg-red-400";
  }

  function varianceColor(row: { rootType: string; variance: number }): string {
    const positive = row.variance > 0;
    const goodWhenPositive = row.rootType === "Income" || row.rootType === "Liability";
    const good = positive === goodWhenPositive;
    return good ? "text-green-700" : "text-red-700";
  }

  if (!data) {
    return (
      <main className="p-8 space-y-4">
        <PageHeader title="Budget vs Actuals" />
        {error ? <Toast kind="error" message={error} /> : <div className="text-sm text-ink-muted">Loading…</div>}
      </main>
    );
  }

  const grouped = data.rows.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.rootType] ||= []).push(r);
    return acc;
  }, {});
  const order = ["Income", "Expense", "Asset", "Liability", "Equity"];

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Budget vs Actuals" },
        ]}
        title="Budget vs Actuals"
        subtitle={`FY ${data.fiscalYear.name} · ${data.rows.length} budgeted account${data.rows.length === 1 ? "" : "s"}`}
      />

      {error && <div><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {data.totals.map((t) => (
          <Card key={t.rootType} className="p-4">
            <div className="text-xs text-ink-muted uppercase tracking-wide">{t.rootType}</div>
            <div className="text-lg font-medium mt-1">
              <span className="font-mono">{money(t.totalActual)}</span>
              <span className="text-ink-muted"> / {money(t.totalBudget)}</span>
            </div>
            <div className={`text-xs mt-1 ${varianceColor({ rootType: t.rootType, variance: t.variance })}`}>
              {t.variance > 0 ? "+" : ""}{money(t.variance)} ({t.variancePct > 0 ? "+" : ""}{t.variancePct.toFixed(1)}%)
            </div>
            <div className="text-[10px] text-ink-muted mt-1">{t.rowCount} account{t.rowCount === 1 ? "" : "s"}</div>
          </Card>
        ))}
      </div>

      {order.filter((rt) => grouped[rt]).map((rt) => (
        <Card key={rt} className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-line bg-surface-sunken font-medium text-sm">{rt}</div>
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="text-end">Budget</th>
                <th className="text-end">Actual</th>
                <th>Utilization</th>
                <th className="text-end">Variance</th>
              </tr>
            </thead>
            <tbody>
              {grouped[rt].map((r) => (
                <tr key={r.accountId}>
                  <td>
                    <a
                      href={`/accounting/reports/general-ledger?accountId=${r.accountId}`}
                      className="text-brand-600 hover:underline"
                    >
                      {r.accountName}
                    </a>
                  </td>
                  <td className="text-end font-mono">{money(r.budgetAmount)}</td>
                  <td className="text-end font-mono">{money(r.actualAmount)}</td>
                  <td className="w-64">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-surface-sunken rounded overflow-hidden">
                        <div
                          className={`h-full ${barColor(r)} transition-all`}
                          style={{ width: `${Math.min(100, r.utilization)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-14 text-end">{r.utilization.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className={`text-end font-mono ${varianceColor(r)}`}>
                    {r.variance > 0 ? "+" : ""}{money(r.variance)}
                    <div className="text-xs">{r.variancePct > 0 ? "+" : ""}{r.variancePct.toFixed(1)}%</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {data.rows.length === 0 && (
        <Card className="p-8 text-center text-ink-muted">
          <div className="font-medium text-ink mb-1">No budgets defined for {data.fiscalYear.name}</div>
          <div className="text-sm">
            Head to <a href="/accounting/budgets" className="text-brand-600 underline">Budgets</a> to set annual amounts per account.
          </div>
        </Card>
      )}
    </main>
  );
}
