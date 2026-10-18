"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
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
import type { Activity } from "../../components/activity-timeline";

type TypeFilter = "all" | Activity["type"];
type StatusFilter = "all" | Activity["status"];

const TYPE_BADGE: Record<Activity["type"], string> = {
  Task: "badge-brand",
  Call: "badge-blue",
  Meeting: "badge-violet",
  Note: "badge-gray",
  Email: "badge-amber",
};

const PARENT_LINK_PREFIX: Record<string, string> = {
  Lead: "/crm/leads/",
  Opportunity: "/crm/opportunities/",
  Customer: "/accounting/customers/",
  SalesOrder: "/crm/sales-orders/",
  Quotation: "/crm/quotations/",
};

export default function ActivitiesPage() {
  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Open");
  const [search, setSearch] = useState("");
  const [myOnly, setMyOnly] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (typeFilter !== "all") qs.set("type", typeFilter);
      if (statusFilter !== "all") qs.set("status", statusFilter);
      qs.set("limit", "300");
      const rs = await api.get<Activity[]>(`/activities?${qs.toString()}`);
      setRows(rs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter]);

  useListPageCommands({
    singular: "Activity",
    plural: "Activities",
    refresh: load,
  });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) list = list.filter((r) => r.subject.toLowerCase().includes(q));
    return list;
  }, [rows, search]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      Task: rows.filter((r) => r.type === "Task").length,
      Call: rows.filter((r) => r.type === "Call").length,
      Meeting: rows.filter((r) => r.type === "Meeting").length,
      Note: rows.filter((r) => r.type === "Note").length,
      Email: rows.filter((r) => r.type === "Email").length,
    }),
    [rows],
  );

  async function toggle(row: Activity) {
    const action = row.status === "Completed" ? "reopen" : "complete";
    await api.post(`/activities/${row.id}/${action}`, {});
    await load();
  }

  const columns: Column<Activity>[] = [
    {
      header: "Type",
      cell: (r) => <span className={TYPE_BADGE[r.type]}>{r.type}</span>,
    },
    {
      header: "Subject",
      cell: (r) => (
        <div className="min-w-0">
          <div className={`font-medium truncate ${r.status === "Completed" ? "line-through text-ink-muted" : "text-ink"}`}>
            {r.subject}
          </div>
          {r.description && (
            <div className="text-xs text-ink-muted truncate">{r.description}</div>
          )}
        </div>
      ),
    },
    {
      header: "Related to",
      cell: (r) => {
        const prefix = PARENT_LINK_PREFIX[r.parentType];
        const label = `${r.parentType} · ${r.parentId.slice(0, 8)}`;
        return prefix ? (
          <a
            href={`${prefix}${r.parentId}`}
            className="text-brand-600 hover:underline text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {label}
          </a>
        ) : (
          <span className="text-ink-soft text-sm">{label}</span>
        );
      },
    },
    {
      header: "Due / When",
      cell: (r) => (
        <span className="text-ink-soft text-sm">
          {dateShort(r.dueDate ?? r.startAt)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.type !== "Note" && r.type !== "Email" ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(r); }}
            className="text-xs text-brand-600 hover:underline"
          >
            {r.status === "Completed" ? "Reopen" : "Complete"}
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Activities"
        subtitle={`${counts.Task} tasks · ${counts.Call} calls · ${counts.Meeting} meetings · ${counts.Note + counts.Email} notes/emails`}
        actions={
          <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={myOnly}
              onChange={(e) => setMyOnly(e.target.checked)}
              className="rounded"
            />
            My activities
          </label>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search subject…" }}
          filters={
            <div className="flex items-center gap-2 flex-wrap">
              <Segmented
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: "all",     label: "All",     count: counts.all },
                  { value: "Task",    label: "Tasks",   count: counts.Task },
                  { value: "Call",    label: "Calls",   count: counts.Call },
                  { value: "Meeting", label: "Meetings", count: counts.Meeting },
                  { value: "Note",    label: "Notes",   count: counts.Note },
                  { value: "Email",   label: "Emails",  count: counts.Email },
                ]}
              />
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "Open",      label: "Open" },
                  { value: "Completed", label: "Completed" },
                  { value: "all",       label: "All" },
                ]}
              />
            </div>
          }
          actions={<SavedViewsControls listKey="crm-web:activities" current={{ search, typeFilter, statusFilter }} onApply={(fv) => { setSearch(fv.search); setTypeFilter(fv.typeFilter); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search ? "No matching activities" : "No activities yet",
            description: search
              ? "Try a different search term."
              : "Log calls, tasks, and meetings from any CRM record — they'll show up here.",
          }}
        />
      </div>
    </>
  );
}
