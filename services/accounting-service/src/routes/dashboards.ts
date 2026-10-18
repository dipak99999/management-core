import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  resolveKpi,
  resolveChart,
  resolveMultiSeries,
  resolveXY,
  resolveHeatmap,
  resolveCalendar,
  resolveTree,
  resolveSankey,
  resolveBoxPlot,
  resolveHistogram,
  resolveGantt,
  resolveWordCloud,
  resolveKpiCards,
  runReport,
  type CardConfig,
  type KpiCardConfig,
  type ChartCardConfig,
  type SavedReportCardConfig,
  type TextCardConfig,
  type ReportDefinition,
  type MultiSeriesConfig,
  type XYConfig,
  type HeatmapConfig,
  type CalendarConfig,
  type TreeConfig,
  type SankeyConfig,
  type BoxPlotConfig,
  type HistogramConfig,
  type GanttConfig,
  type WordCloudConfig,
  type KpiCardsConfig,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// G1-G4: Dashboards + Cards. A dashboard is a collection of cards (KPI /
// chart / table / text / saved-report). The /data endpoint resolves every
// card's config and returns the payload the UI needs to render.

export const dashboardRouter = Router();

const pD = perms("Dashboard");
const pC = perms("DashboardCard");
const pB = perms("Dashboard"); // bookmarks re-use Dashboard perms

// Legacy kinds kept for the existing seeded dashboards; new kinds come from
// the shared @lumaara/charts ChartKind union. Both dispatch below.
const cardKinds = [
  // Legacy
  "KPI",
  "LineChart",
  "BarChart",
  "PieChart",
  "Table",
  "SavedReport",
  "Text",
  // Extended chart kinds
  "Bar",
  "HorizontalBar",
  "Column",
  "Pie",
  "Donut",
  "Funnel",
  "Radar",
  "Gauge",
  "TreeMap",
  "Sunburst",
  "Line",
  "Area",
  "StackedArea",
  "StackedBar",
  "StackedColumn",
  "ClusteredBar",
  "ClusteredColumn",
  "GroupedBar",
  "Combo",
  "Scatter",
  "Bubble",
  "BoxPlot",
  "Histogram",
  "Waterfall",
  "Heatmap",
  "Calendar",
  "Sankey",
  "FlowChart",
  "NetworkDiagram",
  "ClusterDiagram",
  "Timeline",
  "Gantt",
  "GeoMap",
  "BubbleMap",
  "WordCloud",
  "KPICards",
  "SummaryTable",
  "ConditionalTable",
  "SentimentLine",
] as const;

// Kinds routed to the advanced resolver, keyed by payload shape.
const MULTI_SERIES_KINDS = new Set([
  "StackedArea",
  "StackedBar",
  "StackedColumn",
  "ClusteredBar",
  "ClusteredColumn",
  "GroupedBar",
  "Combo",
  "Radar",
]);
const KEY_VALUE_KINDS = new Set([
  "Bar",
  "HorizontalBar",
  "Column",
  "Pie",
  "Donut",
  "Funnel",
  "Line",
  "Area",
  "SentimentLine",
  "Waterfall",
]);
const XY_KINDS = new Set(["Scatter", "Bubble"]);
const SANKEY_KINDS = new Set(["Sankey", "FlowChart"]);
const GRAPH_KINDS = new Set(["NetworkDiagram", "ClusterDiagram"]);
const TREE_KINDS = new Set(["TreeMap", "Sunburst"]);
const GANTT_KINDS = new Set(["Gantt", "Timeline"]);

const cardSchema = z.object({
  kind: z.enum(cardKinds),
  title: z.string().min(1),
  subtitle: z.string().optional().nullable(),
  config: z.record(z.unknown()),
  gridCol: z.coerce.number().int().min(0).default(0),
  gridRow: z.coerce.number().int().min(0).default(0),
  gridWidth: z.coerce.number().int().min(1).max(12).default(4),
  gridHeight: z.coerce.number().int().min(1).max(12).default(2),
  sortOrder: z.coerce.number().int().default(0),
});

const dashboardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  isShared: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
});

// ---- Dashboard CRUD ----

