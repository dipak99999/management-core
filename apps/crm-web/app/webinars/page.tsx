"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

// Marketing P3 — list view for WebinarEvent. Filters on time (upcoming / past
// / all) and status; row-click opens the detail page. New-webinar action
// links to /webinars/new (dedicated create page, not a drawer, because the
// form has enough fields — provider select + start/end date+time + timezone
// + capacity + registration form pointer — to feel cramped in a drawer).

interface WebinarRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  provider: string;
  externalId: string | null;
  joinUrl: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  capacity: number | null;
  registerFormId: string | null;
  actualAttendees: number;
  registrationsCount: number;
  createdAt: string;
}

type WhenFilter = "all" | "upcoming" | "past";
type StatusFilter = "all" | "Draft" | "Scheduled" | "Live" | "Ended" | "Cancelled";

// Provider gets its own palette so operators can eyeball the mix at a glance
// (Zoom-blue, Webex-violet, GoogleMeet-amber, Manual-gray).
function ProviderBadge({ provider }: { provider: string }) {
  const cls =
    provider === "Zoom"
      ? "badge-blue"
      : provider === "Webex"
        ? "badge-violet"
        : provider === "GoogleMeet"
          ? "badge-amber"
          : "badge-gray";
  return <span className={cls}>{provider}</span>;
}

export default function WebinarsPage() {
  const [rows, setRows] = useState<WebinarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [whenFilter, setWhenFilter] = useState<WhenFilter>("upcoming");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      // Server-side "upcoming" flag lets Postgres do the date filter; we still
      // do client-side "past" filtering because the API only returns future
      // rows when upcoming=1.
      const path =
        whenFilter === "upcoming" ? "/webinars?upcoming=1" : "/webinars";
      setRows(await api.get<WebinarRow[]>(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // Reload whenever the time-window filter flips (server-side filter changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whenFilter]);

  useListPageCommands({
    singular: "Webinar",
    plural: "Webinars",
    newHref: "/crm/webinars/new",
    refresh: load,
  });
  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this webinar? This also removes the provider-side meeting."))
      return;
    try {
      await api.del(`/webinars/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  const now = Date.now();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((w) => {
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (
        whenFilter === "past" &&
        new Date(w.startAt).getTime() >= now
      )
        return false;
      if (
        q &&
        !`${w.name} ${w.description ?? ""} ${w.provider}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter, whenFilter, now]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      Draft: rows.filter((r) => r.status === "Draft").length,
      Scheduled: rows.filter((r) => r.status === "Scheduled").length,
      Live: rows.filter((r) => r.status === "Live").length,
      Ended: rows.filter((r) => r.status === "Ended").length,
      Cancelled: rows.filter((r) => r.status === "Cancelled").length,
    }),
    [rows],
  );

  const columns: Column<WebinarRow>[] = [
    {
      header: "Webinar",
      cell: (w) => (
        <div className="flex flex-col">
          <a
            href={`/crm/webinars/${w.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {w.name}
          </a>
          {w.description && (
            <span className="text-[11px] text-ink-muted truncate max-w-[320px]">
              {w.description}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Provider",
      cell: (w) => <ProviderBadge provider={w.provider} />,
    },
    {
      header: "Status",
      cell: (w) => <StatusBadge status={w.status} />,
    },
    {
      header: "Starts",
      cell: (w) => (
        <div className="flex flex-col">
          <span>{dateShort(w.startAt)}</span>
          <span className="text-[11px] text-ink-muted">{w.timezone}</span>
        </div>
      ),
    },
    {
      header: "Registered",
      align: "right",
      cell: (w) => {
        const cap = w.capacity ?? 0;
        const full = cap > 0 && w.registrationsCount >= cap;
        return (
          <span
            className={`tabular-nums ${full ? "text-red-700 font-medium" : "text-ink-soft"}`}
          >
            {w.registrationsCount}
            {cap > 0 ? ` / ${cap}` : ""}
          </span>
        );
      },
    },
    {
      header: "",
      align: "right",
      cell: (w) => (
        <div className="flex justify-end gap-2">
          <a
            href={`/crm/webinars/${w.id}`}
            onClick={(e) => e.stopPropagation()}
            className="btn-ghost btn-sm"
          >
            Open
          </a>
          <button
            onClick={(e) => remove(w.id, e)}
            className="btn-ghost btn-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Webinars" }]}
        title="Webinars"
        subtitle={
          rows.length > 0
            ? `${rows.length} webinar${rows.length === 1 ? "" : "s"}`
            : undefined
        }
        actions={
          <a href="/crm/webinars/new">
            <Button variant="brand" type="button">+ New webinar</Button>
          </a>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search webinar name, description or provider…",
        }}
        filters={
          <>
            <Segmented
              value={whenFilter}
              onChange={setWhenFilter}
              options={[
                { value: "upcoming", label: "Upcoming" },
                { value: "past", label: "Past" },
                { value: "all", label: "All" },
              ]}
        />
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "Draft", label: "Draft", count: counts.Draft },
                { value: "Scheduled", label: "Scheduled", count: counts.Scheduled },
                { value: "Live", label: "Live", count: counts.Live },
                { value: "Ended", label: "Ended", count: counts.Ended },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
            />
          </>
        }
        actions={<SavedViewsControls listKey="crm-web:webinars" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(w) => w.id}
        onRowClick={(w) => (window.location.href = `/crm/webinars/${w.id}`)}
        loading={loading}
        empty={{
          icon: Icon.calendar,
          title:
            search || statusFilter !== "all"
              ? "No matching webinars"
              : "No webinars yet",
          description:
            search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Schedule your first webinar — Zoom / Webex / Google Meet or manual (in-person).",
          action: !search && statusFilter === "all" && (
            <a href="/crm/webinars/new">
              <Button variant="brand" type="button">+ New webinar</Button>
            </a>
          ),
        }}
      />
    </main>
  );
}
