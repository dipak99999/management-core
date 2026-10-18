"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { dashboardApi } from "../../lib/dashboards";
import { AppShell, Icon } from "../../components/app-shell";
import { SHELL_NAV } from "../../components/shell-nav";
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
} from "../../components/ui";

interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  isShared: boolean;
  ownerUserId: string;
  _count: { cards: number };
}

const emptyForm = { name: "", description: "", isShared: false };

export default function DashboardsListPage() {
  const [rows, setRows] = useState<Dashboard[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    try {
      setRows(await dashboardApi.get<Dashboard[]>("/dashboards"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Dashboard",
    plural: "Dashboards",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await dashboardApi.post<{ id: string }>("/dashboards", {
        name: form.name,
        description: form.description || null,
        isShared: form.isShared,
      });
      window.location.href = `/dashboards/${r.id}/edit`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.description].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Dashboards"
        subtitle={`${rows.length} dashboard${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New dashboard
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
          search={{ value: search, onChange: setSearch, placeholder: "Search dashboards…" }}
          actions={<SavedViewsControls listKey="shell:dashboards" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />

        {filtered.length === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon={Icon.bar}
              title={search ? "No matches" : "No dashboards yet"}
              description={
                search
                  ? "Try a different search term."
                  : "Create your first dashboard to start visualising data."
              }
              action={
                !search && (
                  <Button variant="brand" onClick={() => setShowForm(true)}>
                    + New dashboard
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((r) => (
              <a
                key={r.id}
                href={`/dashboards/${r.id}`}
                className="card p-4 hover:shadow-brand-glow transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-medium text-ink">{r.name}</h2>
                  {r.isShared && <span className="badge-blue">Shared</span>}
                </div>
                {r.description && (
                  <p className="text-xs text-ink-muted mt-1">{r.description}</p>
                )}
                <p className="text-xs text-ink-muted mt-3">
                  {r._count.cards} card{r._count.cards === 1 ? "" : "s"}
                </p>
              </a>
            ))}
          </div>
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New dashboard"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => create(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create dashboard"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Name" required>
            <input
              className="input"
              placeholder="Dashboard name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              placeholder="What does this dashboard show?"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField label="Sharing">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.isShared}
                onChange={(e) => setForm({ ...form, isShared: e.target.checked })}
              />
              Share with everyone in tenant
            </label>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
