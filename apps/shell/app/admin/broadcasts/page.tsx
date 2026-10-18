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
  type Column,
} from "../../../components/ui";

interface Broadcast {
  id: string;
  name: string;
  subject: string;
  audience: string;
  status: string;
  recipientCount: number;
  sentAt: string | null;
  createdAt: string;
}
interface Template { id: string; name: string }

const AUDIENCES = ["Customers", "Suppliers", "Employees", "Leads"];

const emptyForm = {
  subject: "",
  body: "",
  templateId: "",
  audience: "Customers",
};

export default function BroadcastsPage() {
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [bs, ts] = await Promise.all([
        api.get<Broadcast[]>("/broadcasts"),
        api.get<Template[]>("/email-templates"),
      ]);
      setRows(bs);
      setTemplates(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Broadcast",
    plural: "Broadcasts",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>("/broadcasts", {
        subject: form.subject,
        body: form.body,
        templateId: form.templateId || null,
        audience: form.audience,
      });
      window.location.href = `/admin/broadcasts/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.subject, r.audience].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Broadcast>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/admin/broadcasts/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Audience", cell: (r) => <span className="text-ink-soft">{r.audience}</span> },
    { header: "Subject", cell: (r) => <span className="text-ink">{r.subject}</span> },
    {
      header: "Recipients",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r.recipientCount}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Broadcasts"
        subtitle={`${rows.length} broadcast${rows.length === 1 ? "" : "s"}`}
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Broadcasts" }]}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New broadcast
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search broadcasts…" }}
          actions={<SavedViewsControls listKey="shell:admin-broadcasts" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/admin/broadcasts/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.megaphone,
            title: search ? "No matches" : "No broadcasts yet",
            description: search
              ? "Try a different search term."
              : "Send an email to a segment of your contacts.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New broadcast</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New broadcast"
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => create(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create draft"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Audience">
              <select
                className="input"
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
              >
                {AUDIENCES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Template">
              <select
                className="input"
                value={form.templateId}
                onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              >
                <option value="">Use raw subject/body</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>Template: {t.name}</option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Subject" required>
            <input
              className="input"
              placeholder="Subject"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Body" required hint="HTML supported; use {{name}} and {{email}} tokens">
            <textarea
              className="input font-mono text-sm"
              rows={10}
              placeholder="Body"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              required
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
