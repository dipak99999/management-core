// Advanced dashboard resolvers — extends the existing `resolveKpi` /
// `resolveChart` (which cover KeyValue-shaped Bar/Line/Pie) with resolvers
// for the new payload shapes required by the extended chart kinds:
//
//   MultiSeries · XY · Heatmap · Calendar · Tree · Sankey · Graph · BoxPlot
//   · Gantt · WordCloud · Gauge · KpiCards · Table
//
// Every resolver returns a ChartPayload (shape defined in @lumaara/charts).
// The dashboards HTTP route dispatches on card.kind, calls the matching
// resolver, and streams the payload straight to the ChartAdapter on the
// browser — no post-processing.

import { PrismaClient } from "@prisma/client";
import { getDoctypeMeta } from "./report-meta";
import { getPrismaDelegate } from "./prisma-delegate";
import { periodWindow, Period } from "./dashboard-resolver";

// The chart-kind and payload-shape enums live in @lumaara/charts. The db
// package can't depend on it (charts pulls in ECharts, a browser lib), so
// we inline the discriminated-union shape here. Keep in sync with
// packages/charts/src/types.ts.
type ChartPayload =
  | { kind: "KeyValue"; rows: { key: string; value: number }[] }
  | { kind: "MultiSeries"; series: string[]; rows: { key: string; values: Record<string, number> }[] }
  | { kind: "XY"; points: { x: number; y: number; label?: string; size?: number; category?: string }[] }
  | { kind: "Heatmap"; xLabels: string[]; yLabels: string[]; points: { x: string; y: string; value: number }[] }
  | { kind: "Calendar"; year: number; points: { date: string; value: number }[] }
  | { kind: "Sankey"; nodes: { name: string }[]; links: { source: string; target: string; value: number }[] }
  | { kind: "Graph"; nodes: { id: string; name: string; category?: string; value?: number }[]; edges: { source: string; target: string; value?: number; label?: string }[] }
  | { kind: "Tree"; root: { name: string; value?: number; children?: unknown[] } }
  | { kind: "BoxPlot"; boxes: { name: string; min: number; q1: number; median: number; q3: number; max: number; outliers?: number[] }[] }
  | { kind: "Gantt"; tasks: { name: string; group?: string; start: string; end: string; progress?: number }[] }
  | { kind: "WordCloud"; words: { text: string; weight: number }[] }
  | { kind: "Geo"; mapName: string; features: { name: string; value: number }[] }
  | { kind: "BubbleMap"; mapName: string; points: { lng: number; lat: number; value: number; name?: string }[] }
  | { kind: "Gauge"; value: number; min?: number; max?: number; label?: string }
  | { kind: "KpiCards"; cards: { label: string; value: number; format?: "number" | "currency" | "percent"; delta?: number; deltaPercent?: number; trend?: number[] }[] }
  | { kind: "Table"; data: { columns: { key: string; label: string; type?: string }[]; rows: Record<string, unknown>[]; conditional?: Record<string, { thresholds: { value: number; color: string }[] }> } };

// Common config nucleus. Every advanced card shares these; per-shape
// specifics live in the `params` bag validated by each resolver.
export interface AdvancedCardConfigBase {
  doctype: string;
  filters?: Record<string, unknown>;
  dateField?: string;
  period?: Period;
}

// —— Utilities ————————————————————————————————————————————————————

function assertDoctype(doctype: string) {
  const meta = getDoctypeMeta(doctype);
  if (!meta) throw new Error(`Doctype "${doctype}" is not reportable`);
  return meta;
}

function assertColumn(doctype: string, key: string) {
  const meta = assertDoctype(doctype);
  if (!meta.columns.find((c) => c.key === key))
    throw new Error(`Unknown field "${key}" on ${doctype}`);
}

function guardFilters(
  doctype: string,
  filters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!filters) return {};
  const meta = assertDoctype(doctype);
  const allowed = new Set(meta.filterableFields);
  for (const k of Object.keys(filters)) {
    if (k.startsWith("$")) continue;
    if (!allowed.has(k))
      throw new Error(`Field "${k}" is not filterable on ${doctype}`);
  }
  return filters;
}

function baseWhere(
  tenantId: string,
  cfg: AdvancedCardConfigBase,
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    tenantId,
    ...guardFilters(cfg.doctype, cfg.filters),
  };
  if (cfg.period && cfg.dateField) {
    const w = periodWindow(cfg.period);
    where[cfg.dateField] = { gte: w.from, lte: w.to };
  }
  return where;
}

