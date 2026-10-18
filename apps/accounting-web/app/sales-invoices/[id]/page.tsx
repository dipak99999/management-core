"use client";

import { useEffect, useState } from "react";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import { trackRecent } from "../../../lib/recent";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { AiInsightCard } from "../../../components/ai-insight-card";
import { ActivityTimeline } from "../../../components/activity-timeline";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  NotFoundState,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
} from "../../../components/ui";
import { NextActionsPanel } from "@lumaara/web-ui";
import { authApi } from "../../../lib/auth-api";

interface Item { itemCode: string; itemName: string; stockUom: string }
interface SIItem {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  description: string | null;
  item: Item;
}
interface SITax {
  id: string;
  description: string;
  rate: string;
  taxAmount: string;
  account: { accountName: string };
}
interface Customer {
  id: string;
  customerName: string;
  email: string | null;
  mobile: string | null;
  gstin: string | null;
}
interface SalesInvoice {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  dueDate: string | null;
  currency: string;
  conversionRate: string;
  netTotal: string;
  totalTaxes: string;
  grandTotal: string;
  outstandingAmt: string;
  remarks: string | null;
  // B15: true when this row is itself a Credit Note. `returnAgainstId` links
  // back to the source SI.
  isReturn: boolean;
  returnAgainstId: string | null;
  customer: Customer;
  items: SIItem[];
  taxes: SITax[];
  paymentTermsTemplate?: { id: string; name: string } | null;
  paymentSchedule?: PaymentScheduleRow[];
  couponCode?: string | null;
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
  invoice: SalesInvoice;
  paymentRefs: PaymentRef[];
  glEntries: GLEntry[];
}

