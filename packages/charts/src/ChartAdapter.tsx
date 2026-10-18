"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import {
  BarChart as EBarChart,
  LineChart as ELineChart,
  PieChart as EPieChart,
  ScatterChart as EScatterChart,
  RadarChart as ERadarChart,
  GaugeChart as EGaugeChart,
  FunnelChart as EFunnelChart,
  HeatmapChart as EHeatmapChart,
  TreemapChart as ETreemapChart,
  SunburstChart as ESunburstChart,
  SankeyChart as ESankeyChart,
  GraphChart as EGraphChart,
  BoxplotChart as EBoxplotChart,
  MapChart as EMapChart,
  EffectScatterChart as EEffectScatterChart,
  CustomChart as ECustomChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  GeoComponent,
  TitleComponent,
  DatasetComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import "echarts-wordcloud";
import { buildOption } from "./builders";
import type { ChartKind, ChartPayload, KpiValue, TableRow } from "./types";

echarts.use([
  EBarChart,
  ELineChart,
  EPieChart,
  EScatterChart,
  ERadarChart,
  EGaugeChart,
  EFunnelChart,
  EHeatmapChart,
  ETreemapChart,
  ESunburstChart,
  ESankeyChart,
  EGraphChart,
  EBoxplotChart,
  EMapChart,
  EEffectScatterChart,
  ECustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  GeoComponent,
  TitleComponent,
  DatasetComponent,
  CanvasRenderer,
]);

const NATIVE_KINDS = new Set<ChartKind>([
  "KPI",
  "KPICards",
  "SummaryTable",
  "ConditionalTable",
]);

interface ChartAdapterProps {
  kind: ChartKind;
  payload: ChartPayload;
  height?: number;
  className?: string;
}

export function ChartAdapter({
  kind,
  payload,
  height = 280,
  className,
}: ChartAdapterProps) {
  // Table-like / KPI-like kinds are pure React, not ECharts
  if (NATIVE_KINDS.has(kind)) {
    if ((kind === "KPI" || kind === "KPICards") && payload.kind === "KpiCards") {
      return <KpiCardsView cards={payload.cards} className={className} />;
    }
    if ((kind === "SummaryTable" || kind === "ConditionalTable") && payload.kind === "Table") {
      return <TableView data={payload.data} conditional={kind === "ConditionalTable"} className={className} />;
    }
    return <div className="text-xs text-red-600">Invalid payload for {kind}</div>;
  }

  return <EChartsCanvas kind={kind} payload={payload} height={height} className={className} />;
}

function EChartsCanvas({
  kind,
  payload,
  height,
  className,
}: {
  kind: ChartKind;
  payload: ChartPayload;
  height: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const option = useMemo(() => {
    try {
      return buildOption(kind, payload);
    } catch (e) {
      return { title: { text: e instanceof Error ? e.message : "Chart error", textStyle: { color: "#dc2626", fontSize: 12 } } };
    }
  }, [kind, payload]);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(ref.current, undefined, { renderer: "canvas" });
    }
    chartRef.current.setOption(option, true);
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
    };
  }, [option]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={ref} className={className} style={{ width: "100%", height }} />;
}

// —— KPI Cards ————————————————————————————————————————————————————

function formatKpi(v: number, fmt?: "number" | "currency" | "percent"): string {
  if (fmt === "currency") return v.toLocaleString(undefined, { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  if (fmt === "percent") return `${v.toFixed(1)}%`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function KpiCardsView({ cards, className }: { cards: KpiValue[]; className?: string }) {
  return (
    <div className={`grid gap-3 ${className ?? ""}`} style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))` }}>
      {cards.map((c, i) => {
        const positive = (c.delta ?? 0) >= 0;
        return (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{c.label}</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{formatKpi(c.value, c.format)}</div>
            {c.deltaPercent !== undefined && (
              <div className={`text-xs mt-1 tabular-nums ${positive ? "text-emerald-700" : "text-red-600"}`}>
                {positive ? "▲" : "▼"} {Math.abs(c.deltaPercent).toFixed(1)}%
              </div>
            )}
            {c.trend && c.trend.length > 0 && (
              <Sparkline values={c.trend} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 100;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-6 mt-2">
      <polyline points={points} fill="none" stroke="#4f46e5" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// —— Table (Summary / Conditional) ————————————————————————————————

function TableView({
  data,
  conditional,
  className,
}: {
  data: TableRow;
  conditional: boolean;
  className?: string;
}) {
  return (
    <div className={`overflow-auto ${className ?? ""}`}>
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-600 text-left">
          <tr>
            {data.columns.map((c) => (
              <th key={c.key} className="px-2 py-1 font-medium">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100">
              {data.columns.map((c) => {
                const raw = r[c.key];
                const bg = conditional ? bgForConditional(data, c.key, raw) : undefined;
                return (
                  <td key={c.key} className="px-2 py-1 text-gray-900" style={bg ? { backgroundColor: bg } : undefined}>
                    {String(raw ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr><td colSpan={data.columns.length} className="px-2 py-4 text-center text-gray-500">No data</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function bgForConditional(data: TableRow, key: string, raw: unknown): string | undefined {
  const rule = data.conditional?.[key];
  if (!rule) return undefined;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return undefined;
  let color: string | undefined;
  for (const t of rule.thresholds) {
    if (num >= t.value) color = t.color;
  }
  return color;
}
