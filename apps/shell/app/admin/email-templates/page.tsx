"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  type Column,
} from "../../../components/ui";

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  enabled: boolean;
}

const emptyForm = { name: "", subject: "", body: "", category: "", enabled: true };

export default function EmailTemplatesPage() {
  const [rows, setRows] = useState<Template[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Template[]>("/email-templates"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Email Template",
    plural: "Email Templates",
    refresh: load,
  });
  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(t: Template) {
    setEditing(t);
    setForm({
      name: t.name,
      subject: t.subject,
      body: t.body,
      category: t.category ?? "",
      enabled: t.enabled,
    });
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        subject: form.subject,
        body: form.body,
        category: form.category || null,
        enabled: form.enabled,
      };
      if (editing) {
        await api.put(`/email-templates/${editing.id}`, payload);
      } else {
        await api.post("/email-templates", payload);
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete template?")) return;
    try {
      await api.delete(`/email-templates/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.subject, r.category].filter(Boolean).some((v) =>
        String(v).toLowerCase().includes(q),
      ),
    );
  }, [rows, search]);

  const columns: Column<Template>[] = [
    {
      header: "Name",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    { header: "Subject", cell: (r) => <span className="text-xs text-ink-soft">{r.subject}</span> },
    { header: "Category", cell: (r) => <span className="text-xs text-ink-soft">{r.category ?? "—"}</span> },
    {
      header: "Enabled",
      cell: (r) => (
        <span className={r.enabled ? "badge-green" : "badge-gray"}>
          {r.enabled ? "Yes" : "No"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="space-x-2 text-xs">
          <button onClick={() => openEdit(r)} className="text-brand-600 hover:underline">
            Edit
          </button>
          <button onClick={() => del(r.id)} className="text-red-600 hover:underline">
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Email templates" }]}
        title="Email templates"
        subtitle={
          <>
            Use <code>{"{{variable}}"}</code> tokens in subject &amp; body. Rendered at
            send-time via <code>/emails/send-from-template</code>.
          </>
        }
        actions={
          <Button variant="brand" onClick={openNew} type="button">
            + New template
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search templates…" }}
          actions={<SavedViewsControls listKey="shell:admin-email-templates" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{ title: "No templates yet" }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? "Edit template" : "New template"}
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => submit(e as unknown as React.FormEvent)}
              disabled={busy}
              type="button"
            >
              {busy ? "Saving…" : editing ? "Update" : "Save"}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Name" required>
              <input
                className="input"
                placeholder="Template name (unique)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Category">
              <input
                className="input"
                placeholder="Optional"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Subject" required>
            <input
              className="input"
              placeholder="Subject (with {{tokens}})"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Body (HTML supported)" required>
            <textarea
              className="input font-mono text-sm"
              rows={10}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              required
            />
          </FormField>
          <label className="text-sm flex items-center gap-2 text-ink-soft">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
