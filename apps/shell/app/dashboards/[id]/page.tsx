"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { ChartAdapter, type ChartKind, type ChartPayload } from "@lumaara/charts";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  Card,
  Drawer,
  PageHeader,
  Skeleton,
  Toast,
} from "../../../components/ui";

interface KpiData {
  value: number;
  previousValue?: number;
  delta?: number;
  deltaPercent?: number;
}
interface ChartRow { key: string; value: number }
interface TableResult {
  columns: { key: string; label: string; type: string }[];
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}
interface TextData { body: string }

interface CardResult {
  id: string;
  kind: string;
  data: KpiData | ChartRow[] | TableResult | TextData | ChartPayload | null;
  error?: string;
}

// Every chart kind that the server routes through the advanced resolvers and
// returns a ChartPayload for. The viewer then hands the payload directly to
// the ChartAdapter — no per-kind branching in this file.
const ADAPTER_KINDS: ReadonlySet<string> = new Set<ChartKind>([
  "Bar", "HorizontalBar", "Column", "Pie", "Donut", "Funnel", "Radar", "Gauge",
  "TreeMap", "Sunburst", "Line", "Area", "StackedArea", "StackedBar",
  "StackedColumn", "ClusteredBar", "ClusteredColumn", "GroupedBar", "Combo",
  "Scatter", "Bubble", "BoxPlot", "Histogram", "Waterfall", "Heatmap",
  "Calendar", "Sankey", "FlowChart", "NetworkDiagram", "ClusterDiagram",
  "Timeline", "Gantt", "GeoMap", "BubbleMap", "WordCloud", "KPICards",
  "SummaryTable", "ConditionalTable", "SentimentLine",
]);

interface DashboardData {
  dashboard: { id: string; name: string; description: string | null };
  cards: CardResult[];
}

interface CardMeta {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  gridCol: number;
  gridRow: number;
  gridWidth: number;
  gridHeight: number;
  sortOrder: number;
}

interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  isShared: boolean;
  cards: CardMeta[];
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function KpiCard({ title, subtitle, data }: { title: string; subtitle: string | null; data: KpiData }) {
  const positive = (data.delta ?? 0) >= 0;
  return (
    <Card className="p-4 h-full">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">{title}</div>
      {subtitle && <div className="text-xs text-ink-muted mb-1">{subtitle}</div>}
      <div className="text-3xl font-semibold text-ink tabular-nums">{fmt(data.value)}</div>
      {data.deltaPercent !== undefined && (
        <div
          className={`text-xs mt-1 tabular-nums ${
            positive ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {positive ? "▲" : "▼"} {fmt(Math.abs(data.deltaPercent))}% vs prev
        </div>
      )}
    </Card>
  );
}

function ChartRows({ rows }: { rows: ChartRow[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.key} className="text-xs flex items-center gap-2">
          <div className="w-24 truncate text-ink-soft">{r.key}</div>
          <div className="flex-1 bg-surface-sunken rounded h-3 overflow-hidden">
            <div
              className="bg-brand-600 h-3"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <div className="w-20 text-end font-mono tabular-nums text-ink">{fmt(r.value)}</div>
        </div>
      ))}
      {rows.length === 0 && <div className="text-xs text-ink-muted">No data</div>}
    </div>
  );
}

function TableCard({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string | null;
  data: TableResult;
}) {
  return (
    <Card className="p-4 h-full overflow-hidden">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">{title}</div>
      {subtitle && <div className="text-xs text-ink-muted mb-2">{subtitle}</div>}
      <div className="overflow-auto max-h-64">
        <table className="w-full text-xs">
          <thead className="bg-surface-sunken text-ink-muted text-start">
            <tr>
              {data.columns.map((c) => (
                <th key={c.key} className="px-2 py-1">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-t border-ink-muted/10">
                {data.columns.map((c) => (
                  <td key={c.key} className="px-2 py-1 text-ink">
                    {String(r[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Analytics-Plus additions —————————————————————————————————————————————
// Time-series-aware chart with linear-forecast overlay.

interface ForecastPoint { key: string; value: number; forecast?: boolean }
interface ForecastResponse {
  method: string;
  historical: ForecastPoint[];
  forecast: ForecastPoint[];
  combined: ForecastPoint[];
}
interface AnomalyPoint extends ForecastPoint { z: number; isAnomaly: boolean }
interface AnomalyResponse {
  threshold: number;
  series: AnomalyPoint[];
  anomalyCount: number;
  anomalies: AnomalyPoint[];
}

function ForecastPanel({ rows }: { rows: ChartRow[] }) {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState<"linear" | "moving-avg">("linear");
  const [periods, setPeriods] = useState(3);

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await dashboardApi.post<ForecastResponse>("/analytics/forecast", {
        series: rows,
        method,
        periods,
      });
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Forecast failed");
    } finally {
      setLoading(false);
    }
  };

  const max = useMemo(() => {
    const src = data?.combined ?? rows;
    return src.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  }, [data, rows]);

  return (
    <div className="mt-3 border-t border-dashed border-ink-muted/20 pt-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-ink-soft">Forecast</span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as "linear" | "moving-avg")}
          className="input py-0.5 px-1 text-xs"
        >
          <option value="linear">Linear</option>
          <option value="moving-avg">Moving avg</option>
        </select>
        <input
          type="number"
          min={1}
          max={12}
          value={periods}
          onChange={(e) => setPeriods(Number(e.target.value) || 3)}
          className="input py-0.5 px-1 text-xs w-14"
        />
        <button
          onClick={run}
          disabled={loading || rows.length < 2}
          className="text-brand-600 hover:underline disabled:text-ink-muted"
        >
          {loading ? "…" : data ? "Refresh" : "Run"}
        </button>
        {err && <span className="text-red-600">{err}</span>}
      </div>
      {data && (
        <div className="mt-2 flex items-end gap-1 h-16">
          {data.combined.map((p, i) => (
            <div key={i} className="flex-1 flex flex-col items-center" title={`${p.key}: ${p.value}`}>
              <div
                className={
                  p.forecast
                    ? "w-full bg-brand-200 border-t-2 border-dashed border-brand-500"
                    : "w-full bg-brand-500"
                }
                style={{ height: `${(p.value / max) * 100}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnomalyPanel({ rows }: { rows: ChartRow[] }) {
  const [data, setData] = useState<AnomalyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(2);

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await dashboardApi.post<AnomalyResponse>("/analytics/anomalies", {
        series: rows,
        threshold,
      });
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Anomaly detection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 border-t border-dashed border-ink-muted/20 pt-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-ink-soft">Anomalies</span>
        <span className="text-ink-muted">z &gt;</span>
        <input
          type="number"
          step={0.5}
          min={0.5}
          max={5}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value) || 2)}
          className="input py-0.5 px-1 text-xs w-14"
        />
        <button
          onClick={run}
          disabled={loading || rows.length < 3}
          className="text-brand-600 hover:underline disabled:text-ink-muted"
        >
          {loading ? "…" : data ? "Refresh" : "Run"}
        </button>
        {err && <span className="text-red-600">{err}</span>}
      </div>
      {data && (
        <div className="mt-2 text-xs">
          {data.anomalyCount === 0 ? (
            <span className="text-ink-muted">No anomalies above z={data.threshold}</span>
          ) : (
            <ul className="space-y-0.5">
              {data.anomalies.map((a, i) => (
                <li key={i} className="flex justify-between text-red-700">
                  <span>{a.key}</span>
                  <span className="tabular-nums">
                    {fmt(a.value)} <span className="text-ink-muted">(z={a.z})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TextCard({ title, subtitle, data }: { title: string; subtitle: string | null; data: TextData }) {
  return (
    <Card className="p-4 h-full">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">{title}</div>
      {subtitle && <div className="text-xs text-ink-muted mb-2">{subtitle}</div>}
      <div className="text-sm whitespace-pre-wrap text-ink">{data.body}</div>
    </Card>
  );
}

interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  isActive: boolean;
  isPasswordProtected: boolean;
  expiresAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

function ShareDrawer({
  dashboardId,
  onClose,
}: {
  dashboardId: string;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await dashboardApi.get<ShareLink[]>(
        `/analytics/share-links?dashboardId=${dashboardId}`,
      );
      setLinks(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load links");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId]);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await dashboardApi.post("/analytics/share-links", {
        dashboardId,
        label: label || undefined,
        password: password || undefined,
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
      });
      setLabel("");
      setPassword("");
      setExpires("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this share link? Anyone with the URL will lose access.")) return;
    await dashboardApi.delete(`/analytics/share-links/${id}`);
    await load();
  };

  const toggle = async (id: string) => {
    await dashboardApi.post(`/analytics/share-links/${id}/toggle`, {});
    await load();
  };

  const shareBase =
    typeof window !== "undefined"
      ? `${window.location.origin}/share/dashboard`
      : "/share/dashboard";

  return (
    <Drawer open onClose={onClose} title="Share dashboard" width="w-[480px]">
      <div className="space-y-4">
        <div className="space-y-2 border border-dashed border-ink-muted/30 rounded p-3">
          <div className="text-xs font-semibold text-ink-soft">New public link</div>
          <input
            placeholder="Label (optional, e.g. Client preview)"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            placeholder="Password (optional)"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            type="datetime-local"
            className="input"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
          <Button variant="brand" size="sm" onClick={create} disabled={busy} type="button">
            {busy ? "Creating…" : "Create link"}
          </Button>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>

        <div className="text-xs font-semibold text-ink-soft pt-2">
          Active links ({links.filter((l) => l.isActive).length}/{links.length})
        </div>
        {links.length === 0 && (
          <div className="text-xs text-ink-muted">No share links yet.</div>
        )}
        {links.map((l) => (
          <div key={l.id} className="border border-ink-muted/10 rounded p-3 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-ink">{l.label ?? "Untitled"}</div>
              <span className={l.isActive ? "badge-green" : "badge-gray"}>
                {l.isActive ? "Active" : "Disabled"}
              </span>
            </div>
            <div className="text-ink-muted">
              Views {l.viewCount}
              {l.isPasswordProtected ? " · Password-protected" : ""}
              {l.expiresAt ? ` · Expires ${new Date(l.expiresAt).toLocaleDateString()}` : ""}
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={`${shareBase}/${l.token}`}
                className="input flex-1 font-mono text-[11px] bg-surface-sunken"
              />
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`${shareBase}/${l.token}`);
                }}
                className="text-brand-600 hover:underline"
              >
                Copy
              </button>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => toggle(l.id)} className="text-ink-soft hover:underline">
                {l.isActive ? "Disable" : "Enable"}
              </button>
              <button onClick={() => revoke(l.id)} className="text-red-600 hover:underline">
                Revoke
              </button>
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

export default function DashboardViewPage() {
  const params = useParams<{ id: string }>();
  const [d, setD] = useState<Dashboard | null>(null);
  const [payload, setPayload] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [meta, data] = await Promise.all([
          dashboardApi.get<Dashboard>(`/dashboards/${params.id}`),
          dashboardApi.get<DashboardData>(`/dashboards/${params.id}/data`),
        ]);
        setD(meta);
        setPayload(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, [params.id]);

  const breadcrumb = [
    { label: "Dashboards", href: "/dashboards" },
    { label: d?.name ?? "Dashboard" },
  ];

  if (error && !d) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="Dashboard"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </AppShell>
    );
  }
  if (!d || !payload) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading dashboard…" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" rounded="rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  const cardMetaById = new Map(d.cards.map((c) => [c.id, c]));

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      {shareOpen && <ShareDrawer dashboardId={params.id} onClose={() => setShareOpen(false)} />}

      <PageHeader
        breadcrumb={breadcrumb}
        title={d.name}
        subtitle={d.description ?? undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => setShareOpen(true)} type="button">
              Share
            </Button>
            <a href={`/dashboards/${params.id}/edit`}>
              <Button variant="brand" type="button">Edit cards</Button>
            </a>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-6xl grid grid-cols-12 gap-4">
        {payload.cards.map((c) => {
          const meta = cardMetaById.get(c.id);
          if (!meta) return null;
          const style = { gridColumn: `span ${meta.gridWidth} / span ${meta.gridWidth}` };
          if (c.error) {
            return (
              <div key={c.id} style={style}>
                <Card className="p-4">
                  <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                    {meta.title}
                  </div>
                  <div className="text-red-600 text-sm mt-2">{c.error}</div>
                </Card>
              </div>
            );
          }
          return (
            <div key={c.id} style={style}>
              {c.kind === "KPI" && c.data && (
                <KpiCard title={meta.title} subtitle={meta.subtitle} data={c.data as KpiData} />
              )}
              {(c.kind === "BarChart" || c.kind === "LineChart" || c.kind === "PieChart") &&
                c.data && (
                  <Card className="h-full flex flex-col">
                    <div className="p-4 pb-0">
                      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                        {meta.title}
                      </div>
                      {meta.subtitle && (
                        <div className="text-xs text-ink-muted mb-2">{meta.subtitle}</div>
                      )}
                    </div>
                    <div className="px-4">
                      <ChartRows rows={c.data as ChartRow[]} />
                    </div>
                    <div className="px-4 pb-4">
                      <ForecastPanel rows={c.data as ChartRow[]} />
                      <AnomalyPanel rows={c.data as ChartRow[]} />
                    </div>
                  </Card>
                )}
              {c.kind === "SavedReport" && c.data && (
                <TableCard
                  title={meta.title}
                  subtitle={meta.subtitle}
                  data={c.data as TableResult}
                />
              )}
              {c.kind === "Text" && c.data && (
                <TextCard
                  title={meta.title}
                  subtitle={meta.subtitle}
                  data={c.data as TextData}
                />
              )}
              {ADAPTER_KINDS.has(c.kind) && c.data && (
                <Card className="h-full flex flex-col">
                  <div className="p-4 pb-2">
                    <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                      {meta.title}
                    </div>
                    {meta.subtitle && (
                      <div className="text-xs text-ink-muted">{meta.subtitle}</div>
                    )}
                  </div>
                  <div className="px-2 pb-2 flex-1">
                    <ChartAdapter
                      kind={c.kind as ChartKind}
                      payload={c.data as ChartPayload}
                      height={Math.max(220, meta.gridHeight * 120)}
                    />
                  </div>
                </Card>
              )}
            </div>
          );
        })}
        {payload.cards.length === 0 && (
          <div className="col-span-12">
            <Card className="p-12 text-center">
              <div className="text-sm text-ink-muted">
                No cards yet.{" "}
                <a
                  href={`/dashboards/${params.id}/edit`}
                  className="text-brand-600 hover:underline"
                >
                  Add one →
                </a>
              </div>
            </Card>
          </div>
        )}
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Dashboard" docId={params.id} />
      </div>
</AppShell>
  );
}