// —— MultiSeries: two-level groupBy → { key, values: { seriesA, seriesB } } ——
// Used by: StackedBar, StackedColumn, ClusteredBar, ClusteredColumn,
// GroupedBar, StackedArea, Radar, Combo.

export interface MultiSeriesConfig extends AdvancedCardConfigBase {
  groupBy: string; // primary axis (categories)
  seriesBy: string; // secondary axis (series names)
  aggregate: "count" | "sum";
  field?: string; // required for sum
  limit?: number;
}

export async function resolveMultiSeries(
  prisma: PrismaClient,
  tenantId: string,
  cfg: MultiSeriesConfig,
): Promise<Extract<ChartPayload, { kind: "MultiSeries" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.groupBy);
  assertColumn(cfg.doctype, cfg.seriesBy);
  if (cfg.aggregate === "sum" && !cfg.field)
    throw new Error("aggregate=sum requires field");

  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const msArgs: Record<string, unknown> = {
    by: [cfg.groupBy, cfg.seriesBy],
    where: baseWhere(tenantId, cfg),
  };
  if (cfg.aggregate === "count") msArgs._count = true;
  else msArgs._sum = { [cfg.field!]: true };
  const rows = await delegate.groupBy(msArgs);

  // Pivot into { key, values }
  const bucket = new Map<string, Record<string, number>>();
  const seriesSet = new Set<string>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const key = String(r[cfg.groupBy] ?? "—");
    const series = String(r[cfg.seriesBy] ?? "—");
    seriesSet.add(series);
    const v =
      cfg.aggregate === "count"
        ? Number((r as { _count?: number })._count ?? 0)
        : Number(
            (r._sum as Record<string, unknown>)?.[cfg.field!] ?? 0,
          );
    const b = bucket.get(key) ?? {};
    b[series] = (b[series] ?? 0) + v;
    bucket.set(key, b);
  }
  const series = Array.from(seriesSet).sort();
  const outRows = Array.from(bucket.entries())
    .map(([key, values]) => ({ key, values }))
    .slice(0, cfg.limit ?? 50);
  return { kind: "MultiSeries", series, rows: outRows };
}

// —— XY: scatter/bubble ————————————————————————————————————————

export interface XYConfig extends AdvancedCardConfigBase {
  xField: string;
  yField: string;
  sizeField?: string; // enables bubble
  labelField?: string;
  categoryField?: string;
  limit?: number;
}

export async function resolveXY(
  prisma: PrismaClient,
  tenantId: string,
  cfg: XYConfig,
): Promise<Extract<ChartPayload, { kind: "XY" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.xField);
  assertColumn(cfg.doctype, cfg.yField);
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const select: Record<string, boolean> = {
    [cfg.xField]: true,
    [cfg.yField]: true,
  };
  if (cfg.sizeField) select[cfg.sizeField] = true;
  if (cfg.labelField) select[cfg.labelField] = true;
  if (cfg.categoryField) select[cfg.categoryField] = true;

  const rows = await delegate.findMany({
    where: baseWhere(tenantId, cfg),
    select,
    take: Math.min(cfg.limit ?? 500, 2000),
  });

  const points = (rows as Array<Record<string, unknown>>).map((r) => ({
    x: Number(r[cfg.xField] ?? 0),
    y: Number(r[cfg.yField] ?? 0),
    size: cfg.sizeField ? Number(r[cfg.sizeField] ?? 0) : undefined,
    label: cfg.labelField ? String(r[cfg.labelField] ?? "") : undefined,
    category: cfg.categoryField ? String(r[cfg.categoryField] ?? "") : undefined,
  }));
  return { kind: "XY", points };
}

// —— Heatmap (2-D cross-tab) ————————————————————————————————————

export interface HeatmapConfig extends AdvancedCardConfigBase {
  xField: string; // becomes column labels
  yField: string; // becomes row labels
  aggregate: "count" | "sum";
  valueField?: string;
}

