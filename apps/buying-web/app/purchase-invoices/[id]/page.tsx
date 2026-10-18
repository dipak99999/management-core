"use client";

import { showToast } from "../../../lib/toast";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Item { itemCode: string; itemName: string; stockUom: string }
interface PIItem {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  description: string | null;
  item: Item;
}
interface PITax {
  id: string;
  description: string;
  rate: string;
  taxAmount: string;
  account: { accountName: string };
}
interface Supplier {
  id: string;
  supplierName: string;
  email: string | null;
  mobile: string | null;
  gstin: string | null;
}
interface PurchaseInvoice {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  dueDate: string | null;
  supplierInvoiceNo: string | null;
  currency: string;
  conversionRate: string;
  netTotal: string;
  totalTaxes: string;
  grandTotal: string;
  outstandingAmt: string;
  remarks: string | null;
  // B15: true when this row is itself a Debit Note.
  isReturn: boolean;
  returnAgainstId: string | null;
  supplier: Supplier;
  items: PIItem[];
  taxes: PITax[];
  paymentTermsTemplate?: { id: string; name: string } | null;
  paymentSchedule?: PaymentScheduleRow[];
}

interface PaymentScheduleRow {
  id: string;
  sortOrder: number;
  description: string;
  invoicePortion: string;
  dueDate: string;
  amount: string;
  paidAmount: string;
  status: string;
}
interface PaymentRef {
  id: string;
  allocatedAmount: string;
  paymentEntry: {
    id: string;
    name: string;
    paymentType: string;
    postingDate: string;
    modeOfPayment: string;
    status: string;
    paidAmount: string;
  };
}
interface GLEntry {
  id: string;
  accountId: string;
  postingDate: string;
  debit: string;
  credit: string;
  remarks: string | null;
  account: { accountName: string; rootType: string };
}
interface Payload {
  invoice: PurchaseInvoice;
  paymentRefs: PaymentRef[];
  glEntries: GLEntry[];
}

