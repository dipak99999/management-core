"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  Toast,
  relativeTime,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

// D9: Zoho-Campaigns-Plus style Contact Lists page.
//
// Two shapes live under one UI: Static (curated bag of contacts) and
// Dynamic (a saved Prisma `where` filter, resolved fresh on every send).
// The drawer swaps in a filter builder when Dynamic is toggled on.

interface ContactList {
  id: string;
  name: string;
  description: string | null;
  isDynamic: boolean;
  memberCount: number;
  updatedAt: string;
  createdAt: string;
  filterJson?: { doctype: "Customer" | "Lead"; where?: Record<string, unknown> } | null;
}

type TypeFilter = "all" | "static" | "dynamic";

interface FormState {
  name: string;
  description: string;
  isDynamic: boolean;
  doctype: "Customer" | "Lead";
  whereJson: string;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  isDynamic: false,
  doctype: "Customer",
  whereJson: "",
};

export default function ContactListsPage() {
  const [rows, setRows] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<ContactList[]>("/contact-lists"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Contact List",
    plural: "Contact Lists",
    refresh: load,
  });
  function edit(l: ContactList, ev: React.MouseEvent) {
    ev.stopPropagation();
    setForm({
      name: l.name,
      description: l.description ?? "",
      isDynamic: l.isDynamic,
      doctype: (l.filterJson?.doctype ?? "Customer") as "Customer" | "Lead",
      whereJson: l.filterJson?.where ? JSON.stringify(l.filterJson.where, null, 2) : "",
    });
    setEditingId(l.id);
    setShowForm(true);
  }

  function close() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let filterJson:
        | { doctype: "Customer" | "Lead"; where?: Record<string, unknown> }
        | null = null;
      if (form.isDynamic) {
        let where: Record<string, unknown> | undefined;
        const trimmed = form.whereJson.trim();
        if (trimmed) {
          try {
            where = JSON.parse(trimmed);
          } catch {
            throw new Error("Filter JSON is not valid JSON");
          }
        }
        filterJson = { doctype: form.doctype, ...(where ? { where } : {}) };
      }
      const body = {
        name: form.name,
        description: form.description || null,
        isDynamic: form.isDynamic,
        filterJson,
      };
      if (editingId) await api.put(`/contact-lists/${editingId}`, body);
      else await api.post("/contact-lists", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this contact list?")) return;
    try {
      await api.del(`/contact-lists/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((l) => {
      if (typeFilter === "static" && l.isDynamic) return false;
      if (typeFilter === "dynamic" && !l.isDynamic) return false;
      if (q && !`${l.name} ${l.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, typeFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      static: rows.filter((r) => !r.isDynamic).length,
      dynamic: rows.filter((r) => r.isDynamic).length,
    }),
    [rows],
  );

  const totalMembers = useMemo(
    () => rows.reduce((s, r) => s + (r.memberCount ?? 0), 0),
    [rows],
  );

  const columns: Column<ContactList>[] = [
    {
      header: "Name",
      cell: (l) => (
        <div>
          <a
            href={`/crm/contact-lists/${l.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {l.name}
          </a>
        </div>
      ),
    },
    {
      header: "Description",
      cell: (l) => (
        <span className="text-sm text-ink-soft line-clamp-1">
          {l.description ?? "—"}
        </span>
      ),
    },
    {
      header: "Type",
      cell: (l) =>
        l.isDynamic ? (
          <span className="badge-violet">Dynamic</span>
        ) : (
          <span className="badge-blue">Static</span>
        ),
    },
    {
      header: "Members",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums font-medium text-ink">{l.memberCount}</span>
      ),
    },
    {
      header: "Updated",
      cell: (l) => (
        <span className="text-sm text-ink-soft">{relativeTime(l.updatedAt)}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (l) => (
        <div className="flex justify-end gap-2">
          <button onClick={(e) => edit(l, e)} className="btn-ghost btn-sm">
            Edit
          </button>
          <button
            onClick={(e) => remove(l.id, e)}
            className="btn-ghost btn-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Contact Lists"
        subtitle={
          rows.length === 0
            ? "Segment customers and leads for campaigns and sequences"
            : `${rows.length} list${rows.length === 1 ? "" : "s"} · ${totalMembers} member${totalMembers === 1 ? "" : "s"}`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New list
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
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search list name or description…",
          }}
          filters={
            <Segmented<TypeFilter>
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "static", label: "Static", count: counts.static },
                { value: "dynamic", label: "Dynamic", count: counts.dynamic },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="crm-web:contact-lists" current={{ search, typeFilter }} onApply={(fv) => { setSearch(fv.search); setTypeFilter(fv.typeFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(l) => l.id}
          onRowClick={(l) => (window.location.href = `/crm/contact-lists/${l.id}`)}
          loading={loading}
          empty={{
            icon: Icon.users,
            title:
              search || typeFilter !== "all"
                ? "No matching lists"
                : "No contact lists yet",
            description:
              search || typeFilter !== "all"
                ? "Try changing your search or filter."
                : "Create a list to segment contacts for campaigns and sequences.",
            action: !search && typeFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New list
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit contact list" : "New contact list"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
            >
              {editingId ? "Save changes" : "Create list"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Name" required>
            <input
              required
              className="input"
              placeholder="Enterprise customers"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={2}
              placeholder="Optional"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField
            label="Dynamic list"
            hint="Static lists have a manual member list. Dynamic lists are resolved fresh from a saved filter on every send."
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDynamic}
                onChange={(e) => setForm({ ...form, isDynamic: e.target.checked })}
              />
              <span className="text-sm text-ink-soft">
                {form.isDynamic ? "Dynamic (filter-driven)" : "Static (manual)"}
              </span>
            </label>
          </FormField>
          {form.isDynamic && (
            <div className="space-y-4 rounded-lg border border-ink-muted/10 bg-surface-sunken p-3">
              <FormField label="Contact type" required>
                <select
                  className="input"
                  value={form.doctype}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      doctype: e.target.value as "Customer" | "Lead",
                    })
                  }
                >
                  <option value="Customer">Customer</option>
                  <option value="Lead">Lead</option>
                </select>
              </FormField>
              <FormField
                label="Filter (Prisma where clause, JSON)"
                hint="Leave empty to include all records of the selected type."
              >
                <textarea
                  className="input font-mono text-xs"
                  rows={6}
                  placeholder={`{"territoryId": "..."}`}
                  value={form.whereJson}
                  onChange={(e) => setForm({ ...form, whereJson: e.target.value })}
                />
              </FormField>
            </div>
          )}
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
