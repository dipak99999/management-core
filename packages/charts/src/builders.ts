// One builder per ChartKind. Each takes the (already-shaped) ChartPayload and
// returns an ECharts option. Kept in one file on purpose — the dispatcher
// below is easier to review than N files behind an index.
//
// Adding a new chart type: add to `types.ts`, then add its case to `build()`.

import { ChartKind, ChartPayload, PAYLOAD_KIND_FOR } from "./types";
import { PALETTE, GRID, TOOLTIP, AXIS_LABEL, AXIS_LINE } from "./palette";

type EChartsOption = Record<string, unknown>;

function assertPayload(kind: ChartKind, payload: ChartPayload) {
  const expected = PAYLOAD_KIND_FOR[kind];
  const ok = Array.isArray(expected)
    ? expected.includes(payload.kind)
    : expected === payload.kind;
  if (!ok) {
    throw new Error(
      `Chart "${kind}" expects payload.kind=${JSON.stringify(expected)}, got "${payload.kind}"`,
    );
  }
}

// —— Bar / Column / HorizontalBar / Line / Area ————————————————————————

function buildBarLike(
  kind: ChartKind,
  payload: Extract<ChartPayload, { kind: "KeyValue" }>,
): EChartsOption {
  const horizontal = kind === "HorizontalBar" || kind === "Bar";
  const isArea = kind === "Area";
  const isLine = kind === "Line" || kind === "SentimentLine";
  const type = isLine || isArea ? "line" : "bar";

  const values = payload.rows.map((r) => r.value);
  const labels = payload.rows.map((r) => r.key);
  return {
    color: PALETTE,
    grid: GRID,
    tooltip: { ...TOOLTIP, trigger: "axis" },
    xAxis: horizontal
      ? { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE }
      : { type: "category", data: labels, axisLabel: AXIS_LABEL, axisLine: AXIS_LINE },
    yAxis: horizontal
      ? { type: "category", data: labels, axisLabel: AXIS_LABEL, axisLine: AXIS_LINE }
      : { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE },
    series: [
      {
        type,
        data: values,
        smooth: isLine,
        areaStyle: isArea ? { opacity: 0.3 } : undefined,
        itemStyle: { borderRadius: type === "bar" ? [4, 4, 0, 0] : 0 },
        showBackground: false,
      },
    ],
  };
}

// —— Pie / Donut / Funnel ————————————————————————————————————————

function buildPieLike(
  kind: ChartKind,
  payload: Extract<ChartPayload, { kind: "KeyValue" }>,
): EChartsOption {
  const data = payload.rows.map((r) => ({ name: r.key, value: r.value }));
  if (kind === "Funnel") {
    return {
      color: PALETTE,
      tooltip: { trigger: "item" },
      series: [
        {
          type: "funnel",
          left: "10%",
          top: 20,
          bottom: 20,
          width: "80%",
          min: 0,
          max: Math.max(...payload.rows.map((r) => r.value), 1),
          gap: 2,
          data,
          label: { position: "inside", color: "#fff" },
          itemStyle: { borderColor: "#fff", borderWidth: 1 },
        },
      ],
    };
  }
  const isDonut = kind === "Donut";
  return {
    color: PALETTE,
    tooltip: { trigger: "item" },
    legend: { bottom: 0, textStyle: { color: "#4b5563", fontSize: 11 } },
    series: [
      {
        type: "pie",
        radius: isDonut ? ["45%", "70%"] : "70%",
        center: ["50%", "45%"],
        data,
        label: { fontSize: 11 },
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
      },
    ],
  };
}

// —— Radar ————————————————————————————————————————————————————————

function buildRadar(payload: Extract<ChartPayload, { kind: "MultiSeries" }>): EChartsOption {
  const indicators = payload.rows.map((r) => {
    const maxAcross = Math.max(
      ...payload.series.map((s) => r.values[s] ?? 0),
      1,
    );
    return { name: r.key, max: maxAcross * 1.2 };
  });
  const series = payload.series.map((s) => ({
    name: s,
    value: payload.rows.map((r) => r.values[s] ?? 0),
  }));
  return {
    color: PALETTE,
    tooltip: { trigger: "item" },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    radar: { indicator: indicators, splitNumber: 4 },
    series: [{ type: "radar", data: series, areaStyle: { opacity: 0.15 } }],
  };
}

// —— Gauge ————————————————————————————————————————————————————————

