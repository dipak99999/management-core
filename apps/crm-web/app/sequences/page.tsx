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
import { Icon } from "../../components/app-shell";

// A drip-campaign sequence — matches GET /email-sequences list shape.
interface Sequence {
  id: string;
  name: string;
  description: string | null;
  triggerType: "Manual" | "OnListAdd" | "OnLeadCreated";
  triggerListId: string | null;
  isActive: boolean;
  totalEnrolled: number;
  totalCompleted: number;
  updatedAt: string;
  _count: { steps: number; enrollments: number };
}

interface ContactList {
  id: string;
  name: string;
}

type TriggerType = "Manual" | "OnListAdd" | "OnLeadCreated";
type StatusFilter = "all" | "active" | "draft";

const emptyForm = {
  name: "",
  description: "",
  triggerType: "Manual" as TriggerType,
  triggerListId: "",
};

// Trigger label + tint so the list badge and filter chips stay aligned.
const TRIGGER_LABEL: Record<TriggerType, string> = {
  Manual: "Manual",
  OnListAdd: "On list add",
  OnLeadCreated: "On lead created",
};
const TRIGGER_BADGE: Record<TriggerType, string> = {
  Manual: "badge-gray",
  OnListAdd: "badge-brand",
  OnLeadCreated: "badge-blue",
};

export default function SequencesPage() {
  const [rows, setRows] = useState<Sequence[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Sequence[]>("/email-sequences"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Only need contact lists when Drawer is open, but the request is small
    // and lets us render the select immediately.
    api
      .get<ContactList[]>("/contact-lists")
      .then(setLists)
      .catch(() => {});
  }, []);

  function close() {
    setForm(emptyForm);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post("/email-sequences", {
        name: form.name,
        description: form.description || undefined,
        triggerType: form.triggerType,
        triggerListId:
          form.triggerType === "OnListAdd" && form.triggerListId
            ? form.triggerListId
            : undefined,
      });
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: Sequence, ev: React.MouseEvent) {
    ev.stopPropagation();
    try {
      await api.post(
        `/email-sequences/${s.id}/${s.isActive ? "pause" : "activate"}`,
        {},
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this sequence? Enrollments will be lost.")) return;
    try {
      await api.del(`/email-sequences/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((s) => {
      if (statusFilter === "active" && !s.isActive) return false;
      if (statusFilter === "draft" && s.isActive) return false;
      if (q && !`${s.name} ${s.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.isActive).length,
      draft: rows.filter((r) => !r.isActive).length,
    }),
    [rows],
  );

  const totalEnrolled = useMemo(
    () => rows.reduce((s, r) => s + (r.totalEnrolled ?? 0), 0),
    [rows],
  );

  const columns: Column<Sequence>[] = [
    {
      header: "Sequence",
      cell: (s) => (
        <div className="flex flex-col">
          <a
            href={`/crm/sequences/${s.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {s.name}
          </a>
          {s.description && (
            <span className="text-xs text-ink-muted truncate max-w-[320px]">
              {s.description}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Trigger",
      cell: (s) => (
        <span className={TRIGGER_BADGE[s.triggerType]}>
          {TRIGGER_LABEL[s.triggerType]}
        </span>
      ),
    },
    {
      header: "Steps",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums text-ink-soft">{s._count?.steps ?? 0}</span>
      ),
    },
    {
      header: "Enrolled",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-medium text-ink">
          {s.totalEnrolled ?? 0}
        </span>
      ),
    },
    {
      header: "Completed",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums text-ink-soft">{s.totalCompleted ?? 0}</span>
      ),
    },
    {
      header: "Status",
      cell: (s) => <StatusBadge status={s.isActive ? "Active" : "Draft"} />,
    },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={(e) => toggleActive(s, e)}
            className="btn-ghost btn-sm"
          >
            {s.isActive ? "Pause" : "Activate"}
          </button>
          <button
            onClick={(e) => remove(s.id, e)}
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
        title="Email Sequences"
        subtitle={
          totalEnrolled > 0
            ? `${totalEnrolled} contact${totalEnrolled === 1 ? "" : "s"} enrolled across ${rows.length} sequence${rows.length === 1 ? "" : "s"}`
            : `${rows.length} sequence${rows.length === 1 ? "" : "s"}`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New sequence
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
            placeholder: "Search sequence name or description…",
          }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "active", label: "Active", count: counts.active },
                { value: "draft", label: "Draft", count: counts.draft },
              ]}
            />
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(s) => s.id}
          onRowClick={(s) => (window.location.href = `/crm/sequences/${s.id}`)}
          loading={loading}
          empty={{
            icon: Icon.send,
            title:
              search || statusFilter !== "all"
                ? "No matching sequences"
                : "No sequences yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Create a drip campaign to keep contacts engaged over time.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New sequence
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title="New sequence"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={saving || !form.name.trim()}
              onClick={(e) => save(e as unknown as React.FormEvent)}
            >
              {saving ? "Creating…" : "Create sequence"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Name" required>
            <input
              required
              autoFocus
              className="input"
              placeholder="Trial nurture, Welcome series…"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              placeholder="Optional — what this sequence is for"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField
            label="Trigger"
            hint="When new contacts should be auto-enrolled"
          >
            <select
              className="input"
              value={form.triggerType}
              onChange={(e) =>
                setForm({
                  ...form,
                  triggerType: e.target.value as TriggerType,
                  triggerListId:
                    e.target.value === "OnListAdd" ? form.triggerListId : "",
                })
              }
            >
              <option value="Manual">Manual (enroll one-by-one)</option>
              <option value="OnListAdd">When added to a contact list</option>
              <option value="OnLeadCreated">When a new lead is created</option>
            </select>
          </FormField>
          {form.triggerType === "OnListAdd" && (
            <FormField
              label="Contact list"
              required
              hint="Adding a contact to this list will start the sequence"
            >
              <select
                required
                className="input"
                value={form.triggerListId}
                onChange={(e) =>
                  setForm({ ...form, triggerListId: e.target.value })
                }
              >
                <option value="">Select a list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
