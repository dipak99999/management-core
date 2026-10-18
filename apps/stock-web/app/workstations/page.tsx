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
  Toast,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Workstation {
  id: string;
  name: string;
  hourRate: string;
  workingHoursPerDay: string;
  description: string | null;
}

const emptyForm = {
  name: "",
  hourRate: 0,
  workingHoursPerDay: 8,
  description: "",
};

export default function WorkstationsPage() {
  const [rows, setRows] = useState<Workstation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Workstation[]>("/workstations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Workstation",
    plural: "Workstations",
    refresh: load,
  });
  function close() {
    setForm(emptyForm);
    setShowForm(false);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/workstations", { ...form, description: form.description || null });
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<Workstation>[] = [
    { header: "Name", cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
    {
      header: "Hour rate",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink">{Number(r.hourRate).toFixed(2)}</span>,
    },
    {
      header: "Hours/day",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{Number(r.workingHoursPerDay)}</span>,
    },
    {
      header: "Description",
      cell: (r) => <span className="text-xs text-ink-muted">{r.description ?? "—"}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Workstations"
        subtitle={`${rows.length} workstation${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New workstation</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search workstations…" }}
          actions={<SavedViewsControls listKey="stock-web:workstations" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.settings,
            title: search ? "No matches" : "No workstations yet",
            description: search
              ? "Try a different search term."
              : "A workstation is a resource with a per-hour cost referenced by BOM operations.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add workstation</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title="New workstation"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>
              Create workstation
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Name" required>
            <input
              required
              className="input"
              placeholder="e.g. CNC Mill 1"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Hour rate">
              <input
                type="number"
                step="any"
                min={0}
                className="input"
                value={form.hourRate}
                onChange={(e) => setForm({ ...form, hourRate: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Working hours / day">
              <input
                type="number"
                step="0.5"
                min={0.5}
                className="input"
                value={form.workingHoursPerDay}
                onChange={(e) => setForm({ ...form, workingHoursPerDay: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <FormField label="Description">
            <textarea
              className="input"
              placeholder="Optional"
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
