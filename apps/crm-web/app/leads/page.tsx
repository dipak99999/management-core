"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  type Column,
} from "../../components/ui";
import {
  AiDraftForm,
  SavedViewsMenu,
  Tour,
  useListPageCommands,
  useOptionalUIBackends,
  useRealtimeList,
  useSavedViews,
  type TourStep,
} from "@lumaara/web-ui";
import { Icon } from "../../components/app-shell";
import { authApi } from "../../lib/auth-api";
import { KanbanBoard, type KanbanColumn } from "../../components/kanban";
import { BulkActionBar, SelectCell, SelectAllHeader } from "../../components/bulk-action-bar";
import { ScanCardButton } from "../../components/scan-card-button";

interface Lead {
  id: string;
  name: string;
  leadName: string;
  companyName: string | null;
  email: string | null;
  mobile: string | null;
  status: string;
  source: string | null;
  convertedCustomerId: string | null;
}

const emptyForm = {
  leadName: "",
  companyName: "",
  email: "",
  mobile: "",
  source: "",
  status: "Open",
};

type StatusFilter = "all" | "Open" | "Contacted" | "Interested" | "Converted" | "Lost";
type ViewMode = "kanban" | "list";

// Five kanban columns for Leads. Colors mirror the StatusBadge palette so a
// lead in "Converted" looks green on both the list and board.
const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: "Open",       label: "Open",       accent: "bg-blue-500" },
  { status: "Contacted",  label: "Contacted",  accent: "bg-amber-500" },
  { status: "Interested", label: "Interested", accent: "bg-violet-500" },
  { status: "Converted",  label: "Converted",  accent: "bg-green-500" },
  { status: "Lost",       label: "Lost",       accent: "bg-red-500" },
];

