"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { InlineEditCell, useListPageCommands, Tour, type TourStep, SavedViewsControls } from "@lumaara/web-ui";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { CustomFieldsForm } from "../../lib/custom-fields";
import { BulkActionsBar, useRowSelection } from "../../lib/bulk-actions";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Supplier {
  id: string;
  supplierName: string;
  supplierType: string;
  supplierGroup: string | null;
  email: string | null;
  gstin: string | null;
  taxWithholdingCategoryId: string | null;
  customData?: Record<string, unknown> | null;
}
interface TdsCategoryLite {
  id: string;
  name: string;
  rate: string;
  disabled: boolean;
}

const emptyForm = {
  supplierName: "",
  supplierType: "Company",
  email: "",
  gstin: "",
  taxWithholdingCategoryId: "",
};
const emptyCustom: Record<string, unknown> = {};

function InnerSuppliersPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [customData, setCustomData] = useState<Record<string, unknown>>(emptyCustom);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tdsCategories, setTdsCategories] = useState<TdsCategoryLite[]>([]);
  const [search, setSearch] = useState("");
  const selection = useRowSelection(rows);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Supplier[]>("/suppliers"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api
      .get<TdsCategoryLite[]>("/tax-withholding-categories")
      .then(setTdsCategories)
      .catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Supplier",
    plural: "Suppliers",
    refresh: load,
  });
  const tourSteps: TourStep[] = [
    { target: "[data-tour=buying-suppliers-v1-header]", title: "Suppliers", body: "This is where you manage suppliers. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=buying-suppliers-v1-new]", title: "Create a new supplier", body: "Click here to add your first supplier. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=buying-suppliers-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  useEffect(() => {
    if (!editId) return;
    api
      .get<Supplier>(`/suppliers/${editId}`)
      .then((s) => {
        setForm({
          supplierName: s.supplierName,
          supplierType: s.supplierType,
          email: s.email ?? "",
          gstin: s.gstin ?? "",
          taxWithholdingCategoryId: s.taxWithholdingCategoryId ?? "",
        });
        setCustomData((s.customData as Record<string, unknown>) ?? {});
        setEditingId(editId);
        setShowForm(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        ...form,
        taxWithholdingCategoryId: form.taxWithholdingCategoryId || null,
        customData,
      };
      if (editingId) {
        await api.put(`/suppliers/${editingId}`, payload);
      } else {
        await api.post("/suppliers", payload);
      }
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  function close() {
    setForm(emptyForm);
    setCustomData(emptyCustom);
    setEditingId(null);
    setShowForm(false);
    if (editId) window.history.replaceState({}, "", "/buying/suppliers");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) =>
      [s.supplierName, s.email, s.gstin]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Supplier>[] = [
    {
      header: (
        <input
          type="checkbox"
          checked={selection.allSelected}
          onChange={selection.toggleAll}
          aria-label="Select all"
        />
      ),
      width: "32px",
      cell: (s) => (
        <span onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selection.isSelected(s.id)}
            onChange={() => selection.toggle(s.id)}
            aria-label={`Select ${s.supplierName}`}
          />
        </span>
      ),
    },
    {
      header: "Name",
      cell: (s) => (
        <span onClick={(e) => e.stopPropagation()}>
          <InlineEditCell
            value={s.supplierName}
            save={async (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === s.supplierName) return;
              await api.put(`/suppliers/${s.id}`, { supplierName: trimmed });
              await load();
            }}
            display={(v) => (
              <a
                href={`/buying/suppliers/${s.id}`}
                className="font-medium text-ink hover:text-brand-700"
                onClick={(e) => e.stopPropagation()}
              >
                {v}
              </a>
            )}
          />
        </span>
      ),
    },
    {
      header: "Type",
      cell: (s) => (
        <span className={s.supplierType === "Company" ? "badge-brand" : "badge-gray"}>
          {s.supplierType}
        </span>
      ),
    },
    { header: "Email", cell: (s) => <span className="text-ink-soft">{s.email ?? "—"}</span> },
    { header: "GSTIN", cell: (s) => <span className="font-mono text-xs">{s.gstin ?? "—"}</span> },
  ];

  return (
    <>
      <Tour id="buying-web.suppliers.v1" steps={tourSteps} />
      <div data-tour="buying-suppliers-v1-header">
      <PageHeader
        title="Suppliers"
        subtitle={`${rows.length} supplier${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New supplier
          </Button>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <BulkActionsBar
        doctype="Supplier"
        selectedIds={selection.selected}
        onClear={selection.clear}
        onDone={load}
      />

      <div className="space-y-4">
        <div data-tour="buying-suppliers-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search suppliers…" }}
          actions={<SavedViewsControls listKey="buying-web:suppliers" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(s) => s.id}
          onRowClick={(s) => (window.location.href = `/buying/suppliers/${s.id}`)}
          loading={loading}
          empty={{
            icon: Icon.users,
            title: search ? "No matches" : "No suppliers yet",
            description: search
              ? "Try a different search term."
              : "Add your first supplier to start purchasing.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add supplier</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit supplier" : "New supplier"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create supplier"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Supplier name" required>
            <input
              className="input"
              placeholder="Acme Supplies"
              value={form.supplierName}
              onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Type">
            <select
              className="input"
              value={form.supplierType}
              onChange={(e) => setForm({ ...form, supplierType: e.target.value })}
            >
              <option>Company</option>
              <option>Individual</option>
            </select>
          </FormField>
          <FormField label="Email">
            <input
              className="input"
              type="email"
              placeholder="billing@supplier.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FormField>
          <FormField label="GSTIN / Tax ID">
            <input
              className="input font-mono"
              placeholder="Optional"
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value })}
            />
          </FormField>
          <FormField
            label="Default TDS category"
            hint="Optional — auto-fills on payments"
          >
            <select
              className="input"
              value={form.taxWithholdingCategoryId}
              onChange={(e) =>
                setForm({ ...form, taxWithholdingCategoryId: e.target.value })
              }
            >
              <option value="">— None —</option>
              {tdsCategories
                .filter((c) => !c.disabled)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({Number(c.rate).toFixed(2)}%)
                  </option>
                ))}
            </select>
          </FormField>
          <CustomFieldsForm
            doctype="Supplier"
            value={customData}
            onChange={setCustomData}
          />
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function SuppliersPage() {
  return (
    <Suspense fallback={null}>
      <InnerSuppliersPage />
    </Suspense>
  );
}
