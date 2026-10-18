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
  StatusBadge,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { useCompanyScope } from "../../components/company-scope";

interface SQRow {
  id: string;
  name: string;
  transactionDate: string;
  validTill: string | null;
  status: string;
  netTotal: string;
  currency: string;
  supplier: { supplierName: string };
  rfq: { name: string };
  _count: { items: number };
}

interface RFQOption {
  id: string;
  name: string;
  status: string;
  items: { id: string; itemId: string; qty: string; item?: { itemCode: string; itemName: string } }[];
  suppliers: { supplierId: string; supplierName: string }[];
}

// Module 45 — Supplier Quotation list + create.
// The buyer enters each supplier's response on their behalf (v1 flow).
// Selecting an RFQ auto-populates the line list; buyer fills in rate +
// optional lead time per line.
export default function SupplierQuotationsPage() {
  const [rows, setRows] = useState<SQRow[]>([]);
  const [rfqs, setRfqs] = useState<RFQOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { qs } = useCompanyScope();

  const [form, setForm] = useState({
    rfqId: "",
    supplierId: "",
    validTill: "",
    currency: "INR",
    remarks: "",
    items: [] as Array<{ rfqItemId: string; itemLabel: string; qty: number; rate: number; leadTimeDays: string; notes: string }>,
  });

  async function load() {
    setLoading(true);
    try {
      const [q, r] = await Promise.all([
        api.get<SQRow[]>(`/supplier-quotations${qs}`),
        // Only pull Submitted RFQs — you can't quote against a Draft.
        api.get<RFQOption[]>("/request-for-quotations"),
      ]);
      setRows(q);
      setRfqs(r.filter((x) => x.status === "Submitted"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  useListPageCommands({
    singular: "Supplier Quotation",
    plural: "Supplier Quotations",
    refresh: load,
  });
  function openCreate() {
    setForm({
      rfqId: "",
      supplierId: "",
      validTill: "",
      currency: "INR",
      remarks: "",
      items: [],
    });
    setShowForm(true);
  }

  async function pickRfq(rfqId: string) {
    const rfq = rfqs.find((r) => r.id === rfqId);
    if (!rfq) return;
    // Fetch item labels via existing rfq detail (need itemCode/name for
    // the picker). Fastest: hit /request-for-quotations/:id which has
    // the full include.
    try {
      const detail = await api.get<{
        items: Array<{
          id: string;
          itemId: string;
          qty: string;
          item: { itemCode: string; itemName: string };
        }>;
      }>(`/request-for-quotations/${rfqId}`);
      setForm({
        ...form,
        rfqId,
        supplierId: "",
        items: detail.items.map((i) => ({
          rfqItemId: i.id,
          itemLabel: `${i.item.itemCode} · ${i.item.itemName}`,
          qty: Number(i.qty),
          rate: 0,
          leadTimeDays: "",
          notes: "",
        })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch RFQ");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.rfqId || !form.supplierId) {
      setError("Pick an RFQ + supplier");
      return;
    }
    if (form.items.some((i) => i.rate <= 0)) {
      setError("Every line needs a positive rate");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post("/supplier-quotations", {
        rfqId: form.rfqId,
        supplierId: form.supplierId,
        validTill: form.validTill ? new Date(form.validTill).toISOString() : null,
        currency: form.currency,
        remarks: form.remarks || null,
        items: form.items.map((i) => ({
          rfqItemId: i.rfqItemId,
          qty: i.qty,
          rate: i.rate,
          leadTimeDays: i.leadTimeDays ? Number(i.leadTimeDays) : null,
          notes: i.notes || null,
        })),
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitQuote(r: SQRow, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    try {
      await api.post(`/supplier-quotations/${r.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.supplier.supplierName.toLowerCase().includes(q) ||
        r.rfq.name.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const selectedRfq = rfqs.find((r) => r.id === form.rfqId);

  const columns: Column<SQRow>[] = [
    {
      header: "Name",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    { header: "RFQ", cell: (r) => <span className="text-sm font-mono">{r.rfq.name}</span> },
    { header: "Supplier", cell: (r) => <span>{r.supplier.supplierName}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{dateShort(r.transactionDate)}</span> },
    { header: "Items", cell: (r) => <span>{r._count.items}</span> },
    {
      header: "Total",
      align: "right",
      cell: (r) => <span className="font-mono">{money(Number(r.netTotal), r.currency)}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Draft" && (
            <button onClick={(e) => submitQuote(r, e)} className="btn-ghost btn-sm">
              Submit
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Supplier Quotations"
        subtitle="Record each supplier's response to an RFQ. Submitted quotes appear in the compare view."
        actions={<Button variant="brand" onClick={openCreate}>+ New quote</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search SQ / RFQ / supplier…" }}
          actions={<SavedViewsControls listKey="buying-web:supplier-quotations" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.tag,
            title: search ? "No matching quotes" : "No supplier quotes yet",
            description: "Enter a supplier's response to an RFQ. Once submitted, it appears in the compare view for that RFQ.",
            action: !search && <Button variant="brand" onClick={openCreate}>+ New quote</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New supplier quotation"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => submit(e as unknown as React.FormEvent)}>
              Create quote
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="RFQ" required>
            <select
              className="input"
              value={form.rfqId}
              onChange={(e) => pickRfq(e.target.value)}
              required
            >
              <option value="">— pick submitted RFQ —</option>
              {rfqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>

          {selectedRfq && (
            <FormField label="Supplier" required>
              <select
                className="input"
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                required
              >
                <option value="">— pick invited supplier —</option>
                {selectedRfq.suppliers.map((s) => (
                  <option key={s.supplierId} value={s.supplierId}>
                    {s.supplierName}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Currency">
              <input
                className="input"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
              />
            </FormField>
            <FormField label="Valid till">
              <input
                type="date"
                className="input"
                value={form.validTill}
                onChange={(e) => setForm({ ...form, validTill: e.target.value })}
              />
            </FormField>
          </div>

          {form.items.length > 0 && (
            <FormField label="Line rates" required>
              <div className="space-y-2">
                {form.items.map((line, idx) => (
                  <div key={line.rfqItemId} className="border border-line rounded p-2 space-y-1">
                    <div className="text-sm text-ink">{line.itemLabel}</div>
                    <div className="text-xs text-ink-muted">Qty: {line.qty}</div>
                    <div className="grid grid-cols-[1fr_100px] gap-2">
                      <input
                        type="number"
                        step="0.01"
                        className="input font-mono"
                        placeholder="Rate"
                        value={line.rate || ""}
                        onChange={(e) => {
                          const next = [...form.items];
                          next[idx] = { ...line, rate: Number(e.target.value) };
                          setForm({ ...form, items: next });
                        }}
                      />
                      <input
                        type="number"
                        className="input font-mono"
                        placeholder="Lead days"
                        value={line.leadTimeDays}
                        onChange={(e) => {
                          const next = [...form.items];
                          next[idx] = { ...line, leadTimeDays: e.target.value };
                          setForm({ ...form, items: next });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </FormField>
          )}

          <FormField label="Remarks">
            <textarea
              className="input"
              rows={2}
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