export default function PurchaseInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/purchase-invoices/${params.id}/full`));
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
      await api.post(`/purchase-invoices/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this invoice? GL entries will be reversed.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/purchase-invoices/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Purchase Invoices", href: "/buying/purchase-invoices" },
          ]}
          title="Purchase Invoice"
          actions={
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Purchase Invoices", href: "/buying/purchase-invoices" },
          ]}
          title="Loading…"
          actions={
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
          }
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  const inv = data.invoice;
  const cur = inv.currency;
  const fx = Number(inv.conversionRate);
  const isFX = fx !== 1;
  const totalPaid = data.paymentRefs.reduce(
    (s, r) => s + Number(r.allocatedAmount),
    0,
  );

  const itemCols: Column<PIItem>[] = [
    {
      header: "Item",
      cell: (it) => (
        <div>
          <div className="font-mono text-sm text-ink">{it.item.itemCode}</div>
          <div className="text-ink-soft text-sm">{it.item.itemName}</div>
          {it.description && (
            <div className="text-xs text-ink-muted mt-1">{it.description}</div>
          )}
        </div>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">
          {Number(it.qty)}{" "}
          <span className="text-ink-muted text-xs">{it.item.stockUom}</span>
        </span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">{money(Number(it.rate), cur)}</span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums font-medium">
          {money(Number(it.amount), cur)}
        </span>
      ),
    },
  ];

  const paymentRefCols: Column<PaymentRef>[] = [
    {
      header: "Payment",
      cell: (r) => (
        <div>
          <a
            href={`/accounting/payments/${r.paymentEntry.id}`}
            className="font-mono text-brand-600 hover:underline"
          >
            {r.paymentEntry.name}
          </a>
          <div className="text-xs text-ink-muted">{r.paymentEntry.paymentType}</div>
        </div>
      ),
    },
    { header: "Date", cell: (r) => dateShort(r.paymentEntry.postingDate) },
    { header: "Mode", cell: (r) => r.paymentEntry.modeOfPayment },
    {
      header: "Allocated",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {money(Number(r.allocatedAmount), cur)}
        </span>
      ),
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.paymentEntry.status} /> },
  ];

  const glCols: Column<GLEntry>[] = [
    {
      header: "Account",
      cell: (g) => (
        <>
          <a
            href={`/accounting/reports/general-ledger?accountId=${g.accountId}`}
            className="text-brand-600 hover:underline"
          >
            {g.account.accountName}
          </a>
          <span className="text-xs text-ink-muted ms-1">
            ({g.account.rootType})
          </span>
        </>
      ),
    },
    {
      header: "Remarks",
      cell: (g) => (
        <span className="text-xs text-ink-soft">{g.remarks ?? "—"}</span>
      ),
    },
    {
      header: "Debit",
      align: "right",
      cell: (g) => (
        <span className="tabular-nums font-mono">
          {Number(g.debit) > 0 ? Number(g.debit).toFixed(2) : ""}
        </span>
      ),
    },
    {
      header: "Credit",
      align: "right",
      cell: (g) => (
        <span className="tabular-nums font-mono">
          {Number(g.credit) > 0 ? Number(g.credit).toFixed(2) : ""}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Purchase Invoices", href: "/buying/purchase-invoices" },
          { label: inv.name },
        ]}
        title={inv.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={inv.status} />
            <span>
              {dateShort(inv.postingDate)}
              {inv.dueDate && ` · due ${dateShort(inv.dueDate)}`}
              {inv.supplierInvoiceNo && (
                <>
                  {" · Bill#: "}
                  <span className="font-mono">{inv.supplierInvoiceNo}</span>
                </>
              )}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
            {inv.status === "Draft" && (
              <>
                <a href={`/buying/purchase-invoices/new?editId=${inv.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button
                  variant="primary"
                  type="button"
                  onClick={submit}
                  disabled={busy}
                >
                  Submit
                </Button>
              </>
            )}
            {inv.status !== "Cancelled" && (
              <Button
                variant="danger"
                type="button"
                onClick={cancel}
                disabled={busy}
              >
                Cancel
              </Button>
            )}
            {inv.status === "Submitted" && !inv.isReturn && (
              <a href={`/buying/purchase-invoices/new?returnAgainstId=${inv.id}`}>
                <Button variant="secondary" type="button">Debit Note</Button>
              </a>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                downloadPdf(
                  `/print/purchase-invoices/${inv.id}`,
                  `${inv.name}.pdf`,
                ).catch((e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"))
              }
            >
              PDF
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => window.print()}
            >
              Print
            </Button>
          </>
        }
      />

      <div className="print:hidden">
        <WorkflowActions doctype="PurchaseInvoice" docId={inv.id} onChange={load} />
      </div>

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Bill from
          </div>
          <div className="mt-1 font-semibold">
            <a
              href={`/buying/suppliers/${inv.supplier.id}`}
              className="text-brand-600 hover:underline"
            >
              {inv.supplier.supplierName}
            </a>
          </div>
          {inv.supplier.email && (
            <div className="text-sm text-ink-soft mt-0.5">{inv.supplier.email}</div>
          )}
          {inv.supplier.mobile && (
            <div className="text-sm text-ink-soft">{inv.supplier.mobile}</div>
          )}
          {inv.supplier.gstin && (
            <div className="text-xs text-ink-muted mt-1">
              GSTIN: {inv.supplier.gstin}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Currency
          </div>
          <div className="mt-1 font-semibold text-lg">{cur}</div>
          {isFX && (
            <div className="text-xs text-ink-muted mt-1">
              1 {cur} = {fx.toFixed(4)} base
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Outstanding
          </div>
          <div className="mt-1 font-semibold text-2xl tabular-nums">
            {money(Number(inv.outstandingAmt), cur)}
          </div>
          <div className="text-xs text-ink-muted mt-1 tabular-nums">
            Paid: {money(totalPaid, cur)} of {money(Number(inv.grandTotal), cur)}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Line items" />
        <div className="hidden md:block">
          <DataTable<PIItem>
            columns={itemCols}
            rows={inv.items}
            rowKey={(it) => it.id}
            empty={{ title: "No line items" }}
          />
        </div>
        {inv.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No line items
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {inv.items.map((it) => (
              <li key={it.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">{money(Number(it.amount))}</div>
                    <div className="text-xs text-ink-muted tabular-nums">
                      {Number(it.qty).toFixed(2)} {it.item.stockUom} × {money(Number(it.rate))}
                    </div>
                  </div>
                </div>
                {it.description && (
                  <div className="mt-1 text-xs text-ink-muted">{it.description}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex justify-end">
        <Card className="w-96 p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Net total</span>
            <span className="tabular-nums">
              {money(Number(inv.netTotal), cur)}
            </span>
          </div>
          {inv.taxes.map((t) => (
            <div key={t.id} className="flex justify-between text-ink-soft">
              <span>
                {t.description}
                <span className="text-xs text-ink-muted ms-1">
                  → {t.account.accountName}
                </span>
              </span>
              <span className="tabular-nums">
                {money(Number(t.taxAmount), cur)}
              </span>
            </div>
          ))}
          <div className="flex justify-between border-t border-ink-muted/10 pt-2 font-semibold text-base">
            <span>Grand total</span>
            <span className="tabular-nums">
              {money(Number(inv.grandTotal), cur)}
            </span>
          </div>
          {isFX && (
            <div className="flex justify-between text-xs text-ink-muted">
              <span>In base currency</span>
              <span className="tabular-nums">
                {(Number(inv.grandTotal) * fx).toFixed(2)}
              </span>
            </div>
          )}
        </Card>
      </section>

      {inv.paymentSchedule && inv.paymentSchedule.length > 0 && (
        <PaymentSchedulePanel
          rows={inv.paymentSchedule}
          templateName={inv.paymentTermsTemplate?.name}
          currency={inv.currency}
          parentStatus={inv.status}
        />
      )}

      {inv.status === "Submitted" && Number(inv.outstandingAmt) > 0 && (
        <AdvancesPanel
          partyType="Supplier"
          partyId={inv.supplier.id}
          outstandingAmt={Number(inv.outstandingAmt)}
          invoiceId={inv.id}
          onApplied={load}
        />
      )}

      <section className="print:hidden">
        <SectionHeader
          title={`Applied payments (${data.paymentRefs.length})`}
        />
        <DataTable<PaymentRef>
          columns={paymentRefCols}
          rows={data.paymentRefs}
          rowKey={(r) => r.id}
          empty={{ title: "No payments applied yet" }}
        />
      </section>

      <section className="print:hidden">
        <SectionHeader title="GL entries (from this invoice)" />
        <DataTable<GLEntry>
          columns={glCols}
          rows={data.glEntries}
          rowKey={(g) => g.id}
          empty={{ title: "Not posted yet" }}
        />
      </section>

      {inv.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm whitespace-pre-wrap text-ink">{inv.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4 print:hidden">
        <AttachmentsPanel doctype="PurchaseInvoice" docId={inv.id} />
        <CommentsPanel
          doctype="PurchaseInvoice"
          docId={inv.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}

// B14: mirror of the SI-side AdvancesPanel. Lists unallocated Pay-type PEs
// for this supplier and lets the user apply one against this PI.
interface AdvancePE {
  id: string;
  name: string;
  postingDate: string;
  paidAmount: number;
  remaining: number;
  currency: string;
}
// D10: staggered payment schedule. Materialized on PI submit from a
// PaymentTermsTemplate. Read-only mirror of the SI-side panel — no
// per-installment reminder button on the buying side (payables reminders
// are outbound-only in module 23).
function PaymentSchedulePanel({
  rows,
  templateName,
  currency,
  parentStatus,
}: {
  rows: PaymentScheduleRow[];
  templateName?: string;
  currency: string;
  parentStatus: string;
}) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return (
    <Card className="p-4">
      <SectionHeader
        title={
          templateName ? `Payment schedule — ${templateName}` : "Payment schedule"
        }
      />
      <table className="w-full text-sm">
        <thead className="text-start text-ink-muted">
          <tr>
            <th className="py-1">#</th>
            <th className="py-1">Description</th>
            <th className="py-1">Due</th>
            <th className="py-1 w-16">%</th>
            <th className="py-1 text-end w-32">Amount</th>
            <th className="py-1 w-24">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const paid = Number(r.paidAmount);
            const amt = Number(r.amount);
            let live: string;
            if (parentStatus === "Paid") live = "Paid";
            else if (paid >= amt && amt > 0) live = "Paid";
            else if (paid > 0) live = "Partial";
            else if (new Date(r.dueDate).getTime() < today.getTime()) live = "Overdue";
            else live = "Upcoming";
            const cls =
              live === "Overdue"
                ? "badge-red"
                : live === "Paid"
                  ? "badge-green"
                  : live === "Partial"
                    ? "badge-amber"
                    : "badge-blue";
            return (
              <tr key={r.id} className="border-t border-ink-muted/10">
                <td className="py-2 tabular-nums text-ink-muted">{r.sortOrder + 1}</td>
                <td className="py-2">{r.description}</td>
                <td className="py-2 tabular-nums">{dateShort(r.dueDate)}</td>
                <td className="py-2 tabular-nums">{Number(r.invoicePortion).toFixed(2)}</td>
                <td className="py-2 text-end tabular-nums">
                  {amt.toFixed(2)} {currency}
                </td>
                <td className="py-2">
                  <span className={`badge ${cls}`}>{live}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function AdvancesPanel(props: {
  partyType: "Customer" | "Supplier";
  partyId: string;
  outstandingAmt: number;
  invoiceId: string;
  onApplied: () => void;
}) {
  const [advances, setAdvances] = useState<AdvancePE[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdvancePE[]>(
        `/payment-entries/advance-balances?partyType=${props.partyType}&partyId=${props.partyId}`,
      )
      .then(setAdvances)
      .catch(() => setAdvances([]));
  }, [props.partyType, props.partyId]);

  async function apply(pe: AdvancePE) {
    const amtStr = window.prompt(
      `Apply how much of ${pe.name} (remaining ${pe.remaining.toFixed(2)}) to this invoice (outstanding ${props.outstandingAmt.toFixed(2)})?`,
      Math.min(pe.remaining, props.outstandingAmt).toFixed(2),
    );
    if (!amtStr) return;
    const amt = Number(amtStr);
    if (!(amt > 0)) return;
    setApplying(pe.id);
    setErr(null);
    try {
      await api.post(`/payment-entries/${pe.id}/allocate-advance`, {
        invoiceId: props.invoiceId,
        allocatedAmount: amt,
      });
      props.onApplied();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setApplying(null);
    }
  }

  if (advances.length === 0) return null;

  const cols: Column<AdvancePE>[] = [
    {
      header: "Payment",
      cell: (a) => <span className="font-mono">{a.name}</span>,
    },
    { header: "Date", cell: (a) => dateShort(a.postingDate) },
    {
      header: "Remaining",
      align: "right",
      cell: (a) => (
        <span className="tabular-nums">{money(a.remaining, a.currency)}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (a) => (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => apply(a)}
          disabled={applying === a.id}
        >
          {applying === a.id ? "Applying…" : "Apply"}
        </Button>
      ),
    },
  ];

  return (
    <section className="print:hidden">
      <SectionHeader title={`Unallocated advances (${advances.length})`} />
      {err && (
        <Card className="p-3 mb-2 text-red-700 border-red-200 bg-red-50 text-sm">
          {err}
        </Card>
      )}
      <DataTable<AdvancePE>
        columns={cols}
        rows={advances}
        rowKey={(a) => a.id}
        empty={{ title: "No advances" }}
      />
    </section>
  );
}
