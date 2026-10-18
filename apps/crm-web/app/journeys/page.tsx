"use client";

// Journeys list — mirrors the sequences list layout: PageHeader + FilterBar
// (search + status Segmented) + DataTable. Clicking a row navigates to the
// detail/builder page. Backend endpoint: GET /journeys.

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
  relativeTime,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Journey {
  id: string;
  name: string;
  description: string | null;
  status: "Draft" | "Active" | "Paused" | "Archived";
  triggerType: string;
  totalEnrolled: number;
  totalCompleted: number;
  totalFailed: number;
  updatedAt: string;
}

type StatusFilter = "all" | "Draft" | "Active" | "Paused" | "Archived";

const TRIGGER_LABEL: Record<string, string> = {
  Manual: "Manual",
  ListAdd: "On list add",
  LeadCreated: "On lead created",
  FormSubmit: "On form submit",
  TagAdded: "On tag added",
  ScheduledDate: "Scheduled date",
};

export default function JourneysPage() {
  const [rows, setRows] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Journey[]>("/journeys"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Journey",
    plural: "Journeys",
    newHref: "/crm/journeys/new",
    refresh: load,
  });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((j) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (q && !`${j.name} ${j.description ?? ""} ${j.triggerType}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      Draft: rows.filter((r) => r.status === "Draft").length,
      Active: rows.filter((r) => r.status === "Active").length,
      Paused: rows.filter((r) => r.status === "Paused").length,
      Archived: rows.filter((r) => r.status === "Archived").length,
    }),
    [rows],
  );

  const columns: Column<Journey>[] = [
    {
      header: "Journey",
      cell: (j) => (
        <div className="flex flex-col">
          <a
            href={`/crm/journeys/${j.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {j.name}
          </a>
          {j.description && (
            <span className="text-xs text-ink-muted truncate max-w-[320px]">
              {j.description}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Trigger",
      cell: (j) => (
        <span className="badge-blue">{TRIGGER_LABEL[j.triggerType] ?? j.triggerType}</span>
      ),
    },
    { header: "Status", cell: (j) => <StatusBadge status={j.status} /> },
    {
      header: "Enrolled",
      align: "right",
      cell: (j) => (
        <span className="tabular-nums font-medium text-ink">{j.totalEnrolled ?? 0}</span>
      ),
    },
    {
      header: "Completed",
      align: "right",
      cell: (j) => (
        <span className="tabular-nums text-ink-soft">{j.totalCompleted ?? 0}</span>
      ),
    },
    {
      header: "Failed",
      align: "right",
      cell: (j) => (
        <span
          className={`tabular-nums ${(j.totalFailed ?? 0) > 0 ? "text-red-700 font-medium" : "text-ink-soft"}`}
        >
          {j.totalFailed ?? 0}
        </span>
      ),
    },
    {
      header: "Updated",
      cell: (j) => <span className="text-xs text-ink-muted">{relativeTime(j.updatedAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Journeys"
        subtitle={`${rows.length} journey${rows.length === 1 ? "" : "s"}`}
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Journeys" },
        ]}
        actions={
          <a href="/crm/journeys/new">
            <Button variant="brand" type="button">+ New journey</Button>
          </a>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search journey name, description, or trigger…",
          }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "Draft", label: "Draft", count: counts.Draft },
                { value: "Active", label: "Active", count: counts.Active },
                { value: "Paused", label: "Paused", count: counts.Paused },
                { value: "Archived", label: "Archived", count: counts.Archived },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="crm-web:journeys" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(j) => j.id}
          onRowClick={(j) => (window.location.href = `/crm/journeys/${j.id}`)}
          loading={loading}
          empty={{
            icon: Icon.send,
            title:
              search || statusFilter !== "all"
                ? "No matching journeys"
                : "No journeys yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Build a multi-step visual automation to nurture contacts over time.",
            action: !search && statusFilter === "all" && (
              <a href="/crm/journeys/new">
                <Button variant="brand" type="button">+ New journey</Button>
              </a>
            ),
          }}
        />
      </div>
    </>
  );
}
