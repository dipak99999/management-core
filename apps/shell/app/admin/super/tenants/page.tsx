"use client";

import { useEffect, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button, Card, DataTable, FilterBar, PageHeader, Toast, type Column,
} from "../../../../components/ui";
import { Icon } from "../../../../components/app-shell";

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  activePlan: { id: string; name: string; tier: string; allowedModules: string[] } | null;
}
interface Plan {
  id: string;
  name: string;
  tier: string;
  priceMonthlyInr: string;
  allowedModules: string[];
  allowedSubmodules: string[];
  isDefault: boolean;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  try { return (JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? ""); } catch { return ""; }
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const r = await fetch(`/api/auth-svc${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status}: ${text.slice(0, 200)}`);
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

export default function SuperAdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assignOpen, setAssignOpen] = useState<TenantRow | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  async function load() {
    setLoading(true);
    try { setTenants(await api<TenantRow[]>("/super/tenants")); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  useListPageCommands({
    singular: "Tenant",
    plural: "Tenants",
    refresh: load,
  });
  async function openAssign(t: TenantRow) {
    setAssignOpen(t);
    setSelectedPlanId(t.activePlan?.id ?? "");
    try { setPlans(await api<Plan[]>(`/super/tenants/${t.id}/plans`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load plans"); }
  }

  async function assignPlan() {
    if (!assignOpen || !selectedPlanId) return;
    try {
      await api(`/super/tenants/${assignOpen.id}/subscribe`, {
        method: "POST", body: JSON.stringify({ planId: selectedPlanId }),
      });
      setMsg(`Plan assigned to ${assignOpen.name}`);
      setAssignOpen(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to assign"); }
  }

  const filtered = tenants.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.slug, t.name, t.activePlan?.name].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });

  const cols: Column<TenantRow>[] = [
    { header: "Slug", cell: (t) => <span className="font-mono text-xs">{t.slug}</span> },
    { header: "Tenant name", cell: (t) => <span className="font-medium">{t.name}</span> },
    { header: "Active plan", cell: (t) => (
      t.activePlan
        ? <span className="badge-gray">{t.activePlan.name} <span className="text-xs text-ink-muted">({t.activePlan.tier})</span></span>
        : <span className="text-red-600 text-xs">No plan</span>
    )},
    { header: "Modules", cell: (t) => (
      <span className="text-xs text-ink-soft">
        {t.activePlan?.allowedModules.join(", ") ?? "—"}
      </span>
    )},
    { header: "", cell: (t) => (
      <Button variant="secondary" onClick={() => void openAssign(t)}>Change plan</Button>
    )},
  ];

  return (
    <AppShell moduleName="Admin" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.briefcase}
        title="Tenants"
        subtitle="Super-admin view. Assign subscription plans across every tenant on this instance."
        breadcrumb={[{ label: "Admin" }, { label: "Super Admin" }, { label: "Tenants" }]}
      />
      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}
      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search by slug or name…" }}
          actions={<SavedViewsControls listKey="shell:admin-super-tenants" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable columns={cols} rows={filtered} rowKey={(t) => t.id} loading={loading}
          empty={{ title: "No tenants", description: "No tenants on this instance yet." }} />
      </div>

      {assignOpen && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center p-6 z-50" onClick={() => setAssignOpen(null)}>
          <Card className="w-full max-w-lg p-6 bg-white" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Change plan for {assignOpen.name}</h3>
            <p className="text-xs text-ink-muted mb-4">Current: {assignOpen.activePlan?.name ?? "none"}</p>
            {plans.length === 0 ? (
              <p className="text-sm text-ink-muted">
                This tenant has no plans yet.{" "}
                <a className="text-brand-700 hover:underline" href={`/admin/super/plans?tenantId=${assignOpen.id}`}>
                  Create one →
                </a>
              </p>
            ) : (
              <>
                <select
                  className="input w-full mb-4"
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                >
                  <option value="">— Pick a plan —</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.tier} · {p.allowedModules.length} modules
                    </option>
                  ))}
                </select>
                <div className="flex gap-2 justify-end">
                  <Button variant="secondary" onClick={() => setAssignOpen(null)}>Cancel</Button>
                  <Button variant="brand" onClick={() => void assignPlan()}>Assign</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
