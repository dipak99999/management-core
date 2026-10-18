"use client";

// Super admin → AI Providers.
// Configure platform-wide API keys for Claude (Anthropic), OpenAI,
// Brew, Azure OpenAI, or Ollama. Any tenant without their own
// TenantIntegration row falls back to the provider marked default here.

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button, Card, DataTable, Drawer, FormField, PageHeader, Toast, type Column,
} from "../../../../components/ui";

type ProviderKind = "anthropic" | "openai" | "brew" | "azure-openai" | "ollama";
interface Provider {
  id: string;
  provider: ProviderKind;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  defaultModel: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  lastTestedAt: string | null;
  lastTestResult: string | null;
}

const PROVIDERS: Array<{ value: ProviderKind; label: string; needsBaseUrl: boolean; defaultModel: string; help: string }> = [
  { value: "anthropic",    label: "Anthropic (Claude)",      needsBaseUrl: false, defaultModel: "claude-3-5-haiku-20241022", help: "Get an API key at console.anthropic.com." },
  { value: "openai",       label: "OpenAI",                  needsBaseUrl: false, defaultModel: "gpt-4o-mini",                help: "API key from platform.openai.com." },
  { value: "brew",         label: "Brew AI (OpenAI-compat)", needsBaseUrl: true,  defaultModel: "brew-default",               help: "Brew workspace token + the base URL from your Brew console." },
  { value: "azure-openai", label: "Azure OpenAI",            needsBaseUrl: true,  defaultModel: "gpt-4o-mini",                help: "API key + Azure deployment endpoint URL." },
  { value: "ollama",       label: "Ollama (self-hosted)",    needsBaseUrl: true,  defaultModel: "llama3.1",                   help: "No API key needed. Base URL points at your Ollama server." },
];

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
  provider: "anthropic" as ProviderKind,
  label: "",
  apiKey: "",
  baseUrl: "",
  defaultModel: "",
  isActive: true,
  isDefault: false,
  priority: 100,
};

