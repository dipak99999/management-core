"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  Drawer,
  FormField,
  PageHeader,
  Toast,
} from "../../../components/ui";

interface Company {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

interface UserAccess {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isAdmin: boolean;
  companyIds: string[];
}

// Multi-company Phase 6 admin surface: per-user × company access matrix.
// Rows are users, columns are companies. Admins render as read-only
// (they bypass allowlist checks). Any change is saved with a PUT per
// row — the change is small (a company list swap) so batching would
// only add complexity without visible benefit.
export default function UserAccessPage() {
  const [users, setUsers] = useState<UserAccess[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Local dirty state — keeps unsaved toggles per user until they click Save.
  const [dirty, setDirty] = useState<Record<string, Set<string>>>({});
  // Multi-company Phase 8: bulk dialog state.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCompanyId, setBulkCompanyId] = useState("");
  const [bulkAction, setBulkAction] = useState<"grant" | "revoke">("grant");
  const [bulkUserIds, setBulkUserIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([
        api.get<UserAccess[]>("/companies/user-access"),
        api.get<Company[]>("/companies"),
      ]);
      setUsers(u);
      setCompanies(c);
      setDirty({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "User Acces",
    plural: "User Access",
    refresh: load,
  });

  async function backfill() {
    if (!confirm("Grandfather every existing non-admin user with access to every current Company? Idempotent — safe to re-run.")) return;
    setError(null);
    try {
      const r = await api.post<{
        usersConsidered: number;
        adminsSkipped: number;
        rowsCreated: number;
      }>("/companies/backfill-user-access", {});
      setInfo(
        `Backfill complete — ${r.usersConsidered} users considered, ${r.adminsSkipped} admins skipped, ${r.rowsCreated} new access rows.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backfill failed");
    }
  }

  function toggle(userId: string, companyId: string) {
    setDirty((prev) => {
      const cur = new Set(prev[userId] ?? getInitial(userId));
      if (cur.has(companyId)) cur.delete(companyId);
      else cur.add(companyId);
      return { ...prev, [userId]: cur };
    });
  }

  function getInitial(userId: string): string[] {
    return users.find((u) => u.id === userId)?.companyIds ?? [];
  }

  function isChecked(userId: string, companyId: string): boolean {
    if (dirty[userId]) return dirty[userId].has(companyId);
    return getInitial(userId).includes(companyId);
  }

  function isDirty(userId: string): boolean {
    if (!dirty[userId]) return false;
    const initial = new Set(getInitial(userId));
    const current = dirty[userId];
    if (initial.size !== current.size) return true;
    for (const id of current) if (!initial.has(id)) return true;
    return false;
  }

  function openBulk() {
    // Reset dialog state whenever it opens fresh.
    setBulkCompanyId("");
    setBulkAction("grant");
    setBulkUserIds(new Set());
    setBulkOpen(true);
  }

  function toggleBulkUser(userId: string) {
    setBulkUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function runBulk() {
    if (!bulkCompanyId) {
      setError("Pick a company first");
      return;
    }
    if (bulkUserIds.size === 0) {
      setError("Pick at least one user");
      return;
    }
    setError(null);
    setBulkBusy(true);
    try {
      const r = await api.post<{
        action: string;
        changed: number;
        adminsSkipped: number;
        usersConsidered: number;
      }>("/companies/user-access/bulk", {
        companyId: bulkCompanyId,
        userIds: Array.from(bulkUserIds),
        action: bulkAction,
      });
      const co = companies.find((c) => c.id === bulkCompanyId);
      setInfo(
        `${bulkAction === "grant" ? "Granted" : "Revoked"} ${r.changed} access row(s) for ${co?.name ?? "?"}` +
          (r.adminsSkipped ? ` (${r.adminsSkipped} admin(s) skipped)` : ""),
      );
      setBulkOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function save(userId: string) {
    setError(null);
    setPending((prev) => new Set(prev).add(userId));
    try {
      const companyIds = Array.from(dirty[userId] ?? new Set(getInitial(userId)));
      await api.put(`/companies/user-access/${userId}`, { companyIds });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  function revert(userId: string) {
    setDirty((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.name.localeCompare(b.name))),
    [companies],
  );

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Companies", href: "/accounting/companies" },
          { label: "User Access" },
        ]}
        title="User × Company Access"
        subtitle="Non-admins see only checked companies across all reports and voucher creation. Admins bypass entirely."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={openBulk}>Bulk grant/revoke…</Button>
            <Button variant="secondary" onClick={backfill}>Backfill (grant all)</Button>
          </div>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {info && <div className="mb-4"><Toast kind="success" message={info} onDismiss={() => setInfo(null)} /></div>}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="sticky start-0 bg-panel z-10">User</th>
                {sortedCompanies.map((c) => (
                  <th key={c.id} className="text-center text-xs font-mono px-3" title={c.name}>
                    {c.code}
                    {c.isDefault && <span className="block text-[10px] text-brand-600">default</span>}
                  </th>
                ))}
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={sortedCompanies.length + 2} className="text-center text-ink-muted p-4">Loading…</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={sortedCompanies.length + 2} className="text-center text-ink-muted p-4">No users found.</td></tr>
              )}
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="sticky start-0 bg-panel z-10">
                    <div className="font-medium text-ink">{u.fullName}</div>
                    <div className="text-xs text-ink-muted">{u.email}</div>
                    {u.isAdmin && <span className="badge-blue text-xs">Admin · bypass</span>}
                  </td>
                  {sortedCompanies.map((c) => (
                    <td key={c.id} className="text-center">
                      <input
                        type="checkbox"
                        disabled={u.isAdmin || pending.has(u.id)}
                        checked={u.isAdmin || isChecked(u.id, c.id)}
                        onChange={() => toggle(u.id, c.id)}
                      />
                    </td>
                  ))}
                  <td className="text-end">
                    {!u.isAdmin && isDirty(u.id) && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => revert(u.id)}
                          disabled={pending.has(u.id)}
                        >
                          Revert
                        </button>
                        <button
                          className="btn-brand btn-sm"
                          onClick={() => save(u.id)}
                          disabled={pending.has(u.id)}
                        >
                          {pending.has(u.id) ? "Saving…" : "Save"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Drawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk grant / revoke company access"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button variant="brand" disabled={bulkBusy} onClick={runBulk}>
              {bulkBusy ? "Working…" : bulkAction === "grant" ? "Grant access" : "Revoke access"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Action" required>
            <select
              className="input"
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value as "grant" | "revoke")}
            >
              <option value="grant">Grant access</option>
              <option value="revoke">Revoke access</option>
            </select>
          </FormField>
          <FormField label="Company" required>
            <select
              className="input"
              value={bulkCompanyId}
              onChange={(e) => setBulkCompanyId(e.target.value)}
              required
            >
              <option value="">— pick —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}){c.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Users">
            <div className="border border-line rounded max-h-72 overflow-y-auto">
              {users.filter((u) => !u.isAdmin).map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 p-2 border-b border-line last:border-0 hover:bg-surface-sunken cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={bulkUserIds.has(u.id)}
                    onChange={() => toggleBulkUser(u.id)}
                  />
                  <span className="font-medium text-ink">{u.fullName}</span>
                  <span className="text-xs text-ink-muted">{u.email}</span>
                </label>
              ))}
              {users.filter((u) => !u.isAdmin).length === 0 && (
                <div className="p-3 text-sm text-ink-muted italic">
                  No non-admin users. Admins bypass company access automatically.
                </div>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              {bulkUserIds.size} selected · admins are always skipped
            </div>
          </FormField>
        </div>
      </Drawer>
    </>
  );
}
