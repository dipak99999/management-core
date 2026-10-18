"use client";

import { useEffect, useState } from "react";
import { authApi } from "../../../lib/auth-api";
import { NextActionsPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";

interface QItem {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  description: string | null;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface Quotation {
  id: string;
  name: string;
  partyType: string;
  status: string;
  quotationDate: string;
  validTill: string | null;
  currency: string;
  netTotal: string;
  grandTotal: string;
  remarks: string | null;
  lead: { name: string; leadName: string; companyName: string | null } | null;
  customer: { id: string; customerName: string; email: string | null } | null;
  items: QItem[];
}
interface DownstreamSO {
  id: string;
  name: string;
  status: string;
  orderDate: string;
  grandTotal: string;
  invoicedAmount: string;
}
interface Payload {
  quotation: Quotation;
  salesOrders: DownstreamSO[];
}

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/quotations/${params.id}/full`));
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
      await api.post(`/quotations/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this quotation?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/quotations/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }
  async function convertToSO() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string; name: string }>(
        `/quotations/${params.id}/convert-to-sales-order`,
        {},
      );
      setSuccess(`Created Sales Order ${r.name} as Draft.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data && error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Quotations", href: "/crm/quotations" }]}
          title="Quotation"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Quotations", href: "/crm/quotations" }]}
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

  const q = data.quotation;
  const cur = q.currency;
  const partyLabel = q.customer
    ? q.customer.customerName
    : q.lead
      ? `${q.lead.leadName}${q.lead.companyName ? ` (${q.lead.companyName})` : ""}`
      : "—";

  const soCols: Column<DownstreamSO>[] = [
    {
      header: "SO",
      cell: (so) => (
        <a
          href={`/crm/sales-orders/${so.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {so.name}
        </a>
      ),
    },
    { header: "Date", cell: (so) => dateShort(so.orderDate) },
    {
      header: "Grand Total",
      align: "right",
      cell: (so) => (
        <span className="tabular-nums">{money(Number(so.grandTotal), cur)}</span>
      ),
    },
    {
      header: "Invoiced",
      align: "right",
      cell: (so) => (
        <span className="tabular-nums">
          {money(Number(so.invoicedAmount), cur)}
        </span>
      ),
    },
    { header: "Status", cell: (so) => <StatusBadge status={so.status} /> },
  ];

  return (
    <main className="p-8 space-y-6 print:p-0">
      {success && (
        <Toast kind="success" message={success} onDismiss={() => setSuccess(null)} />
      )}
      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <PageHeader
        breadcrumb={[
          { label: "Quotations", href: "/crm/quotations" },
          { label: q.name },
        ]}
        title={q.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={q.status} />
            <span>
              {dateShort(q.quotationDate)}
              {q.validTill && ` · valid till ${dateShort(q.validTill)}`}
            </span>
          </span>
        }
        actions={
          <div className="print:hidden flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {q.status === "Draft" && (
              <>
                <a href={`/crm/quotations/new?editId=${q.id}`}>
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
            {q.status === "Submitted" && q.customer && (
              <Button
                variant="brand"
                onClick={convertToSO}
                disabled={busy}
                type="button"
              >
                → Sales Order
              </Button>
            )}
            {q.status !== "Cancelled" && q.status !== "Ordered" && (
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
                downloadPdf(`/print/quotations/${q.id}`, `${q.name}.pdf`).catch(
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

      <NextActionsPanel
        doctype="Quotation"
        docId={params.id}
        heading="What next?"
        fetchChips={() => authApi.post("/ai/next-actions", { doctype: "Quotation", docId: params.id })}
        callService={(method, path, body) => {
          if (method === "POST") return api.post(path, body ?? {});
          if (method === "PUT") return api.put(path, body ?? {});
          if (method === "DELETE") return api.del(path);
          return Promise.resolve();
        }}
        onDone={load}
      />

            <WorkflowActions doctype="Quotation" docId={q.id} onChange={load} />

      <section className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Quoted to ({q.partyType})
          </div>
          <div className="font-semibold text-ink">{partyLabel}</div>
          {q.customer?.email && (
            <div className="text-sm text-ink-muted">{q.customer.email}</div>
          )}
          {q.partyType === "Lead" && (
            <div className="text-xs text-amber-700 mt-1">
              Convert lead to customer before converting to Sales Order
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Currency
          </div>
          <div className="font-semibold text-lg text-ink">{cur}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Grand total
          </div>
          <div className="font-semibold text-2xl tabular-nums text-ink">
            {money(Number(q.grandTotal), cur)}
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
              {q.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className="font-mono text-sm text-ink">{it.item.itemCode}</div>
                    <div className="text-ink-soft text-sm">{it.item.itemName}</div>
                    {it.description && (
                      <div className="text-xs text-ink-muted mt-1">
                        {it.description}
                      </div>
                    )}
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
                  {money(Number(q.grandTotal), cur)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {q.items.map((it) => (
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
              {it.description && (
                <div className="mt-1 text-xs text-ink-muted">{it.description}</div>
              )}
            </li>
          ))}
          <li className="px-4 py-3 bg-surface-sunken flex items-center justify-between font-semibold text-ink">
            <span>Grand total</span>
            <span className="font-mono tabular-nums">{money(Number(q.grandTotal), cur)}</span>
          </li>
        </ul>
      </section>

      <section className="print:hidden">
        <SectionHeader
          title={`Sales Orders from this quote (${data.salesOrders.length})`}
        />
        <div className="hidden md:block">
          <DataTable<DownstreamSO>
            columns={soCols}
            rows={data.salesOrders}
            rowKey={(so) => so.id}
            empty={{ title: "No sales orders created yet" }}
          />
        </div>
        {data.salesOrders.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No sales orders created yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.salesOrders.map((so) => (
              <li key={so.id}>
                <a href={`/crm/sales-orders/${so.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{so.name}</div>
                      <div className="text-xs text-ink-muted">
                        {dateShort(so.orderDate)} · {so.status}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">{money(Number(so.grandTotal), cur)}</div>
                      <div className="text-xs text-ink-muted tabular-nums">
                        {money(Number(so.invoicedAmount), cur)} invoiced
                      </div>
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {q.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">
            {q.remarks}
          </div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Quotation" docId={q.id} />
        <CommentsPanel
          doctype="Quotation"
          docId={q.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
