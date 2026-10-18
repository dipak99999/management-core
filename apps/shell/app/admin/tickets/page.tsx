"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { useT } from "@lumaara/web-i18n";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
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

interface Ticket {
  id: string;
  name: string;
  subject: string;
  status: string;
  priority: string;
  partyType: string;
  partyId: string;
  createdAt: string;
  updatedAt: string;
  portalUser: { email: string; displayName: string | null };
  _count: { replies: number };
}

type StatusFilter = "Open" | "Answered" | "Closed" | "All";

export default function StaffTicketsPage() {
  // `t` is already the Ticket row inside cell callbacks below; use `tr`
  // to avoid shadowing.
  const tr = useT();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Open");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = statusFilter && statusFilter !== "All" ? `?status=${statusFilter}` : "";
      setRows(await dashboardApi.get<Ticket[]>(`/staff-tickets${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  useListPageCommands({
    singular: "Ticket",
    plural: "Tickets",
    refresh: load,
  });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.subject, r.portalUser.email, r.portalUser.displayName ?? ""]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Ticket>[] = [
    {
      header: "Ticket",
      cell: (t) => <span className="font-mono text-sm text-brand-600">{t.name}</span>,
    },
    { header: "Subject", cell: (t) => <span className="text-ink font-medium">{t.subject}</span> },
    {
      header: "From",
      cell: (t) => (
        <div>
          <div className="text-ink">{t.portalUser.displayName ?? t.portalUser.email}</div>
          <div className="text-xs text-ink-muted">{t.partyType} · {t.portalUser.email}</div>
        </div>
      ),
    },
    { header: tr("Priority"), cell: (t) => <span className="text-xs text-ink-soft">{tr(t.priority)}</span> },
    { header: tr("Status"), cell: (t) => <StatusBadge status={t.status} /> },
    {
      header: "Replies",
      align: "right",
      cell: (t) => <span className="tabular-nums text-ink-soft">{t._count.replies}</span>,
    },
    { header: "Updated", cell: (t) => <span className="text-xs text-ink-muted">{relativeTime(t.updatedAt)}</span> },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Portal Tickets"
        subtitle={`${rows.length} ${statusFilter.toLowerCase()} ticket${rows.length === 1 ? "" : "s"}`}
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Support" }]}
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search tickets…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "Open",     label: tr("Open") },
                { value: "Answered", label: "Answered" },
                { value: "Closed",   label: "Closed" },
                { value: "All",      label: tr("All") },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="shell:admin-tickets" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(t) => t.id}
          onRowClick={(t) => (window.location.href = `/admin/tickets/${t.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search ? "No matches" : "No tickets",
            description: search
              ? "Try a different search term."
              : `No ${statusFilter === "All" ? "" : statusFilter.toLowerCase() + " "}tickets right now.`,
          }}
        />
      </div>
    </AppShell>
  );
}
