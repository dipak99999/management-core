import { PrismaClient } from "@prisma/client";
import { getDoctypeMeta } from "./report-meta";
import { getPrismaDelegate } from "./prisma-delegate";

// G2 + G3: Dashboard card resolver. Executes a single card's config against
// Prisma and returns a payload appropriate for the card kind.
//
// All queries are guarded by the doctype whitelist (report-meta). Aggregates
// (count/sum) only accept fields declared in that meta.

export type CardKind =
  | "KPI"
  | "LineChart"
  | "BarChart"
  | "PieChart"
  | "Table"
  | "SavedReport"
  | "Text";

export type Period =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "mtd"
  | "qtd"
  | "ytd";

export interface KpiCardConfig {
  kind: "KPI";
  doctype: string;
  aggregate: "count" | "sum" | "avg";
  field?: string; // required for sum/avg
  filters?: Record<string, unknown>; // raw prisma filter (whitelist-checked)
  dateField?: string;
  period?: Period;
  showDelta?: boolean; // compares against previous equal-length window
  format?: "number" | "currency" | "percent";
}

export interface ChartCardConfig {
  kind: "LineChart" | "BarChart" | "PieChart";
  doctype: string;
  aggregate: "count" | "sum";
  field?: string;
  groupBy: string; // one of the reportable columns
  filters?: Record<string, unknown>;
  dateField?: string;
  period?: Period;
  limit?: number;
  orderDir?: "asc" | "desc";
}

export interface TextCardConfig {
  kind: "Text";
  body: string;
}

export interface SavedReportCardConfig {
  kind: "SavedReport";
  savedReportId: string;
}

export type CardConfig =
  | KpiCardConfig
  | ChartCardConfig
  | TextCardConfig
  | SavedReportCardConfig;

// Resolve a period into an inclusive window. `dateField` is only used by the
// caller — this function is period math only.
export function periodWindow(period: Period, now = new Date()): {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
} {
  const to = now;
  let from: Date;
  switch (period) {
    case "today": {
      from = new Date(now);
      from.setUTCHours(0, 0, 0, 0);
      break;
    }
    case "yesterday": {
      from = new Date(now);
      from.setUTCDate(from.getUTCDate() - 1);
      from.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(from);
      dayEnd.setUTCHours(23, 59, 59, 999);
      const prevF = new Date(from);
      prevF.setUTCDate(prevF.getUTCDate() - 1);
      const prevT = new Date(dayEnd);
      prevT.setUTCDate(prevT.getUTCDate() - 1);
      return { from, to: dayEnd, prevFrom: prevF, prevTo: prevT };
    }
    case "last7": {
      from = new Date(now);
      from.setUTCDate(from.getUTCDate() - 7);
      break;
    }
    case "last30": {
      from = new Date(now);
      from.setUTCDate(from.getUTCDate() - 30);
      break;
    }
    case "mtd": {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    }
    case "qtd": {
      const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      from = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
      break;
    }
    case "ytd": {
      from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      break;
    }
    default:
      from = new Date(now);
      from.setUTCDate(from.getUTCDate() - 30);
  }
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  return { from, to, prevFrom, prevTo };
}

// Very small filter validator: filters is a subset of Prisma-style where. We
// don't try to interpret operators — we just check that every top-level key
// is a filterable field on the doctype and pass through to Prisma.
function guardFilters(
  doctype: string,
  filters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!filters) return {};
  const meta = getDoctypeMeta(doctype);
  if (!meta) throw new Error(`Doctype "${doctype}" is not reportable`);
  const allowed = new Set(meta.filterableFields);
  for (const k of Object.keys(filters)) {
    if (k.startsWith("$")) continue; // allow $and / $or if used
    if (!allowed.has(k))
      throw new Error(`Field "${k}" is not filterable on ${doctype}`);
  }
  return filters;
}

export interface KpiResult {
  value: number;
  previousValue?: number;
  delta?: number;
  deltaPercent?: number;
}

