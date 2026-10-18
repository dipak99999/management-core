"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, PageHeader, SectionHeader } from "../../components/ui";

const DASHBOARDS = [
  { name: "Master Data", charts: "Bar · Heatmap · Line · Pie · KPICards · Bar · TreeMap · Column · Donut" },
  { name: "Planning", charts: "Bar · Bubble · Calendar · Gantt · Line · Pie · Heatmap · Bar · StackedBar" },
  { name: "Procurement", charts: "Funnel · Line · Pie · KPICards · Scatter · Bar · StackedBar · Timeline · Waterfall" },
  { name: "Weighment", charts: "Bar · Gauge · Histogram · Line · KPICards · StackedBar · Pie · Bar" },
  { name: "Quality", charts: "Bar · BoxPlot · Line · Radar · KPICards · StackedBar · Heatmap · Pie" },
  { name: "Inventory", charts: "Bar · Donut · Heatmap · Line · KPICards · StackedBar · Bar · Pie · Column" },
  { name: "Production", charts: "Bar · Gauge · Line · KPICards · Scatter · StackedBar · TreeMap · Bar · Pie" },
  { name: "Engineering", charts: "Bar · Heatmap · Line · NetworkDiagram · Radar · Bar · StackedBar · KPICards · Pie" },
  { name: "Plant Maintenance", charts: "Bar · Gauge · Line · Pie · KPICards · StackedBar · Heatmap · Timeline · Bar" },
  { name: "Sales (Manufacturing)", charts: "Bar · Funnel · Heatmap · Line · Pie · StackedBar · KPICards · Column · Timeline" },
  { name: "Import / Export", charts: "Bar · Bubble · Line · Pie · KPICards · StackedBar · Bar · Timeline · Column" },
];

interface SeedResult {
  dashboards: Array<{ name: string; id: string; cards: number }>;
}

export default function MfgAnalyticsPage() {
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function seed() {
    if (!confirm("Seed all 11 Manufacturing dashboards (~97 charts)? Existing dashboards with matching names will be rebuilt.")) return;
    setSeeding(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<SeedResult>("/mfg-analytics/seed", {});
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
        breadcrumb={[{ label: "Stock", href: "/" }, { label: "Manufacturing Analytics" }]}
        title="Manufacturing Analytics"
       
        actions={
          <Button variant="brand" onClick={seed} disabled={seeding} type="button">
            {seeding ? "Seeding…" : "Seed 11 dashboards"}
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
        <SectionHeader title="The 11 dashboards" />
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
