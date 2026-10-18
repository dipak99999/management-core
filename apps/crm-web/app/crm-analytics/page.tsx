"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, PageHeader, SectionHeader } from "../../components/ui";

const DASHBOARDS = [
  { name: "Sales & Performance", charts: "Bar · Funnel · Line · Donut · StackedBar" },
  { name: "Marketing & Campaign", charts: "Bar · Bubble · Heatmap · Line · TreeMap" },
  { name: "Customer Relationship Management", charts: "Bar · Line · Pie · Radar · Sankey" },
  { name: "Warranty & Support", charts: "Column · Gauge · Scatter · StackedBar · Timeline" },
  { name: "Operational & Task Management", charts: "Bar · Gantt · Heatmap · KPICards · Pie" },
  { name: "Service & Case Management", charts: "Bar · Funnel · Pie · Scatter · Timeline" },
  { name: "Location-Based", charts: "BubbleMap · GeoMap · Heatmap · Line" },
  { name: "Project & Planning", charts: "Bar · Gantt · Line · Pie · Waterfall" },
  { name: "Purchase & Inventory (CRM view)", charts: "Bar · Line · Pie · Scatter · StackedBar" },
  { name: "Performance Evaluation", charts: "Bar · Gauge · Heatmap · Line · Radar" },
  { name: "Customer Interaction & Support", charts: "Bar · Funnel · Timeline · WordCloud" },
  { name: "Customer Segmentation & Insights", charts: "ClusterDiagram · Pie · Scatter · TreeMap" },
  { name: "Financial & Revenue (CRM view)", charts: "Bar · Line · Pie · StackedColumn · Waterfall" },
  { name: "Activity Tracking", charts: "Heatmap · Line · Scatter · Timeline" },
  { name: "Customer Feedback & Sentiment", charts: "Bar · Bubble · SentimentLine · WordCloud" },
  { name: "General CRM", charts: "Bar · Combo · Funnel · KPICards · Pie" },
];

interface SeedResult {
  dashboards: Array<{ name: string; id: string; cards: number }>;
}

export default function CrmAnalyticsPage() {
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function seed() {
    if (!confirm("Seed all 16 CRM dashboards (~75 charts)? Existing dashboards with matching names will be rebuilt.")) return;
    setSeeding(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<SeedResult>("/crm-analytics/seed", {});
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
        breadcrumb={[{ label: "CRM", href: "/" }, { label: "Analytics" }]}
        title="CRM Analytics"
       
        actions={
          <Button variant="brand" onClick={seed} disabled={seeding} type="button">
            {seeding ? "Seeding…" : "Seed 16 dashboards"}
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
        <SectionHeader title="The 16 dashboards" />
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
