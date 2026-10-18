"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  type Column,
} from "../../../components/ui";

interface Flag {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  rolloutPercent: number;
}

const emptyForm = {
  key: "",
  label: "",
  description: "",
  enabled: false,
  rolloutPercent: 100,
};

export default function FeatureFlagsPage() {
  const [rows, setRows] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await dashboardApi.get<Flag[]>("/feature-flags"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Feature Flag",
    plural: "Feature Flags",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post("/feature-flags", {
        ...form,
        description: form.description || null,
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

  async function toggle(row: Flag) {
    try {
      await dashboardApi.put(`/feature-flags/${row.id}`, {
        enabled: !row.enabled,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function updateRollout(row: Flag, pct: number) {
    try {
      await dashboardApi.put(`/feature-flags/${row.id}`, {
        rolloutPercent: pct,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(id: string) {
    if (!confirm("Delete flag?")) return;
    try {
      await dashboardApi.delete(`/feature-flags/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.key, r.label, r.description ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Flag>[] = [
    { header: "Key", cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.key}</span> },
    {
      header: "Label",
      cell: (r) => (
        <div>
          <div className="text-ink font-medium">{r.label}</div>
          {r.description && (
            <div className="text-xs text-ink-muted">{r.description}</div>
          )}
        </div>
      ),
    },
    {
      header: "Enabled",
      cell: (r) => (
        <button
          onClick={() => toggle(r)}
          className={r.enabled ? "badge-green" : "badge-gray"}
        >
          {r.enabled ? "On" : "Off"}
        </button>
      ),
    },
    {
      header: "Rollout %",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={r.rolloutPercent}
            onChange={(e) => updateRollout(r, Number(e.target.value))}
            className="w-24"
          />
          <span className="text-xs text-ink-muted tabular-nums">{r.rolloutPercent}%</span>
        </div>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button onClick={() => del(r.id)} className="text-xs text-red-600 hover:underline">
          Delete
        </button>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Feature Flags"
        subtitle={`${rows.length} flag${rows.length === 1 ? "" : "s"}`}
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Feature Flags" }]}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New flag
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
          search={{ value: search, onChange: setSearch, placeholder: "Search flags…" }}
          actions={<SavedViewsControls listKey="shell:admin-feature-flags" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.tag,
            title: search ? "No matches" : "No flags yet",
            description: search
              ? "Try a different search term."
              : "Add a feature flag to gate new functionality.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New flag</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New feature flag"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => create(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save flag"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Key" required hint="snake_case, lowercase">
              <input
                className="input font-mono text-sm"
                placeholder="snake_case_key"
                pattern="[a-z][a-z0-9_]*"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Label" required>
              <input
                className="input"
                placeholder="Human-readable label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </FormField>
          </div>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              placeholder="What does this flag control?"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
