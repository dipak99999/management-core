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
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

type Priority = "Low" | "Medium" | "High" | "Urgent";
const PRIORITIES: Priority[] = ["Urgent", "High", "Medium", "Low"];

interface SlaRule {
  priority: Priority;
  firstResponseMins: number;
  resolutionMins: number;
}
interface SlaPolicy {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  businessHoursOnly: boolean;
  rulesJson: SlaRule[];
  updatedAt: string;
}

// Small helper to render "15m", "4h", "1d" so the rules summary column
// doesn't drown in "480 mins" everywhere.
function humanMins(m: number): string {
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round((m / 60) * 10) / 10}h`;
  return `${Math.round((m / (60 * 24)) * 10) / 10}d`;
}

const emptyRules: SlaRule[] = PRIORITIES.map((p) => ({
  priority: p,
  firstResponseMins:
    p === "Urgent" ? 15 : p === "High" ? 60 : p === "Medium" ? 240 : 480,
  resolutionMins:
    p === "Urgent" ? 240 : p === "High" ? 480 : p === "Medium" ? 1440 : 2880,
}));

export default function SlaPoliciesPage() {
  const [rows, setRows] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SlaPolicy | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    isDefault: false,
    businessHoursOnly: false,
    rules: emptyRules,
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SlaPolicy[]>("/desk/sla-policies"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Sla",
    plural: "Sla",
    refresh: load,
  });
  function openNew() {
    setEditing(null);
    setForm({
      name: "",
      description: "",
      isDefault: false,
      businessHoursOnly: false,
      rules: emptyRules,
    });
    setShowForm(true);
  }
  function openEdit(p: SlaPolicy) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      isDefault: p.isDefault,
      businessHoursOnly: p.businessHoursOnly,
      rules: PRIORITIES.map(
        (pri) =>
          p.rulesJson.find((r) => r.priority === pri) ?? {
            priority: pri,
            firstResponseMins: 0,
            resolutionMins: 0,
          },
      ),
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        isDefault: form.isDefault,
        businessHoursOnly: form.businessHoursOnly,
        rulesJson: form.rules
          .filter((r) => r.firstResponseMins > 0 && r.resolutionMins > 0)
          .map((r) => ({
            priority: r.priority,
            firstResponseMins: Number(r.firstResponseMins),
            resolutionMins: Number(r.resolutionMins),
          })),
      };
      if (payload.rulesJson.length === 0)
        throw new Error("Add at least one priority rule");
      if (editing) {
        await api.put(`/desk/sla-policies/${editing.id}`, payload);
        setMsg("Policy updated");
      } else {
        await api.post("/desk/sla-policies", payload);
        setMsg("Policy created");
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: SlaPolicy) {
    if (!confirm(`Delete SLA policy "${p.name}"?`)) return;
    try {
      await api.del(`/desk/sla-policies/${p.id}`);
      setMsg("Deleted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const columns: Column<SlaPolicy>[] = [
    {
      header: "Name",
      cell: (p) => (
        <button
          onClick={() => openEdit(p)}
          className="font-medium text-ink hover:text-brand-700 text-start"
        >
          {p.name}
        </button>
      ),
    },
    {
      header: "Default",
      cell: (p) =>
        p.isDefault ? <StatusBadge status="Default" /> : <span className="text-ink-muted">—</span>,
    },
    {
      header: "Hours",
      cell: (p) => (
        <span className={p.businessHoursOnly ? "badge-brand" : "badge-gray"}>
          {p.businessHoursOnly ? "Business" : "24×7"}
        </span>
      ),
    },
    {
      header: "Rules",
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.rulesJson.map((r) => (
            <span key={r.priority} className="badge-gray whitespace-nowrap">
              {r.priority}: {humanMins(r.firstResponseMins)}/
              {humanMins(r.resolutionMins)}
            </span>
          ))}
        </div>
      ),
    },
    {
      header: "Updated",
      cell: (p) => <span className="text-ink-muted text-xs">{dateShort(p.updatedAt)}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (p) => (
        <div className="flex items-center gap-2 justify-end">
          <button onClick={() => openEdit(p)} className="text-xs text-brand-600 hover:underline">Edit</button>
          <button onClick={() => remove(p)} className="text-xs text-red-600 hover:underline">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="SLA Policies"
        subtitle={`${rows.length} polic${rows.length === 1 ? "y" : "ies"} · defines first-response + resolution targets per priority`}
        actions={
          <Button variant="brand" onClick={openNew}>
            + New Policy
          </Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search policies…" }}
          actions={<SavedViewsControls listKey="crm-web:desk-sla" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          loading={loading}
          empty={{
            icon: Icon.shield,
            title: search ? "No matches" : "No SLA policies yet",
            description: search
              ? "Try a different search."
              : "Define first-response + resolution targets per priority so agents know when a ticket is running late.",
            action: !search && (
              <Button variant="brand" onClick={openNew}>+ New Policy</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? "Edit SLA policy" : "New SLA policy"}
        width="w-[720px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.name.trim()}
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Create policy"}
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
              placeholder="e.g. Standard SLA"
              required
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional"
            />
          </FormField>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Set as default policy
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={form.businessHoursOnly}
                onChange={(e) => setForm({ ...form, businessHoursOnly: e.target.checked })}
              />
              Business hours only
            </label>
          </div>

          <div>
            <label className="label">Targets per priority (minutes)</label>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 text-start text-[11px] uppercase font-semibold">Priority</th>
                    <th className="px-3 py-2 text-end text-[11px] uppercase font-semibold w-40">First response</th>
                    <th className="px-3 py-2 text-end text-[11px] uppercase font-semibold w-40">Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {form.rules.map((r, i) => (
                    <tr key={r.priority} className="border-t border-ink-muted/10">
                      <td className="px-3 py-2 font-medium">{r.priority}</td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={0}
                          className="input input-sm text-end"
                          value={r.firstResponseMins}
                          onChange={(e) => {
                            const next = [...form.rules];
                            next[i] = { ...r, firstResponseMins: Number(e.target.value) || 0 };
                            setForm({ ...form, rules: next });
                          }}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={0}
                          className="input input-sm text-end"
                          value={r.resolutionMins}
                          onChange={(e) => {
                            const next = [...form.rules];
                            next[i] = { ...r, resolutionMins: Number(e.target.value) || 0 };
                            setForm({ ...form, rules: next });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-muted mt-1">
              Common values: 15m/4h (Urgent), 1h/8h (High), 4h/1d (Medium), 8h/2d (Low).
            </p>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