export default function LeadsPage() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("kanban");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Lead[]>("/leads"));
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
    singular: "Lead",
    plural: "Leads",
    newHref: "/crm/leads/new",
    refresh: load,
  });

  useRealtimeList("lead", load);

  const backends = useOptionalUIBackends();
  const views = useSavedViews<{ search: string; statusFilter: StatusFilter }>(
    "crm-web:leads",
    backends?.views,
  );

  const tourSteps: TourStep[] = [
    { target: "[data-tour=crm-leads-v1-header]", title: "Leads", body: "This is where you manage leads. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=crm-leads-v1-new]", title: "Create a new lead", body: "Click here to add your first lead. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=crm-leads-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/leads", form);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    }
  }

  function close() {
    setForm(emptyForm);
    setShowForm(false);
  }

  async function convert(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Convert this lead to a Customer? This can't be undone.")) return;
    setError(null);
    try {
      await api.post(`/leads/${id}/convert`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
    }
  }

  // Drag-and-drop between kanban columns. Optimistic — snap the card to the
  // new column immediately, then PUT the status change. Rollback on failure
  // (e.g. an API error, permission denied) with a toast so the user sees why.
  async function moveCard(row: Lead, newStatus: string) {
    // Convert & Lost are terminal-ish states that touch other records; we
    // route those through the existing /convert endpoint (or leave a Toast for
    // Convert since it needs confirmation). Simple status transitions go
    // through PUT.
    if (row.status === newStatus) return;
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)));
    try {
      await api.put(`/leads/${row.id}`, { status: newStatus });
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Move failed — status not updated");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (
        q &&
        ![l.name, l.leadName, l.companyName, l.email, l.mobile]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      Open: rows.filter((r) => r.status === "Open").length,
      Contacted: rows.filter((r) => r.status === "Contacted").length,
      Interested: rows.filter((r) => r.status === "Interested").length,
      Converted: rows.filter((r) => r.status === "Converted").length,
      Lost: rows.filter((r) => r.status === "Lost").length,
    }),
    [rows],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const allSelected = filtered.length > 0 && filtered.every((l) => selectedIds.has(l.id));
  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(filtered.map((l) => l.id)) : new Set());
  }
  async function bulkMarkLost() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Mark ${ids.length} lead${ids.length === 1 ? "" : "s"} as Lost? You can reopen individually later.`)) return;
    setBulkBusy(true);
    for (const id of ids) {
      try { await api.put(`/leads/${id}`, { status: "Lost" }); }
      catch { /* keep going */ }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    await load();
  }

  const columns: Column<Lead>[] = [
    {
      header: <SelectAllHeader allSelected={allSelected} onToggleAll={toggleAll} />,
      width: "36px",
      sortable: false,
      cell: (l) => (
        <SelectCell row={l} rowKey={(r) => r.id} selectedIds={selectedIds} onToggle={toggleOne} />
      ),
    },
    {
      header: "Lead",
      cell: (l) => (
        <a
          href={`/crm/leads/${l.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {l.name}
        </a>
      ),
    },
    {
      header: "Person / Company",
      cell: (l) => (
        <div>
          <div className="font-medium text-ink">{l.leadName}</div>
          {l.companyName && <div className="text-xs text-ink-muted">{l.companyName}</div>}
        </div>
      ),
    },
    {
      header: "Contact",
      cell: (l) => (
        <div className="text-sm">
          {l.email && <div className="text-ink-soft">{l.email}</div>}
          {l.mobile && <div className="text-ink-muted">{l.mobile}</div>}
          {!l.email && !l.mobile && <span className="text-ink-muted">—</span>}
        </div>
      ),
    },
    {
      header: "Source",
      cell: (l) => <span className="text-ink-soft">{l.source ?? "—"}</span>,
    },
    {
      header: "Status",
      cell: (l) => <StatusBadge status={l.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (l) =>
        l.status !== "Converted" && l.status !== "Lost" ? (
          <button onClick={(e) => convert(l.id, e)} className="btn-ghost btn-sm">
            Convert to Customer
          </button>
        ) : null,
    },
  ];

  // Kanban card renderer — dense but scannable. We put the identifier + source
  // badge on top, name + company in the middle, contact hints below, and hide
  // the "Convert to Customer" action inside the card only for eligible leads
  // (so users don't lose that flow when kanban is the default view).
  function renderCard(l: Lead) {
    const canConvert = l.status !== "Converted" && l.status !== "Lost";
    return (
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <a
            href={`/crm/leads/${l.id}`}
            className="font-mono text-[11px] text-brand-600 hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          >
            {l.name}
          </a>
          {l.source && <span className="badge-gray">{l.source}</span>}
        </div>
        <div className="font-medium text-ink truncate">{l.leadName}</div>
        {l.companyName && (
          <div className="text-[11px] text-ink-muted truncate">{l.companyName}</div>
        )}
        {l.email && (
          <div className="text-[11px] text-ink-soft truncate">{l.email}</div>
        )}
        {canConvert && (
          <div className="pt-1.5 border-t border-ink-muted/10 mt-2 flex justify-end">
            <button
              onClick={(e) => convert(l.id, e)}
              className="text-[11px] text-brand-600 hover:text-brand-700 font-medium"
              // Prevent the drag handler on the parent from starting when a
              // user clicks the button. Otherwise a mousedown-then-click gets
              // swallowed by drag-start.
              onMouseDown={(e) => e.stopPropagation()}
              draggable={false}
            >
              Convert to Customer →
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Tour id="crm-web.leads.v1" steps={tourSteps} />
      <div data-tour="crm-leads-v1-header">
      <PageHeader
        title="Leads"
        subtitle={`${rows.length} lead${rows.length === 1 ? "" : "s"}`}
        actions={
          <>
            <ScanCardButton onCreated={load} />
            <Button variant="brand" onClick={() => setShowForm(true)}>
              + New lead
            </Button>
          </>
        }
      />
      </div>

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <BulkActionBar
        count={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          { label: "Mark Lost", onClick: bulkMarkLost, busy: bulkBusy, danger: true },
        ]}
      />

      <div className="space-y-4">
        <div data-tour="crm-leads-v1-filter">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search name, company, email…",
          }}
          filters={
            view === "list" ? (
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "Open", label: "Open", count: counts.Open },
                  { value: "Contacted", label: "Contacted", count: counts.Contacted },
                  { value: "Interested", label: "Interested", count: counts.Interested },
                  { value: "Converted", label: "Converted", count: counts.Converted },
                  { value: "Lost", label: "Lost", count: counts.Lost },
                ]}
              />
            ) : null
          }
          actions={
            <>
              <SavedViewsMenu
                controller={views}
                currentFilters={{ search, statusFilter }}
                onApply={(f) => {
                  setSearch(f.search);
                  setStatusFilter(f.statusFilter);
                }}
              />
              <Segmented<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { value: "kanban", label: "Kanban" },
                  { value: "list", label: "List" },
                ]}
              />
            </>
          }
        />
        </div>

        {view === "kanban" ? (
          <KanbanBoard<Lead>
            columns={KANBAN_COLUMNS}
            rows={filtered}
            getStatus={(l) => l.status}
            rowKey={(l) => l.id}
            renderCard={renderCard}
            onMoveCard={moveCard}
            loading={loading}
            emptyMessage={
              search
                ? "No leads match your search."
                : "No leads yet — capture your first lead to kick off the sales cycle."
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(l) => l.id}
            onRowClick={(l) => (window.location.href = `/crm/leads/${l.id}`)}
            loading={loading}
            empty={{
              icon: Icon.users,
              title: search || statusFilter !== "all" ? "No matching leads" : "No leads yet",
              description:
                search || statusFilter !== "all"
                  ? "Try changing your search or filter."
                  : "Capture your first lead to kick off the sales cycle.",
              action: !search && statusFilter === "all" && (
                <Button variant="brand" onClick={() => setShowForm(true)}>
                  + Add lead
                </Button>
              ),
            }}
          />
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title="New lead"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>
              Create lead
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <AiDraftForm
            scope="crm-web:lead-draft"
            doctypeHint="New sales lead. Fields: leadName (person name), companyName, email, mobile, source. Status defaults to Open."
            placeholder="/ai John Smith from Acme Industries, cold outreach"
            fields={["leadName", "companyName", "email", "mobile", "source"]}
            before={{
              leadName: form.leadName || null,
              companyName: form.companyName || null,
              email: form.email || null,
              mobile: form.mobile || null,
              source: form.source || null,
            }}
            post={(path, body) => authApi.post(path, body)}
            apply={(rows) => {
              setForm((cur) => {
                const next = { ...cur };
                for (const r of rows) {
                  const v = (r.after ?? "") as string;
                  if (r.field === "leadName") next.leadName = v;
                  if (r.field === "companyName") next.companyName = v;
                  if (r.field === "email") next.email = v;
                  if (r.field === "mobile") next.mobile = v;
                  if (r.field === "source") next.source = v;
                }
                return next;
              });
            }}
          />
          <FormField label="Person name" required>
            <input
              className="input"
              placeholder="Jane Doe"
              value={form.leadName}
              onChange={(e) => setForm({ ...form, leadName: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Company name">
            <input
              className="input"
              placeholder="Optional"
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email">
              <input
                className="input"
                type="email"
                placeholder="jane@acme.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </FormField>
            <FormField label="Mobile">
              <input
                className="input"
                placeholder="+91 90000 00000"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Source">
              <input
                className="input"
                placeholder="Website, Referral…"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
            </FormField>
            <FormField label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option>Open</option>
                <option>Contacted</option>
                <option>Interested</option>
                <option>Lost</option>
              </select>
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
