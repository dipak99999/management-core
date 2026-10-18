"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  Toast,
  relativeTime,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";
import { KanbanBoard, type KanbanColumn } from "../../../components/kanban";
import {
  PriorityBadge,
  SlaIndicator,
  TicketStatusBadge,
  fetchDeskUsers,
  type DeskUser,
  type TicketPriority,
  type TicketStatus,
} from "../_lib/ui";

// Desk Ticket Inbox — the agent's landing page. Polls /desk/tickets and
// /desk/tickets/stats every 10s so incoming/breach state stays live. Rows
// deep-link to the ticket detail view. Creation is inline via a right-side
// drawer (server auto-assigns via rules if agent omitted).

type TicketType = "Question" | "Incident" | "Problem" | "FeatureRequest" | "Task";
type TicketChannel = "Email" | "Web" | "Chat" | "Phone" | "Api";

interface Ticket {
  id: string;
  name: string;
  subject: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  channel: TicketChannel;
  requesterEmail: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
  assigneeUserId: string | null;
  tags: string[] | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  slaFirstResponseBreached: boolean;
  slaResolutionBreached: boolean;
  createdAt: string;
  updatedAt?: string;
  _count: { replies: number };
}

interface TicketStats {
  new: number;
  open: number;
  inProgress: number;
  onHold: number;
  resolved: number;
  closed: number;
  mine: number;
  breachedFirstResponse: number;
  breachedResolution: number;
}

type SegFilter =
  | "all"
  | "mine"
  | "New"
  | "Open"
  | "InProgress"
  | "OnHold"
  | "Resolved"
  | "Closed";

type ViewMode = "kanban" | "list";

// Six ticket-status columns. Closed sits far right; the muted accent keeps
// it out of the way of active work. Colours mirror TicketStatusBadge so a
// ticket looks the same on both views.
const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: "New",        label: "New",         accent: "bg-blue-500" },
  { status: "Open",       label: "Open",        accent: "bg-cyan-500" },
  { status: "InProgress", label: "In Progress", accent: "bg-amber-500" },
  { status: "OnHold",     label: "On Hold",     accent: "bg-violet-500" },
  { status: "Resolved",   label: "Resolved",    accent: "bg-green-500" },
  { status: "Closed",     label: "Closed",      accent: "bg-ink-muted/40" },
];

interface CreateForm {
  subject: string;
  description: string;
  priority: TicketPriority;
  type: TicketType;
  channel: TicketChannel;
  requesterEmail: string;
  requesterName: string;
  requesterPhone: string;
  assigneeUserId: string;
  tags: string;
}

const EMPTY_CREATE: CreateForm = {
  subject: "",
  description: "",
  priority: "Medium",
  type: "Question",
  channel: "Web",
  requesterEmail: "",
  requesterName: "",
  requesterPhone: "",
  assigneeUserId: "",
  tags: "",
};

