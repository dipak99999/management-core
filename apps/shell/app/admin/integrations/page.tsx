"use client";

// Super-admin surface for every external integration the platform knows
// about. Auto-renders one form per entry in `INTEGRATION_CATALOG`
// (packages/db/src/integration-catalog.ts) so adding a new provider is
// one PR to the catalog — no UI change needed here.

import { useEffect, useMemo, useState } from "react";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
// PageHeader is exported from ui.tsx (supports breadcrumb + icon + eyebrow).
import { Button, PageHeader, Toast } from "../../../components/ui";
// The catalog lives in @lumaara/shared-types (pure data, no Prisma or
// Node deps) so it's safe to ship into a browser bundle. See
// packages/shared-types/src/integration-catalog.ts.
import {
  INTEGRATION_CATALOG,
  type ProviderSpec,
  type SecretField,
} from "@lumaara/shared-types";

interface Integration {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

interface FormState {
  provider: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  secrets: Record<string, string>;
  config: Record<string, string>;
}

function emptyForm(defaultSlug: string): FormState {
  return {
    provider: defaultSlug,
    name: "",
    isActive: true,
    isDefault: false,
    secrets: {},
    config: {},
  };
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: SecretField;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === "select") {
    return (
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
      >
        <option value="">— pick one —</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const inputType =
    field.type === "password" ? "password" : field.type === "url" ? "url" : "text";
  return (
    <input
      type={inputType}
      className="input font-mono text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

export default function IntegrationsPage() {
  const [rows, setRows] = useState<Integration[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(INTEGRATION_CATALOG[0]?.slug ?? ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  async function load() {
    try {
      setRows(await dashboardApi.get<Integration[]>("/integrations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post("/integrations", form);
      setSuccess(`${form.provider} connected`);
      setForm(emptyForm(INTEGRATION_CATALOG[0]?.slug ?? ""));
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: Integration) {
    try {
      await dashboardApi.put(`/integrations/${row.id}`, {
        isActive: !row.isActive,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(id: string, name: string) {
    if (!confirm(`Delete integration "${name}"? This clears its secrets.`)) return;
    try {
      await dashboardApi.delete(`/integrations/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const spec: ProviderSpec | undefined = useMemo(
    () => INTEGRATION_CATALOG.find((p) => p.slug === form.provider),
    [form.provider],
  );

  const categories = useMemo(
    () => Array.from(new Set(INTEGRATION_CATALOG.map((p) => p.category))).sort(),
    [],
  );
  const filteredCatalog = useMemo(
    () =>
      filter === "all"
        ? INTEGRATION_CATALOG
        : INTEGRATION_CATALOG.filter((p) => p.category === filter),
    [filter],
  );

  // Group active integrations by provider so admins see coverage at a glance.
  const activeBySlug = useMemo(() => {
    const m = new Map<string, Integration[]>();
    for (const r of rows) {
      const arr = m.get(r.provider) ?? [];
      arr.push(r);
      m.set(r.provider, arr);
    }
    return m;
  }, [rows]);

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.settings}
        eyebrow="Super Admin"
        title="Integrations"
        subtitle="Connect payment gateways, AI providers, notification channels, storage and other third-party services. Every credential is encrypted per tenant."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Integrations" }]}
        actions={
          <Button variant="brand" onClick={() => setShowForm((s) => !s)} type="button">
            {showForm ? "Cancel" : "+ Connect provider"}
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {success && (
        <div className="mb-4">
          <Toast kind="success" message={success} onDismiss={() => setSuccess(null)} />
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="card p-6 mb-6 space-y-4 max-w-3xl">
          <div>
            <label className="label">Provider</label>
            <select
              className="input"
              value={form.provider}
              onChange={(e) =>
                setForm({ ...emptyForm(e.target.value), name: form.name })
              }
            >
              {INTEGRATION_CATALOG.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.displayName} ({p.category})
                </option>
              ))}
            </select>
            {spec && (
              <p className="text-xs text-ink-muted mt-1.5">
                {spec.description}{" "}
                <a
                  href={spec.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-ink hover:text-gold-700"
                >
                  Docs →
                </a>
              </p>
            )}
          </div>

          <div>
            <label className="label">Name</label>
            <input
              className="input"
              placeholder={`e.g. Live ${spec?.displayName ?? ""}`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          {spec && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-ink-muted pt-2 border-t border-ink/8">
                Credentials
              </div>
              {spec.secretFields.map((f) => (
                <div key={f.key}>
                  <label className="label">
                    {f.label}
                    {f.required && <span className="text-red-500 ms-0.5">*</span>}
                  </label>
                  <FieldInput
                    field={f}
                    value={form.secrets[f.key] ?? ""}
                    onChange={(v) =>
                      setForm({ ...form, secrets: { ...form.secrets, [f.key]: v } })
                    }
                  />
                  {f.help && <p className="text-[11px] text-ink-muted mt-1">{f.help}</p>}
                </div>
              ))}

              {spec.configFields && spec.configFields.length > 0 && (
                <>
                  <div className="text-xs font-semibold uppercase tracking-widest text-ink-muted pt-2 border-t border-ink/8">
                    Configuration
                  </div>
                  {spec.configFields.map((f) => (
                    <div key={f.key}>
                      <label className="label">{f.label}</label>
                      <FieldInput
                        field={f}
                        value={form.config[f.key] ?? ""}
                        onChange={(v) =>
                          setForm({ ...form, config: { ...form.config, [f.key]: v } })
                        }
                      />
                      {f.help && (
                        <p className="text-[11px] text-ink-muted mt-1">{f.help}</p>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-4 pt-2">
            <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Default for this provider
            </label>
          </div>

          <Button variant="brand" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save integration"}
          </Button>
        </form>
      )}

      {/* Catalog grid — one card per provider, showing whether it's
          connected. */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={filter === "all" ? "pill-active" : "pill-outline"}
        >
          All ({INTEGRATION_CATALOG.length})
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={filter === c ? "pill-active" : "pill-outline"}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCatalog.map((p) => {
          const connected = activeBySlug.get(p.slug) ?? [];
          return (
            <div key={p.slug} className="card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-ink truncate">{p.displayName}</div>
                  <div className="text-[11px] uppercase tracking-widest text-ink-muted">
                    {p.category}
                  </div>
                </div>
                {connected.length > 0 ? (
                  <span className="chip chip-solid-green">Connected · {connected.length}</span>
                ) : (
                  <span className="chip chip-solid-gray">Not connected</span>
                )}
              </div>
              <p className="text-xs text-ink-muted flex-1">{p.description}</p>
              <div className="flex items-center gap-2">
                <a
                  href={p.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-ink-muted hover:text-ink underline"
                >
                  Docs
                </a>
                <div className="flex-1" />
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setForm({ ...emptyForm(p.slug), name: p.displayName });
                    setShowForm(true);
                  }}
                >
                  + Connect
                </Button>
              </div>

              {connected.length > 0 && (
                <div className="border-t border-ink/8 pt-3 space-y-1.5">
                  {connected.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          c.isActive ? "bg-success" : "bg-ink/25"
                        }`}
                      />
                      <span className="flex-1 truncate">{c.name}</span>
                      {c.isDefault && (
                        <span className="badge-gold text-[9px]">default</span>
                      )}
                      <button
                        onClick={() => toggle(c)}
                        className="text-ink-muted hover:text-ink text-[11px] underline"
                      >
                        {c.isActive ? "disable" : "enable"}
                      </button>
                      <button
                        onClick={() => del(c.id, c.name)}
                        className="text-red-500 hover:text-red-600 text-[11px] underline"
                      >
                        delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
