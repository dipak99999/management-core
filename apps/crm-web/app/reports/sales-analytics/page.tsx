"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
  money,
  type Column,
} from "../../../components/ui";

// D13: Sales Analytics page. Two panels — funnel (from crm-service /reports/
// sales-funnel) + analytics (cross-service call to accounting-service
// /reports/sales-analytics for revenue + top customers/items).

interface FunnelStage { name: string; count: number; value: number | null }
interface FunnelData {
  from: string;
  to: string;
  stages: FunnelStage[];
  conversions: {
    leadToOpp: number | null;
    oppToQuote: number | null;
    quoteToSO: number | null;
    soToSI: number | null;
    leadToSI: number | null;
  };
  lossReasons: {
    leadsLost: number;
    oppsLost: number;
    quotesLost: number;
  };
}
interface AnalyticsData {
  from: string;
  to: string;
  totalRevenue: number;
  invoiceCount: number;
  monthly: { month: string; revenue: number }[];
  topCustomers: { id: string; customerName: string; revenue: number; count: number }[];
  topItems: {
    id: string;
    itemCode: string;
    itemName: string;
    qty: number;
    revenue: number;
  }[];
}

async function loadAnalytics(from: string, to: string): Promise<AnalyticsData> {
  const ACC =
    process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(
    `${ACC}/reports/sales-analytics?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Analytics failed (${res.status})`);
  return res.json();
}

type TopCustomer = AnalyticsData["topCustomers"][number];
type TopItem = AnalyticsData["topItems"][number];

export default function SalesAnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthsAgo = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
  };
  const minDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 10);
    return d.toISOString().slice(0, 10);
  })();
  const [from, setFrom] = useState(monthsAgo(12));
  const [to, setTo] = useState(today);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setError(null);
    if (from > to) {
      setError("'From' date must be on or before 'To' date.");
      return;
    }
    setLoading(true);
    try {
      const [f, a] = await Promise.all([
        api.get<FunnelData>(
          `/reports/sales-funnel?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`,
        ),
        loadAnalytics(from, to),
      ]);
      setFunnel(f);
      setAnalytics(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useListPageCommands({
    singular: "Sales Analytic",
    plural: "Sales Analytics",
    refresh: load,
  });

  const maxStage = funnel
    ? Math.max(...funnel.stages.map((s) => s.count), 1)
    : 1;
  const maxMonth = analytics
    ? Math.max(...analytics.monthly.map((m) => m.revenue), 1)
    : 1;

  const customerCols: Column<TopCustomer>[] = [
    { header: "Customer", cell: (c) => c.customerName },
    {
      header: "Invoices",
      align: "right",
      cell: (c) => <span className="tabular-nums">{c.count}</span>,
    },
    {
      header: "Revenue",
      align: "right",
      cell: (c) => (
        <span className="font-medium tabular-nums">{money(c.revenue)}</span>
      ),
    },
  ];

  const itemCols: Column<TopItem>[] = [
    {
      header: "Item",
      cell: (i) => (
        <>
          <div className="font-medium text-ink">{i.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{i.itemCode}</div>
        </>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums">{i.qty.toFixed(2)}</span>
      ),
    },
    {
      header: "Revenue",
      align: "right",
      cell: (i) => (
        <span className="font-medium tabular-nums">{money(i.revenue)}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Reports" },
          { label: "Sales Analytics" },
        ]}
        title="Sales Analytics"
        subtitle="Funnel conversions + revenue trend across the period"
        actions={
          <Button
            variant="secondary"
            onClick={() => history.back()}
            type="button"
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <Card className="p-4 flex gap-3 items-end flex-wrap">
        <FormField label="From">
          <input
            type="date"
            className="input"
            value={from}
            min={minDate}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </FormField>
        <FormField label="To">
          <input
            type="date"
            className="input"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
          />
        </FormField>
        <Button variant="primary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </Card>

      {funnel && (
        <section>
          <SectionHeader title="Funnel" />
          <Card className="p-4 space-y-2">
            {funnel.stages.map((s) => {
              const w = Math.max(4, Math.round((s.count / maxStage) * 100));
              return (
                <div key={s.name} className="flex items-center gap-3">
                  <div className="text-xs text-ink-muted w-32">{s.name}</div>
                  <div className="flex-1 bg-surface-sunken rounded h-6 relative">
                    <div
                      className="bg-brand-600 h-6 rounded transition-all"
                      style={{ width: `${w}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-xs text-white font-medium tabular-nums">
                      {s.count}
                      {s.value != null && ` · ${money(s.value)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
          <div className="grid grid-cols-5 gap-2 mt-3 text-sm">
            {[
              ["Lead → Opp", funnel.conversions.leadToOpp],
              ["Opp → Quote", funnel.conversions.oppToQuote],
              ["Quote → SO", funnel.conversions.quoteToSO],
              ["SO → SI", funnel.conversions.soToSI],
              ["Lead → SI", funnel.conversions.leadToSI],
            ].map(([label, val]) => (
              <Card key={String(label)} className="p-3 text-center">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                  {label}
                </div>
                <div className="font-semibold text-ink tabular-nums mt-0.5">
                  {val == null ? "—" : `${val}%`}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {analytics && (
        <>
          <section className="grid grid-cols-3 gap-3">
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Total revenue
              </div>
              <div className="text-lg font-semibold tabular-nums text-ink">
                {money(analytics.totalRevenue)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Invoices
              </div>
              <div className="text-lg font-semibold tabular-nums text-ink">
                {analytics.invoiceCount}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Avg / invoice
              </div>
              <div className="text-lg font-semibold tabular-nums text-ink">
                {analytics.invoiceCount > 0
                  ? money(analytics.totalRevenue / analytics.invoiceCount)
                  : "—"}
              </div>
            </Card>
          </section>

          <section>
            <SectionHeader title="Monthly revenue" />
            <Card className="p-4 space-y-1">
              {analytics.monthly.length === 0 && (
                <div className="text-sm text-ink-muted text-center py-4">
                  No data in period
                </div>
              )}
              {analytics.monthly.map((m) => {
                const w = Math.max(2, Math.round((m.revenue / maxMonth) * 100));
                return (
                  <div key={m.month} className="flex items-center gap-3 text-sm">
                    <div className="w-20 text-ink-muted text-xs">{m.month}</div>
                    <div className="flex-1 bg-surface-sunken rounded h-5 relative">
                      <div
                        className="bg-green-600 h-5 rounded transition-all"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                    <div className="w-24 text-end font-medium tabular-nums">
                      {money(m.revenue)}
                    </div>
                  </div>
                );
              })}
            </Card>
          </section>

          <section className="grid grid-cols-2 gap-4">
            <div>
              <SectionHeader title="Top customers" />
              <DataTable<TopCustomer>
                columns={customerCols}
                rows={analytics.topCustomers}
                rowKey={(c) => c.id}
                empty={{ title: "No customer revenue in period" }}
              />
            </div>
            <div>
              <SectionHeader title="Top items" />
              <DataTable<TopItem>
                columns={itemCols}
                rows={analytics.topItems}
                rowKey={(i) => i.id}
                empty={{ title: "No item revenue in period" }}
              />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