export async function resolveHeatmap(
  prisma: PrismaClient,
  tenantId: string,
  cfg: HeatmapConfig,
): Promise<Extract<ChartPayload, { kind: "Heatmap" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.xField);
  assertColumn(cfg.doctype, cfg.yField);
  if (cfg.aggregate === "sum" && !cfg.valueField)
    throw new Error("aggregate=sum requires valueField");

  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const hmArgs: Record<string, unknown> = {
    by: [cfg.xField, cfg.yField],
    where: baseWhere(tenantId, cfg),
  };
  if (cfg.aggregate === "count") hmArgs._count = true;
  else hmArgs._sum = { [cfg.valueField!]: true };
  const rows = await delegate.groupBy(hmArgs);

  const xSet = new Set<string>();
  const ySet = new Set<string>();
  const points: { x: string; y: string; value: number }[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const x = String(r[cfg.xField] ?? "—");
    const y = String(r[cfg.yField] ?? "—");
    xSet.add(x);
    ySet.add(y);
    const value =
      cfg.aggregate === "count"
        ? Number((r as { _count?: number })._count ?? 0)
        : Number((r._sum as Record<string, unknown>)?.[cfg.valueField!] ?? 0);
    points.push({ x, y, value });
  }
  return {
    kind: "Heatmap",
    xLabels: Array.from(xSet).sort(),
    yLabels: Array.from(ySet).sort(),
    points,
  };
}

// —— Calendar heatmap ——————————————————————————————————————————

export interface CalendarConfig extends AdvancedCardConfigBase {
  dateField: string;
  aggregate: "count" | "sum";
  valueField?: string;
  year: number;
}

export async function resolveCalendar(
  prisma: PrismaClient,
  tenantId: string,
  cfg: CalendarConfig,
): Promise<Extract<ChartPayload, { kind: "Calendar" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.dateField);
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const from = new Date(Date.UTC(cfg.year, 0, 1));
  const to = new Date(Date.UTC(cfg.year, 11, 31, 23, 59, 59));
  const where: Record<string, unknown> = {
    tenantId,
    ...guardFilters(cfg.doctype, cfg.filters),
    [cfg.dateField]: { gte: from, lte: to },
  };

  const raw = await delegate.findMany({
    where,
    select: {
      [cfg.dateField]: true,
      ...(cfg.valueField ? { [cfg.valueField]: true } : {}),
    },
    take: 10000,
  });

  const byDate = new Map<string, number>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const d = r[cfg.dateField] as Date | string | null;
    if (!d) continue;
    const iso = new Date(d).toISOString().slice(0, 10);
    const inc =
      cfg.aggregate === "count" ? 1 : Number(r[cfg.valueField!] ?? 0);
    byDate.set(iso, (byDate.get(iso) ?? 0) + inc);
  }
  return {
    kind: "Calendar",
    year: cfg.year,
    points: Array.from(byDate.entries()).map(([date, value]) => ({ date, value })),
  };
}

// —— Tree (TreeMap/Sunburst) ————————————————————————————————————

export interface TreeConfig extends AdvancedCardConfigBase {
  rootGroupBy: string;
  leafGroupBy?: string; // optional second level
  aggregate: "count" | "sum";
  valueField?: string;
  rootLabel?: string;
}

export async function resolveTree(
  prisma: PrismaClient,
  tenantId: string,
  cfg: TreeConfig,
): Promise<Extract<ChartPayload, { kind: "Tree" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.rootGroupBy);
  if (cfg.leafGroupBy) assertColumn(cfg.doctype, cfg.leafGroupBy);
  if (cfg.aggregate === "sum" && !cfg.valueField)
    throw new Error("aggregate=sum requires valueField");
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const by = cfg.leafGroupBy ? [cfg.rootGroupBy, cfg.leafGroupBy] : [cfg.rootGroupBy];
  const treeArgs: Record<string, unknown> = {
    by,
    where: baseWhere(tenantId, cfg),
  };
  if (cfg.aggregate === "count") treeArgs._count = true;
  else treeArgs._sum = { [cfg.valueField!]: true };
  const rows = await delegate.groupBy(treeArgs);

  const branches = new Map<string, { total: number; leaves: Map<string, number> }>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const root = String(r[cfg.rootGroupBy] ?? "—");
    const leaf = cfg.leafGroupBy ? String(r[cfg.leafGroupBy] ?? "—") : null;
    const v =
      cfg.aggregate === "count"
        ? Number((r as { _count?: number })._count ?? 0)
        : Number((r._sum as Record<string, unknown>)?.[cfg.valueField!] ?? 0);
    const b = branches.get(root) ?? { total: 0, leaves: new Map() };
    b.total += v;
    if (leaf !== null) b.leaves.set(leaf, (b.leaves.get(leaf) ?? 0) + v);
    branches.set(root, b);
  }
  return {
    kind: "Tree",
    root: {
      name: cfg.rootLabel ?? cfg.doctype,
      children: Array.from(branches.entries()).map(([name, b]) => ({
        name,
        value: b.total,
        children:
          b.leaves.size > 0
            ? Array.from(b.leaves.entries()).map(([n, v]) => ({ name: n, value: v }))
            : undefined,
      })),
    },
  };
}

