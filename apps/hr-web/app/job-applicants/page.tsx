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
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { KanbanBoard, type KanbanColumn } from "../../components/kanban";

interface Applicant {
  id: string;
  name: string;
  applicantName: string;
  email: string | null;
  mobile: string | null;
  source: string | null;
  status: string;
  jobOpeningId: string | null;
  jobOpening?: { title: string } | null;
}

type StatusFilter = "all" | "New" | "Shortlisted" | "Interviewing" | "Offer" | "Hired" | "Rejected" | "Withdrawn";
type ViewMode = "kanban" | "list";

// Seven pipeline stages. Terminal states (Hired/Rejected/Withdrawn) get muted
// accents since work-in-progress cards are what the recruiter cares about.
const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: "New",          label: "New",          accent: "bg-blue-500" },
  { status: "Shortlisted",  label: "Shortlisted",  accent: "bg-cyan-500" },
  { status: "Interviewing", label: "Interviewing", accent: "bg-amber-500" },
  { status: "Offer",        label: "Offer",        accent: "bg-violet-500" },
  { status: "Hired",        label: "Hired",        accent: "bg-green-500" },
  { status: "Rejected",     label: "Rejected",     accent: "bg-red-500" },
  { status: "Withdrawn",    label: "Withdrawn",    accent: "bg-ink-muted/40" },
];

export default function JobApplicantsPage() {
  const [rows, setRows] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("kanban");

  async function load() {
    setLoading(true);
    try {
      // Kanban shows all statuses at once — only the list view narrows by
      // status. Requesting all rows for kanban avoids one round-trip per
      // column filter change.
      const qs = view === "list" && statusFilter !== "all"
        ? `?status=${encodeURIComponent(statusFilter)}`
        : "";
      setRows(await api.get<Applicant[]>(`/job-applicants${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, view]);

  useListPageCommands({
    singular: "Job Applicant",
    plural: "Job Applicants",
    refresh: load,
  });
  // Drag between pipeline columns → POST /set-status. Optimistic; rolls back
  // on error. The set-status endpoint is dedicated (not generic PUT) so it
  // can enforce transition rules server-side later.
  async function moveCard(row: Applicant, newStatus: string) {
    if (row.status === newStatus) return;
    const prev = rows;
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)),
    );
    try {
      await api.post(`/job-applicants/${row.id}/set-status`, { status: newStatus });
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Move failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.applicantName, r.email, r.source, r.jobOpening?.title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Applicant>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/hr/job-applicants/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Applicant", cell: (r) => <span className="font-medium text-ink">{r.applicantName}</span> },
    { header: "Email",     cell: (r) => <span className="text-ink-soft">{r.email ?? "—"}</span> },
    { header: "Source",    cell: (r) => <span className="text-ink-soft">{r.source ?? "—"}</span> },
    { header: "Opening",   cell: (r) => <span className="text-ink-soft">{r.jobOpening?.title ?? "—"}</span> },
    { header: "Status",    cell: (r) => <StatusBadge status={r.status} /> },
  ];

  const STATUSES: StatusFilter[] = ["all", "New", "Shortlisted", "Interviewing", "Offer", "Hired", "Rejected", "Withdrawn"];

  return (
    <>
      <PageHeader
        title="Job Applicants"
        subtitle={`${rows.length} applicant${rows.length === 1 ? "" : "s"}`}
        actions={<a href="/hr/job-openings" className="btn-secondary">← Openings</a>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search name, email, source…" }}
          filters={
            view === "list" ? (
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUSES.map((s) => ({ value: s, label: s === "all" ? "All" : s }))}
              />
            ) : null
          }
          actions={
            <>
              <Segmented<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { value: "kanban", label: "Kanban" },
                  { value: "list", label: "List" },
                ]}
              />
              <SavedViewsControls
                listKey="hr-web:job-applicants"
                current={{ search, statusFilter }}
                onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }}
              />
            </>
          }
        />
        {view === "kanban" ? (
          <KanbanBoard<Applicant>
            columns={KANBAN_COLUMNS}
            rows={filtered}
            getStatus={(r) => r.status}
            rowKey={(r) => r.id}
            onMoveCard={moveCard}
            loading={loading}
            emptyMessage={
              search
                ? "No applicants match your search."
                : "No applicants yet — they'll appear here as they apply."
            }
            renderCard={(r) => (
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={`/hr/job-applicants/${r.id}`}
                    className="font-mono text-[11px] text-brand-600 hover:text-brand-700"
                    onClick={(e) => e.stopPropagation()}
                    draggable={false}
                  >
                    {r.name}
                  </a>
                  {r.source && <span className="badge-gray">{r.source}</span>}
                </div>
                <div className="font-medium text-ink truncate">{r.applicantName}</div>
                {r.jobOpening?.title && (
                  <div className="text-[11px] text-ink-muted truncate">
                    {r.jobOpening.title}
                  </div>
                )}
                {r.email && (
                  <div className="text-[11px] text-ink-soft truncate">{r.email}</div>
                )}
              </div>
            )}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => (window.location.href = `/hr/job-applicants/${r.id}`)}
            loading={loading}
            empty={{
              icon: Icon.users,
              title: search || statusFilter !== "all" ? "No matching applicants" : "No applicants yet",
              description: search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Applicants will appear here as they apply to your openings.",
            }}
          />
        )}
      </div>
    </>
  );
}
