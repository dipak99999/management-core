import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import {
  prisma,
  runReport,
  resolveKpi,
  resolveChart,
  type ReportDefinition,
  type CardConfig,
  type KpiCardConfig,
  type ChartCardConfig,
  type SavedReportCardConfig,
  type TextCardConfig,
} from "@lumaara/db";
import { BCRYPT_COST, perms } from "@lumaara/service-auth";

// Zoho-Analytics-Plus additions on top of the existing Dashboards + Saved
// Reports system:
//   1. Forecasting  — linear regression + moving average over any time-series
//   2. Anomalies    — z-score outliers over any series
//   3. Share links  — public, token-signed dashboard views (optionally with
//                     password + expiry). No JWT required to view.
// The public router below has no requireAuth and is mounted separately.

export const analyticsRouter = Router();
export const analyticsPublicRouter = Router();

const shareLinkPerms = perms("Dashboard"); // share links inherit dashboard perms

/* ─────────────────────────── FORECASTING ──────────────────────────────── */
//
// Given a series [{key: dateISO, value: number}], produce N forecast points.
// Method:
//   linear       — least-squares regression on x=index, y=value
//   moving-avg   — trailing mean over the last `window` points (default 3)
// Returns the historical points plus the forecast points, tagged so the UI
// can render them distinctly.

interface SeriesPoint {
  key: string;
  value: number;
  forecast?: boolean;
}

function linearForecast(series: SeriesPoint[], periods: number): SeriesPoint[] {
  const n = series.length;
  if (n < 2) return [];
  const sumX = (n * (n - 1)) / 2;
  const sumY = series.reduce((s, p) => s + p.value, 0);
  const sumXY = series.reduce((s, p, i) => s + i * p.value, 0);
  const sumX2 = series.reduce((s, _p, i) => s + i * i, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < periods; i++) {
    const x = n + i;
    const y = Math.max(0, intercept + slope * x);
    out.push({ key: `+${i + 1}`, value: Math.round(y * 100) / 100, forecast: true });
  }
  return out;
}

function movingAverageForecast(
  series: SeriesPoint[],
  periods: number,
  window: number,
): SeriesPoint[] {
  const w = Math.min(window, series.length);
  if (w === 0) return [];
  const rolling = [...series.map((p) => p.value)];
  const out: SeriesPoint[] = [];
  for (let i = 0; i < periods; i++) {
    const slice = rolling.slice(-w);
    const avg = slice.reduce((s, v) => s + v, 0) / w;
    rolling.push(avg);
    out.push({ key: `+${i + 1}`, value: Math.round(avg * 100) / 100, forecast: true });
  }
  return out;
}

const forecastSchema = z.object({
  // Either a savedReportId (time-series report), or an inline series.
  savedReportId: z.string().optional(),
  series: z
    .array(z.object({ key: z.string(), value: z.coerce.number() }))
    .optional(),
  method: z.enum(["linear", "moving-avg"]).default("linear"),
  periods: z.coerce.number().int().min(1).max(24).default(3),
  window: z.coerce.number().int().min(1).max(12).default(3),
});

analyticsRouter.post("/forecast", shareLinkPerms.read, async (req, res) => {
  const parsed = forecastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let series: SeriesPoint[] = parsed.data.series ?? [];
  if (!series.length && parsed.data.savedReportId) {
    const saved = await prisma.savedReport.findFirst({
      where: { id: parsed.data.savedReportId, tenantId: req.auth!.tenantId },
    });
    if (!saved) return res.status(404).json({ error: "SavedReport not found" });
    const result = await runReport(
      prisma,
      req.auth!.tenantId,
      saved.doctype,
      saved.definition as unknown as ReportDefinition,
    );
    // Convention: first column is the date/label, last numeric column is the value.
    const numericCol = [...result.columns].reverse().find((c) =>
      ["decimal", "int", "float", "number"].includes(c.type.toLowerCase()),
    );
    const labelCol = result.columns[0];
    if (!numericCol || !labelCol) {
      return res.status(400).json({ error: "Report has no numeric column to forecast" });
    }
    series = result.rows.map((r) => ({
      key: String(r[labelCol.key] ?? ""),
      value: Number(r[numericCol.key] ?? 0),
    }));
  }

  if (series.length < 2) {
    return res.status(400).json({ error: "Need at least 2 data points to forecast" });
  }

  const forecast =
    parsed.data.method === "linear"
      ? linearForecast(series, parsed.data.periods)
      : movingAverageForecast(series, parsed.data.periods, parsed.data.window);

  res.json({
    method: parsed.data.method,
    historical: series,
    forecast,
    combined: [...series, ...forecast],
  });
});