// —— Sankey / FlowChart ————————————————————————————————————————

export interface SankeyConfig extends AdvancedCardConfigBase {
  sourceField: string;
  targetField: string;
  aggregate: "count" | "sum";
  valueField?: string;
}

export async function resolveSankey(
  prisma: PrismaClient,
  tenantId: string,
  cfg: SankeyConfig,
): Promise<Extract<ChartPayload, { kind: "Sankey" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.sourceField);
  assertColumn(cfg.doctype, cfg.targetField);
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const skArgs: Record<string, unknown> = {
    by: [cfg.sourceField, cfg.targetField],
    where: baseWhere(tenantId, cfg),
  };
  if (cfg.aggregate === "count") skArgs._count = true;
  else skArgs._sum = { [cfg.valueField!]: true };
  const rows = await delegate.groupBy(skArgs);

  const nodeSet = new Set<string>();
  const links = (rows as Array<Record<string, unknown>>).map((r) => {
    const source = String(r[cfg.sourceField] ?? "—");
    const target = String(r[cfg.targetField] ?? "—");
    nodeSet.add(source);
    nodeSet.add(target);
    const value =
      cfg.aggregate === "count"
        ? Number((r as { _count?: number })._count ?? 0)
        : Number((r._sum as Record<string, unknown>)?.[cfg.valueField!] ?? 0);
    return { source, target, value };
  });
  return {
    kind: "Sankey",
    nodes: Array.from(nodeSet).map((name) => ({ name })),
    links,
  };
}

// —— BoxPlot ——————————————————————————————————————————————————————

export interface BoxPlotConfig extends AdvancedCardConfigBase {
  groupBy: string;
  valueField: string;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined)
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

export async function resolveBoxPlot(
  prisma: PrismaClient,
  tenantId: string,
  cfg: BoxPlotConfig,
): Promise<Extract<ChartPayload, { kind: "BoxPlot" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.groupBy);
  assertColumn(cfg.doctype, cfg.valueField);
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const rows = await delegate.findMany({
    where: baseWhere(tenantId, cfg),
    select: { [cfg.groupBy]: true, [cfg.valueField]: true },
    take: 5000,
  });

  const byGroup = new Map<string, number[]>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const g = String(r[cfg.groupBy] ?? "—");
    const v = Number(r[cfg.valueField] ?? 0);
    if (!Number.isFinite(v)) continue;
    const arr = byGroup.get(g) ?? [];
    arr.push(v);
    byGroup.set(g, arr);
  }
  const boxes = Array.from(byGroup.entries()).map(([name, vals]) => {
    const sorted = vals.slice().sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const outliers = sorted.filter((v) => v < lo || v > hi);
    const inner = sorted.filter((v) => v >= lo && v <= hi);
    return {
      name,
      min: inner[0] ?? sorted[0] ?? 0,
      q1,
      median: quantile(sorted, 0.5),
      q3,
      max: inner[inner.length - 1] ?? sorted[sorted.length - 1] ?? 0,
      outliers,
    };
  });
  return { kind: "BoxPlot", boxes };
}

// —— Histogram (bins on a numeric field) ————————————————————————

export interface HistogramConfig extends AdvancedCardConfigBase {
  field: string;
  bins?: number;
}

export async function resolveHistogram(
  prisma: PrismaClient,
  tenantId: string,
  cfg: HistogramConfig,
): Promise<Extract<ChartPayload, { kind: "KeyValue" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.field);
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const rows = await delegate.findMany({
    where: baseWhere(tenantId, cfg),
    select: { [cfg.field]: true },
    take: 10000,
  });
  const vals = (rows as Array<Record<string, unknown>>)
    .map((r) => Number(r[cfg.field] ?? 0))
    .filter((v) => Number.isFinite(v));
  if (vals.length === 0) return { kind: "KeyValue", rows: [] };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const bins = Math.max(3, Math.min(cfg.bins ?? 10, 30));
  const step = (max - min) / bins || 1;
  const buckets = Array.from({ length: bins }, (_, i) => ({
    from: min + i * step,
    to: min + (i + 1) * step,
    n: 0,
  }));
  for (const v of vals) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / step));
    buckets[idx].n++;
  }
  return {
    kind: "KeyValue",
    rows: buckets.map((b) => ({
      key: `${b.from.toFixed(1)}–${b.to.toFixed(1)}`,
      value: b.n,
    })),
  };
}

