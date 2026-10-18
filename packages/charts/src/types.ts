// Every chart kind the platform can render. This is the ONE source of truth
// consumed by both dashboard-resolver (to shape the payload) and ChartAdapter
// (to render). If a new spec calls for a new kind, add it here first.

export type ChartKind =
  // Categorical single-series
  | "Bar"
  | "HorizontalBar"
  | "Column"
  | "Pie"
  | "Donut"
  | "Funnel"
  | "Radar"
  | "Gauge"
  | "TreeMap"
  | "Sunburst"
  // Time-series / continuous
  | "Line"
  | "Area"
  | "StackedArea"
  // Multi-series categorical
  | "StackedBar"
  | "StackedColumn"
  | "ClusteredBar"
  | "ClusteredColumn"
  | "GroupedBar"
  | "Combo"
  // Statistical
  | "Scatter"
  | "Bubble"
  | "BoxPlot"
  | "Histogram"
  | "Waterfall"
  // 2-D / grid
  | "Heatmap"
  | "Calendar"
  // Flow / relational
  | "Sankey"
  | "FlowChart"
  | "NetworkDiagram"
  | "ClusterDiagram"
  // Time / event
  | "Timeline"
  | "Gantt"
  // Geo
  | "GeoMap"
  | "BubbleMap"
  // Text
  | "WordCloud"
  // Composite (rendered by the adapter but data is table-like, not series)
  | "KPI"
  | "KPICards"
  | "SummaryTable"
  | "ConditionalTable"
  | "SentimentLine";

// Row shapes the resolver returns and the adapter consumes.
// Kept intentionally narrow — one type per family so we can validate.

export interface KeyValueRow {
  key: string;
  value: number;
}

export interface MultiSeriesRow {
  key: string; // category / x-axis label
  values: Record<string, number>; // series name → value
}

export interface XYPoint {
  x: number;
  y: number;
  label?: string;
  size?: number; // for bubble
  category?: string; // for coloring
}

export interface HeatmapPoint {
  x: string;
  y: string;
  value: number;
}

export interface CalendarPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface SankeyNode {
  name: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface GraphNode {
  id: string;
  name: string;
  category?: string;
  value?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  value?: number;
  label?: string;
}

export interface TreeNode {
  name: string;
  value?: number;
  children?: TreeNode[];
}

export interface BoxPlotBox {
  name: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers?: number[];
}

export interface GanttTask {
  name: string;
  group?: string;
  start: string; // ISO
  end: string; // ISO
  progress?: number; // 0..100
}

export interface WordCloudEntry {
  text: string;
  weight: number;
}

export interface GeoFeature {
  name: string; // region name matching the registered map
  value: number;
}

export interface BubbleMapPoint {
  lng: number;
  lat: number;
  value: number;
  name?: string;
}

export interface KpiValue {
  label: string;
  value: number;
  format?: "number" | "currency" | "percent";
  delta?: number;
  deltaPercent?: number;
  trend?: number[]; // sparkline
}

export interface TableRow {
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, unknown>[];
  conditional?: Record<
    string,
    { thresholds: { value: number; color: string }[] }
  >;
}

// Discriminated union of every payload shape. The dashboard-resolver's card
// output must match one of these — validated at the adapter boundary.
export type ChartPayload =
  | { kind: "KeyValue"; rows: KeyValueRow[] }
  | { kind: "MultiSeries"; series: string[]; rows: MultiSeriesRow[] }
  | { kind: "XY"; points: XYPoint[] }
  | { kind: "Heatmap"; xLabels: string[]; yLabels: string[]; points: HeatmapPoint[] }
  | { kind: "Calendar"; year: number; points: CalendarPoint[] }
  | { kind: "Sankey"; nodes: SankeyNode[]; links: SankeyLink[] }
  | { kind: "Graph"; nodes: GraphNode[]; edges: GraphEdge[] }
  | { kind: "Tree"; root: TreeNode }
  | { kind: "BoxPlot"; boxes: BoxPlotBox[] }
  | { kind: "Gantt"; tasks: GanttTask[] }
  | { kind: "WordCloud"; words: WordCloudEntry[] }
  | { kind: "Geo"; mapName: string; features: GeoFeature[] }
  | { kind: "BubbleMap"; mapName: string; points: BubbleMapPoint[] }
  | { kind: "Gauge"; value: number; min?: number; max?: number; label?: string }
  | { kind: "KpiCards"; cards: KpiValue[] }
  | { kind: "Table"; data: TableRow };

// Per-chart-kind expectation. Used by the adapter to pick the right builder
// and by the resolver to shape the query output.
export const PAYLOAD_KIND_FOR: Record<ChartKind, ChartPayload["kind"] | ChartPayload["kind"][]> = {
  Bar: "KeyValue",
  HorizontalBar: "KeyValue",
  Column: "KeyValue",
  Pie: "KeyValue",
  Donut: "KeyValue",
  Funnel: "KeyValue",
  Radar: "MultiSeries",
  Gauge: "Gauge",
  TreeMap: "Tree",
  Sunburst: "Tree",
  Line: "KeyValue",
  Area: "KeyValue",
  StackedArea: "MultiSeries",
  StackedBar: "MultiSeries",
  StackedColumn: "MultiSeries",
  ClusteredBar: "MultiSeries",
  ClusteredColumn: "MultiSeries",
  GroupedBar: "MultiSeries",
  Combo: "MultiSeries",
  Scatter: "XY",
  Bubble: "XY",
  BoxPlot: "BoxPlot",
  Histogram: "KeyValue",
  Waterfall: "KeyValue",
  Heatmap: "Heatmap",
  Calendar: "Calendar",
  Sankey: "Sankey",
  FlowChart: "Sankey",
  NetworkDiagram: "Graph",
  ClusterDiagram: "Graph",
  Timeline: "Gantt",
  Gantt: "Gantt",
  GeoMap: "Geo",
  BubbleMap: "BubbleMap",
  WordCloud: "WordCloud",
  KPI: "KpiCards",
  KPICards: "KpiCards",
  SummaryTable: "Table",
  ConditionalTable: "Table",
  SentimentLine: "KeyValue",
};