/* ────────────────────────── ANOMALY DETECTION ─────────────────────────── */
//
// Z-score based: flag points where |value − mean| > threshold * stddev.
// Simple, robust for most business series (revenue, ticket counts, etc.).

interface AnomalyPoint extends SeriesPoint {
  z: number;
  isAnomaly: boolean;
}

function detectAnomalies(series: SeriesPoint[], threshold: number): AnomalyPoint[] {
  if (series.length < 3) return series.map((p) => ({ ...p, z: 0, isAnomaly: false }));
  const values = series.map((p) => p.value);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance) || 1;
  return series.map((p) => {
    const z = (p.value - mean) / stddev;
    return { ...p, z: Math.round(z * 100) / 100, isAnomaly: Math.abs(z) > threshold };
  });
}

const anomalySchema = z.object({
  savedReportId: z.string().optional(),
  series: z
    .array(z.object({ key: z.string(), value: z.coerce.number() }))
    .optional(),
  threshold: z.coerce.number().min(0.5).max(5).default(2),
});

analyticsRouter.post("/anomalies", shareLinkPerms.read, async (req, res) => {
  const parsed = anomalySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let series: SeriesPoint[] = parsed.data.series ?? [];
  if (!series.length && parsed.data.savedReportId) {
    const saved = await prisma.savedReport.findFirst({
      where: { id: parsed.data.savedReportId, tenantId: req.auth!.tenantId },
    });
    if (!saved) return res.status(404).json({ error: "SavedReport not found" });
    const result = await runReport(
      prisma,
      req.auth!.tenantId,
      saved.doctype,
      saved.definition as unknown as ReportDefinition,
    );
    const numericCol = [...result.columns].reverse().find((c) =>
      ["decimal", "int", "float", "number"].includes(c.type.toLowerCase()),
    );
    const labelCol = result.columns[0];
    if (!numericCol || !labelCol) {
      return res.status(400).json({ error: "Report has no numeric column to analyze" });
    }
    series = result.rows.map((r) => ({
      key: String(r[labelCol.key] ?? ""),
      value: Number(r[numericCol.key] ?? 0),
    }));
  }

  const analyzed = detectAnomalies(series, parsed.data.threshold);
  const anomalies = analyzed.filter((a) => a.isAnomaly);
  res.json({
    threshold: parsed.data.threshold,
    series: analyzed,
    anomalyCount: anomalies.length,
    anomalies,
  });
});

/* ─────────────────────────── SHARE LINKS ──────────────────────────────── */
//
// Create a public share link for a dashboard. The token becomes the URL
// slug; the operator can optionally set an expiry and/or a password.

function newToken() {
  return randomBytes(24).toString("base64url");
}

