"use client";

import { useEffect, useState } from "react";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
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

interface PaymentEntry {
  id: string;
  name: string;
  paymentType: string;
  partyType: string;
  partyId: string;
  paidAmount: string;
  currency: string;
  conversionRate: string;
  modeOfPayment: string;
  postingDate: string;
  status: string;
  remarks: string | null;
}
interface RefRow {
  id: string;
  referenceDoctype: string;
  referenceId: string;
  allocatedAmount: string;
  invoiceName: string | null;
  invoiceGrandTotal: string | null;
  invoiceOutstanding: string | null;
  invoiceStatus: string | null;
}
interface GLEntry {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  remarks: string | null;
  account: { accountName: string; rootType: string };
}
interface Payload {
  paymentEntry: PaymentEntry;
  partyName: string | null;
  references: RefRow[];
  glEntries: GLEntry[];
}

// Where to jump when clicking an invoice reference. Payments can allocate to
// either sales or purchase invoices, so route by doctype.
function invoiceHref(doctype: string, id: string): string {
  return doctype === "SalesInvoice"
    ? `/accounting/sales-invoices/${id}`
    : `/buying/purchase-invoices/${id}`;
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/payment-entries/${params.id}/full`));
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
      await api.post(`/payment-entries/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this payment? Allocations + GL will be reversed.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payment-entries/${params.id}/cancel`, {});
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
          breadcrumb={[{ label: "Payments", href: "/accounting/payments" }]}
          title="Payment"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
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
          breadcrumb={[{ label: "Payments", href: "/accounting/payments" }]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const pe = data.paymentEntry;
  const allocated = data.references.reduce((s, r) => s + Number(r.allocatedAmount), 0);
  const unallocated = Number(pe.paidAmount) - allocated;

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Payments", href: "/accounting/payments" },
          { label: pe.name },
        ]}
        title={pe.name}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={pe.status} />
            <span>{dateShort(pe.postingDate)}</span>
            <span>· {pe.paymentType}</span>
            <span>· {pe.modeOfPayment}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {pe.status === "Draft" && (
              <>
                <a href={`/accounting/payments/new?editId=${pe.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button variant="primary" onClick={submit} disabled={busy} type="button">
                  Submit
                </Button>
              </>
            )}
            {pe.status !== "Cancelled" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                downloadPdf(`/print/payment-entries/${pe.id}`, `${pe.name}.pdf`).catch(
                  (e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"),
                )
              }
            >
              PDF
            </Button>
            <Button variant="secondary" type="button" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />

      <WorkflowActions doctype="PaymentEntry" docId={pe.id} onChange={load} />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            {pe.paymentType === "Receive" ? "From" : "To"} {pe.partyType}
          </div>
          <div className="font-semibold text-ink mt-0.5">{data.partyName ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Paid amount
          </div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {money(Number(pe.paidAmount), pe.currency)}
          </div>
          {Number(pe.conversionRate) !== 1 && (
            <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
              @ {Number(pe.conversionRate).toFixed(4)} ={" "}
              {(Number(pe.paidAmount) * Number(pe.conversionRate)).toFixed(2)} base
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Unallocated
          </div>
          <div
            className={`font-semibold text-lg mt-0.5 tabular-nums ${unallocated > 0 ? "text-amber-700" : "text-ink-muted"}`}
          >
            {money(unallocated, pe.currency)}
          </div>
          <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
            Allocated: {allocated.toFixed(2)} of {Number(pe.paidAmount).toFixed(2)}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title={`Allocations (${data.references.length})`} />
        <div className="hidden md:block table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th className="text-end">Invoice Total</th>
                <th className="text-end">Outstanding (now)</th>
                <th className="text-end">Allocated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.references.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-ink-muted">
                    No allocations (unallocated payment)
                  </td>
                </tr>
              )}
              {data.references.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.invoiceName ? (
                      <a
                        href={invoiceHref(r.referenceDoctype, r.referenceId)}
                        className="font-mono text-brand-600 hover:underline"
                      >
                        {r.invoiceName}
                      </a>
                    ) : (
                      <span className="text-ink-muted italic">(missing)</span>
                    )}
                    <div className="text-xs text-ink-muted">{r.referenceDoctype}</div>
                  </td>
                  <td className="text-end tabular-nums">
                    {r.invoiceGrandTotal ? Number(r.invoiceGrandTotal).toFixed(2) : "—"}
                  </td>
                  <td className="text-end tabular-nums">
                    {r.invoiceOutstanding ? Number(r.invoiceOutstanding).toFixed(2) : "—"}
                  </td>
                  <td className="text-end font-semibold tabular-nums">
                    {Number(r.allocatedAmount).toFixed(2)}
                  </td>
                  <td className="text-xs">
                    {r.invoiceStatus && <StatusBadge status={r.invoiceStatus} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.references.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No allocations (unallocated payment)
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.references.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {r.invoiceName ? (
                      <a
                        href={invoiceHref(r.referenceDoctype, r.referenceId)}
                        className="font-mono text-sm text-brand-600 hover:underline"
                      >
                        {r.invoiceName}
                      </a>
                    ) : (
                      <span className="text-xs text-ink-muted italic">(missing)</span>
                    )}
                    <div className="text-xs text-ink-muted">{r.referenceDoctype}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums font-semibold">
                      {Number(r.allocatedAmount).toFixed(2)}
                    </div>
                    {r.invoiceStatus && (
                      <div className="text-xs mt-0.5"><StatusBadge status={r.invoiceStatus} /></div>
                    )}
                  </div>
                </div>
                {(r.invoiceGrandTotal || r.invoiceOutstanding) && (
                  <div className="mt-1 text-xs text-ink-muted tabular-nums">
                    {r.invoiceGrandTotal && `Total ${Number(r.invoiceGrandTotal).toFixed(2)}`}
                    {r.invoiceGrandTotal && r.invoiceOutstanding && " · "}
                    {r.invoiceOutstanding && `Outstanding ${Number(r.invoiceOutstanding).toFixed(2)}`}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="print:hidden">
        <SectionHeader title="GL entries (from this payment)" />
        <div className="hidden md:block table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Remarks</th>
                <th className="text-end">Debit</th>
                <th className="text-end">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.glEntries.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-ink-muted">
                    Not posted yet
                  </td>
                </tr>
              )}
              {data.glEntries.map((g) => (
                <tr key={g.id}>
                  <td>
                    <a
                      href={`/accounting/reports/general-ledger?accountId=${g.accountId}`}
                      className="text-brand-600 hover:underline"
                    >
                      {g.account.accountName}
                    </a>
                    <span className="text-xs text-ink-muted ms-1">({g.account.rootType})</span>
                  </td>
                  <td className="text-xs text-ink-soft">{g.remarks ?? "—"}</td>
                  <td className="text-end font-mono tabular-nums">
                    {Number(g.debit) > 0 ? Number(g.debit).toFixed(2) : ""}
                  </td>
                  <td className="text-end font-mono tabular-nums">
                    {Number(g.credit) > 0 ? Number(g.credit).toFixed(2) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.glEntries.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            Not posted yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.glEntries.map((g) => (
              <li key={g.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/accounting/reports/general-ledger?accountId=${g.accountId}`}
                      className="font-medium text-brand-600 hover:underline truncate block"
                    >
                      {g.account.accountName}
                    </a>
                    <div className="text-xs text-ink-muted">{g.account.rootType}</div>
                  </div>
                  <div className="text-end font-mono tabular-nums">
                    {Number(g.debit) > 0 ? (
                      <span className="text-ink">Dr {Number(g.debit).toFixed(2)}</span>
                    ) : (
                      <span className="text-ink">Cr {Number(g.credit).toFixed(2)}</span>
                    )}
                  </div>
                </div>
                {g.remarks && (
                  <div className="mt-1 text-xs text-ink-muted">{g.remarks}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pe.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">{pe.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="PaymentEntry" docId={pe.id} />
        <CommentsPanel
          doctype="PaymentEntry"
          docId={pe.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
