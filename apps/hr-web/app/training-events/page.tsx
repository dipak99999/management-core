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
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Event {
  id: string;
  name: string;
  subject: string;
  startAt: string;
  endAt: string;
  location: string | null;
  trainerName: string | null;
  status: string;
  _count: { attendees: number };
}

type StatusFilter = "all" | "Scheduled" | "InProgress" | "Completed" | "Cancelled";

const emptyForm = {
  subject: "",
  description: "",
  startAt: "",
  endAt: "",
  location: "",
  trainerName: "",
};

export default function TrainingEventsPage() {
  const [rows, setRows] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Event[]>("/training-events"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Training Event",
    plural: "Training Events",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/training-events", {
        subject: form.subject,
        description: form.description || null,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        location: form.location || null,
        trainerName: form.trainerName || null,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && ![r.name, r.subject, r.location, r.trainerName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:        rows.length,
    Scheduled:  rows.filter((r) => r.status === "Scheduled").length,
    InProgress: rows.filter((r) => r.status === "InProgress").length,
    Completed:  rows.filter((r) => r.status === "Completed").length,
    Cancelled:  rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<Event>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/hr/training-events/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Subject", cell: (r) => <span className="font-medium text-ink">{r.subject}</span> },
    {
      header: "When",
      cell: (r) => (
        <span className="text-ink-soft">
          {dateShort(r.startAt)}{" "}
          <span className="text-xs text-ink-muted">
            {new Date(r.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {" → "}
            {new Date(r.endAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
      ),
    },
    { header: "Trainer", cell: (r) => <span className="text-ink-soft">{r.trainerName ?? "—"}</span> },
    {
      header: "Attendees",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink">{r._count.attendees}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Training Events"
        subtitle={`${rows.length} event${rows.length === 1 ? "" : "s"}`}
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New training</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search training…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",        label: "All",         count: counts.all },
                { value: "Scheduled",  label: "Scheduled",   count: counts.Scheduled },
                { value: "InProgress", label: "In Progress", count: counts.InProgress },
                { value: "Completed",  label: "Completed",   count: counts.Completed },
                { value: "Cancelled",  label: "Cancelled",   count: counts.Cancelled },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="hr-web:training-events" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/hr/training-events/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.book,
            title: search || statusFilter !== "all" ? "No matching trainings" : "No trainings yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Schedule your first training session.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New training</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => { setShowForm(false); setForm(emptyForm); }}
        title="New training event"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => create(e as unknown as React.FormEvent)}>
              {busy ? "Saving…" : "Create event"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Subject" required>
            <input
              className="input"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start" required>
              <input
                type="datetime-local"
                className="input"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                required
              />
            </FormField>
            <FormField label="End" required>
              <input
                type="datetime-local"
                className="input"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                required
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Location">
              <input
                className="input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </FormField>
            <FormField label="Trainer">
              <input
                className="input"
                value={form.trainerName}
                onChange={(e) => setForm({ ...form, trainerName: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
