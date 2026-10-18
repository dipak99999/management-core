"use client";

// Marketing P3 — ROI dashboard.
//
// Reads GET /attribution/roi?from=&to=&model= from crm-service and renders
// KPI cards + a per-source revenue table. All numeric columns use
// `tabular-nums` + `money()` for aligned formatting. Date range defaults to
// the last 90 days (matches attribution engine's default window). Attribution
// model is client-selected (LastTouch / FirstTouch / Linear) — note the
// engine writes attributed revenue at SI-submit time under whatever model
// was active THEN; the model switcher here is currently informational until
// the backend `?model=` triggers an in-place recomputation. See
// `packages/db/src/attribution.ts` for the read-vs-recompute story.

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { AppShell, Icon } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  SkeletonList,
  Toast,
  money,
  type Column,
} from "../../../../components/ui";

const CRM_BASE =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

function crmToken(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

// Stale-JWT 401 auto-clear pattern (see [[feedback-stale-jwt-401]]).
async function crmFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${CRM_BASE}${path}`, {
    headers: { authorization: `Bearer ${crmToken()}` },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("lumaara.session");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return (await res.json()) as T;
}

type AttributionModel = "LastTouch" | "FirstTouch" | "Linear";

interface RoiRow {
  sourceType: string;
  sourceId: string;
  sourceName: string;
  touchpointCount: number;
  uniqueContacts: number;
  attributedRevenue: number;
}

const SOURCE_BADGE: Record<string, string> = {
  Campaign: "badge-blue",
  Journey: "badge-purple",
  WebForm: "badge-green",
  Webinar: "badge-amber",
  SocialPost: "badge-cyan",
};

function SourceBadge({ type }: { type: string }) {
  const cls = SOURCE_BADGE[type] ?? "badge-gray";
  return <span className={cls}>{type}</span>;
}

// ── Date helpers ─────────────────────────────────────────────────────

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default function RoiDashboardPage() {
  // Default: last 90 days (matches engine default window). To-date is
  // end-of-today so any invoice submitted today is visible.
  const [from, setFrom] = useState<string>(() => isoDay(daysAgo(90)));
  const [to, setTo] = useState<string>(() => isoDay(new Date()));
  const [model, setModel] = useState<AttributionModel>("LastTouch");
  const [sourceType, setSourceType] = useState<string>("all");

  const [rows, setRows] = useState<RoiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      // Emit as ISO datetimes so the backend Date() parse is unambiguous.
      qs.set("from", new Date(from).toISOString());
      // Include the full "to" day by setting end-of-day.
      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999);
      qs.set("to", toEnd.toISOString());
      qs.set("model", model);
      if (sourceType !== "all") qs.set("sourceType", sourceType);
      const data = await crmFetch<RoiRow[]>(`/attribution/roi?${qs.toString()}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — the /attribution/roi endpoint may not be reachable.`
          : "Failed to load ROI data",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch when the server-side filters change (from/to/model/sourceType).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, model, sourceType]);

  useListPageCommands({
    singular: "Roi",
    plural: "Roi",
    refresh: load,
  });

  // ── KPIs ─────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const totalRevenue = rows.reduce((s, r) => s + (r.attributedRevenue || 0), 0);
    const totalTouchpoints = rows.reduce((s, r) => s + r.touchpointCount, 0);
    // Sum of uniqueContacts per source is not the true global unique count
    // (a contact touched by two sources is double-counted). Backend already
    // dedups PER source; a global dedup would need a separate endpoint. Label
    // this as "reach across sources" to avoid misleading the operator.
    const reach = rows.reduce((s, r) => s + r.uniqueContacts, 0);
    const top = rows[0] ?? null; // rows come sorted by revenue DESC
    return { totalRevenue, totalTouchpoints, reach, top };
  }, [rows]);

  // ── Table ────────────────────────────────────────────────────────────

  const columns: Column<RoiRow>[] = [
    {
      header: "Source",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-sm text-ink font-medium">{r.sourceName}</span>
          <span className="text-xs text-ink-muted font-mono">{r.sourceId}</span>
        </div>
      ),
    },
    { header: "Type", cell: (r) => <SourceBadge type={r.sourceType} /> },
    {
      header: "Touchpoints",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-ink-soft">
          {r.touchpointCount.toLocaleString()}
        </span>
      ),
    },
    {
      header: "Unique contacts",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-ink-soft">
          {r.uniqueContacts.toLocaleString()}
        </span>
      ),
    },
    {
      header: "Attributed revenue",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-ink font-medium">
          {money(r.attributedRevenue)}
        </span>
      ),
    },
    {
      header: "% of total",
      align: "right",
      cell: (r) => {
        const pct =
          kpis.totalRevenue > 0
            ? (r.attributedRevenue / kpis.totalRevenue) * 100
            : 0;
        return (
          <span className="tabular-nums text-xs text-ink-muted">
            {pct.toFixed(1)}%
          </span>
        );
      },
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Marketing ROI"
        subtitle="Revenue attributed to each marketing source across the selected window."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing", href: "/admin/marketing" },
          { label: "ROI" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => history.back()}
            >
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => load()}>
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* ── KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Card className="p-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-1">
            Attributed revenue
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums">
            {money(kpis.totalRevenue)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-1">
            Touchpoints
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums">
            {kpis.totalTouchpoints.toLocaleString()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-1">
            Reach (contacts × sources)
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums">
            {kpis.reach.toLocaleString()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-1">
            Top-performing source
          </div>
          {kpis.top ? (
            <div>
              <div className="text-sm text-ink font-medium truncate">
                {kpis.top.sourceName}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                <SourceBadge type={kpis.top.sourceType} />{" "}
                <span className="tabular-nums ms-2">
                  {money(kpis.top.attributedRevenue)}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-ink-muted">No data yet</div>
          )}
        </Card>
      </div>

      {/* ── Filters ──────────────────────────────────────────────── */}
      <FilterBar
        filters={
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-muted">From</label>
              <input
                type="date"
                className="input h-8 text-xs"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <label className="text-xs text-ink-muted ms-2">To</label>
              <input
                type="date"
                className="input h-8 text-xs"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Segmented<AttributionModel>
              value={model}
              onChange={setModel}
              options={[
                { value: "LastTouch", label: "Last touch" },
                { value: "FirstTouch", label: "First touch" },
                { value: "Linear", label: "Linear" },
              ]}
            />
            <select
              className="input h-8 text-xs"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              title="Filter by source type"
            >
              <option value="all">All source types</option>
              <option value="Campaign">Campaign</option>
              <option value="Journey">Journey</option>
              <option value="WebForm">Web form</option>
              <option value="Webinar">Webinar</option>
              <option value="SocialPost">Social post</option>
            </select>
          </>
        }
        actions={<SavedViewsControls listKey="shell:admin-marketing-roi" current={{ from, to, model, sourceType }} onApply={(fv) => { setFrom(fv.from); setTo(fv.to); setModel(fv.model); setSourceType(fv.sourceType); }} />}
      />

      <div className="mt-4">
        {loading ? (
          <SkeletonList rows={5} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.sourceType}::${r.sourceId}`}
            empty={{
              icon: Icon.bar,
              title: "No attributed revenue in the selected window",
              description:
                "Attribution rows accumulate as marketing touchpoints (opens, clicks, form submits, journey completions, webinar attends) tie to submitted sales invoices. If you're just getting started, submit a few invoices for customers with recent touchpoints to populate this table.",
            }}
          />
        )}
      </div>

      {/* ── Model caveat ─────────────────────────────────────────── */}
      <Card className="p-4 mt-6 text-sm text-ink-soft">
        <div className="font-medium text-ink mb-1">About the attribution model</div>
        <p>
          Attribution is computed <strong>at sales-invoice-submit time</strong>{" "}
          under the engine's default model (Last touch, 90-day window). The
          model switcher above filters the display but does not re-attribute
          historical invoices. To globally rebuild attribution under a
          different model, run{" "}
          <code className="text-xs bg-surface-sunken px-1.5 py-0.5 rounded">
            POST /attribution/recompute?invoiceId=…&model=…
          </code>{" "}
          per invoice (admin only).
        </p>
      </Card>
    </AppShell>
  );
}