export default function SalesInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/sales-invoices/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  useEffect(() => {
    if (data?.invoice) {
      trackRecent({
        doctype: "Invoice",
        id: data.invoice.id,
        label: data.invoice.name,
        href: `/accounting/sales-invoices/${data.invoice.id}`,
      });
    }
    // deliberately granular — avoid refiring on unrelated invoice edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.invoice?.id, data?.invoice?.name]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sales-invoices/${params.id}/submit`, {});
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
      await api.post(`/sales-invoices/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    const is404 = /not found/i.test(error) || /404/.test(error);
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Sales Invoices", href: "/accounting/sales-invoices" }]}
          title="Sales Invoice"
        />
        {is404 ? (
          <NotFoundState doctype="Invoice" listHref="/accounting/sales-invoices" listLabel="Invoices" />
        ) : (
          <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
        )}
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Sales Invoices", href: "/accounting/sales-invoices" }]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const inv = data.invoice;
  const cur = inv.currency;
  const fx = Number(inv.conversionRate);
  const isFX = fx !== 1;
  const totalPaid = data.paymentRefs.reduce((s, r) => s + Number(r.allocatedAmount), 0);

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Sales Invoices", href: "/accounting/sales-invoices" },
          { label: inv.name },
        ]}
        title={inv.name}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={inv.status} />
            <span>{dateShort(inv.postingDate)}</span>
            {inv.dueDate && <span>· due {dateShort(inv.dueDate)}</span>}
            {inv.couponCode && (
              <span className="badge badge-blue font-mono text-[10px]">
                Coupon: {inv.couponCode}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {inv.status === "Draft" && (
              <>
                <a href={`/accounting/sales-invoices/new?editId=${inv.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button variant="primary" onClick={submit} disabled={busy} type="button">
                  Submit
                </Button>
              </>
            )}
            {inv.status !== "Cancelled" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
            {inv.status === "Submitted" && !inv.isReturn && (
              <a href={`/accounting/sales-invoices/new?returnAgainstId=${inv.id}`}>
                <Button variant="secondary" type="button">Credit Note</Button>
              </a>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                downloadPdf(`/print/sales-invoices/${inv.id}`, `${inv.name}.pdf`).catch(
                  (e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"),
                )
              }
            >
              PDF
            </Button>
            <Button variant="secondary" type="button" onClick={() => window.print()}>
              Print
            </Button>
            {(inv.status === "Submitted" || inv.status === "Paid") && (
              <a href={`/accounting/sales-invoices/${inv.id}/eway-bill`}>
                <Button variant="secondary" type="button">
                  E-way Bill
                </Button>
              </a>
            )}
          </>
        }
      />

      <WorkflowActions doctype="SalesInvoice" docId={inv.id} onChange={load} />

      <NextActionsPanel
        doctype="SalesInvoice"
        docId={inv.id}
        heading="What next?"
        fetchChips={() =>
          authApi.post("/ai/next-actions", { doctype: "SalesInvoice", docId: inv.id })
        }
        callService={(method, path, body) => {
          // Routed through accounting-service's /sales-invoices endpoint.
          if (method === "POST") return api.post(path, body ?? {});
          if (method === "PUT") return api.put(path, body ?? {});
          if (method === "DELETE") return api.del(path);
          return Promise.resolve();
        }}
        onDone={load}
      />

      <AiInsightCard doctype="SalesInvoice" docId={inv.id} />

      <ActivityTimeline parentType="SalesInvoice" parentId={inv.id} />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Bill to</div>
          <div className="font-semibold text-ink mt-0.5">{inv.customer.customerName}</div>
          {inv.customer.email && (
            <div className="text-sm text-ink-soft">{inv.customer.email}</div>
          )}
          {inv.customer.mobile && (
            <div className="text-sm text-ink-soft">{inv.customer.mobile}</div>
          )}
          {inv.customer.gstin && (
            <div className="text-xs text-ink-muted mt-0.5 font-mono">GSTIN: {inv.customer.gstin}</div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Currency</div>
          <div className="font-semibold text-lg text-ink mt-0.5">{cur}</div>
          {isFX && (
            <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
              1 {cur} = {fx.toFixed(4)} base
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Outstanding</div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {money(Number(inv.outstandingAmt), cur)}
          </div>
          <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
            Paid: {totalPaid.toFixed(2)} of {Number(inv.grandTotal).toFixed(2)}
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
              {inv.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className="font-mono text-sm">{it.item.itemCode}</div>
                    <div className="text-ink-soft text-sm">{it.item.itemName}</div>
                    {it.description && (
                      <div className="text-xs text-ink-muted mt-1">{it.description}</div>
                    )}
                  </td>
                  <td className="text-end tabular-nums">
                    {Number(it.qty)} {it.item.stockUom}
                  </td>
                  <td className="text-end tabular-nums">{Number(it.rate).toFixed(2)}</td>
                  <td className="text-end tabular-nums">{Number(it.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {inv.items.map((it) => (
            <li key={it.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                </div>
                <div className="text-end">
                  <div className="font-mono text-ink tabular-nums">{Number(it.amount).toFixed(2)} {cur}</div>
                  <div className="text-xs text-ink-muted tabular-nums">
                    {Number(it.qty).toFixed(2)} {it.item.stockUom} × {Number(it.rate).toFixed(2)}
                  </div>
                </div>
              </div>
              {it.description && (
                <div className="mt-1 text-xs text-ink-muted">{it.description}</div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex justify-end">
        <Card className="w-96 p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-soft">Net total</span>
            <span className="tabular-nums">{Number(inv.netTotal).toFixed(2)} {cur}</span>
          </div>
          {inv.taxes.map((t) => (
            <div key={t.id} className="flex justify-between text-ink">
              <span>
                {t.description}
                <span className="text-xs text-ink-muted ms-1">
                  → {t.account.accountName}
                </span>
              </span>
              <span className="tabular-nums">{Number(t.taxAmount).toFixed(2)} {cur}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-ink-muted/10 pt-2 font-semibold text-base">
            <span>Grand total</span>
            <span className="tabular-nums">{Number(inv.grandTotal).toFixed(2)} {cur}</span>
          </div>
          {isFX && (
            <div className="flex justify-between text-xs text-ink-muted">
              <span>In base currency</span>
              <span className="tabular-nums">{(Number(inv.grandTotal) * fx).toFixed(2)}</span>
            </div>
          )}
        </Card>
      </section>

      {inv.status === "Submitted" && Number(inv.outstandingAmt) > 0 && (
        <AdvancesPanel
          partyType="Customer"
          partyId={inv.customer.id}
          outstandingAmt={Number(inv.outstandingAmt)}
          invoiceId={inv.id}
          onApplied={load}
        />
      )}

      <section className="print:hidden">
        <SectionHeader title={`Applied payments (${data.paymentRefs.length})`} />
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Date</th>
                <th>Mode</th>
                <th className="text-end">Allocated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.paymentRefs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-ink-muted">
                    No payments applied yet
                  </td>
                </tr>
              )}
              {data.paymentRefs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a
                      href={`/accounting/payments/${r.paymentEntry.id}`}
                      className="font-mono text-brand-600 hover:underline"
                    >
                      {r.paymentEntry.name}
                    </a>
                    <div className="text-xs text-ink-muted">{r.paymentEntry.paymentType}</div>
                  </td>
                  <td className="text-sm">{dateShort(r.paymentEntry.postingDate)}</td>
                  <td className="text-sm">{r.paymentEntry.modeOfPayment}</td>
                  <td className="text-end tabular-nums">
                    {Number(r.allocatedAmount).toFixed(2)}
                  </td>
                  <td className="text-xs">
                    <StatusBadge status={r.paymentEntry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="print:hidden">
        <SectionHeader title="GL entries (from this invoice)" />
        <div className="table-wrap overflow-x-auto">
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
                    <span className="text-xs text-ink-muted ms-1">
                      ({g.account.rootType})
                    </span>
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
      </section>

      {inv.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">{inv.remarks}</div>
        </Card>
      )}

      {/* D10: Payment schedule (staggered installments from a
          PaymentTermsTemplate). Only present when the invoice was created
          with a template + has been submitted (rows materialize at submit
          time). Non-Draft invoices with no schedule fall through. */}
      {inv.paymentSchedule && inv.paymentSchedule.length > 0 && (
        <PaymentSchedulePanel
          rows={inv.paymentSchedule}
          templateName={inv.paymentTermsTemplate?.name}
          currency={cur}
          parentStatus={inv.status}
          invoiceId={inv.id}
          invoiceName={inv.name}
          onReminderSent={load}
        />
      )}

      {/* Payment reminders — visible only on Submitted invoices with an
          outstanding balance (Draft/Cancelled/fully-paid don't need
          reminders). Renders a small history + a manual Send button that
          picks the next-due kind from the tenant's thresholds. */}
      {inv.status === "Submitted" && Number(inv.outstandingAmt) > 0 && (
        <PaymentRemindersPanel invoiceId={inv.id} invoiceName={inv.name} />
      )}

      <SalesTeamPanel invoiceId={inv.id} status={inv.status} />

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="SalesInvoice" docId={inv.id} />
        <CommentsPanel
          doctype="SalesInvoice"
          docId={inv.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}

interface PaymentReminderRow {
  id: string;
  kind: "First" | "Second" | "Final";
  daysOverdue: number;
  outstandingAmt: string;
  toEmail: string;
  trigger: "Auto" | "Manual";
  createdAt: string;
  // D10: null for invoice-level reminders; set for per-installment reminders.
  paymentScheduleId?: string | null;
}

// Inline panel to keep the file self-contained. Fetches history on mount
// and refreshes after a manual send. Errors surface via a small toast row
// inside the card (parent page's Toast is above the fold and would scroll
// off).
function PaymentRemindersPanel({
  invoiceId,
  invoiceName,
}: {
  invoiceId: string;
  invoiceName: string;
}) {
  const [rows, setRows] = useState<PaymentReminderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setRows(await api.get<PaymentReminderRow[]>(`/sales-invoices/${invoiceId}/reminders`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reminders");
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  async function send() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const r = await api.post<{ kind: string }>(
        `/sales-invoices/${invoiceId}/reminders/send`,
        {},
      );
      setInfo(`${r.kind} reminder queued for ${invoiceName}.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader title={`Payment reminders (${rows.length})`} />
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={send}
          type="button"
        >
          {busy ? "Sending…" : "Send reminder now"}
        </Button>
      </div>
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </div>
      )}
      {info && (
        <div className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded px-2 py-1">
          {info}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-xs text-ink-muted italic">
          No reminders sent yet. The scheduler will send them automatically
          once the invoice crosses the tenant's overdue thresholds.
        </div>
      ) : (
        <ul className="divide-y divide-ink-muted/10 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex items-center gap-2">
              <span
                className={`badge ${
                  r.kind === "Final"
                    ? "badge-red"
                    : r.kind === "Second"
                      ? "badge-amber"
                      : "badge-blue"
                }`}
              >
                {r.kind}
              </span>
              <span className="text-ink-soft">{r.daysOverdue} days overdue</span>
              {r.paymentScheduleId && (
                <span className="text-[10px] text-ink-muted uppercase tracking-wider">
                  · per-installment
                </span>
              )}
              <span className="text-xs text-ink-muted">· {r.toEmail}</span>
              <span
                className={`ms-auto text-[10px] uppercase tracking-wider ${
                  r.trigger === "Manual" ? "text-brand-600" : "text-ink-muted"
                }`}
              >
                {r.trigger}
              </span>
              <span className="text-xs text-ink-muted tabular-nums">
                {dateShort(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// D10: staggered payment schedule. Materialized on submit from a
// PaymentTermsTemplate. Status derives from (dueDate vs today) + parent
// status + row paidAmount (PE apply → schedule allocation lands in
// module 20). Overdue rows expose a per-installment "Remind" action that
// targets a specific row rather than the whole invoice.
function PaymentSchedulePanel({
  rows,
  templateName,
  currency,
  parentStatus,
  invoiceId,
  invoiceName,
  onReminderSent,
}: {
  rows: PaymentScheduleRow[];
  templateName?: string;
  currency: string;
  parentStatus: string;
  invoiceId: string;
  invoiceName: string;
  onReminderSent?: () => void;
}) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowInfo, setRowInfo] = useState<string | null>(null);

  async function remind(rowId: string) {
    setBusyRow(rowId);
    setRowError(null);
    setRowInfo(null);
    try {
      const r = await api.post<{ kind: string }>(
        `/sales-invoices/${invoiceId}/reminders/send`,
        { paymentScheduleId: rowId },
      );
      setRowInfo(`${r.kind} reminder queued for ${invoiceName}.`);
      onReminderSent?.();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        title={
          templateName ? `Payment schedule — ${templateName}` : "Payment schedule"
        }
      />
      {rowError && (
        <div className="text-xs text-red-600 mb-2">{rowError}</div>
      )}
      {rowInfo && (
        <div className="text-xs text-emerald-700 mb-2">{rowInfo}</div>
      )}
      <table className="w-full text-sm">
        <thead className="text-start text-ink-muted">
          <tr>
            <th className="py-1">#</th>
            <th className="py-1">Description</th>
            <th className="py-1">Due</th>
            <th className="py-1 w-16">%</th>
            <th className="py-1 text-end w-32">Amount</th>
            <th className="py-1 w-24">Status</th>
            <th className="py-1 w-24"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const paid = Number(r.paidAmount);
            const amt = Number(r.amount);
            // Mirror the server's scheduleItemStatus rule client-side to
            // survive parent-invoice status transitions without a refetch.
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
            const canRemind =
              parentStatus === "Submitted" && live === "Overdue" && paid < amt;
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
                <td className="py-2 text-end">
                  {canRemind && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-xs"
                      onClick={() => remind(r.id)}
                      disabled={busyRow === r.id}
                    >
                      {busyRow === r.id ? "Sending…" : "Remind"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// B14: renders any unallocated advance PEs for this party. User picks one
// and hits "Apply" → route pins the PE ref to this invoice + reduces
// outstanding. No new GL posts.
interface AdvancePE {
  id: string;
  name: string;
  postingDate: string;
  paidAmount: number;
  remaining: number;
  currency: string;
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
  return (
    <section className="print:hidden">
      <SectionHeader title={`Unallocated advances (${advances.length})`} />
      {err && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm mb-2">{err}</Card>
      )}
      <div className="table-wrap overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Payment</th>
              <th>Date</th>
              <th className="text-end">Remaining</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {advances.map((a) => (
              <tr key={a.id}>
                <td className="font-mono">{a.name}</td>
                <td>{dateShort(a.postingDate)}</td>
                <td className="text-end tabular-nums">
                  {a.remaining.toFixed(2)} {a.currency}
                </td>
                <td className="text-end">
                  <button
                    className="text-sm text-brand-600 disabled:text-ink-muted"
                    onClick={() => apply(a)}
                    disabled={applying === a.id}
                  >
                    {applying === a.id ? "Applying..." : "Apply"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Sales Team (deal splits) ─────────────────────────────────────────
// Multi-salesperson attribution editor. Empty list = fallback to the
// SI's single-person salesPersonId at 100%. When populated, allocations
// must sum to 100% (validated server-side; UI shows the running total).

interface AllocationRow {
  id: string;
  salesPersonId: string;
  allocationPct: string;
  commissionRate: string;
  salesPerson: { name: string; defaultCommissionPercent?: string };
}
interface SalesPersonOption {
  id: string;
  name: string;
  defaultCommissionPercent: string;
  enabled: boolean;
}
interface DraftRow {
  salesPersonId: string;
  allocationPct: string;
  commissionRate: string;
}

function SalesTeamPanel({ invoiceId, status }: { invoiceId: string; status: string }) {
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [options, setOptions] = useState<SalesPersonOption[]>([]);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = status === "Cancelled";

  async function load() {
    setError(null);
    try {
      const [rs, ops] = await Promise.all([
        api.get<AllocationRow[]>(`/sales-invoices/${invoiceId}/allocations`),
        api.get<SalesPersonOption[]>("/sales-persons"),
      ]);
      setRows(rs);
      setOptions(ops.filter((o) => o.enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  function startEdit() {
    setDraft(
      rows.length > 0
        ? rows.map((r) => ({
            salesPersonId: r.salesPersonId,
            allocationPct: String(Number(r.allocationPct)),
            commissionRate: String(Number(r.commissionRate)),
          }))
        : [{ salesPersonId: "", allocationPct: "100", commissionRate: "0" }],
    );
    setEditing(true);
    setError(null);
  }

  function addRow() {
    setDraft([...draft, { salesPersonId: "", allocationPct: "0", commissionRate: "0" }]);
  }
  function removeRow(i: number) {
    setDraft(draft.filter((_, idx) => idx !== i));
  }
  function setRow(i: number, patch: Partial<DraftRow>) {
    setDraft(draft.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function splitEvenly() {
    if (draft.length === 0) return;
    const each = 100 / draft.length;
    const rounded = Math.round(each * 1000) / 1000;
    const next = draft.map((r) => ({ ...r, allocationPct: String(rounded) }));
    // Correct the last row for rounding drift so sum lands on exactly 100.
    const sumFirst = rounded * (draft.length - 1);
    next[next.length - 1].allocationPct = String(Math.round((100 - sumFirst) * 1000) / 1000);
    setDraft(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        allocations: draft
          .filter((r) => r.salesPersonId)
          .map((r) => ({
            salesPersonId: r.salesPersonId,
            allocationPct: Number(r.allocationPct),
            commissionRate: Number(r.commissionRate),
          })),
      };
      await api.put(`/sales-invoices/${invoiceId}/allocations`, body);
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (!confirm("Clear all deal splits? Falls back to the invoice's single salesperson.")) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/sales-invoices/${invoiceId}/allocations`, { allocations: [] });
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const draftSum = draft.reduce((s, r) => s + (Number(r.allocationPct) || 0), 0);
  const sumOk = Math.abs(draftSum - 100) < 0.01;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader title="Sales Team (Deal Splits)" />
        {!editing && !readOnly && (
          <Button variant="secondary" onClick={startEdit}>
            {rows.length > 0 ? "Edit splits" : "Add splits"}
          </Button>
        )}
      </div>

      {error ? <div className="text-red-700 text-sm">{error}</div> : null}

      {!editing ? (
        rows.length === 0 ? (
          <div className="text-sm text-ink-muted">
            No splits configured. Commission (if any) is credited entirely to the invoice's primary salesperson.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs uppercase text-ink-muted border-b border-ink-muted/10">
                <th className="py-1">Salesperson</th>
                <th className="text-end py-1">Allocation %</th>
                <th className="text-end py-1">Commission %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-ink-muted/5">
                  <td className="py-1.5">{r.salesPerson.name}</td>
                  <td className="text-end py-1.5 font-mono tabular-nums">{Number(r.allocationPct).toFixed(2)}</td>
                  <td className="text-end py-1.5 font-mono tabular-nums">{Number(r.commissionRate).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <div className="space-y-2">
          {draft.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className="input flex-1"
                value={r.salesPersonId}
                onChange={(e) => {
                  const spId = e.target.value;
                  const opt = options.find((o) => o.id === spId);
                  setRow(i, {
                    salesPersonId: spId,
                    commissionRate: opt && r.commissionRate === "0" ? String(Number(opt.defaultCommissionPercent)) : r.commissionRate,
                  });
                }}
              >
                <option value="">Select salesperson</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  className="input w-20"
                  type="number"
                  min={0}
                  max={100}
                  step={0.001}
                  value={r.allocationPct}
                  onChange={(e) => setRow(i, { allocationPct: e.target.value })}
                />
                <span className="text-xs text-ink-muted">%</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  className="input w-20"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={r.commissionRate}
                  onChange={(e) => setRow(i, { commissionRate: e.target.value })}
                  title="Commission rate"
                />
                <span className="text-xs text-ink-muted">%</span>
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-red-700 hover:text-red-900 text-sm px-2"
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm">
            <div>
              <button type="button" onClick={addRow} className="text-brand-700 hover:underline">+ Add salesperson</button>
              <button type="button" onClick={splitEvenly} className="text-brand-700 hover:underline ms-3" disabled={draft.length === 0}>
                Split evenly
              </button>
            </div>
            <div className={sumOk ? "text-green-700" : "text-red-700"}>
              Total: {draftSum.toFixed(3)}% {sumOk ? "✓" : "(must be 100)"}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={saving || !sumOk}>{saving ? "Saving…" : "Save"}</Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            {rows.length > 0 && (
              <Button variant="danger" onClick={clearAll} disabled={saving}>Clear all</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
