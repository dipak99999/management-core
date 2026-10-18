"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { CustomFieldsForm } from "../../lib/custom-fields";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../components/ui";
import { InlineEditCell, Tour, useListPageCommands, type TourStep, SavedViewsControls } from "@lumaara/web-ui";
import { Icon } from "../../components/app-shell";
import { BulkActionBar, SelectCell, SelectAllHeader } from "../../components/bulk-action-bar";
import type { CustomerDto } from "@lumaara/shared-types";

// Every field the accounting-service POST /customers zod schema accepts —
// prevents "silently dropped" data on save. See services/accounting-service/
// src/routes/customers.ts:10 for the upsertSchema.
const emptyForm = {
  customerName: "",
  customerType: "Company",
  email: "",
  mobile: "",
  gstin: "",
  pan: "",
  creditLimit: 0,
  creditLimitBypassAllowed: false,
  customerGroupId: "",
  territoryId: "",
  loyaltyProgramId: "",
  defaultPaymentTermsTemplateId: "",
  taxCollectionCategoryId: "",
};

interface OptionRow { id: string; name: string }

function InnerCustomersPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [rows, setRows] = useState<CustomerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [customData, setCustomData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Dropdown option lists. Fetched once on drawer open; empty arrays until
  // then so the selects render but stay empty rather than throwing.
  const [customerGroups, setCustomerGroups] = useState<OptionRow[]>([]);
  const [territories, setTerritories] = useState<OptionRow[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<OptionRow[]>([]);
  const [taxCategories, setTaxCategories] = useState<OptionRow[]>([]);
  const [loyaltyPrograms, setLoyaltyPrograms] = useState<OptionRow[]>([]);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<CustomerDto[]>("/customers?stats=1"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Customer",
    plural: "Customers",
    refresh: load,
  });
  const tourSteps: TourStep[] = [
    { target: "[data-tour=accounting-customers-v1-header]", title: "Customers", body: "This is where you manage customers. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=accounting-customers-v1-new]", title: "Create a new customer", body: "Click here to add your first customer. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=accounting-customers-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  // Load dropdown option lists lazily on first drawer open. `showForm` gate
  // keeps the extra requests off the list-page render path.
  useEffect(() => {
    if (!showForm) return;
    if (customerGroups.length + territories.length + paymentTerms.length + taxCategories.length + loyaltyPrograms.length > 0) return;
    Promise.allSettled([
      api
        .get<Array<{ id: string; groupName: string; isGroup: boolean }>>("/customer-groups")
        .then((r) =>
          setCustomerGroups(
            r.filter((g) => !g.isGroup).map((g) => ({ id: g.id, name: g.groupName })),
          ),
        ),
      api
        .get<Array<{ id: string; territoryName: string; isGroup: boolean }>>("/territories")
        .then((r) =>
          setTerritories(
            r.filter((t) => !t.isGroup).map((t) => ({ id: t.id, name: t.territoryName })),
          ),
        ),
      api.get<Array<{ id: string; name: string }>>("/payment-terms-templates").then((r) =>
        setPaymentTerms(r.map((t) => ({ id: t.id, name: t.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/tax-collection-categories").then((r) =>
        setTaxCategories(r.map((t) => ({ id: t.id, name: t.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/loyalty-programs").then((r) =>
        setLoyaltyPrograms(r.map((t) => ({ id: t.id, name: t.name }))),
      ),
    ]).catch(() => {}); // silent — dropdowns just stay empty on failure
  }, [showForm, customerGroups.length, territories.length, paymentTerms.length, taxCategories.length, loyaltyPrograms.length]);

  useEffect(() => {
    if (!editId) return;
    api.get<CustomerDto & {
      mobile?: string | null;
      pan?: string | null;
      creditLimit?: number | string | null;
      creditLimitBypassAllowed?: boolean | null;
      customerGroupId?: string | null;
      territoryId?: string | null;
      loyaltyProgramId?: string | null;
      defaultPaymentTermsTemplateId?: string | null;
      taxCollectionCategoryId?: string | null;
      customData?: Record<string, unknown> | null;
    }>(`/customers/${editId}`)
      .then((c) => {
        setForm({
          customerName: c.customerName,
          customerType: c.customerType,
          email: c.email ?? "",
          mobile: c.mobile ?? "",
          gstin: c.gstin ?? "",
          pan: c.pan ?? "",
          creditLimit: Number(c.creditLimit ?? 0),
          creditLimitBypassAllowed: !!c.creditLimitBypassAllowed,
          customerGroupId: c.customerGroupId ?? "",
          territoryId: c.territoryId ?? "",
          loyaltyProgramId: c.loyaltyProgramId ?? "",
          defaultPaymentTermsTemplateId: c.defaultPaymentTermsTemplateId ?? "",
          taxCollectionCategoryId: c.taxCollectionCategoryId ?? "",
        });
        setCustomData(c.customData ?? {});
        setEditingId(editId);
        setShowForm(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // Coerce empty-string select values to null so zod treats them as
      // "no selection" rather than "invalid FK". Zod schema is `.optional()
      // .nullable()` on every FK so null is accepted.
      const payload = {
        ...form,
        email: form.email || null,
        mobile: form.mobile || null,
        gstin: form.gstin || null,
        pan: form.pan || null,
        customerGroupId: form.customerGroupId || null,
        territoryId: form.territoryId || null,
        loyaltyProgramId: form.loyaltyProgramId || null,
        defaultPaymentTermsTemplateId: form.defaultPaymentTermsTemplateId || null,
        taxCollectionCategoryId: form.taxCollectionCategoryId || null,
        customData: Object.keys(customData).length > 0 ? customData : null,
      };
      if (editingId) await api.put(`/customers/${editingId}`, payload);
      else await api.post("/customers", payload);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  function close() {
    setForm(emptyForm);
    setCustomData({});
    setEditingId(null);
    setShowForm(false);
    if (editId) window.history.replaceState({}, "", "/accounting/customers");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) =>
      [c.customerName, c.email, c.gstin]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  // Row-selection state for bulk actions. Cleared on filter change.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => { setSelectedIds(new Set()); }, [search]);
  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(filtered.map((c) => c.id)) : new Set());
  }
  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} customer${ids.length === 1 ? "" : "s"}? Each will be rejected if it has invoices.`)) return;
    setBulkBusy(true);
    const failures: string[] = [];
    for (const id of ids) {
      try { await api.del(`/customers/${id}`); }
      catch {
        const row = rows.find((r) => r.id === id);
        failures.push(row?.customerName ?? id);
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    if (failures.length > 0) {
      setError(`Deleted ${ids.length - failures.length} / ${ids.length}. Could not delete: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? `, +${failures.length - 3} more` : ""}.`);
    }
    await load();
  }

  const columns: Column<CustomerDto>[] = [
    {
      header: <SelectAllHeader allSelected={allSelected} onToggleAll={toggleAll} />,
      width: "36px",
      sortable: false,
      cell: (c) => (
        <SelectCell row={c} rowKey={(r) => r.id} selectedIds={selectedIds} onToggle={toggleOne} />
      ),
    },
    {
      header: "Name",
      cell: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <InlineEditCell
            value={c.customerName}
            save={async (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === c.customerName) return;
              await api.put(`/customers/${c.id}`, { customerName: trimmed });
              await load();
            }}
            display={(v) => (
              <a
                href={`/accounting/customers/${c.id}`}
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
      cell: (c) => (
        <span className={c.customerType === "Company" ? "badge-brand" : "badge-gray"}>
          {c.customerType}
        </span>
      ),
    },
    {
      header: "Contact",
      cell: (c) => (
        <div className="leading-tight">
          <div className="text-sm text-ink-soft">{c.email ?? "—"}</div>
          {c.mobile && <div className="text-xs text-ink-muted">{c.mobile}</div>}
        </div>
      ),
    },
    {
      header: "Lifetime billed",
      align: "right",
      cell: (c) => {
        const r = c as CustomerDto & { lifetimeBilled?: number };
        return (
          <span className="tabular-nums text-ink-soft">
            {r.lifetimeBilled && r.lifetimeBilled > 0 ? money(r.lifetimeBilled) : "—"}
          </span>
        );
      },
    },
    {
      header: "Last activity",
      cell: (c) => {
        const r = c as CustomerDto & { lastActivityAt?: string | null };
        return (
          <span className="text-ink-soft">
            {r.lastActivityAt ? dateShort(r.lastActivityAt) : "—"}
          </span>
        );
      },
    },
    { header: "GSTIN", cell: (c) => <span className="font-mono text-xs">{c.gstin ?? "—"}</span> },
  ];

  return (
    <>
      <Tour id="accounting-web.customers.v1" steps={tourSteps} />
      <div data-tour="accounting-customers-v1-header">
      <PageHeader
        icon={Icon.users}
        title="Customers"
        subtitle="Search by name, phone, or email. Click a row to open the customer detail."
        actions={
          <>
            <Button variant="secondary" icon={<span>⇪</span>}>
              Import CSV / Excel
            </Button>
            <Button variant="brand" onClick={() => setShowForm(true)}>
              + New customer
            </Button>
          </>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <BulkActionBar
        count={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          { label: "Delete", onClick: bulkDelete, busy: bulkBusy, danger: true },
        ]}
      />

      <div className="space-y-4">
        <div data-tour="accounting-customers-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search customers…" }}
          actions={<SavedViewsControls listKey="accounting-web:customers" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          onRowClick={(c) => (window.location.href = `/accounting/customers/${c.id}`)}
          loading={loading}
          empty={{
            icon: Icon.users,
            title: search ? "No matches" : "No customers yet",
            description: search
              ? "Try a different search term."
              : "Add your first customer to start invoicing.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add customer</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit customer" : "New customer"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create customer"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Customer name" required>
            <input
              className="input"
              placeholder="Acme Corp"
              value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Type">
            <select
              className="input"
              value={form.customerType}
              onChange={(e) => setForm({ ...form, customerType: e.target.value })}
            >
              <option>Company</option>
              <option>Individual</option>
            </select>
          </FormField>
          <FormField label="Email">
            <input
              className="input"
              type="email"
              placeholder="billing@acme.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FormField>
          <FormField label="Phone / Mobile">
            <input
              className="input"
              type="tel"
              placeholder="+91 98765 43210"
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            />
          </FormField>
          <FormField label="GSTIN">
            <input
              className="input font-mono"
              placeholder="15-char India GST identifier"
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value })}
            />
          </FormField>
          <FormField label="PAN">
            <input
              className="input font-mono uppercase"
              placeholder="10-char India PAN"
              value={form.pan}
              onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
              maxLength={10}
            />
          </FormField>
          <FormField label="Customer group">
            <select
              className="input"
              value={form.customerGroupId}
              onChange={(e) => setForm({ ...form, customerGroupId: e.target.value })}
            >
              <option value="">— None —</option>
              {customerGroups.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Territory">
            <select
              className="input"
              value={form.territoryId}
              onChange={(e) => setForm({ ...form, territoryId: e.target.value })}
            >
              <option value="">— None —</option>
              {territories.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Default payment terms">
            <select
              className="input"
              value={form.defaultPaymentTermsTemplateId}
              onChange={(e) => setForm({ ...form, defaultPaymentTermsTemplateId: e.target.value })}
            >
              <option value="">— None —</option>
              {paymentTerms.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Tax collection category (TCS)">
            <select
              className="input"
              value={form.taxCollectionCategoryId}
              onChange={(e) => setForm({ ...form, taxCollectionCategoryId: e.target.value })}
            >
              <option value="">— None —</option>
              {taxCategories.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Loyalty program"
            hint="Enrolled customers accrue points on submitted sales invoices per the program's pointsPerCurrency rate."
          >
            <select
              className="input"
              value={form.loyaltyProgramId}
              onChange={(e) => setForm({ ...form, loyaltyProgramId: e.target.value })}
            >
              <option value="">— Not enrolled —</option>
              {loyaltyPrograms.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Credit limit (0 = no limit)">
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) || 0 })}
            />
          </FormField>
          <FormField label="">
            <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.creditLimitBypassAllowed}
                onChange={(e) => setForm({ ...form, creditLimitBypassAllowed: e.target.checked })}
              />
              Allow bypassing credit limit on this customer's sales invoices
            </label>
          </FormField>
          <CustomFieldsForm doctype="Customer" value={customData} onChange={setCustomData} />
          {/* Hidden submit so form onSubmit fires from footer button. */}
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <InnerCustomersPage />
    </Suspense>
  );
}
