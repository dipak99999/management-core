"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { accApi } from "../../lib/api";
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  FilterBar,
  FormField,
  PageHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  money,
} from "../../components/ui";

interface POItem {
  qty: string;
  rate: string;
  amount: string;
  item: { itemCode: string; itemName: string };
}
interface PO {
  id: string;
  name: string;
  transactionDate: string;
  status: string;
  grandTotal: string;
  currency: string;
  items: POItem[];
}

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState<PO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [billFor, setBillFor] = useState<PO | null>(null);
  const [billForm, setBillForm] = useState({
    supplierInvoiceNo: "",
    postingDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    remarks: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    try {
      setRows(await accApi.get<PO[]>("/portal/purchase-orders"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Purchase Order",
    plural: "Purchase Orders",
    refresh: load,
  });
  async function submitBill(e: React.FormEvent) {
    e.preventDefault();
    if (!billFor) return;
    setSubmitting(true);
    setError(null);
    setMsg(null);
    try {
      const r = await accApi.post<{ name: string }>(
        "/portal/supplier/bills",
        {
          purchaseOrderId: billFor.id,
          supplierInvoiceNo: billForm.supplierInvoiceNo,
          postingDate: billForm.postingDate,
          dueDate: billForm.dueDate || null,
          remarks: billForm.remarks || null,
        },
      );
      setMsg(`Bill ${r.name} submitted as Draft — pending staff review`);
      setBillFor(null);
      setBillForm({
        supplierInvoiceNo: "",
        postingDate: new Date().toISOString().slice(0, 10),
        dueDate: "",
        remarks: "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  if (error && !rows) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "Purchase orders" },
          ]}
          title="Purchase orders"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">
          {error}
        </Card>
      </main>
    );
  }

  if (rows === null) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "Purchase orders" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-12 w-full" rounded="rounded-lg" />
        <Skeleton className="h-40 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Purchase orders" },
        ]}
        title="Purchase orders"
        subtitle="Purchase orders we've issued to you. Submit a bill against any open PO."
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => history.back()}
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast
          kind="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {msg && (
        <Toast kind="success" message={msg} onDismiss={() => setMsg(null)} />
      )}

      <FilterBar
          search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search PO number…",
        }}
          actions={<SavedViewsControls listKey="portal-web:purchase-orders" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No purchase orders"
            description="Purchase orders sent to you will appear here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((po) => (
            <Card key={po.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono text-sm text-ink">{po.name}</div>
                  <div className="text-xs text-ink-muted mt-1">
                    Dated {dateShort(po.transactionDate)}
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-2xl font-semibold tabular-nums text-ink">
                    {money(Number(po.grandTotal), po.currency)}
                  </div>
                  <div className="mt-1">
                    <StatusBadge status={po.status} />
                  </div>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="table text-xs">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-end">Qty</th>
                      <th className="text-end">Rate</th>
                      <th className="text-end">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.items.map((it, i) => (
                      <tr key={i}>
                        <td>
                          <span className="font-mono text-ink-muted">
                            {it.item.itemCode}
                          </span>{" "}
                          <span className="text-ink">{it.item.itemName}</span>
                        </td>
                        <td className="text-end tabular-nums">
                          {Number(it.qty)}
                        </td>
                        <td className="text-end tabular-nums">
                          {money(Number(it.rate), po.currency)}
                        </td>
                        <td className="text-end tabular-nums">
                          {money(Number(it.amount), po.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {po.status !== "Cancelled" && (
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="primary"
                    type="button"
                    onClick={() => setBillFor(po)}
                  >
                    Submit bill against this PO
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={billFor !== null}
        onClose={() => setBillFor(null)}
        title={billFor ? `Submit bill against ${billFor.name}` : "Submit bill"}
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setBillFor(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="portal-po-bill-form"
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit bill"}
            </Button>
          </>
        }
      >
        <form
          id="portal-po-bill-form"
          onSubmit={submitBill}
          className="space-y-3"
        >
          <FormField label="Your invoice #" required>
            <input
              className="input"
              value={billForm.supplierInvoiceNo}
              onChange={(e) =>
                setBillForm({
                  ...billForm,
                  supplierInvoiceNo: e.target.value,
                })
              }
              required
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Bill date" required>
              <input
                type="date"
                className="input"
                value={billForm.postingDate}
                onChange={(e) =>
                  setBillForm({ ...billForm, postingDate: e.target.value })
                }
                required
              />
            </FormField>
            <FormField label="Due date (optional)">
              <input
                type="date"
                className="input"
                value={billForm.dueDate}
                onChange={(e) =>
                  setBillForm({ ...billForm, dueDate: e.target.value })
                }
              />
            </FormField>
          </div>
          <FormField label="Remarks (optional)">
            <input
              className="input"
              value={billForm.remarks}
              onChange={(e) =>
                setBillForm({ ...billForm, remarks: e.target.value })
              }
            />
          </FormField>
          <p className="text-xs text-ink-muted">
            Line items will be copied from the PO. Staff can adjust taxes and
            totals before final approval.
          </p>
        </form>
      </Drawer>
    </main>
  );
}
