"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
} from "../../../components/ui";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";

interface SOItem {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  description: string | null;
  billedQty?: string;
  deliveredQty?: string;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface SalesOrder {
  id: string;
  name: string;
  status: string;
  orderDate: string;
  deliveryDate: string | null;
  currency: string;
  netTotal: string;
  grandTotal: string;
  invoicedAmount: string;
  remarks: string | null;
  customer: { id: string; customerName: string; email: string | null };
  quotation: { id: string; name: string; status: string } | null;
  items: SOItem[];
}
interface Payload {
  salesOrder: SalesOrder;
}

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/sales-orders/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sales-orders/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this sales order?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sales-orders/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }
  async function invoice(partial: boolean) {
    if (!data) return;
    setError(null);
    let body: unknown = {};
    if (partial) {
      const lines: { soItemId: string; qty: number }[] = [];
      for (const l of data.salesOrder.items) {
        const remaining = Number(l.qty) - Number(l.billedQty ?? 0);
        if (remaining <= 0) continue;
        const input = prompt(
          `Invoice qty for ${l.item.itemCode} (remaining ${remaining}):`,
          String(remaining),
        );
        if (input === null) return;
        const qty = Number(input);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        if (qty > remaining) {
          setError(`${l.item.itemCode}: cannot invoice ${qty}, only ${remaining} remaining`);
          return;
        }
        lines.push({ soItemId: l.id, qty });
      }
      if (lines.length === 0) return;
      body = { lines };
    }
    setBusy(true);
    try {
      const r = await api.post<{ salesInvoice: { id: string; name: string } }>(
        `/sales-orders/${params.id}/convert-to-invoice`,
        body,
      );
      window.location.href = `/accounting/sales-invoices/${r.salesInvoice.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Sales Orders", href: "/crm/sales-orders" }]}
          title="Sales Order"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Sales Orders", href: "/crm/sales-orders" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const so = data.salesOrder;
  const cur = so.currency;
  const invoicedPct = Number(so.grandTotal) > 0
    ? Math.min(100, (Number(so.invoicedAmount) / Number(so.grandTotal)) * 100)
    : 0;

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Sales Orders", href: "/crm/sales-orders" },
          { label: so.name },
        ]}
        title={so.name}
        subtitle={
          <span className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={so.status} />
            <span>
              {dateShort(so.orderDate)}
              {so.deliveryDate && ` · delivery ${dateShort(so.deliveryDate)}`}
            </span>
            {so.quotation && (
              <span>
                from{" "}
                <a
                  href={`/crm/quotations/${so.quotation.id}`}
                  className="font-mono text-brand-600 hover:underline"
                >
                  {so.quotation.name}
                </a>
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {so.status === "Draft" && (
              <>
                <a href={`/crm/sales-orders/new?editId=${so.id}`}>
                  <Button variant="secondary" type="button">
                    Edit
                  </Button>
                </a>
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={busy}
                  type="button"
                >
                  Submit
                </Button>
              </>
            )}
            {so.status !== "Draft" &&
              so.status !== "Cancelled" &&
              so.status !== "Fully Billed" &&
              Number(so.invoicedAmount) < Number(so.grandTotal) && (
                <>
                  <Button
                    variant="brand"
                    onClick={() => invoice(false)}
                    disabled={busy}
                    type="button"
                    title="Invoice all remaining quantity"
                  >
                    → Invoice (remaining)
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => invoice(true)}
                    disabled={busy}
                    type="button"
                    title="Invoice a partial quantity per line"
                  >
                    → Invoice (partial…)
                  </Button>
                </>
              )}
            {so.status !== "Cancelled" && (
              <Button
                variant="danger"
                onClick={cancel}
                disabled={busy}
                type="button"
              >
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                downloadPdf(`/print/sales-orders/${so.id}`, `${so.name}.pdf`).catch(
                  (e) => setError(e instanceof Error ? e.message : "PDF failed"),
                )
              }
              type="button"
            >
              PDF
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.print()}
              type="button"
            >
              Print
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <WorkflowActions doctype="SalesOrder" docId={so.id} onChange={load} />

      <section className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Customer
          </div>
          <div className="font-semibold text-ink">
            {so.customer.customerName}
          </div>
          {so.customer.email && (
            <div className="text-sm text-ink-muted">{so.customer.email}</div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Grand total
          </div>
          <div className="font-semibold text-2xl tabular-nums text-ink">
            {money(Number(so.grandTotal), cur)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Invoiced
          </div>
          <div className="font-semibold text-2xl tabular-nums text-ink">
            {money(Number(so.invoicedAmount), cur)}
          </div>
          <div className="w-full bg-surface-sunken rounded h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-green-500 h-full transition-all"
              style={{ width: `${invoicedPct}%` }}
            />
          </div>
          <div className="text-xs text-ink-muted mt-1">
            {invoicedPct.toFixed(0)}% of grand total
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Line items" />
        <div className="hidden md:block table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Rate</th>
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {so.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className="font-mono text-sm text-ink">
                      {it.item.itemCode}
                    </div>
                    <div className="text-ink-soft text-sm">
                      {it.item.itemName}
                    </div>
                  </td>
                  <td className="text-end tabular-nums">
                    {Number(it.qty)} {it.item.stockUom}
                  </td>
                  <td className="text-end tabular-nums">
                    {money(Number(it.rate), cur)}
                  </td>
                  <td className="text-end tabular-nums">
                    {money(Number(it.amount), cur)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-surface-sunken">
                <td colSpan={3}>Grand total</td>
                <td className="text-end tabular-nums">
                  {money(Number(so.grandTotal), cur)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {so.items.map((it) => (
            <li key={it.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                </div>
                <div className="text-end">
                  <div className="font-mono text-ink tabular-nums">{money(Number(it.amount), cur)}</div>
                  <div className="text-xs text-ink-muted tabular-nums">
                    {Number(it.qty).toFixed(2)} {it.item.stockUom} × {money(Number(it.rate), cur)}
                  </div>
                </div>
              </div>
            </li>
          ))}
          <li className="px-4 py-3 bg-surface-sunken flex items-center justify-between font-semibold text-ink">
            <span>Grand total</span>
            <span className="font-mono tabular-nums">{money(Number(so.grandTotal), cur)}</span>
          </li>
        </ul>
      </section>

      {so.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">
            {so.remarks}
          </div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="SalesOrder" docId={so.id} />
        <CommentsPanel
          doctype="SalesOrder"
          docId={so.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