export default function DeskInboxPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [users, setUsers] = useState<DeskUser[]>([]);
  const [search, setSearch] = useState("");
  // Debounced copy of `search` — only this drives the load. Prevents an
  // API round-trip per keystroke and prevents the polling interval from
  // being torn down + recreated as the user types.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<SegFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<ViewMode>("kanban");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      // Kanban shows every status at once — only the list view narrows by
      // status. The "mine" filter still applies to both views.
      if (filter === "mine") params.set("mine", "1");
      else if (filter !== "all" && view === "list") params.set("status", filter);
      const qs = params.toString();
      const [tickets, s] = await Promise.all([
        api.get<Ticket[]>(`/desk/tickets${qs ? `?${qs}` : ""}`),
        api.get<TicketStats>("/desk/tickets/stats"),
      ]);
      setRows(tickets);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    }
  }, [debouncedSearch, filter, view]);

  // Drag between columns → POST /set-status. Optimistic; rolls back on error.
  // The dedicated endpoint fires SLA/assignment side-effects the plain PUT
  // doesn't, so we route drag through it explicitly.
  async function moveCard(row: Ticket, newStatus: string) {
    if (row.status === newStatus) return;
    const prev = rows;
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id ? { ...r, status: newStatus as TicketStatus } : r,
      ),
    );
    try {
      await api.post(`/desk/tickets/${row.id}/set-status`, { status: newStatus });
      // Refresh stats badge so counts stay honest without waiting for the
      // 10s poll to fire.
      const s = await api.get<TicketStats>("/desk/tickets/stats");
      setStats(s);
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Move failed");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  useListPageCommands({
    singular: "Inbox",
    plural: "Inbox",
    refresh: load,
  });
  useEffect(() => {
    fetchDeskUsers().then(setUsers);
  }, []);

  const userLookup = useMemo(() => {
    const m = new Map<string, DeskUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const openBadge = stats
    ? `${stats.open + stats.new + stats.inProgress} open · ${
        stats.breachedFirstResponse + stats.breachedResolution
      } breached SLA`
    : "";

  async function createTicket(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (creating) return;
    const subject = form.subject.trim();
    if (!subject) return;
    setCreating(true);
    try {
      const tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        subject,
        description: form.description.trim() || undefined,
        priority: form.priority,
        type: form.type,
        channel: form.channel,
        requesterEmail: form.requesterEmail.trim() || undefined,
        requesterName: form.requesterName.trim() || undefined,
        requesterPhone: form.requesterPhone.trim() || undefined,
        assigneeUserId: form.assigneeUserId || undefined,
        tags: tags.length ? tags : undefined,
      };
      const created = await api.post<Ticket>("/desk/tickets", body);
      setDrawer(false);
      setForm(EMPTY_CREATE);
      router.push(`/crm/desk/tickets/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setCreating(false);
    }
  }

  const columns: Column<Ticket>[] = [
    {
      header: "Name",
      width: "110px",
      cell: (t) => (
        <span className="font-mono text-xs text-ink-soft">{t.name}</span>
      ),
    },
    {
      header: "Subject",
      cell: (t) => (
        <div className="min-w-0 max-w-[380px]">
          <div className="font-semibold text-ink truncate">{t.subject}</div>
          {t.tags && t.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {t.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="badge-gray">{tag}</span>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Requester",
      cell: (t) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="text-sm text-ink truncate">
            {t.requesterName || "—"}
          </div>
          <div className="text-xs text-ink-muted truncate">
            {t.requesterEmail || ""}
          </div>
        </div>
      ),
    },
    {
      header: "Priority",
      cell: (t) => <PriorityBadge priority={t.priority} />,
    },
    {
      header: "Status",
      cell: (t) => <TicketStatusBadge status={t.status} />,
    },
    {
      header: "SLA",
      cell: (t) => {
        // Prefer resolution SLA when we've already met first-response, else
        // show first-response — this is what the agent cares about right now.
        const showFr = !t.firstResponseAt;
        return showFr ? (
          <SlaIndicator
            dueAt={t.firstResponseDueAt}
            breached={t.slaFirstResponseBreached}
            metAt={t.firstResponseAt}
          />
        ) : (
          <SlaIndicator
            dueAt={t.resolutionDueAt}
            breached={t.slaResolutionBreached}
            metAt={t.resolvedAt}
          />
        );
      },
    },
    {
      header: "Assignee",
      cell: (t) => {
        if (!t.assigneeUserId) return <span className="text-ink-muted/60">—</span>;
        const u = userLookup.get(t.assigneeUserId);
        const label = u ? u.fullName || u.email.split("@")[0] : "…";
        return <span className="text-sm text-ink-soft truncate">{label}</span>;
      },
    },
    {
      header: "Updated",
      cell: (t) => (
        <span className="text-xs text-ink-muted">
          {relativeTime(t.updatedAt ?? t.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Ticket Inbox"
        subtitle={openBadge || " "}
        actions={
          <Button variant="brand" onClick={() => setDrawer(true)}>
            + New Ticket
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
            placeholder: "Search subject, requester, ID…",
          }}
          filters={
            view === "list" ? (
              <Segmented<SegFilter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "mine", label: "Mine", count: stats?.mine },
                  { value: "New", label: "New", count: stats?.new },
                  { value: "Open", label: "Open", count: stats?.open },
                  { value: "InProgress", label: "In Progress", count: stats?.inProgress },
                  { value: "OnHold", label: "On Hold", count: stats?.onHold },
                  { value: "Resolved", label: "Resolved", count: stats?.resolved },
                  { value: "Closed", label: "Closed", count: stats?.closed },
                ]}
              />
            ) : (
              // Kanban view still lets the agent scope to "mine" — the
              // status segment isn't needed since all columns are visible.
              <Segmented<SegFilter>
                value={filter === "all" || filter === "mine" ? filter : "all"}
                onChange={(v) => setFilter(v)}
                options={[
                  { value: "all", label: "All" },
                  { value: "mine", label: "Mine", count: stats?.mine },
                ]}
              />
            )
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
                listKey="crm-web:desk-inbox"
                current={{ search, filter, view }}
                onApply={(fv) => { setSearch(fv.search); setFilter(fv.filter); setView(fv.view); }}
              />
            </>
          }
        />

        {view === "kanban" ? (
          <KanbanBoard<Ticket>
            columns={KANBAN_COLUMNS}
            rows={rows}
            getStatus={(t) => t.status}
            rowKey={(t) => t.id}
            onMoveCard={moveCard}
            emptyMessage="New tickets from any channel — email, web form, chat — will show up here."
            renderCard={(t) => (
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={`/crm/desk/tickets/${t.id}`}
                    className="font-mono text-[11px] text-brand-600 hover:text-brand-700"
                    onClick={(e) => e.stopPropagation()}
                    draggable={false}
                  >
                    {t.name}
                  </a>
                  <PriorityBadge priority={t.priority} />
                </div>
                <div className="font-medium text-ink truncate">{t.subject}</div>
                {t.requesterName && (
                  <div className="text-[11px] text-ink-muted truncate">
                    {t.requesterName}
                  </div>
                )}
                {(t.slaFirstResponseBreached || t.slaResolutionBreached) && (
                  <div className="text-[11px] text-red-600 font-medium">
                    SLA breached
                  </div>
                )}
                {t.tags && t.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {t.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="badge-gray">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/crm/desk/tickets/${r.id}`)}
            empty={{
              icon: Icon.clipboard,
              title: "No tickets match",
              description:
                "New tickets from any channel — email, web form, chat — will show up here.",
            }}
          />
        )}
      </div>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="New Ticket"
        width="w-[560px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawer(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={() => createTicket()}
              disabled={creating || !form.subject.trim()}
            >
              {creating ? "Creating…" : "Create ticket"}
            </Button>
          </>
        }
      >
        <form onSubmit={createTicket} className="space-y-4">
          <FormField label="Subject" required>
            <input
              required
              className="input"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Brief description of the issue"
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input resize-none"
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Detailed description (optional)"
            />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Priority">
              <select
                className="input"
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as TicketPriority })
                }
              >
                <option value="Urgent">Urgent</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </FormField>
            <FormField label="Type">
              <select
                className="input"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as TicketType })
                }
              >
                <option value="Question">Question</option>
                <option value="Incident">Incident</option>
                <option value="Problem">Problem</option>
                <option value="FeatureRequest">Feature Request</option>
                <option value="Task">Task</option>
              </select>
            </FormField>
            <FormField label="Channel">
              <select
                className="input"
                value={form.channel}
                onChange={(e) =>
                  setForm({ ...form, channel: e.target.value as TicketChannel })
                }
              >
                <option value="Email">Email</option>
                <option value="Web">Web</option>
                <option value="Chat">Chat</option>
                <option value="Phone">Phone</option>
                <option value="Api">API</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Requester name">
              <input
                className="input"
                value={form.requesterName}
                onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
              />
            </FormField>
            <FormField label="Requester email">
              <input
                type="email"
                className="input"
                value={form.requesterEmail}
                onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Requester phone">
              <input
                className="input"
                value={form.requesterPhone}
                onChange={(e) => setForm({ ...form, requesterPhone: e.target.value })}
              />
            </FormField>
            <FormField
              label="Assignee"
              hint="Leave blank to let assignment rules pick"
            >
              <select
                className="input"
                value={form.assigneeUserId}
                onChange={(e) => setForm({ ...form, assigneeUserId: e.target.value })}
              >
                <option value="">— Auto-assign —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName || u.email}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Tags" hint="Comma-separated">
            <input
              className="input"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="billing, urgent, integration"
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
