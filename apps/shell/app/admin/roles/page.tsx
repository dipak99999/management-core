"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
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

interface RoleRow {
  id: string;
  roleName: string;
  isSystem: boolean;
  _count: { userRoles: number; permissions: number };
}

export default function RolesListPage() {
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<RoleRow[]>("/roles"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Role",
    plural: "Roles",
    refresh: load,
  });
  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/roles", { roleName: newName });
      setNewName("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.roleName.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<RoleRow>[] = [
    {
      header: "Role",
      cell: (r) => (
        <a
          href={`/admin/roles/${r.id}`}
          className="font-medium text-ink hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.roleName}
        </a>
      ),
    },
    {
      header: "Kind",
      cell: (r) =>
        r.isSystem ? (
          <span className="badge-gray">System</span>
        ) : (
          <span className="badge-blue">Custom</span>
        ),
    },
    {
      header: "Users",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r._count.userRoles}</span>,
    },
    {
      header: "Permissions",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r._count.permissions}</span>,
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Roles"
        subtitle="Roles bundle permissions and are assigned to users. System roles are seeded per tenant and cannot be deleted; you can add custom roles."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Roles" }]}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New role
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
          search={{ value: search, onChange: setSearch, placeholder: "Search roles…" }}
          actions={<SavedViewsControls listKey="shell:admin-roles" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/admin/roles/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.shield,
            title: search ? "No matches" : "No roles yet",
            description: search ? "Try a different search term." : "Create a role to get started.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New role</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New role"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => createRole(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create role"}
            </Button>
          </>
        }
      >
        <form onSubmit={createRole} className="space-y-4">
          <FormField label="Role name" required>
            <input
              className="input"
              placeholder="e.g. Warehouse Auditor"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              autoFocus
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