dashboardRouter.get("/", pD.read, async (req, res) => {
  const auth = req.auth!;
  const rows = await prisma.dashboard.findMany({
    where: {
      tenantId: auth.tenantId,
      OR: [{ ownerUserId: auth.userId }, { isShared: true }],
    },
    include: { _count: { select: { cards: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

dashboardRouter.get("/:id", pD.read, async (req, res) => {
  const auth = req.auth!;
  const row = await prisma.dashboard.findFirst({
    where: {
      id: req.params.id,
      tenantId: auth.tenantId,
      OR: [{ ownerUserId: auth.userId }, { isShared: true }],
    },
    include: { cards: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

dashboardRouter.post("/", pD.create, async (req, res) => {
  const parsed = dashboardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.dashboard.create({
      data: {
        tenantId: req.auth!.tenantId,
        ownerUserId: req.auth!.userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        isShared: parsed.data.isShared,
        sortOrder: parsed.data.sortOrder,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Dashboard name already exists" });
    throw e;
  }
});

dashboardRouter.put("/:id", pD.write, async (req, res) => {
  const parsed = dashboardSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const existing = await prisma.dashboard.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.ownerUserId !== auth.userId)
    return res.status(403).json({ error: "Only the owner can modify this dashboard" });
  const row = await prisma.dashboard.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

dashboardRouter.delete("/:id", pD.delete, async (req, res) => {
  const auth = req.auth!;
  const existing = await prisma.dashboard.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.ownerUserId !== auth.userId)
    return res.status(403).json({ error: "Only the owner can delete this dashboard" });
  await prisma.dashboard.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---- Cards ----

async function assertOwnerOrForbid(
  dashboardId: string,
  tenantId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const d = await prisma.dashboard.findFirst({
    where: { id: dashboardId, tenantId },
  });
  if (!d) return { ok: false, status: 404, error: "Not found" };
  if (d.ownerUserId !== userId)
    return { ok: false, status: 403, error: "Only the owner can modify cards" };
  return { ok: true };
}

dashboardRouter.post("/:id/cards", pC.create, async (req, res) => {
  const parsed = cardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const guard = await assertOwnerOrForbid(req.params.id, req.auth!.tenantId, req.auth!.userId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  const row = await prisma.dashboardCard.create({
    data: {
      dashboardId: req.params.id,
      ...parsed.data,
      config: parsed.data.config as Prisma.InputJsonValue,
    },
  });
  res.status(201).json(row);
});

dashboardRouter.put("/:id/cards/:cardId", pC.write, async (req, res) => {
  const parsed = cardSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const guard = await assertOwnerOrForbid(req.params.id, req.auth!.tenantId, req.auth!.userId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  const row = await prisma.dashboardCard.update({
    where: { id: req.params.cardId },
    data: {
      ...parsed.data,
      config: parsed.data.config as Prisma.InputJsonValue | undefined,
    },
  });
  res.json(row);
});

dashboardRouter.delete("/:id/cards/:cardId", pC.delete, async (req, res) => {
  const guard = await assertOwnerOrForbid(req.params.id, req.auth!.tenantId, req.auth!.userId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  await prisma.dashboardCard.delete({ where: { id: req.params.cardId } });
  res.status(204).send();
});

// ---- Resolve card data ----

dashboardRouter.get("/:id/data", pD.read, async (req, res) => {
  const auth = req.auth!;
  const d = await prisma.dashboard.findFirst({
    where: {
      id: req.params.id,
      tenantId: auth.tenantId,
      OR: [{ ownerUserId: auth.userId }, { isShared: true }],
    },
    include: { cards: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (!d) return res.status(404).json({ error: "Not found" });

  const results = await Promise.all(
    d.cards.map(async (c) => {
      try {
        const cfg = c.config as unknown as CardConfig;
        if (c.kind === "KPI") {
          const data = await resolveKpi(prisma, auth.tenantId, cfg as KpiCardConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "LineChart" || c.kind === "BarChart" || c.kind === "PieChart") {
          const data = await resolveChart(prisma, auth.tenantId, cfg as ChartCardConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "SavedReport") {
          const src = cfg as SavedReportCardConfig;
          const saved = await prisma.savedReport.findFirst({
            where: { id: src.savedReportId, tenantId: auth.tenantId },
          });
          if (!saved) return { id: c.id, kind: c.kind, data: null, error: "SavedReport missing" };
          const data = await runReport(
            prisma,
            auth.tenantId,
            saved.doctype,
            saved.definition as unknown as ReportDefinition,
          );
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "Text") {
          return { id: c.id, kind: c.kind, data: cfg as TextCardConfig };
        }

        // Extended chart kinds → advanced resolvers → ChartPayload
        if (KEY_VALUE_KINDS.has(c.kind)) {
          if (c.kind === "Waterfall") {
            const data = await resolveChart(prisma, auth.tenantId, cfg as ChartCardConfig);
            return { id: c.id, kind: c.kind, data: { kind: "KeyValue", rows: data } };
          }
          if (c.kind === "Histogram") {
            const data = await resolveHistogram(prisma, auth.tenantId, cfg as HistogramConfig);
            return { id: c.id, kind: c.kind, data };
          }
          const data = await resolveChart(prisma, auth.tenantId, cfg as ChartCardConfig);
          return { id: c.id, kind: c.kind, data: { kind: "KeyValue", rows: data } };
        }
        if (MULTI_SERIES_KINDS.has(c.kind)) {
          const data = await resolveMultiSeries(prisma, auth.tenantId, cfg as unknown as MultiSeriesConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (XY_KINDS.has(c.kind)) {
          const data = await resolveXY(prisma, auth.tenantId, cfg as unknown as XYConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "Heatmap") {
          const data = await resolveHeatmap(prisma, auth.tenantId, cfg as unknown as HeatmapConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "Calendar") {
          const data = await resolveCalendar(prisma, auth.tenantId, cfg as unknown as CalendarConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (SANKEY_KINDS.has(c.kind)) {
          const data = await resolveSankey(prisma, auth.tenantId, cfg as unknown as SankeyConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (TREE_KINDS.has(c.kind)) {
          const data = await resolveTree(prisma, auth.tenantId, cfg as unknown as TreeConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "BoxPlot") {
          const data = await resolveBoxPlot(prisma, auth.tenantId, cfg as unknown as BoxPlotConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (GANTT_KINDS.has(c.kind)) {
          const data = await resolveGantt(prisma, auth.tenantId, cfg as unknown as GanttConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "WordCloud") {
          const data = await resolveWordCloud(prisma, auth.tenantId, cfg as unknown as WordCloudConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "KPICards") {
          const data = await resolveKpiCards(prisma, auth.tenantId, cfg as unknown as KpiCardsConfig);
          return { id: c.id, kind: c.kind, data };
        }
        if (c.kind === "SummaryTable" || c.kind === "ConditionalTable") {
          const src = cfg as SavedReportCardConfig;
          const saved = await prisma.savedReport.findFirst({
            where: { id: src.savedReportId, tenantId: auth.tenantId },
          });
          if (!saved) return { id: c.id, kind: c.kind, data: null, error: "SavedReport missing" };
          const res = await runReport(
            prisma,
            auth.tenantId,
            saved.doctype,
            saved.definition as unknown as ReportDefinition,
          );
          return { id: c.id, kind: c.kind, data: { kind: "Table", data: { columns: res.columns, rows: res.rows } } };
        }
        // Kinds still on the roadmap (Gauge / Graph / GeoMap / BubbleMap)
        // fall through — the client will render an error card.
        return { id: c.id, kind: c.kind, data: null, error: `Chart kind "${c.kind}" is not yet routed` };
      } catch (e) {
        return {
          id: c.id,
          kind: c.kind,
          data: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
  res.json({ dashboard: { id: d.id, name: d.name, description: d.description }, cards: results });
});

// ---- Bookmarks ----

dashboardRouter.post("/:id/bookmark", pB.write, async (req, res) => {
  const auth = req.auth!;
  const d = await prisma.dashboard.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!d) return res.status(404).json({ error: "Not found" });
  try {
    const row = await prisma.dashboardBookmark.create({
      data: { tenantId: auth.tenantId, userId: auth.userId, dashboardId: d.id },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(200).json({ ok: true, already: true });
    }
    throw e;
  }
});

dashboardRouter.delete("/:id/bookmark", pB.write, async (req, res) => {
  const auth = req.auth!;
  await prisma.dashboardBookmark.deleteMany({
    where: { tenantId: auth.tenantId, userId: auth.userId, dashboardId: req.params.id },
  });
  res.status(204).send();
});
