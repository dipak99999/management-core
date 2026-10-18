"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  Toast,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

// D9: Contact list detail — shows members, and (for static lists) lets you
// add/remove them. Dynamic lists surface the saved filter with an "Edit
// filter" shortcut back into the same drawer the list index uses.

interface ContactList {
  id: string;
  name: string;
  description: string | null;
  isDynamic: boolean;
  memberCount: number;
  filterJson: { doctype: "Customer" | "Lead"; where?: Record<string, unknown> } | null;
}
interface Member {
  contactType: "Customer" | "Lead";
  contactId: string;
  name: string;
  email: string | null;
}
interface Customer {
  id: string;
  customerName: string;
  email?: string | null;
}
interface Lead {
  id: string;
  leadName: string;
  email?: string | null;
}

interface EditFormState {
  name: string;
  description: string;
  isDynamic: boolean;
  doctype: "Customer" | "Lead";
  whereJson: string;
}

export default function ContactListDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [list, setList] = useState<ContactList | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-member drawer
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<"Customer" | "Lead">("Customer");
  const [addId, setAddId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  // Bulk-add drawer
  const [showBulk, setShowBulk] = useState(false);
  const [bulkType, setBulkType] = useState<"Customer" | "Lead">("Customer");
  const [bulkWhere, setBulkWhere] = useState("");

  // Edit-list drawer (reuses the same shape the index page uses).
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>({
    name: "",
    description: "",
    isDynamic: false,
    doctype: "Customer",
    whereJson: "",
  });

  async function loadList() {
    try {
      const l = await api.get<ContactList>(`/contact-lists/${id}`);
      setList(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load list");
    }
  }
  async function loadMembers() {
    try {
      setMembers(await api.get<Member[]>(`/contact-lists/${id}/members`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members");
    }
  }
  async function loadAll() {
    setLoading(true);
    await Promise.all([loadList(), loadMembers()]);
    setLoading(false);
  }
  useEffect(() => {
    loadAll();
    // Only fetch pickers once — small enough at MVP scale, filtered client-side.
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api.get<Lead[]>("/leads").then(setLeads).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function openEdit() {
    if (!list) return;
    setEditForm({
      name: list.name,
      description: list.description ?? "",
      isDynamic: list.isDynamic,
      doctype: (list.filterJson?.doctype ?? "Customer") as "Customer" | "Lead",
      whereJson: list.filterJson?.where
        ? JSON.stringify(list.filterJson.where, null, 2)
        : "",
    });
    setShowEdit(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let filterJson:
        | { doctype: "Customer" | "Lead"; where?: Record<string, unknown> }
        | null = null;
      if (editForm.isDynamic) {
        let where: Record<string, unknown> | undefined;
        const trimmed = editForm.whereJson.trim();
        if (trimmed) {
          try {
            where = JSON.parse(trimmed);
          } catch {
            throw new Error("Filter JSON is not valid JSON");
          }
        }
        filterJson = { doctype: editForm.doctype, ...(where ? { where } : {}) };
      }
      await api.put(`/contact-lists/${id}`, {
        name: editForm.name,
        description: editForm.description || null,
        isDynamic: editForm.isDynamic,
        filterJson,
      });
      setShowEdit(false);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!addId) {
      setError(`Pick a ${addType.toLowerCase()} to add`);
      return;
    }
    try {
      await api.post(`/contact-lists/${id}/add-member`, {
        contactType: addType,
        contactId: addId,
      });
      setShowAdd(false);
      setAddId("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    }
  }

  async function removeMember(m: Member) {
    if (!confirm(`Remove ${m.name} from this list?`)) return;
    try {
      await api.post(`/contact-lists/${id}/remove-member`, {
        contactType: m.contactType,
        contactId: m.contactId,
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    }
  }

  async function bulkAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let where: Record<string, unknown> | undefined;
      const trimmed = bulkWhere.trim();
      if (trimmed) {
        try {
          where = JSON.parse(trimmed);
        } catch {
          throw new Error("Filter JSON is not valid JSON");
        }
      }
      await api.post(`/contact-lists/${id}/bulk-add`, {
        contactType: bulkType,
        ...(where ? { where } : {}),
      });
      setShowBulk(false);
      setBulkWhere("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to bulk add");
    }
  }

  const columns: Column<Member>[] = useMemo(() => {
    const cols: Column<Member>[] = [
      {
        header: "Type",
        cell: (m) =>
          m.contactType === "Customer" ? (
            <span className="badge-brand">Customer</span>
          ) : (
            <span className="badge-blue">Lead</span>
          ),
      },
      {
        header: "Name",
        cell: (m) => <span className="font-medium text-ink">{m.name}</span>,
      },
      {
        header: "Email",
        cell: (m) => (
          <span className="text-ink-soft">{m.email ?? "—"}</span>
        ),
      },
    ];
    if (list && !list.isDynamic) {
      cols.push({
        header: "",
        align: "right",
        cell: (m) => (
          <div className="flex justify-end">
            <button
              onClick={() => removeMember(m)}
              className="btn-ghost btn-sm text-red-600 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  if (!list && !loading && error) {
    return (
      <>
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
        <div>
          <a href="/crm/contact-lists" className="text-sm text-brand-600 hover:underline">
            ← Back to lists
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={list?.name ?? "Loading…"}
        subtitle={
          list ? (
            <span>
              {list.description ?? "No description"} ·{" "}
              <span className="tabular-nums">{list.memberCount}</span> member
              {list.memberCount === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
        breadcrumb={[
          { label: "Contact Lists", href: "/crm/contact-lists" },
          { label: list?.name ?? "…" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {list && !list.isDynamic && (
              <>
                <Button variant="secondary" onClick={() => setShowBulk(true)}>
                  + Bulk add
                </Button>
                <Button variant="brand" onClick={() => setShowAdd(true)}>
                  + Add member
                </Button>
              </>
            )}
            {list && list.isDynamic && (
              <Button variant="brand" onClick={openEdit}>
                Edit filter
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {list && list.isDynamic && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-ink-muted font-medium">
              Dynamic filter
            </div>
            <span className="badge-violet">Resolved on every send</span>
          </div>
          <div className="text-sm text-ink-soft mb-2">
            Contact type:{" "}
            <span className="font-medium text-ink">
              {list.filterJson?.doctype ?? "—"}
            </span>
          </div>
          <pre className="font-mono text-xs bg-surface-sunken border border-ink-muted/10 rounded-lg p-3 overflow-x-auto text-ink">
            {list.filterJson?.where
              ? JSON.stringify(list.filterJson.where, null, 2)
              : "// no filter — all records of this type"}
          </pre>
        </div>
      )}

      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={members}
          rowKey={(m) => `${m.contactType}:${m.contactId}`}
          loading={loading}
          empty={{
            icon: Icon.users,
            title: list?.isDynamic ? "Filter matched no records" : "No members yet",
            description: list?.isDynamic
              ? "Adjust the filter to include more records."
              : "Add customers or leads to this list to reach them via campaigns.",
            action:
              list && !list.isDynamic ? (
                <Button variant="brand" onClick={() => setShowAdd(true)}>
                  + Add member
                </Button>
              ) : list && list.isDynamic ? (
                <Button variant="brand" onClick={openEdit}>
                  Edit filter
                </Button>
              ) : undefined,
          }}
        />
      </div>
      {members.length === 0 ? (
        <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
          {list?.isDynamic ? "Filter matched no records" : "No members yet"}
        </div>
      ) : (
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {members.map((m) => (
            <li key={`${m.contactType}:${m.contactId}`} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{m.name}</div>
                  {m.email && <div className="text-xs text-ink-muted truncate">{m.email}</div>}
                </div>
                <span className="text-xs text-ink-muted rounded bg-surface-sunken px-2 py-0.5">
                  {m.contactType}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => addMember(e as unknown as React.FormEvent)}
            >
              Add
            </Button>
          </>
        }
      >
        <form onSubmit={addMember} className="space-y-4">
          <FormField label="Contact type" required>
            <select
              className="input"
              value={addType}
              onChange={(e) => {
                setAddType(e.target.value as "Customer" | "Lead");
                setAddId("");
              }}
            >
              <option value="Customer">Customer</option>
              <option value="Lead">Lead</option>
            </select>
          </FormField>
          <FormField label={addType} required>
            <select
              className="input"
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              required
            >
              <option value="">— pick a {addType.toLowerCase()} —</option>
              {addType === "Customer"
                ? customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.customerName}
                      {c.email ? ` (${c.email})` : ""}
                    </option>
                  ))
                : leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.leadName}
                      {l.email ? ` (${l.email})` : ""}
                    </option>
                  ))}
            </select>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={showBulk}
        onClose={() => setShowBulk(false)}
        title="Bulk add members"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowBulk(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => bulkAdd(e as unknown as React.FormEvent)}
            >
              Add matches
            </Button>
          </>
        }
      >
        <form onSubmit={bulkAdd} className="space-y-4">
          <FormField label="Contact type" required>
            <select
              className="input"
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value as "Customer" | "Lead")}
            >
              <option value="Customer">Customer</option>
              <option value="Lead">Lead</option>
            </select>
          </FormField>
          <FormField
            label="Filter (Prisma where clause, JSON)"
            hint="Leave empty to add every record of the selected type."
          >
            <textarea
              className="input font-mono text-xs"
              rows={6}
              placeholder={`{"territoryId": "..."}`}
              value={bulkWhere}
              onChange={(e) => setBulkWhere(e.target.value)}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title="Edit contact list"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => saveEdit(e as unknown as React.FormEvent)}
            >
              Save changes
            </Button>
          </>
        }
      >
        <form onSubmit={saveEdit} className="space-y-4">
          <FormField label="Name" required>
            <input
              required
              className="input"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={2}
              value={editForm.description}
              onChange={(e) =>
                setEditForm({ ...editForm, description: e.target.value })
              }
            />
          </FormField>
          <FormField label="Dynamic list">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.isDynamic}
                onChange={(e) =>
                  setEditForm({ ...editForm, isDynamic: e.target.checked })
                }
              />
              <span className="text-sm text-ink-soft">
                {editForm.isDynamic ? "Dynamic (filter-driven)" : "Static (manual)"}
              </span>
            </label>
          </FormField>
          {editForm.isDynamic && (
            <div className="space-y-4 rounded-lg border border-ink-muted/10 bg-surface-sunken p-3">
              <FormField label="Contact type" required>
                <select
                  className="input"
                  value={editForm.doctype}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
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
                  value={editForm.whereJson}
                  onChange={(e) =>
                    setEditForm({ ...editForm, whereJson: e.target.value })
                  }
                />
              </FormField>
            </div>
          )}
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="ContactList" docId={params.id} />
      </div>
    </>
  );
}
