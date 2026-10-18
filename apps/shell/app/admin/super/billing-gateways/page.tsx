"use client";

// Super admin → Billing Gateways. Operator configures Razorpay key_id,
// key_secret and webhook_secret (encrypted at rest with MASTER_SECRET_KEY).
// Only one gateway per (provider, mode) can be active — switching between
// test/live is a one-click flip.

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button, Card, DataTable, Drawer, FormField, PageHeader, Toast, type Column,
} from "../../../../components/ui";

interface Gateway {
  id: string;
  provider: string;
  mode: "test" | "live";
  isActive: boolean;
  keyId: string | null;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  lastTestedAt: string | null;
  lastTestResult: string | null;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  try { return (JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? ""); } catch { return ""; }
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/auth-svc${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}`, ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

const emptyForm = {
  provider: "razorpay",
  mode: "test" as "test" | "live",
  keyId: "",
  keySecret: "",
  webhookSecret: "",
  isActive: true,
};

export default function BillingGatewaysPage() {
  const [rows, setRows] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api<Gateway[]>("/super/billing-gateways"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  useListPageCommands({
    singular: "Billing Gateway",
    plural: "Billing Gateways",
    refresh: load,
  });

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(row: Gateway) {
    setEditingId(row.id);
    setForm({
      provider: row.provider,
      mode: row.mode,
      keyId: row.keyId ?? "",
      keySecret: "", // never prefilled
      webhookSecret: "",
      isActive: row.isActive,
    });
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        provider: form.provider,
        mode: form.mode,
        isActive: form.isActive,
      };
      if (form.keyId.trim()) payload.keyId = form.keyId.trim();
      if (form.keySecret.trim()) payload.keySecret = form.keySecret.trim();
      if (form.webhookSecret.trim()) payload.webhookSecret = form.webhookSecret.trim();
      if (editingId) {
        await api(`/super/billing-gateways/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setMsg("Gateway updated.");
      } else {
        await api("/super/billing-gateways", { method: "POST", body: JSON.stringify(payload) });
        setMsg("Gateway created.");
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this gateway? Tenants currently paying through it will fail at next renewal.")) return;
    try {
      await api(`/super/billing-gateways/${id}`, { method: "DELETE" });
      await load();
      setMsg("Gateway deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function test(id: string) {
    setTestingId(id);
    try {
      const r = await api<{ ok: boolean; orderId: string; keyId: string }>(
        `/super/billing-gateways/${id}/test`, { method: "POST" },
      );
      setMsg(`✓ created test order ${r.orderId}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
      await load();
    } finally {
      setTestingId(null);
    }
  }

  const columns: Column<Gateway>[] = [
    {
      header: "Provider",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium capitalize">{r.provider}</span>
          <span className={`chip ${r.mode === "live" ? "chip-solid-navy" : ""} text-[10px]`}>
            {r.mode.toUpperCase()}
          </span>
          {r.isActive ? (
            <span className="text-xs text-green-700 font-semibold">ACTIVE</span>
          ) : (
            <span className="text-xs text-ink-muted">INACTIVE</span>
          )}
        </div>
      ),
    },
    { header: "Key ID", cell: (r) => <span className="text-sm font-mono">{r.keyId ?? "—"}</span> },
    {
      header: "Secrets",
      cell: (r) => (
        <div className="flex gap-1.5 text-[11px]">
          <span className={r.hasKeySecret ? "text-green-700" : "text-amber-700"}>
            {r.hasKeySecret ? "✓ key_secret" : "✗ key_secret"}
          </span>
          <span className={r.hasWebhookSecret ? "text-green-700" : "text-amber-700"}>
            {r.hasWebhookSecret ? "✓ webhook_secret" : "✗ webhook_secret"}
          </span>
        </div>
      ),
    },
    {
      header: "Last test",
      cell: (r) =>
        r.lastTestedAt ? (
          <div className="text-xs">
            <div>{new Date(r.lastTestedAt).toLocaleString()}</div>
            <div className={r.lastTestResult?.startsWith("ok") ? "text-green-700" : "text-red-700"}>
              {r.lastTestResult?.slice(0, 60)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
    {
      header: "",
      cell: (r) => (
        <div className="flex gap-1.5 justify-end">
          <Button variant="ghost" size="sm" onClick={() => test(r.id)} disabled={testingId === r.id || !r.hasKeySecret}>
            {testingId === r.id ? "Testing…" : "Test"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>
          <Button variant="danger" size="sm" onClick={() => remove(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell moduleName="Admin" nav={SHELL_NAV}>
      <PageHeader
        title="Billing Gateways"
        subtitle="Platform-level payment credentials (Razorpay). Tenants subscribe through the active gateway for the matching mode (test/live)."
        actions={<Button variant="brand" onClick={openCreate}>+ Add gateway</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <Card className="p-4">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            title: "No billing gateway configured",
            description: "Add Razorpay credentials to let tenants subscribe to paid plans.",
            action: <Button variant="brand" onClick={openCreate}>+ Add gateway</Button>,
          }}
        />
      </Card>

      <Drawer open={showForm} title={editingId ? "Edit gateway" : "Add Razorpay gateway"} onClose={() => setShowForm(false)}>
        <form onSubmit={submit} className="p-6 space-y-4">
          <FormField label="Mode" required>
            <select
              className="input"
              value={form.mode}
              onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as "test" | "live" }))}
            >
              <option value="test">Test (sandbox — no real money)</option>
              <option value="live">Live (real charges)</option>
            </select>
          </FormField>

          <FormField label="Key ID" required={!editingId}>
            <input
              className="input" required={!editingId}
              placeholder="rzp_test_… / rzp_live_…"
              value={form.keyId}
              onChange={(e) => setForm((f) => ({ ...f, keyId: e.target.value }))}
            />
            <p className="text-xs text-ink-muted mt-1">From dashboard.razorpay.com → Settings → API Keys.</p>
          </FormField>

          <FormField label={editingId ? "Key Secret (leave blank to keep current)" : "Key Secret"} required={!editingId}>
            <input
              className="input" type="password" autoComplete="off"
              placeholder={editingId ? "•••••••••••••••" : "paste from Razorpay dashboard"}
              value={form.keySecret}
              onChange={(e) => setForm((f) => ({ ...f, keySecret: e.target.value }))}
              required={!editingId}
            />
          </FormField>

          <FormField label={editingId ? "Webhook Secret (leave blank to keep current)" : "Webhook Secret"}>
            <input
              className="input" type="password" autoComplete="off"
              placeholder={editingId ? "•••••••••••••••" : "optional — required to accept webhooks"}
              value={form.webhookSecret}
              onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
            />
            <p className="text-xs text-ink-muted mt-1">
              Configure a webhook at Razorpay → Settings → Webhooks pointing at <code>/api/auth-svc/billing/webhook</code> and paste the secret here.
            </p>
          </FormField>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Active (deactivates any other gateway in the same mode)
          </label>

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" variant="brand">{editingId ? "Save" : "Create"}</Button>
          </div>
        </form>
      </Drawer>
    </AppShell>
  );
}
