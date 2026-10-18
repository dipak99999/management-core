"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

interface Canned {
  id: string;
  name: string;
  category: string | null;
  subject: string | null;
  body: string;
  usageCount: number;
  updatedAt: string;
}

const emptyForm = { name: "", category: "", subject: "", body: "" };

export default function CannedResponsesPage() {
  const [rows, setRows] = useState<Canned[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Canned | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Canned[]>("/desk/canned-responses"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Canned",
    plural: "Canned",
    refresh: load,
  });
  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(c: Canned) {
    setEditing(c);
    setForm({
      name: c.name,
      category: c.category ?? "",
      subject: c.subject ?? "",
      body: c.body,
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        subject: form.subject.trim() || null,
        body: form.body,
      };
      if (editing) {
        await api.put(`/desk/canned-responses/${editing.id}`, payload);
        setMsg("Response updated");
      } else {
        await api.post("/desk/canned-responses", payload);
        setMsg("Response created");
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Canned) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try {
      await api.del(`/desk/canned-responses/${c.id}`);
      setMsg("Deleted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.category, r.subject, r.body]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  // Group by category for a cleaner display.
  const groups = useMemo(() => {
    const m = new Map<string, Canned[]>();
    for (const r of filtered) {
      const k = r.category || "Uncategorised";
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const columns: Column<Canned>[] = [
    {
      header: "Shortcut",
      cell: (c) => (
        <button
          onClick={() => openEdit(c)}
          className="font-mono text-sm text-brand-600 hover:text-brand-700 text-start"
        >
          /{c.name}
        </button>
      ),
    },
    { header: "Subject", cell: (c) => <span className="text-ink-soft">{c.subject ?? "—"}</span> },
    {
      header: "Body",
      cell: (c) => (
        <div className="text-ink-muted text-xs max-w-md truncate">
          {c.body.replace(/\s+/g, " ").slice(0, 120)}
        </div>
      ),
    },
    {
      header: "Uses",
      align: "right",
      cell: (c) => <span className="tabular-nums text-ink-soft">{c.usageCount}</span>,
    },
    {
      header: "Updated",
      cell: (c) => <span className="text-ink-muted text-xs">{dateShort(c.updatedAt)}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <div className="flex items-center gap-2 justify-end">
          <button onClick={() => openEdit(c)} className="text-xs text-brand-600 hover:underline">Edit</button>
          <button onClick={() => remove(c)} className="text-xs text-red-600 hover:underline">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Canned Responses"
        subtitle={`${rows.length} reusable repl${rows.length === 1 ? "y" : "ies"} · pick one from the ticket reply composer`}
        actions={<Button variant="brand" onClick={openNew}>+ New Response</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search name, category, subject, body…" }}
          actions={<SavedViewsControls listKey="crm-web:desk-canned" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        {rows.length === 0 && !loading ? (
          <DataTable
            columns={columns}
            rows={[]}
            rowKey={(c) => c.id}
            empty={{
              icon: Icon.book,
              title: "No canned responses yet",
              description: "Save reusable snippets your agents can drop into replies with one click.",
              action: <Button variant="brand" onClick={openNew}>+ New Response</Button>,
            }}
          />
        ) : (
          groups.map(([cat, list]) => (
            <div key={cat} className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted px-1">
                {cat} <span className="text-ink-muted/60">· {list.length}</span>
              </div>
              <DataTable
                columns={columns}
                rows={list}
                rowKey={(c) => c.id}
                loading={loading}
              />
            </div>
          ))
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? "Edit response" : "New canned response"}
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.name.trim() || !form.body.trim()}
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Create response"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Shortcut" required hint="Used as /shortcut in the reply composer">
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.replace(/\s+/g, "-").toLowerCase() })}
                placeholder="greeting"
                required
                autoFocus
              />
            </FormField>
            <FormField label="Category">
              <input
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Billing, General"
              />
            </FormField>
          </div>

          <FormField label="Subject (optional — overrides ticket subject when picked)">
            <input
              className="input"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Re: your recent ticket"
            />
          </FormField>

          <FormField label="Body" required>
            <textarea
              className="input min-h-[220px] font-mono text-[13px]"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Hi {{first_name}}, thanks for reaching out…"
              required
            />
          </FormField>

          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