function buildGauge(payload: Extract<ChartPayload, { kind: "Gauge" }>): EChartsOption {
  return {
    color: PALETTE,
    series: [
      {
        type: "gauge",
        min: payload.min ?? 0,
        max: payload.max ?? 100,
        splitNumber: 5,
        progress: { show: true, width: 18 },
        axisLine: { lineStyle: { width: 18 } },
        pointer: { show: true },
        detail: { formatter: "{value}", fontSize: 22, color: "#111827" },
        title: { fontSize: 12, color: "#6b7280" },
        data: [{ value: payload.value, name: payload.label ?? "" }],
      },
    ],
  };
}

// —— TreeMap / Sunburst ———————————————————————————————————————————

function buildTree(
  kind: ChartKind,
  payload: Extract<ChartPayload, { kind: "Tree" }>,
): EChartsOption {
  if (kind === "Sunburst") {
    return {
      color: PALETTE,
      tooltip: { trigger: "item" },
      series: [
        {
          type: "sunburst",
          data: payload.root.children ?? [payload.root],
          radius: [0, "90%"],
          label: { fontSize: 10, color: "#111827" },
        },
      ],
    };
  }
  return {
    color: PALETTE,
    tooltip: { trigger: "item" },
    series: [
      {
        type: "treemap",
        data: payload.root.children ?? [payload.root],
        roam: false,
        label: { fontSize: 11 },
        upperLabel: { show: true, height: 20 },
      },
    ],
  };
}

// —— Multi-series bar / column / area ————————————————————————————————

function buildMultiSeries(
  kind: ChartKind,
  payload: Extract<ChartPayload, { kind: "MultiSeries" }>,
): EChartsOption {
  const horizontal = kind === "StackedBar" || kind === "ClusteredBar" || kind === "GroupedBar";
  const stacked = kind === "StackedBar" || kind === "StackedColumn" || kind === "StackedArea";
  const isArea = kind === "StackedArea";
  const isCombo = kind === "Combo";

  const categories = payload.rows.map((r) => r.key);
  const series = payload.series.map((s, i) => ({
    name: s,
    // Combo alternates bar/line to visually differentiate series
    type: isCombo ? (i === 0 ? "bar" : "line") : isArea ? "line" : "bar",
    stack: stacked ? "total" : undefined,
    areaStyle: isArea ? { opacity: 0.3 } : undefined,
    smooth: isArea || (isCombo && i > 0),
    data: payload.rows.map((r) => r.values[s] ?? 0),
    itemStyle: { borderRadius: (isCombo && i === 0) || (!isArea && !isCombo) ? [4, 4, 0, 0] : 0 },
  }));

  return {
    color: PALETTE,
    grid: GRID,
    tooltip: { ...TOOLTIP, trigger: "axis" },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    xAxis: horizontal
      ? { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE }
      : { type: "category", data: categories, axisLabel: AXIS_LABEL, axisLine: AXIS_LINE },
    yAxis: horizontal
      ? { type: "category", data: categories, axisLabel: AXIS_LABEL, axisLine: AXIS_LINE }
      : { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE },
    series,
  };
}

// —— Scatter / Bubble ————————————————————————————————————————————

function buildScatter(
  kind: ChartKind,
  payload: Extract<ChartPayload, { kind: "XY" }>,
): EChartsOption {
  const isBubble = kind === "Bubble";
  return {
    color: PALETTE,
    grid: GRID,
    tooltip: {
      trigger: "item",
      formatter: (p: { data: [number, number, number?, string?] }) => {
        const [x, y, size, label] = p.data;
        return `${label ?? ""}<br/>x: ${x}, y: ${y}${size ? `, size: ${size}` : ""}`;
      },
    },
    xAxis: { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE, scale: true },
    yAxis: { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE, scale: true },
    series: [
      {
        type: "scatter",
        data: payload.points.map((p) => [p.x, p.y, p.size ?? 0, p.label ?? ""]),
        symbolSize: isBubble
          ? (v: number[]) => {
              const s = v[2] ?? 10;
              return Math.max(6, Math.min(60, Math.sqrt(s) * 3));
            }
          : 8,
      },
    ],
  };
}

// —— BoxPlot ——————————————————————————————————————————————————————

