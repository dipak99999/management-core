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

interface Permission {
  id: string;
  doctype: string;
  action: string;
}
interface RoleUserRow {
  user: { id: string; email: string; fullName: string };
}
interface RoleDetail {
  id: string;
  roleName: string;
  isSystem: boolean;
  permissions: Permission[];
  userRoles: RoleUserRow[];
}
interface Meta {
  doctypes: string[];
  actions: string[];
}

export default function RoleDetailPage() {
  const params = useParams<{ id: string }>();
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [r, m] = await Promise.all([
        api.get<RoleDetail>(`/roles/${params.id}`),
        api.get<Meta>("/roles/meta"),
      ]);
      setRole(r);
      setMeta(m);
      setGrants(new Set(r.permissions.map((p) => `${p.doctype}:${p.action}`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function toggle(doctype: string, action: string) {
    const key = `${doctype}:${action}`;
    setGrants((g) => {
      const n = new Set(g);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function toggleRow(doctype: string) {
    if (!meta) return;
    const fullyGranted = meta.actions.every((a) => grants.has(`${doctype}:${a}`));
    setGrants((g) => {
      const n = new Set(g);
      for (const a of meta.actions) {
        const key = `${doctype}:${a}`;
        if (fullyGranted) n.delete(key);
        else n.add(key);
      }
      return n;
    });
  }

  async function save() {
    if (!role) return;
    setSaving(true);
    setError(null);
    try {
      const grantArr = [...grants].map((k) => {
        const [doctype, action] = k.split(":");
        return { doctype, action };
      });
      await api.put(`/roles/${role.id}/permissions`, { grants: grantArr });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const dirty = useMemo(() => {
    if (!role) return false;
    const server = new Set(role.permissions.map((p) => `${p.doctype}:${p.action}`));
    if (server.size !== grants.size) return true;
    for (const g of grants) if (!server.has(g)) return true;
    return false;
  }, [role, grants]);

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Roles", href: "/admin/roles" },
    { label: role?.roleName ?? "Role" },
  ];

  if (error && !role) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="Role"
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

  if (!role || !meta) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading role…" />
        <Skeleton className="h-96" rounded="rounded-lg" />
      </AppShell>
    );
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={role.roleName}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            {role.isSystem && <span className="badge-gray">System</span>}
            <span>
              {role.userRoles.length} user{role.userRoles.length !== 1 ? "s" : ""} assigned
            </span>
            <span className="text-ink-muted">·</span>
            <span>
              {grants.size} permission{grants.size !== 1 ? "s" : ""}
            </span>
          </span>
        }
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
              {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-6xl space-y-6">
        <section>
          <SectionHeader title="Permissions" />
          <Card className="p-0 overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken text-start text-ink-muted">
                  <tr>
                    <th className="px-4 py-2">Doctype</th>
                    {meta.actions.map((a) => (
                      <th key={a} className="px-4 py-2 text-center capitalize">
                        {a}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-center">All</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.doctypes.map((dt) => {
                    const rowFull = meta.actions.every((a) => grants.has(`${dt}:${a}`));
                    return (
                      <tr key={dt} className="border-t border-ink-muted/10">
                        <td className="px-4 py-2 font-mono text-xs text-ink">{dt}</td>
                        {meta.actions.map((a) => {
                          const on = grants.has(`${dt}:${a}`);
                          return (
                            <td key={a} className="px-4 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggle(dt, a)}
                              />
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={rowFull}
                            onChange={() => toggleRow(dt)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <ul className="md:hidden space-y-2">
            {meta.doctypes.map((dt) => {
              const rowFull = meta.actions.every((a) => grants.has(`${dt}:${a}`));
              return (
                <li key={dt} className="rounded-xl border border-ink/10 bg-canvas p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-mono text-xs text-ink">{dt}</div>
                    <label className="flex items-center gap-1 text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        checked={rowFull}
                        onChange={() => toggleRow(dt)}
                      />
                      All
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {meta.actions.map((a) => (
                      <label key={a} className="flex items-center gap-2 text-xs capitalize">
                        <input
                          type="checkbox"
                          checked={grants.has(`${dt}:${a}`)}
                          onChange={() => toggle(dt, a)}
                        />
                        {a}
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {role.userRoles.length > 0 && (
          <section>
            <SectionHeader title="Users with this role" />
            <Card className="p-0">
              <ul className="divide-y divide-ink-muted/10">
                {role.userRoles.map((ur) => (
                  <li key={ur.user.id} className="px-4 py-2 text-sm">
                    <a
                      href={`/admin/users/${ur.user.id}`}
                      className="text-brand-600 hover:text-brand-700 hover:underline"
                    >
                      {ur.user.fullName}
                    </a>{" "}
                    <span className="text-ink-muted">· {ur.user.email}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Role" docId={params.id} />
      </div>
</AppShell>
  );
}