const shareCreateSchema = z.object({
  dashboardId: z.string().min(1),
  label: z.string().max(120).optional(),
  password: z.string().min(4).max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

analyticsRouter.post("/share-links", shareLinkPerms.write, async (req, res) => {
  const parsed = shareCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const d = await prisma.dashboard.findFirst({
    where: { id: parsed.data.dashboardId, tenantId: auth.tenantId },
  });
  if (!d) return res.status(404).json({ error: "Dashboard not found" });
  const link = await prisma.analyticsShareLink.create({
    data: {
      tenantId: auth.tenantId,
      dashboardId: d.id,
      token: newToken(),
      createdByUserId: auth.userId,
      label: parsed.data.label ?? null,
      passwordHash: parsed.data.password ? await bcrypt.hash(parsed.data.password, BCRYPT_COST) : null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });
  res.status(201).json({
    ...link,
    passwordHash: undefined,
    isPasswordProtected: !!link.passwordHash,
  });
});

analyticsRouter.get("/share-links", shareLinkPerms.read, async (req, res) => {
  const dashboardId = typeof req.query.dashboardId === "string" ? req.query.dashboardId : undefined;
  const rows = await prisma.analyticsShareLink.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(dashboardId ? { dashboardId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    rows.map((r) => ({
      ...r,
      passwordHash: undefined,
      isPasswordProtected: !!r.passwordHash,
    })),
  );
});

analyticsRouter.delete("/share-links/:id", shareLinkPerms.delete, async (req, res) => {
  const existing = await prisma.analyticsShareLink.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.analyticsShareLink.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Toggle isActive without deleting the token.
analyticsRouter.post("/share-links/:id/toggle", shareLinkPerms.write, async (req, res) => {
  const existing = await prisma.analyticsShareLink.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.analyticsShareLink.update({
    where: { id: existing.id },
    data: { isActive: !existing.isActive },
  });
  res.json({ ...row, passwordHash: undefined, isPasswordProtected: !!row.passwordHash });
});

/* ─────────────────────── PUBLIC DASHBOARD VIEW ────────────────────────── */
//
// Public — no JWT required. Validates the token, optional password, and
// expiry, then returns the dashboard + resolved card data. Mounted at
// `/public/analytics/shares/:token`.

async function loadShare(token: string) {
  return prisma.analyticsShareLink.findUnique({
    where: { token },
    include: {
      dashboard: { include: { cards: { orderBy: [{ sortOrder: "asc" }] } } },
    },
  });
}

analyticsPublicRouter.get("/shares/:token", async (req, res) => {
  const share = await loadShare(req.params.token);
  if (!share || !share.isActive) return res.status(404).json({ error: "Not found" });
  if (share.expiresAt && share.expiresAt < new Date())
    return res.status(410).json({ error: "Share link has expired" });
  res.json({
    dashboardName: share.dashboard.name,
    dashboardDescription: share.dashboard.description,
    isPasswordProtected: !!share.passwordHash,
    expiresAt: share.expiresAt,
  });
});

// Data endpoint — requires the password if one is set. Increments viewCount.
analyticsPublicRouter.post("/shares/:token/data", async (req, res) => {
  const share = await loadShare(req.params.token);
  if (!share || !share.isActive) return res.status(404).json({ error: "Not found" });
  if (share.expiresAt && share.expiresAt < new Date())
    return res.status(410).json({ error: "Share link has expired" });

  if (share.passwordHash) {
    const supplied = typeof req.body?.password === "string" ? req.body.password : "";
    const ok = await bcrypt.compare(supplied, share.passwordHash);
    if (!ok) return res.status(401).json({ error: "Password required or incorrect" });
  }

  const tenantId = share.tenantId;
  const cards = await Promise.all(
    share.dashboard.cards.map(async (c) => {
      try {
        const cfg = c.config as unknown as CardConfig;
        if (c.kind === "KPI") {
          const data = await resolveKpi(prisma, tenantId, cfg as KpiCardConfig);
          return { id: c.id, kind: c.kind, title: c.title, subtitle: c.subtitle, data };
        }
        if (c.kind === "LineChart" || c.kind === "BarChart" || c.kind === "PieChart") {
          const data = await resolveChart(prisma, tenantId, cfg as ChartCardConfig);
          return { id: c.id, kind: c.kind, title: c.title, subtitle: c.subtitle, data };
        }
        if (c.kind === "SavedReport") {
          const src = cfg as SavedReportCardConfig;
          const saved = await prisma.savedReport.findFirst({
            where: { id: src.savedReportId, tenantId },
          });
          if (!saved)
            return { id: c.id, kind: c.kind, title: c.title, data: null, error: "SavedReport missing" };
          const data = await runReport(
            prisma,
            tenantId,
            saved.doctype,
            saved.definition as unknown as ReportDefinition,
          );
          return { id: c.id, kind: c.kind, title: c.title, subtitle: c.subtitle, data };
        }
        if (c.kind === "Text") {
          return {
            id: c.id,
            kind: c.kind,
            title: c.title,
            subtitle: c.subtitle,
            data: cfg as TextCardConfig,
          };
        }
        return { id: c.id, kind: c.kind, title: c.title, data: null };
      } catch (e) {
        return {
          id: c.id,
          kind: c.kind,
          title: c.title,
          data: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  await prisma.analyticsShareLink.update({
    where: { id: share.id },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });

  res.json({
    dashboard: {
      id: share.dashboard.id,
      name: share.dashboard.name,
      description: share.dashboard.description,
    },
    cards,
  });
});