export default function AiProvidersPage() {
  const [rows, setRows] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const providerMeta = PROVIDERS.find((p) => p.value === form.provider)!;

  async function load() {
    setLoading(true);
    try {
      setRows(await api<Provider[]>("/super/ai-providers"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  useListPageCommands({
    singular: "Ai Provider",
    plural: "Ai Providers",
    refresh: load,
  });

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, defaultModel: providerMeta.defaultModel });
    setShowForm(true);
  }
  function openEdit(row: Provider) {
    setEditingId(row.id);
    setForm({
      provider: row.provider,
      label: row.label,
      apiKey: "", // never prefilled — operator re-enters to rotate
      baseUrl: row.baseUrl ?? "",
      defaultModel: row.defaultModel ?? "",
      isActive: row.isActive,
      isDefault: row.isDefault,
      priority: row.priority,
    });
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        provider: form.provider,
        label: form.label,
        isActive: form.isActive,
        isDefault: form.isDefault,
        priority: Number(form.priority),
      };
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
      if (form.baseUrl.trim()) payload.baseUrl = form.baseUrl.trim();
      if (form.defaultModel.trim()) payload.defaultModel = form.defaultModel.trim();

      if (editingId) {
        await api(`/super/ai-providers/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setMsg("Provider updated.");
      } else {
        await api("/super/ai-providers", { method: "POST", body: JSON.stringify(payload) });
        setMsg("Provider created.");
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this provider? Tenants using it fall back to the next active one.")) return;
    try {
      await api(`/super/ai-providers/${id}`, { method: "DELETE" });
      await load();
      setMsg("Provider deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function activate(id: string) {
    try {
      await api(`/super/ai-providers/${id}/activate`, { method: "POST" });
      await load();
      setMsg("Default provider updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function test(id: string) {
    setTestingId(id);
    try {
      const r = await api<{ ok: boolean; provider: string; model: string; snippet: string }>(
        `/super/ai-providers/${id}/test`, { method: "POST" },
      );
      setMsg(`✓ ${r.provider} / ${r.model} replied: ${r.snippet || "(empty)"}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
      await load();
    } finally {
      setTestingId(null);
    }
  }

  const columns: Column<Provider>[] = [
    {
      header: "Provider",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{r.label}</span>
          {r.isDefault && <span className="chip chip-solid-navy text-[10px]">DEFAULT</span>}
          {!r.isActive && <span className="chip text-[10px]">INACTIVE</span>}
        </div>
      ),
    },
    { header: "Kind",       cell: (r) => <span className="text-sm">{r.provider}</span> },
    { header: "Model",      cell: (r) => <span className="text-sm text-ink-muted">{r.defaultModel ?? "—"}</span> },
    {
      header: "API key",
      cell: (r) => r.hasApiKey
        ? <span className="text-xs text-green-700 font-semibold">CONFIGURED</span>
        : <span className="text-xs text-amber-700 font-semibold">MISSING</span>,
    },
    { header: "Priority",   cell: (r) => <span className="text-sm tabular-nums">{r.priority}</span> },
    {
      header: "Last test",
      cell: (r) => r.lastTestedAt ? (
        <div className="text-xs">
          <div>{new Date(r.lastTestedAt).toLocaleString()}</div>
          <div className={r.lastTestResult === "ok" ? "text-green-700" : "text-red-700"}>
            {r.lastTestResult?.slice(0, 60)}
          </div>
        </div>
      ) : <span className="text-xs text-ink-muted">—</span>,
    },
    {
      header: "",
      cell: (r) => (
        <div className="flex gap-1.5 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => test(r.id)}
            disabled={testingId === r.id || (!r.hasApiKey && r.provider !== "ollama")}
          >
            {testingId === r.id ? "Testing…" : "Test"}
          </Button>
          {!r.isDefault && (
            <Button variant="ghost" size="sm" onClick={() => activate(r.id)}>
              Make default
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>
          <Button variant="danger" size="sm" onClick={() => remove(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell moduleName="Admin" nav={SHELL_NAV}>
      <PageHeader
        title="AI Providers"
        subtitle="Platform-level fallback keys for Claude, OpenAI, Brew, Azure, Ollama. Tenants without their own key fall back to the default here."
        actions={<Button variant="brand" onClick={openCreate}>+ Add provider</Button>}
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
            title: "No providers configured",
            description: "Add Claude, OpenAI, Brew, Azure or Ollama as the platform fallback.",
            action: <Button variant="brand" onClick={openCreate}>+ Add provider</Button>,
          }}
        />
      </Card>

      <Drawer open={showForm} title={editingId ? "Edit provider" : "Add provider"} onClose={() => setShowForm(false)}>
        <form onSubmit={submit} className="p-6 space-y-4">
          <FormField label="Provider" required>
            <select
              className="input"
              value={form.provider}
              onChange={(e) => {
                const next = e.target.value as ProviderKind;
                const meta = PROVIDERS.find((p) => p.value === next)!;
                setForm((f) => ({ ...f, provider: next, defaultModel: meta.defaultModel }));
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <p className="text-xs text-ink-muted mt-1">{providerMeta.help}</p>
          </FormField>

          <FormField label="Label" required>
            <input
              className="input" required
              placeholder="e.g. Platform Claude (fallback)"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </FormField>

          {form.provider !== "ollama" && (
            <FormField label={editingId ? "API key (leave blank to keep current)" : "API key"} required={!editingId}>
              <input
                className="input" type="password" autoComplete="off"
                placeholder={editingId ? "•••••••••••••••" : "sk-ant-… / sk-… / brew_…"}
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                required={!editingId}
              />
            </FormField>
          )}

          {providerMeta.needsBaseUrl && (
            <FormField label="Base URL" required>
              <input
                className="input" type="url" required
                placeholder={form.provider === "ollama" ? "http://localhost:11434" : "https://your.endpoint/v1"}
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
            </FormField>
          )}

          <FormField label="Default model">
            <input
              className="input"
              placeholder={providerMeta.defaultModel}
              value={form.defaultModel}
              onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Priority (lower = tried first)">
              <input
                className="input" type="number" min={0} step={1}
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
              />
            </FormField>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isDefault}
                  onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} />
                Default fallback for all tenants
              </label>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" variant="brand">{editingId ? "Save" : "Create"}</Button>
          </div>
        </form>
      </Drawer>
    </AppShell>
  );
}