function buildBoxPlot(payload: Extract<ChartPayload, { kind: "BoxPlot" }>): EChartsOption {
  return {
    color: PALETTE,
    grid: GRID,
    tooltip: { trigger: "item" },
    xAxis: {
      type: "category",
      data: payload.boxes.map((b) => b.name),
      axisLabel: AXIS_LABEL,
      axisLine: AXIS_LINE,
    },
    yAxis: { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE },
    series: [
      {
        type: "boxplot",
        data: payload.boxes.map((b) => [b.min, b.q1, b.median, b.q3, b.max]),
      },
      {
        type: "scatter",
        data: payload.boxes.flatMap((b, i) => (b.outliers ?? []).map((o) => [i, o])),
        symbolSize: 6,
      },
    ],
  };
}

// —— Waterfall ————————————————————————————————————————————————————

function buildWaterfall(payload: Extract<ChartPayload, { kind: "KeyValue" }>): EChartsOption {
  // ECharts pattern: a transparent "placeholder" bar plus positive/negative
  // stacked on top so the visible bar starts at the running total.
  const labels = payload.rows.map((r) => r.key);
  const running: number[] = [];
  const positives: (number | "-")[] = [];
  const negatives: (number | "-")[] = [];
  const placeholder: number[] = [];
  let acc = 0;
  for (const r of payload.rows) {
    const v = r.value;
    if (v >= 0) {
      placeholder.push(acc);
      positives.push(v);
      negatives.push("-");
      acc += v;
    } else {
      acc += v;
      placeholder.push(acc);
      positives.push("-");
      negatives.push(-v);
    }
    running.push(acc);
  }
  return {
    color: ["transparent", PALETTE[1], PALETTE[3]],
    grid: GRID,
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: AXIS_LABEL,
      axisLine: AXIS_LINE,
    },
    yAxis: { type: "value", axisLabel: AXIS_LABEL, axisLine: AXIS_LINE },
    series: [
      { name: "_", type: "bar", stack: "wf", data: placeholder, itemStyle: { color: "transparent" } },
      { name: "+", type: "bar", stack: "wf", data: positives },
      { name: "−", type: "bar", stack: "wf", data: negatives },
    ],
  };
}

// —— Histogram ————————————————————————————————————————————————————

function buildHistogram(payload: Extract<ChartPayload, { kind: "KeyValue" }>): EChartsOption {
  // Assume the resolver already binned the data; we render as a gap-less bar.
  const opt = buildBarLike("Column", payload);
  const series = opt.series as Array<Record<string, unknown>>;
  series[0] = { ...series[0], barCategoryGap: "0%", itemStyle: { borderRadius: 0, borderColor: "#fff", borderWidth: 1 } };
  return opt;
}

// —— Heatmap ——————————————————————————————————————————————————————

function buildHeatmap(payload: Extract<ChartPayload, { kind: "Heatmap" }>): EChartsOption {
  const values = payload.points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  return {
    grid: { ...GRID, top: 40, bottom: 60 },
    tooltip: { position: "top" },
    xAxis: { type: "category", data: payload.xLabels, axisLabel: AXIS_LABEL, axisLine: AXIS_LINE, splitArea: { show: true } },
    yAxis: { type: "category", data: payload.yLabels, axisLabel: AXIS_LABEL, axisLine: AXIS_LINE, splitArea: { show: true } },
    visualMap: {
      min,
      max,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: ["#e0e7ff", "#4f46e5", "#312e81"] },
      textStyle: { fontSize: 11, color: "#4b5563" },
    },
    series: [
      {
        type: "heatmap",
        data: payload.points.map((p) => [
          payload.xLabels.indexOf(p.x),
          payload.yLabels.indexOf(p.y),
          p.value,
        ]),
        label: { show: false },
      },
    ],
  };
}

// —— Calendar heatmap ————————————————————————————————————————————

function buildCalendar(payload: Extract<ChartPayload, { kind: "Calendar" }>): EChartsOption {
  const values = payload.points.map((p) => p.value);
  return {
    tooltip: { position: "top" },
    visualMap: {
      min: Math.min(...values, 0),
      max: Math.max(...values, 1),
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: ["#e0e7ff", "#4f46e5", "#312e81"] },
    },
    calendar: {
      range: String(payload.year),
      cellSize: ["auto", 14],
      itemStyle: { borderColor: "#fff" },
      dayLabel: { fontSize: 10, color: "#6b7280" },
      monthLabel: { fontSize: 10, color: "#4b5563" },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: payload.points.map((p) => [p.date, p.value]),
      },
    ],
  };
}

// —— Sankey / FlowChart ——————————————————————————————————————————

