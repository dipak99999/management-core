"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
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

// Full Zoho-Campaigns-Plus-style list: attribution fields + email marketing
// fields (channel, subject, HTML body, from-address, tracking, scheduled send)
// plus per-row engagement rates for anything already sent.
interface Campaign {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: string;
  expectedRevenue: string;
  status: string;
  channel: string | null;
  subject: string | null;
  bodyHtml: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  trackOpens: boolean;
  trackClicks: boolean;
  scheduledFor: string | null;
  sentAt: string | null;
  totalRecipients: number;
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalBounced: number;
  totalUnsubs: number;
}

type ChannelValue = "Email" | "SMS" | "Push" | "Other";

const empty = {
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  budget: 0,
  expectedRevenue: 0,
  status: "Planned" as "Planned" | "Active" | "Completed" | "Cancelled",
  channel: "Email" as ChannelValue,
  subject: "",
  bodyHtml: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  trackOpens: true,
  trackClicks: true,
  scheduledFor: "",
};

type StatusFilter = "all" | "Planned" | "Active" | "Completed" | "Cancelled";

// Small pill for channel — different palette than status.
function ChannelBadge({ channel }: { channel: string | null }) {
  if (!channel) return <span className="badge-gray">—</span>;
  const cls =
    channel === "Email"
      ? "badge-blue"
      : channel === "SMS"
        ? "badge-violet"
        : channel === "Push"
          ? "badge-amber"
          : "badge-gray";
  return <span className={cls}>{channel}</span>;
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  const r = (numerator / denominator) * 100;
  return `${r.toFixed(1)}%`;
}

