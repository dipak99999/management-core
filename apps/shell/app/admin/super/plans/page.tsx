"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button, Card, DataTable, Drawer, FilterBar, FormField, PageHeader, Toast, type Column,
} from "../../../../components/ui";
import { Icon } from "../../../../components/app-shell";
import { MODULES, MODULE_REGISTRY } from "@lumaara/shared-types";

interface Tenant { id: string; slug: string; name: string; activePlan: { id: string; name: string } | null }
interface Plan {
  id: string; name: string; tier: string; priceMonthlyInr: string;
  allowedModules: string[]; allowedSubmodules: string[]; isDefault: boolean;
}
const TIERS = ["starter", "pro", "enterprise", "custom"] as const;
type Tier = (typeof TIERS)[number];

function getToken(): string {
  if (typeof window === "undefined") return "";
  try { return (JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? ""); } catch { return ""; }
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const r = await fetch(`/api/auth-svc${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

const emptyForm = {
  name: "", tier: "starter" as Tier, priceMonthlyInr: 0,
  allowedModules: [] as string[], allowedSubmodules: [] as string[],
};

function InnerPage() {
  const search = useSearchParams();
  const preselectTenant = search.get("tenantId");

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string>(preselectTenant ?? "");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { void api<Tenant[]>("/super/tenants").then(setTenants).catch(() => {}); }, []);
  async function loadPlans(tid: string) {
    if (!tid) { setPlans([]); return; }
    setLoading(true);
    try { setPlans(await api<Plan[]>(`/super/tenants/${tid}/plans`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadPlans(tenantId); }, [tenantId]);

  function openCreate() { setEditing(null); setForm(emptyForm); setShowForm(true); }
  function openEdit(p: Plan) {
    setEditing(p);
    setForm({
      name: p.name, tier: p.tier as Tier, priceMonthlyInr: Number(p.priceMonthlyInr),
      allowedModules: p.allowedModules, allowedSubmodules: p.allowedSubmodules,
    });
    setShowForm(true);
  }
  function toggleModule(key: string) {
    setForm((f) => {
      const has = f.allowedModules.includes(key);
      const nextModules = has ? f.allowedModules.filter((m) => m !== key) : [...f.allowedModules, key];
      // When toggling off a module, drop its submodules too.
      const nextSubs = has
        ? f.allowedSubmodules.filter((s) => !s.startsWith(key + "."))
        : f.allowedSubmodules;
      return { ...f, allowedModules: nextModules, allowedSubmodules: nextSubs };
    });
  }
  function toggleSubmodule(subKey: string) {
    setForm((f) => ({
      ...f,
      allowedSubmodules: f.allowedSubmodules.includes(subKey)
        ? f.allowedSubmodules.filter((s) => s !== subKey)
        : [...f.allowedSubmodules, subKey],
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) { setError("Pick a tenant first"); return; }
    try {
      if (editing) {
        await api(`/super/plans/${editing.id}`, { method: "PATCH", body: JSON.stringify(form) });
        setMsg("Plan updated");
      } else {
        await api(`/super/tenants/${tenantId}/plans`, { method: "POST", body: JSON.stringify(form) });
        setMsg("Plan created");
      }
      setShowForm(false);
      await loadPlans(tenantId);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
  }

  async function del(p: Plan) {
    if (!confirm(`Delete plan "${p.name}"? Only works if no tenant is subscribed to it.`)) return;
    try {
      await api(`/super/plans/${p.id}`, { method: "DELETE" });
      await loadPlans(tenantId);
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  }

  const cols: Column<Plan>[] = [
    { header: "Plan", cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: "Tier", cell: (p) => <span className="badge-gray">{p.tier}</span> },
    { header: "Price/mo", cell: (p) => <span className="font-mono">₹{Number(p.priceMonthlyInr).toFixed(0)}</span> },
    { header: "Modules", cell: (p) => <span className="text-xs text-ink-soft">{p.allowedModules.join(", ") || "—"}</span> },
    { header: "Submodules", cell: (p) => <span className="text-xs text-ink-soft">{p.allowedSubmodules.length}</span> },
    { header: "", cell: (p) => (
      <div className="flex gap-2 justify-end">
        <button className="text-xs text-brand-700 hover:underline" onClick={() => openEdit(p)}>Edit</button>
        <button className="text-xs text-red-600 hover:underline" onClick={() => void del(p)}>Delete</button>
      </div>
    )},
  ];

  const availableSubmodules = useMemo(() => {
    return MODULE_REGISTRY.filter((m) => form.allowedModules.includes(m.key));
  }, [form.allowedModules]);

  return (
    <AppShell moduleName="Admin" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.target}
        title="Subscription Plans"
        subtitle="Super-admin view. Create module/submodule bundles tenants can subscribe to."
        breadcrumb={[{ label: "Admin" }, { label: "Super Admin" }, { label: "Plans" }]}
        actions={<Button variant="brand" onClick={openCreate} disabled={!tenantId}>+ New plan</Button>}
      />
      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: "", onChange: () => {}, placeholder: "" }}
          filters={
            <select className="input w-96" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="">— Pick a tenant to manage its plans —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.slug}) — current: {t.activePlan?.name ?? "none"}
                </option>
              ))}
            </select>
          }
        />
        {!tenantId ? (
          <Card className="p-8 text-center text-ink-muted">Pick a tenant above to see its plans.</Card>
        ) : (
          <DataTable columns={cols} rows={plans} rowKey={(p) => p.id} loading={loading}
            empty={{ title: "No plans", description: "Create one via the + button.", action: <Button variant="brand" onClick={openCreate}>+ New plan</Button> }} />
        )}
      </div>

      <Drawer open={showForm} onClose={() => setShowForm(false)}
        title={editing ? `Edit ${editing.name}` : "New plan"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>{editing ? "Save" : "Create"}</Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Plan name" required>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Tier">
              <select className="input" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}>
                {TIERS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Monthly price (₹)">
              <input className="input" type="number" min={0} value={form.priceMonthlyInr}
                onChange={(e) => setForm({ ...form, priceMonthlyInr: Number(e.target.value) || 0 })} />
            </FormField>
          </div>
          <FormField label="Modules">
            <div className="grid grid-cols-2 gap-2">
              {MODULES.map((m) => (
                <label key={m} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.allowedModules.includes(m)} onChange={() => toggleModule(m)} />
                  {m}
                </label>
              ))}
            </div>
          </FormField>
          {availableSubmodules.length > 0 && (
            <FormField label="Submodules (per enabled module)" hint="Granular access. Un-check to hide specific pages while keeping the module.">
              <div className="space-y-3">
                {availableSubmodules.map((m) => (
                  <div key={m.key}>
                    <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">{m.label}</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {m.submodules.map((sm) => (
                        <label key={sm.key} className="inline-flex items-center gap-2">
                          <input type="checkbox" checked={form.allowedSubmodules.includes(sm.key)} onChange={() => toggleSubmodule(sm.key)} />
                          {sm.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </FormField>
          )}
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InnerPage />
    </Suspense>
  );
}
