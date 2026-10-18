"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
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
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";
import { fetchDeskUsers, type DeskUser } from "../_lib/ui";

const CHANNELS = ["Email", "Portal", "Chat", "Phone", "Manual", "API"] as const;
const PRIORITIES = ["Urgent", "High", "Medium", "Low"] as const;
const TYPES = ["Question", "Problem", "FeatureRequest", "Incident", "Task"] as const;

interface AssignmentRule {
  id: string;
  name: string;
  isActive: boolean;
  ruleType: "RoundRobin" | "LoadBalanced";
  agentUserIds: string[];
  matchConditions: {
    channel?: string[];
    priority?: string[];
    type?: string[];
  } | null;
  priority: number;
  updatedAt: string;
}

const emptyForm = {
  name: "",
  isActive: true,
  ruleType: "RoundRobin" as "RoundRobin" | "LoadBalanced",
  agentUserIds: [] as string[],
  channels: [] as string[],
  priorities: [] as string[],
  types: [] as string[],
  priority: 0,
};

export default function AssignmentRulesPage() {
  const [rows, setRows] = useState<AssignmentRule[]>([]);
  const [users, setUsers] = useState<DeskUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AssignmentRule | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [rules, us] = await Promise.all([
        api.get<AssignmentRule[]>("/desk/assignment-rules"),
        fetchDeskUsers(),
      ]);
      setRows(rules);
      setUsers(us);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Rule",
    plural: "Rules",
    refresh: load,
  });
  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(r: AssignmentRule) {
    setEditing(r);
    setForm({
      name: r.name,
      isActive: r.isActive,
      ruleType: r.ruleType,
      agentUserIds: r.agentUserIds,
      channels: r.matchConditions?.channel ?? [],
      priorities: r.matchConditions?.priority ?? [],
      types: r.matchConditions?.type ?? [],
      priority: r.priority,
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        isActive: form.isActive,
        ruleType: form.ruleType,
        agentUserIds: form.agentUserIds,
        matchConditions:
          form.channels.length || form.priorities.length || form.types.length
            ? {
                ...(form.channels.length && { channel: form.channels }),
                ...(form.priorities.length && { priority: form.priorities }),
                ...(form.types.length && { type: form.types }),
              }
            : null,
        priority: form.priority,
      };
      if (payload.agentUserIds.length === 0) throw new Error("Pick at least one agent");
      if (editing) {
        await api.put(`/desk/assignment-rules/${editing.id}`, payload);
        setMsg("Rule updated");
      } else {
        await api.post("/desk/assignment-rules", payload);
        setMsg("Rule created");
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: AssignmentRule) {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    try {
      await api.del(`/desk/assignment-rules/${r.id}`);
      setMsg("Deleted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function toggleActive(r: AssignmentRule) {
    try {
      await api.put(`/desk/assignment-rules/${r.id}`, {
        name: r.name,
        isActive: !r.isActive,
        ruleType: r.ruleType,
        agentUserIds: r.agentUserIds,
        matchConditions: r.matchConditions,
        priority: r.priority,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  }

  function toggleInList(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const columns: Column<AssignmentRule>[] = [
    {
      header: "Name",
      cell: (r) => (
        <button onClick={() => openEdit(r)} className="font-medium text-ink hover:text-brand-700 text-start">
          {r.name}
        </button>
      ),
    },
    { header: "Type", cell: (r) => <StatusBadge status={r.ruleType} /> },
    {
      header: "Priority",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r.priority}</span>,
    },
    {
      header: "Agents",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r.agentUserIds.length}</span>,
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.isActive ? "Active" : "Draft"} />,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center gap-2 justify-end">
          <button onClick={() => toggleActive(r)} className="text-xs text-ink-soft hover:text-brand-700">
            {r.isActive ? "Pause" : "Activate"}
          </button>
          <button onClick={() => openEdit(r)} className="text-xs text-brand-600 hover:underline">Edit</button>
          <button onClick={() => remove(r)} className="text-xs text-red-600 hover:underline">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Assignment Rules"
        subtitle="Auto-assign new tickets by round-robin or load-balance across your agents"
        actions={<Button variant="brand" onClick={openNew}>+ New Rule</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search rules…" }}
          actions={<SavedViewsControls listKey="crm-web:desk-rules" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search ? "No matches" : "No assignment rules yet",
            description: search
              ? "Try a different search."
              : "Create rules that auto-assign incoming tickets to your agents.",
            action: !search && <Button variant="brand" onClick={openNew}>+ New Rule</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? "Edit rule" : "New assignment rule"}
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.name.trim() || form.agentUserIds.length === 0}
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Create rule"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Name" required>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Round-robin Tier-1"
              required
              autoFocus
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Strategy">
              <Segmented
                value={form.ruleType}
                onChange={(v) => setForm({ ...form, ruleType: v })}
                options={[
                  { value: "RoundRobin", label: "Round-robin" },
                  { value: "LoadBalanced", label: "Load-balanced" },
                ]}
              />
            </FormField>
            <FormField label="Priority (higher wins)">
              <input
                type="number"
                min={0}
                className="input"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })}
              />
            </FormField>
          </div>

          <FormField label="Active">
            <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Enabled — apply to new tickets
            </label>
          </FormField>

          <FormField label={`Candidate agents (${form.agentUserIds.length} selected)`} required>
            <div className="card p-2 max-h-56 overflow-y-auto">
              {users.length === 0 && (
                <div className="text-xs text-ink-muted p-2">No users found</div>
              )}
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 p-2 rounded hover:bg-brand-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.agentUserIds.includes(u.id)}
                    onChange={() =>
                      setForm({ ...form, agentUserIds: toggleInList(form.agentUserIds, u.id) })
                    }
                  />
                  <span className="text-sm">
                    {u.fullName || u.email}
                    {u.fullName && (
                      <span className="text-ink-muted ms-1 text-xs">({u.email})</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </FormField>

          <div>
            <label className="label">Match conditions (optional — rule fires when ALL conditions match)</label>
            <div className="card p-3 space-y-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">Channel</div>
                <div className="flex flex-wrap gap-1.5">
                  {CHANNELS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, channels: toggleInList(form.channels, c) })}
                      className={form.channels.includes(c) ? "badge-brand" : "badge-gray hover:badge-brand"}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">Priority</div>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setForm({ ...form, priorities: toggleInList(form.priorities, p) })}
                      className={form.priorities.includes(p) ? "badge-brand" : "badge-gray hover:badge-brand"}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">Type</div>
                <div className="flex flex-wrap gap-1.5">
                  {TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, types: toggleInList(form.types, t) })}
                      className={form.types.includes(t) ? "badge-brand" : "badge-gray hover:badge-brand"}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-ink-muted">
                Leave a section empty to match everything on that dimension.
              </p>
            </div>
          </div>

          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
