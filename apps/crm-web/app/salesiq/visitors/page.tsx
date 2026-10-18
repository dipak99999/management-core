"use client";

import { useCallback, useEffect, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  relativeTime,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

// Live visitor tracker — Zoho-style "who's on the site right now". Polls
// every 5s. Rows link to a stub per-visitor detail page.

interface Visitor {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
  currentUrl: string | null;
  pageCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "Active" | "Idle" | "Chatting" | "Away";
  linkedLeadId: string | null;
}

type StatusFilter = "all" | "Active" | "Chatting" | "Idle";

export default function LiveVisitorsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Visitor[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("Active");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      setRows(await api.get<Visitor[]>(`/siq/visitors${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load visitors");
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useListPageCommands({
    singular: "Visitor",
    plural: "Visitors",
    refresh: load,
  });

  const columns: Column<Visitor>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className="font-medium text-ink">
          {r.displayName || "Anonymous"}
        </span>
      ),
    },
    {
      header: "Email",
      cell: (r) => (
        <span className="text-sm text-ink-soft">{r.email || "—"}</span>
      ),
    },
    {
      header: "Location",
      cell: (r) => {
        const parts = [r.country, r.city].filter(Boolean);
        return (
          <span className="text-sm text-ink-soft">
            {parts.length ? parts.join(" · ") : "—"}
          </span>
        );
      },
    },
    {
      header: "Current page",
      cell: (r) => (
        <span
          className="text-xs text-ink-muted truncate block max-w-[260px]"
          title={r.currentUrl ?? ""}
        >
          {r.currentUrl || "—"}
        </span>
      ),
    },
    {
      header: "Pages",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">{r.pageCount}</span>
      ),
    },
    {
      header: "Last seen",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {relativeTime(r.lastSeenAt)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Live Visitors"
        subtitle={
          <span>
            {rows.length} visitor{rows.length === 1 ? "" : "s"} in view
          </span>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          filters={
            <Segmented<StatusFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "Active", label: "Active" },
                { value: "Chatting", label: "Chatting" },
                { value: "Idle", label: "Idle" },
                { value: "all", label: "All" },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="crm-web:salesiq-visitors" current={{ filter }} onApply={(fv) => { setFilter(fv.filter); }} />}
        />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/crm/salesiq/visitors/${r.id}`)}
          empty={{
            icon: Icon.users,
            title: "No visitors on the site",
            description:
              "Visitors will appear here as soon as the SalesIQ widget loads on any page.",
          }}
        />
      </div>
    </>
  );
}