function buildSankey(payload: Extract<ChartPayload, { kind: "Sankey" }>): EChartsOption {
  return {
    color: PALETTE,
    tooltip: { trigger: "item" },
    series: [
      {
        type: "sankey",
        left: 10,
        right: 80,
        data: payload.nodes,
        links: payload.links,
        emphasis: { focus: "adjacency" },
        lineStyle: { color: "gradient", curveness: 0.5 },
        label: { fontSize: 11 },
      },
    ],
  };
}

// —— NetworkDiagram / ClusterDiagram ——————————————————————————————

function buildGraph(
  kind: ChartKind,
  payload: Extract<ChartPayload, { kind: "Graph" }>,
): EChartsOption {
  const categories = Array.from(
    new Set(payload.nodes.map((n) => n.category ?? "default")),
  ).map((name) => ({ name }));
  return {
    color: PALETTE,
    tooltip: { trigger: "item" },
    legend: kind === "ClusterDiagram" ? { data: categories.map((c) => c.name), bottom: 0 } : undefined,
    series: [
      {
        type: "graph",
        layout: kind === "ClusterDiagram" ? "circular" : "force",
        force: { repulsion: 120, edgeLength: 80 },
        data: payload.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          value: n.value ?? 1,
          category: categories.findIndex((c) => c.name === (n.category ?? "default")),
          symbolSize: Math.max(10, Math.min(40, Math.sqrt(n.value ?? 10) * 3)),
        })),
        links: payload.edges.map((e) => ({
          source: e.source,
          target: e.target,
          value: e.value,
        })),
        categories,
        roam: true,
        label: { show: true, fontSize: 10 },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 6,
      },
    ],
  };
}

// —— Gantt / Timeline ————————————————————————————————————————————

function buildGantt(payload: Extract<ChartPayload, { kind: "Gantt" }>): EChartsOption {
  const groups = Array.from(new Set(payload.tasks.map((t) => t.group ?? t.name)));
  const data = payload.tasks.map((t) => {
    const yIndex = groups.indexOf(t.group ?? t.name);
    return {
      name: t.name,
      value: [yIndex, new Date(t.start).getTime(), new Date(t.end).getTime(), t.progress ?? 0],
      itemStyle: { color: PALETTE[yIndex % PALETTE.length] },
    };
  });
  return {
    tooltip: {
      formatter: (p: { name: string; value: [number, number, number, number] }) => {
        return `${p.name}<br/>${new Date(p.value[1]).toLocaleDateString()} → ${new Date(p.value[2]).toLocaleDateString()}${p.value[3] ? ` · ${p.value[3]}%` : ""}`;
      },
    },
    grid: { ...GRID, left: 120 },
    xAxis: {
      type: "time",
      axisLabel: { ...AXIS_LABEL, fontSize: 10 },
      axisLine: AXIS_LINE,
    },
    yAxis: {
      type: "category",
      data: groups,
      axisLabel: AXIS_LABEL,
      axisLine: AXIS_LINE,
    },
    series: [
      {
        type: "custom",
        renderItem: (_params: unknown, api: {
          value: (i: number) => number;
          coord: (v: [number, number]) => [number, number];
          size: (v: [number, number]) => [number, number];
          style: () => Record<string, unknown>;
        }) => {
          const y = api.value(0);
          const start = api.coord([api.value(1), y]);
          const end = api.coord([api.value(2), y]);
          const height = (api.size([0, 1]) as [number, number])[1] * 0.6;
          return {
            type: "rect",
            shape: { x: start[0], y: start[1] - height / 2, width: end[0] - start[0], height },
            style: api.style(),
          };
        },
        encode: { x: [1, 2], y: 0 },
        data,
      },
    ],
  };
}

// —— GeoMap / BubbleMap ——————————————————————————————————————————

function buildGeoMap(payload: Extract<ChartPayload, { kind: "Geo" }>): EChartsOption {
  return {
    color: PALETTE,
    tooltip: { trigger: "item" },
    visualMap: {
      min: Math.min(...payload.features.map((f) => f.value), 0),
      max: Math.max(...payload.features.map((f) => f.value), 1),
      left: 12,
      bottom: 12,
      orient: "vertical",
      inRange: { color: ["#e0e7ff", "#4f46e5", "#312e81"] },
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        type: "map",
        map: payload.mapName,
        roam: true,
        label: { show: false },
        data: payload.features,
      },
    ],
  };
}

