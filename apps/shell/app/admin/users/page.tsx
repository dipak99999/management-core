"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  createdAt: string;
  userRoles: { role: { id: string; roleName: string } }[];
}

export default function UsersListPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get<UserRow[]>("/roles/users/list")
      .then((rs) => {
        setRows(rs);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed");
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) =>
      [u.fullName, u.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<UserRow>[] = [
    {
      header: "Name",
      cell: (u) => (
        <a
          href={`/admin/users/${u.id}`}
          className="font-medium text-ink hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {u.fullName}
        </a>
      ),
    },
    { header: "Email", cell: (u) => <span className="text-ink-soft">{u.email}</span> },
    {
      header: "Roles",
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.userRoles.length === 0 && u.role === "admin" && (
            <span className="badge-violet">legacy admin</span>
          )}
          {u.userRoles.map((ur) => (
            <span key={ur.role.id} className="badge-gray">{ur.role.roleName}</span>
          ))}
        </div>
      ),
    },
    { header: "Joined", cell: (u) => <span className="text-ink-soft">{dateShort(u.createdAt)}</span> },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Users"
        subtitle={`${rows.length} user${rows.length === 1 ? "" : "s"}`}
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Users" }]}
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search users…" }}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(u) => u.id}
          onRowClick={(u) => (window.location.href = `/admin/users/${u.id}`)}
          loading={loading}
          empty={{
            icon: Icon.users,
            title: search ? "No matches" : "No users",
            description: search ? "Try a different search term." : "No users in this tenant.",
          }}
        />
      </div>
    </AppShell>
  );
}
