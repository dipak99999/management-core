"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface HolidayList {
  id: string;
  name: string;
  fromDate: string;
  toDate: string;
  weeklyOffDay: string | null;
  _count: { holidays: number };
}

export default function HolidayListsPage() {
  const [rows, setRows] = useState<HolidayList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<HolidayList[]>("/holiday-lists"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Holiday List",
    plural: "Holiday Lists",
    newHref: "/hr/holiday-lists/new",
    refresh: load,
  });
  async function setDefault(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    setMsg(null);
    try {
      await api.post(`/holiday-lists/${id}/set-default`, {});
      setMsg("Set as tenant default");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<HolidayList>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/hr/holiday-lists/${r.id}`}
          className="font-medium text-ink hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "From", cell: (r) => <span className="text-ink-soft">{dateShort(r.fromDate)}</span> },
    { header: "To",   cell: (r) => <span className="text-ink-soft">{dateShort(r.toDate)}</span> },
    { header: "Weekly Off", cell: (r) => <span className="text-ink-soft">{r.weeklyOffDay ?? "—"}</span> },
    {
      header: "Holidays",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink">{r._count.holidays}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button onClick={(e) => setDefault(r.id, e)} className="btn-ghost btn-sm">Set as default</button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Holiday Lists"
        subtitle={`${rows.length} list${rows.length === 1 ? "" : "s"}`}
        actions={<a href="/hr/holiday-lists/new" className="btn-brand">+ New holiday list</a>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search holiday lists…" }}
          actions={<SavedViewsControls listKey="hr-web:holiday-lists" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/hr/holiday-lists/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.calendar,
            title: search ? "No matches" : "No holiday lists yet",
            description: search ? "Try a different search term." : "Create a list to define company holidays.",
            action: !search && (
              <a href="/hr/holiday-lists/new" className="btn-brand">+ New holiday list</a>
            ),
          }}
        />
      </div>
    </>
  );
}
