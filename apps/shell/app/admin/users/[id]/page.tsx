"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  Toast,
} from "../../../../components/ui";

interface Role {
  id: string;
  roleName: string;
  isSystem: boolean;
}
interface UserDetail {
  id: string;
  email: string;
  fullName: string;
  role: string;
  userRoles: { role: Role }[];
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [users, roles] = await Promise.all([
        api.get<UserDetail[]>("/roles/users/list"),
        api.get<Role[]>("/roles"),
      ]);
      const u = users.find((x) => x.id === params.id);
      if (!u) throw new Error("User not found");
      setUser(u);
      setAllRoles(roles);
      setSelected(new Set(u.userRoles.map((ur) => ur.role.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/roles/users/${user.id}/roles`, { roleIds: [...selected] });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const dirty = useMemo(() => {
    if (!user) return false;
    const server = new Set(user.userRoles.map((ur) => ur.role.id));
    if (server.size !== selected.size) return true;
    for (const s of selected) if (!server.has(s)) return true;
    return false;
  }, [user, selected]);

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Users", href: "/admin/users" },
    { label: user?.fullName ?? "User" },
  ];

  if (error && !user) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="User"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading user…" />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </AppShell>
    );
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={user.fullName}
        subtitle={user.email}
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <Button
              variant="brand"
              disabled={!dirty || saving}
              onClick={save}
              type="button"
            >
              {saving ? "Saving…" : dirty ? "Save" : "No changes"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-3xl space-y-4">
        {user.role === "admin" && (
          <Card className="p-3 text-xs text-brand-800 bg-brand-50 border-brand-200">
            Legacy admin flag — treated as SystemManager. Assign explicit roles below to
            migrate away from the legacy flag.
          </Card>
        )}

        <section>
          <SectionHeader title="Roles" />
          <Card className="p-0">
            <ul className="divide-y divide-ink-muted/10">
              {allRoles.map((r) => (
                <li key={r.id} className="px-4 py-2 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <a
                    href={`/admin/roles/${r.id}`}
                    className="text-sm text-brand-600 hover:text-brand-700 hover:underline flex-1"
                  >
                    {r.roleName}
                  </a>
                  {r.isSystem && <span className="badge-gray">System</span>}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="User" docId={params.id} />
      </div>
</AppShell>
  );
}