// Convert a Date to the local-time value expected by <input type="datetime-local">.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CampaignsPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Campaign[]>("/campaigns"));
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
    singular: "Campaign",
    plural: "Campaigns",
    refresh: load,
  });
  function edit(c: Campaign, ev: React.MouseEvent) {
    ev.stopPropagation();
    setForm({
      name: c.name,
      description: c.description ?? "",
      startDate: c.startDate ? c.startDate.slice(0, 10) : "",
      endDate: c.endDate ? c.endDate.slice(0, 10) : "",
      budget: Number(c.budget),
      expectedRevenue: Number(c.expectedRevenue),
      status: c.status as typeof empty.status,
      channel: (c.channel as ChannelValue) ?? "Email",
      subject: c.subject ?? "",
      bodyHtml: c.bodyHtml ?? "",
      fromName: c.fromName ?? "",
      fromEmail: c.fromEmail ?? "",
      replyTo: c.replyTo ?? "",
      trackOpens: c.trackOpens ?? true,
      trackClicks: c.trackClicks ?? true,
      scheduledFor: toLocalInput(c.scheduledFor),
    });
    setEditingId(c.id);
    setShowForm(true);
  }
  function close() {
    setForm(empty);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        ...form,
        description: form.description || null,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        subject: form.subject || null,
        bodyHtml: form.bodyHtml || null,
        fromName: form.fromName || null,
        fromEmail: form.fromEmail || null,
        replyTo: form.replyTo || null,
        scheduledFor: form.scheduledFor
          ? new Date(form.scheduledFor).toISOString()
          : null,
      };
      if (editingId) await api.put(`/campaigns/${editingId}`, body);
      else await api.post("/campaigns", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this campaign?")) return;
    try {
      await api.del(`/campaigns/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (
        q &&
        !`${c.name} ${c.description ?? ""} ${c.subject ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      Planned: rows.filter((r) => r.status === "Planned").length,
      Active: rows.filter((r) => r.status === "Active").length,
      Completed: rows.filter((r) => r.status === "Completed").length,
      Cancelled: rows.filter((r) => r.status === "Cancelled").length,
    }),
    [rows],
  );

  const activeBudget = useMemo(
    () =>
      rows
        .filter((r) => r.status === "Active")
        .reduce((s, r) => s + Number(r.budget ?? 0), 0),
    [rows],
  );

  const columns: Column<Campaign>[] = [
    {
      header: "Campaign",
      cell: (c) => (
        <div className="flex flex-col">
          <a
            href={`/crm/campaigns/${c.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {c.name}
          </a>
          {c.subject && (
            <span className="text-[11px] text-ink-muted truncate max-w-[280px]">
              {c.subject}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Channel",
      cell: (c) => <ChannelBadge channel={c.channel} />,
    },
    {
      header: "Status",
      cell: (c) => <StatusBadge status={c.status} />,
    },
    {
      header: "Sent",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-ink-soft">
          {c.totalSent > 0 ? c.totalSent.toLocaleString() : "—"}
        </span>
      ),
    },
    {
      header: "Open rate",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-ink-soft">
          {c.totalSent > 0 ? pct(c.totalOpened, c.totalSent) : "—"}
        </span>
      ),
    },
    {
      header: "Click rate",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-ink-soft">
          {c.totalSent > 0 ? pct(c.totalClicked, c.totalSent) : "—"}
        </span>
      ),
    },
    {
      header: "Budget",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(c.budget))}
        </span>
      ),
    },
    {
      header: "Window",
      cell: (c) => (
        <span className="text-xs text-ink-muted">
          {dateShort(c.startDate)} → {dateShort(c.endDate)}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <div className="flex justify-end gap-2">
          <a
            href={`/crm/campaigns/${c.id}`}
            onClick={(e) => e.stopPropagation()}
            className="btn-ghost btn-sm"
          >
            View analytics
          </a>
          <button onClick={(e) => edit(c, e)} className="btn-ghost btn-sm">
            Edit
          </button>
          <button
            onClick={(e) => remove(c.id, e)}
            className="btn-ghost btn-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle={
          activeBudget > 0
            ? `${money(activeBudget)} active budget across ${counts.Active} campaign${counts.Active === 1 ? "" : "s"}`
            : `${rows.length} campaign${rows.length === 1 ? "" : "s"}`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New campaign
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
            placeholder: "Search campaign name, subject or description…",
          }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "Planned", label: "Planned", count: counts.Planned },
                { value: "Active", label: "Active", count: counts.Active },
                { value: "Completed", label: "Completed", count: counts.Completed },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="crm-web:campaigns" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          onRowClick={(c) => (window.location.href = `/crm/campaigns/${c.id}`)}
          loading={loading}
          empty={{
            icon: Icon.megaphone,
            title:
              search || statusFilter !== "all" ? "No matching campaigns" : "No campaigns yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Plan a campaign to track spend, engagement and attributed revenue.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New campaign
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        width="w-[720px]"
        title={editingId ? "Edit campaign" : "New campaign"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create campaign"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-6">
          {/* ── Basics ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Basics
            </h4>
            <FormField label="Name" required>
              <input
                required
                className="input"
                placeholder="Spring launch"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </FormField>
            <FormField label="Description">
              <textarea
                className="input"
                rows={2}
                placeholder="Optional internal note"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Channel">
                <select
                  className="input"
                  value={form.channel}
                  onChange={(e) =>
                    setForm({ ...form, channel: e.target.value as ChannelValue })
                  }
                >
                  <option>Email</option>
                  <option>SMS</option>
                  <option>Push</option>
                  <option>Other</option>
                </select>
              </FormField>
              <FormField label="Status">
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as typeof empty.status })
                  }
                >
                  <option>Planned</option>
                  <option>Active</option>
                  <option>Completed</option>
                  <option>Cancelled</option>
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start date">
                <input
                  type="date"
                  className="input"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </FormField>
              <FormField label="End date">
                <input
                  type="date"
                  className="input"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Budget">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input"
                  placeholder="0.00"
                  value={form.budget}
                  onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })}
                />
              </FormField>
              <FormField label="Expected revenue">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input"
                  placeholder="0.00"
                  value={form.expectedRevenue}
                  onChange={(e) =>
                    setForm({ ...form, expectedRevenue: Number(e.target.value) })
                  }
                />
              </FormField>
            </div>
          </div>

          {/* ── Email content ──────────────────────────────────────── */}
          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Email content
            </h4>
            <FormField label="Subject line">
              <input
                className="input"
                placeholder="Meet our new spring collection"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </FormField>
            <FormField
              label="Body (HTML)"
              hint="Paste raw HTML. Use {{first_name}} etc. as merge tags if your backend supports them."
            >
              <textarea
                className="input font-mono text-xs"
                rows={10}
                placeholder="<h1>Hello {{first_name}}</h1><p>…</p>"
                value={form.bodyHtml}
                onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })}
              />
            </FormField>
          </div>

          {/* ── Sender ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Sender
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="From name">
                <input
                  className="input"
                  placeholder="Lumaara Team"
                  value={form.fromName}
                  onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                />
              </FormField>
              <FormField label="From email">
                <input
                  type="email"
                  className="input"
                  placeholder="hello@example.com"
                  value={form.fromEmail}
                  onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                />
              </FormField>
            </div>
            <FormField label="Reply-to">
              <input
                type="email"
                className="input"
                placeholder="support@example.com"
                value={form.replyTo}
                onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
              />
            </FormField>
          </div>

          {/* ── Delivery & tracking ────────────────────────────────── */}
          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Delivery & tracking
            </h4>
            <FormField
              label="Scheduled for"
              hint="Leave empty to send manually from the campaign detail page."
            >
              <input
                type="datetime-local"
                className="input"
                value={form.scheduledFor}
                onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
              />
            </FormField>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.trackOpens}
                  onChange={(e) =>
                    setForm({ ...form, trackOpens: e.target.checked })
                  }
                />
                <span>Track opens</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.trackClicks}
                  onChange={(e) =>
                    setForm({ ...form, trackClicks: e.target.checked })
                  }
                />
                <span>Track clicks</span>
              </label>
            </div>
          </div>

          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