export async function resolveKpi(
  prisma: PrismaClient,
  tenantId: string,
  cfg: KpiCardConfig,
): Promise<KpiResult> {
  const meta = getDoctypeMeta(cfg.doctype);
  if (!meta) throw new Error(`Doctype "${cfg.doctype}" is not reportable`);
  if (cfg.aggregate !== "count" && !cfg.field)
    throw new Error(`aggregate=${cfg.aggregate} requires a field`);
  if (cfg.field && !meta.columns.find((c) => c.key === cfg.field))
    throw new Error(`Unknown field "${cfg.field}"`);

  const del = getPrismaDelegate(prisma, meta.delegate);
  if (!del) throw new Error(`No Prisma delegate for ${meta.doctype}`);
  // Capture non-null in a stable local so the inner closure keeps the
  // narrowing that TS drops at the function boundary.
  const delegate = del;

  const filters = guardFilters(cfg.doctype, cfg.filters);
  const dateField = cfg.dateField;
  const period = cfg.period;

  const baseWhere: Record<string, unknown> = { tenantId, ...filters };
  let currentWhere = baseWhere;
  let prevWhere: Record<string, unknown> | null = null;
  if (period && dateField) {
    const w = periodWindow(period);
    currentWhere = { ...baseWhere, [dateField]: { gte: w.from, lte: w.to } };
    if (cfg.showDelta) {
      prevWhere = { ...baseWhere, [dateField]: { gte: w.prevFrom, lte: w.prevTo } };
    }
  }

  async function runAgg(where: Record<string, unknown>): Promise<number> {
    if (cfg.aggregate === "count") {
      const n = await delegate.count({ where });
      return Number(n);
    }
    const aggArgs: Record<string, unknown> = { where };
    if (cfg.aggregate === "sum") aggArgs._sum = { [cfg.field!]: true };
    else aggArgs._avg = { [cfg.field!]: true };
    const r = (await delegate.aggregate(aggArgs)) as { _sum?: Record<string, unknown>; _avg?: Record<string, unknown> };
    const bucket = cfg.aggregate === "sum" ? r._sum : r._avg;
    const val = bucket?.[cfg.field!];
    return Number(val ?? 0);
  }

  const value = await runAgg(currentWhere);
  if (!prevWhere) return { value };
  const previousValue = await runAgg(prevWhere);
  const delta = value - previousValue;
  const deltaPercent = previousValue === 0 ? null : (delta / previousValue) * 100;
  return { value, previousValue, delta, deltaPercent: deltaPercent ?? undefined };
}

export interface ChartRow {
  key: string;
  value: number;
}

export async function resolveChart(
  prisma: PrismaClient,
  tenantId: string,
  cfg: ChartCardConfig,
): Promise<ChartRow[]> {
  const meta = getDoctypeMeta(cfg.doctype);
  if (!meta) throw new Error(`Doctype "${cfg.doctype}" is not reportable`);
  if (!meta.columns.find((c) => c.key === cfg.groupBy))
    throw new Error(`Unknown groupBy "${cfg.groupBy}"`);
  if (cfg.aggregate === "sum" && !cfg.field)
    throw new Error(`aggregate=sum requires a field`);
  if (cfg.groupBy.includes("."))
    throw new Error(`groupBy on nested paths is not supported yet`);

  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  const filters = guardFilters(cfg.doctype, cfg.filters);
  const baseWhere: Record<string, unknown> = { tenantId, ...filters };
  if (cfg.period && cfg.dateField) {
    const w = periodWindow(cfg.period);
    baseWhere[cfg.dateField] = { gte: w.from, lte: w.to };
  }

  // Prisma normalizes `_count: undefined` into `{ select: undefined }` and
  // then rejects it. Only include the aggregate we're actually using.
  const groupArgs: Record<string, unknown> = {
    by: [cfg.groupBy],
    where: baseWhere,
    orderBy:
      cfg.aggregate === "count"
        ? { _count: { [cfg.groupBy]: cfg.orderDir ?? "desc" } }
        : { _sum: { [cfg.field!]: cfg.orderDir ?? "desc" } },
    take: Math.min(cfg.limit ?? 20, 100),
  };
  if (cfg.aggregate === "count") groupArgs._count = true;
  else groupArgs._sum = { [cfg.field!]: true };
  const rows = await delegate.groupBy(groupArgs);

  return rows.map((r: Record<string, unknown>) => {
    const key = r[cfg.groupBy];
    if (cfg.aggregate === "count") {
      return { key: String(key ?? "—"), value: Number(r._count ?? 0) };
    }
    const sumBucket = r._sum as Record<string, unknown>;
    return { key: String(key ?? "—"), value: Number(sumBucket[cfg.field!] ?? 0) };
  });
}