// —— Gantt / Timeline ————————————————————————————————————————————

export interface GanttConfig extends AdvancedCardConfigBase {
  nameField: string;
  startField: string;
  endField: string;
  groupField?: string;
  progressField?: string;
  limit?: number;
}

export async function resolveGantt(
  prisma: PrismaClient,
  tenantId: string,
  cfg: GanttConfig,
): Promise<Extract<ChartPayload, { kind: "Gantt" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.nameField);
  assertColumn(cfg.doctype, cfg.startField);
  assertColumn(cfg.doctype, cfg.endField);
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const select: Record<string, boolean> = {
    [cfg.nameField]: true,
    [cfg.startField]: true,
    [cfg.endField]: true,
  };
  if (cfg.groupField) select[cfg.groupField] = true;
  if (cfg.progressField) select[cfg.progressField] = true;

  const rows = await delegate.findMany({
    where: baseWhere(tenantId, cfg),
    select,
    take: Math.min(cfg.limit ?? 200, 500),
  });
  const tasks = (rows as Array<Record<string, unknown>>)
    .map((r) => {
      const s = r[cfg.startField] as Date | string | null;
      const e = r[cfg.endField] as Date | string | null;
      if (!s || !e) return null;
      return {
        name: String(r[cfg.nameField] ?? "—"),
        start: new Date(s).toISOString(),
        end: new Date(e).toISOString(),
        group: cfg.groupField ? String(r[cfg.groupField] ?? "—") : undefined,
        progress: cfg.progressField ? Number(r[cfg.progressField] ?? 0) : undefined,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  return { kind: "Gantt", tasks };
}

// —— WordCloud (top-N string values) ————————————————————————————

export interface WordCloudConfig extends AdvancedCardConfigBase {
  field: string;
  limit?: number;
}

export async function resolveWordCloud(
  prisma: PrismaClient,
  tenantId: string,
  cfg: WordCloudConfig,
): Promise<Extract<ChartPayload, { kind: "WordCloud" }>> {
  const meta = assertDoctype(cfg.doctype);
  assertColumn(cfg.doctype, cfg.field);
  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const rows = await delegate.groupBy({
    by: [cfg.field],
    where: baseWhere(tenantId, cfg),
    _count: true,
    orderBy: { _count: { [cfg.field]: "desc" } },
    take: Math.min(cfg.limit ?? 50, 200),
  });
  return {
    kind: "WordCloud",
    words: (rows as Array<Record<string, unknown>>).map((r) => ({
      text: String(r[cfg.field] ?? "—"),
      weight: Number((r as { _count?: number })._count ?? 0),
    })),
  };
}

// —— KpiCards (multiple KPIs in one card) ———————————————————————

export interface KpiCardsConfig {
  cards: Array<{
    label: string;
    doctype: string;
    aggregate: "count" | "sum" | "avg";
    field?: string;
    filters?: Record<string, unknown>;
    dateField?: string;
    period?: Period;
    format?: "number" | "currency" | "percent";
  }>;
}

export async function resolveKpiCards(
  prisma: PrismaClient,
  tenantId: string,
  cfg: KpiCardsConfig,
): Promise<Extract<ChartPayload, { kind: "KpiCards" }>> {
  const cards = await Promise.all(
    cfg.cards.map(async (c) => {
      const meta = assertDoctype(c.doctype);
      const delegate = getPrismaDelegate(prisma, meta.delegate);
      if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);
      const where: Record<string, unknown> = {
        tenantId,
        ...guardFilters(c.doctype, c.filters),
      };
      if (c.period && c.dateField) {
        const w = periodWindow(c.period);
        where[c.dateField] = { gte: w.from, lte: w.to };
      }
      let value = 0;
      if (c.aggregate === "count") {
        value = Number(await delegate.count({ where }));
      } else {
        const aggArgs: Record<string, unknown> = { where };
        if (c.aggregate === "sum") aggArgs._sum = { [c.field!]: true };
        else aggArgs._avg = { [c.field!]: true };
        const r = (await delegate.aggregate(aggArgs)) as { _sum?: Record<string, unknown>; _avg?: Record<string, unknown> };
        const bucket = c.aggregate === "sum" ? r._sum : r._avg;
        value = Number(bucket?.[c.field!] ?? 0);
      }
      return { label: c.label, value, format: c.format };
    }),
  );
  return { kind: "KpiCards", cards };
}
