"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealtimeList } from "@lumaara/web-ui";
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
  dateShort,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { KanbanBoard, type KanbanColumn } from "../../components/kanban";

interface Opp {
  id: string;
  name: string;
  partyType: string;
  expectedAmount: string;
  expectedCloseDate: string | null;
  status: string;
  source: string | null;
  lead: { name: string; leadName: string } | null;
  customer: { customerName: string } | null;
}
interface Lead {
  id: string;
  name: string;
  leadName: string;
  status: string;
}
interface Customer {
  id: string;
  customerName: string;
}

type StatusFilter = "all" | "Open" | "Quotation" | "Converted" | "Lost";
type ViewMode = "kanban" | "list";

// The four kanban columns for opportunities. Colors track the StatusBadge
// palette (blue = Open, amber = in-progress/Quotation, green = won, red = lost)
// so board columns and inline badges stay visually consistent.
const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: "Open",       label: "Open",       accent: "bg-blue-500" },
  { status: "Quotation",  label: "Quotation",  accent: "bg-amber-500" },
  { status: "Converted",  label: "Converted",  accent: "bg-green-500" },
  { status: "Lost",       label: "Lost",       accent: "bg-red-500" },
];

export default function OpportunitiesPage() {
  const [rows, setRows] = useState<Opp[]>([]);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [partyType, setPartyType] = useState<"Lead" | "Customer">("Lead");
  const [partyId, setPartyId] = useState("");
  const [expectedAmount, setExpectedAmount] = useState(0);
  const [expectedCloseDate, setCloseDate] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("kanban");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Opp[]>("/opportunities"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api
      .get<Lead[]>("/leads")
      .then((rs) => setLeads(rs.filter((l) => l.status !== "Converted" && l.status !== "Lost")))
      .catch(() => {});
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
  }, []);
  useRealtimeList("opportunity", load);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/opportunities", {
        partyType,
        leadId: partyType === "Lead" ? partyId : undefined,
        customerId: partyType === "Customer" ? partyId : undefined,
        expectedAmount,
        expectedCloseDate: expectedCloseDate
          ? new Date(expectedCloseDate).toISOString()
          : undefined,
        source: source || undefined,
      });
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function close() {
    setPartyId("");
    setExpectedAmount(0);
    setCloseDate("");
    setSource("");
    setShowForm(false);
  }

  // Drag-and-drop between columns. Optimistically flip the row's status in
  // local state (so the card jumps to the new column instantly), then PUT.
  // If the API rejects, restore the previous state and surface a Toast so the
  // user knows the move didn't stick.
  async function moveCard(row: Opp, newStatus: string) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)));
    try {
      await api.put(`/opportunities/${row.id}`, { status: newStatus });
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Move failed — status not updated");
    }
  }

  const parties = partyType === "Lead" ? leads : customers;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      const label =
        o.customer?.customerName ?? (o.lead ? `${o.lead.name} ${o.lead.leadName}` : "");
      if (q && !`${o.name} ${label}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      Open: rows.filter((r) => r.status === "Open").length,
      Quotation: rows.filter((r) => r.status === "Quotation").length,
      Converted: rows.filter((r) => r.status === "Converted").length,
      Lost: rows.filter((r) => r.status === "Lost").length,
    }),
    [rows],
  );

  const pipelineValue = useMemo(
    () =>
      rows
        .filter((r) => r.status === "Open")
        .reduce((s, r) => s + Number(r.expectedAmount ?? 0), 0),
    [rows],
  );

  const columns: Column<Opp>[] = [
    {
      header: "Opportunity",
      cell: (o) => (
        <a
          href={`/crm/opportunities/${o.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {o.name}
        </a>
      ),
    },
    {
      header: "Party",
      cell: (o) => (
        <span className="font-medium text-ink">
          {o.customer?.customerName ??
            (o.lead ? `${o.lead.name} — ${o.lead.leadName}` : "—")}
        </span>
      ),
    },
    {
      header: "Expected",
      align: "right",
      cell: (o) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(o.expectedAmount))}
        </span>
      ),
    },
    {
      header: "Close date",
      cell: (o) => <span className="text-ink-soft">{dateShort(o.expectedCloseDate)}</span>,
    },
    {
      header: "Source",
      cell: (o) => <span className="text-ink-soft">{o.source ?? "—"}</span>,
    },
    {
      header: "Status",
      cell: (o) => <StatusBadge status={o.status} />,
    },
  ];

  function renderCard(o: Opp) {
    const partyLabel =
      o.customer?.customerName ?? (o.lead ? o.lead.leadName : "—");
    return (
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <a
            href={`/crm/opportunities/${o.id}`}
            className="font-mono text-[11px] text-brand-600 hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          >
            {o.name}
          </a>
          <span className="tabular-nums font-semibold text-ink text-sm">
            {money(Number(o.expectedAmount))}
          </span>
        </div>
        <div className="font-medium text-ink truncate">{partyLabel}</div>
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>{dateShort(o.expectedCloseDate)}</span>
          {o.source && <span className="badge-gray">{o.source}</span>}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Opportunities"
        subtitle={
          pipelineValue > 0
            ? `${money(pipelineValue)} pipeline across ${counts.Open} open opportunit${counts.Open === 1 ? "y" : "ies"}`
            : `${rows.length} opportunit${rows.length === 1 ? "y" : "ies"}`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New opportunity
          </Button>
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
            placeholder: "Search opportunity # or party…",
          }}
          filters={
            view === "list" ? (
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "Open", label: "Open", count: counts.Open },
                  { value: "Quotation", label: "Quotation", count: counts.Quotation },
                  { value: "Converted", label: "Converted", count: counts.Converted },
                  { value: "Lost", label: "Lost", count: counts.Lost },
                ]}
              />
            ) : null
          }
          actions={
            <Segmented<ViewMode>
              value={view}
              onChange={setView}
              options={[
                { value: "kanban", label: "Kanban" },
                { value: "list", label: "List" },
              ]}
            />
          }
        />

        {view === "kanban" ? (
          <KanbanBoard<Opp>
            columns={KANBAN_COLUMNS}
            rows={filtered}
            getStatus={(o) => o.status}
            rowKey={(o) => o.id}
            renderCard={renderCard}
            aggregate={(o) => Number(o.expectedAmount ?? 0)}
            formatAggregate={(t) => money(t)}
            onMoveCard={moveCard}
            loading={loading}
            emptyMessage={
              search
                ? "No opportunities match your search."
                : "No opportunities yet — create one to start tracking your pipeline."
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(o) => o.id}
            onRowClick={(o) => (window.location.href = `/crm/opportunities/${o.id}`)}
            loading={loading}
            empty={{
              icon: Icon.target,
              title:
                search || statusFilter !== "all"
                  ? "No matching opportunities"
                  : "No opportunities yet",
              description:
                search || statusFilter !== "all"
                  ? "Try changing your search or filter."
                  : "Create an opportunity to track your pipeline.",
              action: !search && statusFilter === "all" && (
                <Button variant="brand" onClick={() => setShowForm(true)}>
                  + New opportunity
                </Button>
              ),
            }}
          />
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title="New opportunity"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>
              Create opportunity
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Party type">
            <Segmented
              value={partyType}
              onChange={(t) => {
                setPartyType(t);
                setPartyId("");
              }}
              options={[
                { value: "Lead", label: "Lead" },
                { value: "Customer", label: "Customer" },
              ]}
            />
          </FormField>
          <FormField label={partyType} required>
            <select
              required
              className="input"
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
            >
              <option value="">Select {partyType.toLowerCase()}…</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {"customerName" in p ? p.customerName : `${p.name} — ${p.leadName}`}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Expected amount">
            <input
              type="number"
              step="any"
              min={0}
              className="input"
              placeholder="0.00"
              value={expectedAmount}
              onChange={(e) => setExpectedAmount(Number(e.target.value))}
            />
          </FormField>
          <FormField label="Expected close date">
            <input
              type="date"
              className="input"
              value={expectedCloseDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </FormField>
          <FormField label="Source">
            <input
              className="input"
              placeholder="Website, Referral…"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
