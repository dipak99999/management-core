"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, PageHeader, SectionHeader } from "../../components/ui";

const DASHBOARDS = [
  { name: "Payroll Summary", charts: "Bar · Gauge · Line · Pie · KPICards · StackedBar · Column · Donut" },
  { name: "Statutory Compliance", charts: "Bar · Gauge · Heatmap · Line · Pie · KPICards · StackedBar · Bar · Column · Waterfall · Timeline · Donut" },
  { name: "Salary Slips", charts: "Bar · Gauge · Line · Pie · KPICards · StackedColumn · Scatter · Bar" },
  { name: "Payroll · Leave & Attendance", charts: "Bar · Heatmap · Line · Pie · KPICards · StackedBar · Bar · Timeline · Donut" },
  { name: "Employee Benefits", charts: "Bar · Line · Pie · Radar · KPICards · StackedBar · Bar · Column" },
  { name: "Bonus & Incentive", charts: "Bar · Gauge · Line · Pie · KPICards · StackedBar · Column" },
  { name: "Reimbursements", charts: "Bar · Donut · Line · Pie · KPICards · StackedBar · Bar" },
  { name: "Payroll Cost Analysis", charts: "Bar · Line · Pie · Report · StackedBar · KPICards · TreeMap · Waterfall" },
  { name: "Tax & Audit", charts: "Bar · Heatmap · Line · Pie · KPICards · StackedBar · Timeline · Column" },
  { name: "Compliance & Filing", charts: "Bar · Gauge · Line · Pie · KPICards · StackedColumn · Bar · Timeline" },
  { name: "Year-End", charts: "Bar · Gauge · Line · Pie · KPICards · StackedBar · Bar" },
  { name: "Payroll · Custom", charts: "Bar · Line · KPICards" },
  { name: "Payroll · Attendance", charts: "Bar · Heatmap · Line · Pie · KPICards · StackedBar · Bar · Column · Histogram · Timeline" },
  { name: "Monthly Payroll", charts: "Bar · Gauge · Line · Pie · KPICards · StackedBar · Bar · Column" },
  { name: "Income Tax", charts: "Bar · Gauge · Line · Pie · KPICards · StackedColumn · Bar" },
  { name: "Payroll · Savings", charts: "Bar · Line · Pie · Radar · KPICards · StackedBar · Column" },
  { name: "Payroll · Financial", charts: "Bar · Gauge · Line · Pie · KPICards · StackedBar · Column · Waterfall" },
  { name: "Deductions", charts: "Bar · Line · Pie · Report · Scatter · KPICards · StackedBar" },
];

interface SeedResult {
  dashboards: Array<{ name: string; id: string; cards: number }>;
}

export default function PayrollAnalyticsPage() {
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function seed() {
    if (!confirm("Seed all 18 Payroll dashboards (~140 charts)? Existing dashboards with matching names will be rebuilt.")) return;
    setSeeding(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<SeedResult>("/payroll-analytics/seed", {});
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
        breadcrumb={[{ label: "HR", href: "/" }, { label: "Payroll Analytics" }]}
        title="Payroll Analytics"
       
        actions={
          <Button variant="brand" onClick={seed} disabled={seeding} type="button">
            {seeding ? "Seeding…" : "Seed 18 dashboards"}
          </Button>
        }
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      {result && (
        <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          Seeded {result.dashboards.length} dashboards with {totalCharts} charts. Visit the <a href="/dashboards" className="underline font-semibold">Dashboards page</a> to browse.
        </div>
      )}
      <Card className="p-4">
        <SectionHeader title="The 18 dashboards" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {DASHBOARDS.map((d, i) => {
            const seeded = result?.dashboards.find((x) => x.name === d.name);
            return (
              <div key={i} className="border border-ink-muted/10 rounded p-3 flex flex-col justify-between hover:border-brand-500/50 transition">
                <div>
                  <div className="text-sm font-semibold text-ink">{d.name}</div>
                  <div className="text-xs text-ink-muted mt-1">{d.charts}</div>
                </div>
                {seeded && (
                  <a href={`/dashboards/${seeded.id}`} className="text-xs text-brand-600 mt-2 hover:underline">Open →</a>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
