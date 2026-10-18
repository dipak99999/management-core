"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, PageHeader, SectionHeader } from "../../components/ui";

// One-click seed for the 18 Finance & Accounting dashboards. After seeding,
// each shows up in the shell's /dashboards list; clicking one lands on
// /dashboards/[id] where the ChartAdapter renders the 3 (or so) charts per
// group.

const DASHBOARDS = [
  { name: "Accounts Payable", charts: "Donut · Line · StackedBar" },
  { name: "Accounts Receivable", charts: "Line · Pie · StackedBar" },
  { name: "Cash Flow & Bank", charts: "Bar · Line · Waterfall" },
  { name: "Budgeting & Forecasting", charts: "Bar · Line · Scatter" },
  { name: "Taxation & Compliance", charts: "Pie · StackedBar · Timeline" },
  { name: "Fixed Asset Management", charts: "Bar · Line · TreeMap" },
  { name: "Operational Efficiency", charts: "Bar · Bubble · Line" },
  { name: "Cost Center Analysis", charts: "Bar · Heatmap · Pie" },
  { name: "Journal Entry", charts: "Line · StackedBar · TreeMap" },
  { name: "Budget & Allocation", charts: "Donut · Waterfall · Bar" },
  { name: "Financial Summary", charts: "Line · StackedArea · KPICards" },
  { name: "Variance & Forecasting", charts: "Bar · Line · Scatter" },
  { name: "Compliance & Audit", charts: "Gantt · Pie · Bar" },
  { name: "Allocation", charts: "StackedBar · Sunburst · TreeMap" },
  { name: "Custom", charts: "SummaryTable" },
  { name: "Party & Bank", charts: "Bar · Line · Pie" },
  { name: "Summary & Dashboard", charts: "Combo · Bar · KPICards" },
  { name: "Budgeting & Variance", charts: "Heatmap · Line · Waterfall" },
];

interface SeedResult {
  dashboards: Array<{ name: string; id: string; cards: number }>;
}

export default function FinanceAnalyticsPage() {
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function seed() {
    if (!confirm("Seed all 18 Finance & Accounting dashboards? Existing dashboards with matching names will be rebuilt.")) return;
    setSeeding(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<SeedResult>("/finance-analytics/seed", {});
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  }

  const totalCharts = result?.dashboards.reduce((s, d) => s + d.cards, 0) ?? 0;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Accounting", href: "/" }, { label: "Finance Analytics" }]}
        title="Finance & Accounting Analytics"
       
        actions={
          <Button variant="brand" onClick={seed} disabled={seeding} type="button">
            {seeding ? "Seeding…" : "Seed 18 dashboards"}
          </Button>
        }
      />

      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}

      {result && (
        <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          Seeded {result.dashboards.length} dashboards with {totalCharts} charts. Visit the{" "}
          <a href="/dashboards" className="underline font-semibold">
            Dashboards page
          </a>{" "}
          to browse them.
        </div>
      )}

      <Card className="p-4">
        <SectionHeader title={`The 18 dashboards`} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {DASHBOARDS.map((d, i) => {
            const seeded = result?.dashboards.find((x) => x.name === d.name);
            return (
              <div
                key={i}
                className="border border-ink-muted/10 rounded p-3 flex flex-col justify-between hover:border-brand-500/50 transition"
              >
                <div>
                  <div className="text-sm font-semibold text-ink">{d.name}</div>
                  <div className="text-xs text-ink-muted mt-1">{d.charts}</div>
                </div>
                {seeded && (
                  <a
                    href={`/dashboards/${seeded.id}`}
                    className="text-xs text-brand-600 mt-2 hover:underline"
                  >
                    Open →
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