function buildBubbleMap(payload: Extract<ChartPayload, { kind: "BubbleMap" }>): EChartsOption {
  return {
    color: PALETTE,
    tooltip: { trigger: "item" },
    geo: { map: payload.mapName, roam: true, itemStyle: { areaColor: "#e5e7eb", borderColor: "#fff" } },
    series: [
      {
        type: "effectScatter",
        coordinateSystem: "geo",
        data: payload.points.map((p) => ({
          name: p.name,
          value: [p.lng, p.lat, p.value],
        })),
        symbolSize: (v: number[]) => Math.max(6, Math.min(40, Math.sqrt(v[2]) * 2)),
        rippleEffect: { brushType: "stroke" },
      },
    ],
  };
}

// —— Word cloud ——————————————————————————————————————————————————

function buildWordCloud(payload: Extract<ChartPayload, { kind: "WordCloud" }>): EChartsOption {
  return {
    tooltip: { show: true },
    series: [
      {
        type: "wordCloud",
        shape: "circle",
        gridSize: 8,
        sizeRange: [12, 42],
        rotationRange: [-30, 30],
        drawOutOfBound: false,
        textStyle: {
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          color: () => PALETTE[Math.floor(Math.random() * PALETTE.length)],
        },
        data: payload.words.map((w) => ({ name: w.text, value: w.weight })),
      },
    ],
  };
}

// —— Dispatcher ——————————————————————————————————————————————————

export function buildOption(kind: ChartKind, payload: ChartPayload): EChartsOption {
  assertPayload(kind, payload);
  switch (kind) {
    case "Bar":
    case "HorizontalBar":
    case "Column":
    case "Line":
    case "SentimentLine":
    case "Area":
      return buildBarLike(kind, payload as Extract<ChartPayload, { kind: "KeyValue" }>);

    case "Pie":
    case "Donut":
    case "Funnel":
      return buildPieLike(kind, payload as Extract<ChartPayload, { kind: "KeyValue" }>);

    case "Radar":
      return buildRadar(payload as Extract<ChartPayload, { kind: "MultiSeries" }>);

    case "Gauge":
      return buildGauge(payload as Extract<ChartPayload, { kind: "Gauge" }>);

    case "TreeMap":
    case "Sunburst":
      return buildTree(kind, payload as Extract<ChartPayload, { kind: "Tree" }>);

    case "StackedArea":
    case "StackedBar":
    case "StackedColumn":
    case "ClusteredBar":
    case "ClusteredColumn":
    case "GroupedBar":
    case "Combo":
      return buildMultiSeries(kind, payload as Extract<ChartPayload, { kind: "MultiSeries" }>);

    case "Scatter":
    case "Bubble":
      return buildScatter(kind, payload as Extract<ChartPayload, { kind: "XY" }>);

    case "BoxPlot":
      return buildBoxPlot(payload as Extract<ChartPayload, { kind: "BoxPlot" }>);

    case "Histogram":
      return buildHistogram(payload as Extract<ChartPayload, { kind: "KeyValue" }>);

    case "Waterfall":
      return buildWaterfall(payload as Extract<ChartPayload, { kind: "KeyValue" }>);

    case "Heatmap":
      return buildHeatmap(payload as Extract<ChartPayload, { kind: "Heatmap" }>);

    case "Calendar":
      return buildCalendar(payload as Extract<ChartPayload, { kind: "Calendar" }>);

    case "Sankey":
    case "FlowChart":
      return buildSankey(payload as Extract<ChartPayload, { kind: "Sankey" }>);

    case "NetworkDiagram":
    case "ClusterDiagram":
      return buildGraph(kind, payload as Extract<ChartPayload, { kind: "Graph" }>);

    case "Timeline":
    case "Gantt":
      return buildGantt(payload as Extract<ChartPayload, { kind: "Gantt" }>);

    case "GeoMap":
      return buildGeoMap(payload as Extract<ChartPayload, { kind: "Geo" }>);

    case "BubbleMap":
      return buildBubbleMap(payload as Extract<ChartPayload, { kind: "BubbleMap" }>);

    case "WordCloud":
      return buildWordCloud(payload as Extract<ChartPayload, { kind: "WordCloud" }>);

    // KPI / Table families are rendered by the adapter directly, not ECharts
    case "KPI":
    case "KPICards":
    case "SummaryTable":
    case "ConditionalTable":
      throw new Error(`${kind} is rendered by the adapter directly, not via ECharts`);
  }
}
