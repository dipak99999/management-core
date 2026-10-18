"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../../lib/api";
import { AppShell, Icon } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  Toast,
  relativeTime,
  type Column,
} from "../../../../components/ui";

// Read-only feed of TrackingEvent rows across all campaigns / transactional
// emails. Backed by GET /email/track/events on auth-service.
//
// Shape per row (see auth-service/routes/email-tracking.ts):
//   { id, tenantId, type, campaignId, recipientId, emailMessageId,
//     targetUrl, ip, userAgent, occurredAt }
//
// We fetch campaigns from crm-service to render campaign names inline.

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
async function crmFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${CRM_BASE}${path}`, {
      headers: { authorization: `Bearer ${crmToken()}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface TrackingEvent {
  id: string;
  type: string;
  campaignId: string | null;
  recipientId: string | null;
  emailMessageId: string | null;
  targetUrl: string | null;
  ip: string | null;
  userAgent: string | null;
  occurredAt: string;
  // Optional joined fields — server may or may not include them.
  recipientEmail?: string | null;
  toEmail?: string | null;
}

interface CampaignLite {
  id: string;
  name: string;
}

type TypeFilter =
  | "all"
  | "Open"
  | "Click"
  | "Bounce"
  | "Complaint"
  | "Unsubscribe"
  | "Delivered"
  | "Deferred";

const TYPES: TypeFilter[] = [
  "Open",
  "Click",
  "Bounce",
  "Complaint",
  "Unsubscribe",
  "Delivered",
  "Deferred",
];

function TypeBadge({ type }: { type: string }) {
  if (type === "Open") return <span className="badge-green">Open</span>;
  if (type === "Click") return <span className="badge-blue">Click</span>;
  if (type === "Bounce") return <span className="badge-red">Bounce</span>;
  if (type === "Complaint") return <span className="badge-red">Complaint</span>;
  if (type === "Unsubscribe") return <span className="badge-gray">Unsub</span>;
  if (type === "Delivered") return <span className="badge-green">Delivered</span>;
  if (type === "Deferred") return <span className="badge-amber">Deferred</span>;
  return <span className="badge-gray">{type}</span>;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export default function TrackingEventsPage() {
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (typeFilter !== "all") qs.set("type", typeFilter);
      if (campaignFilter) qs.set("campaignId", campaignFilter);
      qs.set("limit", "500");
      const data = await api.get<TrackingEvent[]>(
        `/email/track/events?${qs.toString()}`,
      );
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — the /email/track/events endpoint may not be wired yet.`
          : "Failed to load tracking events",
      );
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Refetch when server-side filters change so the /events request narrows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, campaignFilter]);

  useListPageCommands({
    singular: "Tracking Event",
    plural: "Tracking Events",
    refresh: load,
  });
  useEffect(() => {
    crmFetch<CampaignLite[]>("/campaigns").then((rows) => {
      if (Array.isArray(rows)) setCampaigns(rows);
    });
  }, []);

  const campaignName = useMemo(() => {
    const m = new Map(campaigns.map((c) => [c.id, c.name] as const));
    return (id: string | null | undefined) => (id ? m.get(id) ?? id : "—");
  }, [campaigns]);

  const filtered = useMemo(() => {
    let out = events;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((e) => {
        const email = e.recipientEmail ?? e.toEmail ?? "";
        return [email, e.targetUrl ?? "", e.ip ?? ""].some((v) =>
          v.toLowerCase().includes(q),
        );
      });
    }
    if (dateFrom) {
      const t = new Date(dateFrom).getTime();
      out = out.filter((e) => new Date(e.occurredAt).getTime() >= t);
    }
    if (dateTo) {
      // include the full day
      const t = new Date(dateTo).getTime() + 86400 * 1000;
      out = out.filter((e) => new Date(e.occurredAt).getTime() <= t);
    }
    return out;
  }, [events, search, dateFrom, dateTo]);

  const columns: Column<TrackingEvent>[] = [
    {
      header: "When",
      cell: (r) => (
        <span
          className="text-xs text-ink-muted whitespace-nowrap"
          title={new Date(r.occurredAt).toLocaleString()}
        >
          {relativeTime(r.occurredAt)}
        </span>
      ),
    },
    { header: "Type", cell: (r) => <TypeBadge type={r.type} /> },
    {
      header: "Campaign",
      cell: (r) =>
        r.campaignId ? (
          <a
            href={`/crm/campaigns/${r.campaignId}`}
            className="text-brand-600 hover:text-brand-700 text-sm"
          >
            {campaignName(r.campaignId)}
          </a>
        ) : (
          <span className="text-ink-muted text-xs">Transactional</span>
        ),
    },
    {
      header: "Recipient",
      cell: (r) => (
        <span className="text-sm text-ink font-mono">
          {r.recipientEmail ?? r.toEmail ?? "—"}
        </span>
      ),
    },
    {
      header: "Target URL",
      cell: (r) =>
        r.targetUrl ? (
          <a
            href={r.targetUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-ink-soft hover:text-brand-700 truncate max-w-[240px] block"
            title={r.targetUrl}
          >
            {truncate(r.targetUrl, 40)}
          </a>
        ) : (
          <span className="text-ink-muted text-xs">—</span>
        ),
    },
    {
      header: "IP · UA",
      cell: (r) => (
        <div className="text-xs text-ink-muted max-w-[220px]">
          <div className="tabular-nums">{r.ip ?? "—"}</div>
          {r.userAgent && (
            <div className="truncate" title={r.userAgent}>
              {truncate(r.userAgent, 40)}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Tracking events"
        subtitle={`${events.length.toLocaleString()} event${events.length === 1 ? "" : "s"} — latest ${Math.min(events.length, 500).toLocaleString()} across all campaigns.`}
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing", href: "/admin/marketing" },
          { label: "Tracking events" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
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
          <Toast
            kind="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search recipient / URL / IP…",
          }}
          filters={
            <>
              <Segmented<TypeFilter>
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: "all", label: "All" },
                  ...TYPES.map((t) => ({ value: t, label: t })),
                ]}
              />
              <select
                className="input h-8 text-xs"
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
              >
                <option value="">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="input h-8 text-xs"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                title="From date"
              />
              <input
                type="date"
                className="input h-8 text-xs"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                title="To date"
              />
            </>
          }
          actions={<SavedViewsControls listKey="shell:admin-marketing-tracking-events" current={{ search, typeFilter, campaignFilter, dateFrom, dateTo }} onApply={(fv) => { setSearch(fv.search); setTypeFilter(fv.typeFilter); setCampaignFilter(fv.campaignFilter); setDateFrom(fv.dateFrom); setDateTo(fv.dateTo); }} />}
        />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.bar,
            title: "No tracking events",
            description:
              "Events show here after recipients open or click a campaign email, or when the provider reports a bounce/complaint.",
          }}
        />
      </div>
    </AppShell>
  );
}
