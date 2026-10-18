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
  StatusBadge,
  Toast,
  relativeTime,
  type Column,
} from "../../../components/ui";

interface PortalUser {
  id: string;
  email: string;
  displayName: string | null;
  partyType: string;
  partyId: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Party { id: string; label: string }

const emptyForm = {
  email: "",
  displayName: "",
  partyType: "Customer" as "Customer" | "Supplier",
  partyId: "",
};

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

function token(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

async function listParties(kind: "customers" | "suppliers"): Promise<Party[]> {
  const r = await fetch(`${ACC}/${kind}`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!r.ok) return [];
  const data = (await r.json()) as Array<Record<string, unknown>>;
  return data.map((p) => ({
    id: p.id as string,
    label:
      (p.customerName as string) ??
      (p.supplierName as string) ??
      (p.id as string),
  }));
}

export default function PortalUsersPage() {
  const [rows, setRows] = useState<PortalUser[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<PortalUser[]>("/portal-auth/users"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Portal User",
    plural: "Portal Users",
    refresh: load,
  });
  useEffect(() => {
    (async () => {
      const kind = form.partyType === "Customer" ? "customers" : "suppliers";
      setParties(await listParties(kind));
      setForm((s) => ({ ...s, partyId: "" }));
    })();
     
  }, [form.partyType]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInviteLink(null);
    try {
      const r = await api.post<{ inviteLink: string }>("/portal-auth/invite", form);
      setInviteLink(r.inviteLink);
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/portal-auth/users/${id}/disable`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.email, r.displayName ?? "", r.partyType].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<PortalUser>[] = [
    {
      header: "Email",
      cell: (r) => (
        <div>
          <div className="text-ink font-medium">{r.email}</div>
          {r.displayName && <div className="text-xs text-ink-muted">{r.displayName}</div>}
        </div>
      ),
    },
    {
      header: "Party",
      cell: (r) => (
        <span className="text-xs text-ink-soft">
          {r.partyType} · <span className="font-mono">{r.partyId.slice(0, 8)}…</span>
        </span>
      ),
    },
    {
      header: "Last login",
      cell: (r) => (
        <span className="text-xs text-ink-soft">
          {r.lastLoginAt ? relativeTime(r.lastLoginAt) : "never"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.isActive ? "Active" : "Cancelled"} />,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button
          onClick={(e) => toggle(r.id, e)}
          className="text-xs text-brand-600 hover:underline"
        >
          {r.isActive ? "Disable" : "Enable"}
        </button>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Portal Users"
        subtitle="Customers & suppliers who can log into the self-service portal (separate from staff accounts)."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Portal Users" }]}
        actions={
          <Button
            variant="brand"
            onClick={() => {
              setShowForm(true);
              setInviteLink(null);
            }}
          >
            + Invite portal user
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {inviteLink && (
        <div className="mb-4">
          <Toast
            kind="success"
            message={`Invite emailed. Direct link: ${inviteLink}`}
            onDismiss={() => setInviteLink(null)}
          />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search portal users…" }}
          actions={<SavedViewsControls listKey="shell:admin-portal-users" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.users,
            title: search ? "No matches" : "No portal users yet",
            description: search
              ? "Try a different search term."
              : "Invite a customer or supplier to access the portal.",
            action: !search && (
              <Button
                variant="brand"
                onClick={() => {
                  setShowForm(true);
                  setInviteLink(null);
                }}
              >
                + Invite portal user
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Invite portal user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => invite(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Sending…" : "Send invite"}
            </Button>
          </>
        }
      >
        <form onSubmit={invite} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Party type">
              <select
                className="input"
                value={form.partyType}
                onChange={(e) =>
                  setForm({ ...form, partyType: e.target.value as "Customer" | "Supplier" })
                }
              >
                <option value="Customer">Customer</option>
                <option value="Supplier">Supplier</option>
              </select>
            </FormField>
            <FormField label="Party" required>
              <select
                className="input"
                value={form.partyId}
                onChange={(e) => setForm({ ...form, partyId: e.target.value })}
                required
              >
                <option value="">Select party…</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Email" required>
            <input
              type="email"
              className="input"
              placeholder="portal@customer.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Display name">
            <input
              className="input"
              placeholder="Optional"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
