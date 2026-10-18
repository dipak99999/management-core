"use client";

// Recurring invoice detail. Three panels stacked:
//   1. Header + status + pause/resume/generate-now actions
//   2. Schedule summary + upcoming N runs (pure preview, no DB writes)
//   3. History table — every SalesInvoice the template has generated,
//      linking through to the SI detail page
//
// The upcoming-runs preview + history endpoints are both new; the pause/
// resume/generate-now actions call the pre-existing endpoints on the
// list page.

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
  money,
} from "../../../components/ui";

interface RecurringInvoiceItem {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  description: string | null;
  item: { itemCode: string; itemName: string };
}

interface RecurringInvoice {
  id: string;
  name: string;
  title: string;
  currency: string;
  frequency: "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  daysUntilDue: number;
  status: "Active" | "Paused" | "Ended";
  nextRunDate: string;
  lastGeneratedAt: string | null;
  generatedCount: number;
  remarks: string | null;
  customer: { id: string; customerName: string; email: string | null };
  items: RecurringInvoiceItem[];
}

interface HistoryRow {
  id: string;
  name: string;
  postingDate: string;
  dueDate: string | null;
  status: string;
  grandTotal: string;
  outstandingAmt: string;
  currency: string;
}

export default function RecurringInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<RecurringInvoice | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [upcoming, setUpcoming] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [d, h, u] = await Promise.all([
        api.get<RecurringInvoice>(`/recurring-invoices/${params.id}`),
        api.get<HistoryRow[]>(`/recurring-invoices/${params.id}/history`),
        api.get<string[]>(`/recurring-invoices/${params.id}/upcoming?count=6`),
      ]);
      setData(d);
      setHistory(h);
      setUpcoming(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function toggleStatus() {
    if (!data) return;
    const action = data.status === "Active" ? "pause" : "resume";
    setBusy(true);
    try {
      await api.post(`/recurring-invoices/${data.id}/${action}`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateNow() {
    if (!data) return;
    if (!confirm(`Generate a Draft invoice from "${data.title}" right now?`)) return;
    setBusy(true);
    try {
      await api.post(`/recurring-invoices/${data.id}/generate-now`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Recurring Invoices", href: "/accounting/recurring-invoices" },
          ]}
          title={error ? "Recurring invoice" : "Loading…"}
        />
        {error && <Toast kind="error" message={error} onDismiss={() => setError(null)} />}
      </main>
    );
  }

  const cadence = `${data.frequency}${data.intervalCount > 1 ? ` × ${data.intervalCount}` : ""}`;
  const netTotal = data.items.reduce((s, l) => s + Number(l.amount), 0);

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Recurring Invoices", href: "/accounting/recurring-invoices" },
          { label: data.name },
        ]}
        title={data.title}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            <span className="font-mono text-xs">{data.name}</span>
            <span>·</span>
            <span>{cadence}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history_pop()} type="button">
              ← Back
            </Button>
            {data.status !== "Ended" && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={toggleStatus}
                  type="button"
                >
                  {data.status === "Active" ? "Pause" : "Resume"}
                </Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={generateNow}
                  type="button"
                >
                  Generate now
                </Button>
              </>
            )}
          </>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Customer
          </div>
          <div className="font-semibold text-ink mt-0.5">
            {data.customer.customerName}
          </div>
          {data.customer.email && (
            <div className="text-sm text-ink-soft">{data.customer.email}</div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Cadence
          </div>
          <div className="font-semibold text-ink mt-0.5">{cadence}</div>
          <div className="text-xs text-ink-muted mt-1">
            Started {dateShort(data.startDate)}
            {data.endDate ? ` · ends ${dateShort(data.endDate)}` : ""}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Progress
          </div>
          <div className="font-semibold text-ink mt-0.5 tabular-nums">
            {data.generatedCount} invoice{data.generatedCount === 1 ? "" : "s"}{" "}
            generated
          </div>
          {data.lastGeneratedAt && (
            <div className="text-xs text-ink-muted mt-1">
              Last on {dateShort(data.lastGeneratedAt)}
            </div>
          )}
        </Card>
      </section>

      <section className="grid md:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Line template
          </div>
          <div className="hidden md:block">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Rate</th>
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="font-medium">
                      {l.item.itemCode}{" "}
                      <span className="text-ink-muted font-normal">
                        {l.item.itemName}
                      </span>
                    </div>
                    {l.description && (
                      <div className="text-xs text-ink-muted">{l.description}</div>
                    )}
                  </td>
                  <td className="text-end tabular-nums">{Number(l.qty).toFixed(2)}</td>
                  <td className="text-end tabular-nums">{Number(l.rate).toFixed(2)}</td>
                  <td className="text-end tabular-nums font-medium">
                    {Number(l.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="text-end font-medium">
                  Per-cycle total
                </td>
                <td className="text-end font-bold tabular-nums">
                  {money(netTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
          <ul className="md:hidden divide-y divide-line rounded-lg border border-ink/10 overflow-hidden">
            {data.items.map((l) => (
              <li key={l.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{l.item.itemName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{l.item.itemCode}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">{Number(l.amount).toFixed(2)}</div>
                    <div className="text-xs text-ink-muted tabular-nums">
                      {Number(l.qty).toFixed(2)} × {Number(l.rate).toFixed(2)}
                    </div>
                  </div>
                </div>
                {l.description && (
                  <div className="mt-1 text-xs text-ink-muted">{l.description}</div>
                )}
              </li>
            ))}
            <li className="px-3 py-2 bg-surface-sunken flex items-center justify-between font-semibold">
              <span>Per-cycle total</span>
              <span className="font-mono tabular-nums">{money(netTotal)}</span>
            </li>
          </ul>
          {data.remarks && (
            <div className="mt-3 text-xs text-ink-muted italic">
              {data.remarks}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
              Upcoming runs
            </div>
            <div className="text-xs text-ink-muted">
              {data.status === "Ended"
                ? "Schedule complete"
                : data.status === "Paused"
                  ? "Paused — no runs until resumed"
                  : "Next 6 dates"}
            </div>
          </div>
          {upcoming.length === 0 ? (
            <div className="text-sm text-ink-muted italic">
              {data.status === "Ended"
                ? "No further runs."
                : "No upcoming runs to preview."}
            </div>
          ) : (
            <ol className="space-y-1 text-sm">
              {upcoming.map((iso, i) => (
                <li key={iso} className="flex items-center gap-2 tabular-nums">
                  <span
                    className={`w-6 text-xs ${
                      i === 0 ? "text-brand-600 font-bold" : "text-ink-muted"
                    }`}
                  >
                    #{data.generatedCount + i + 1}
                  </span>
                  <span
                    className={
                      i === 0 ? "text-ink font-medium" : "text-ink-soft"
                    }
                  >
                    {dateShort(iso)}
                  </span>
                  {i === 0 && data.status === "Active" && (
                    <span className="ms-auto text-[10px] uppercase tracking-wider text-brand-600">
                      Next
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
          History — {history.length} invoice{history.length === 1 ? "" : "s"} generated
        </div>
        <Card className="p-0 hidden md:block overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Posting date</th>
                <th>Due date</th>
                <th>Status</th>
                <th className="text-end">Total</th>
                <th className="text-end">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-ink-muted py-8">
                    No invoices generated yet.
                  </td>
                </tr>
              )}
              {history.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/accounting/sales-invoices/${r.id}`}
                      className="font-mono text-brand-600 hover:text-brand-700"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td>{dateShort(r.postingDate)}</td>
                  <td>{r.dueDate ? dateShort(r.dueDate) : "—"}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="text-end tabular-nums">
                    {money(Number(r.grandTotal))}
                  </td>
                  <td className="text-end tabular-nums">
                    {Number(r.outstandingAmt) > 0.001 ? (
                      <span className="text-amber-700 font-medium">
                        {money(Number(r.outstandingAmt))}
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {history.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No invoices generated yet.
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {history.map((r) => (
              <li key={r.id}>
                <Link href={`/accounting/sales-invoices/${r.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600">{r.name}</div>
                      <div className="text-xs text-ink-muted">
                        {dateShort(r.postingDate)}
                        {r.dueDate && ` · due ${dateShort(r.dueDate)}`}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">
                        {money(Number(r.grandTotal))}
                      </div>
                      <div className="text-xs mt-0.5"><StatusBadge status={r.status} /></div>
                    </div>
                  </div>
                  {Number(r.outstandingAmt) > 0.001 && (
                    <div className="mt-1 text-xs text-amber-700 tabular-nums">
                      Outstanding {money(Number(r.outstandingAmt))}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="RecurringInvoice" docId={params.id} />
      </div>
</main>
  );
}

// Small helper — the shared Back button uses history.back() elsewhere in
// the codebase. Naming the fn `history_pop` avoids clashing with the
// component's `history` state variable when read inside the button
// handler above.
function history_pop() {
  if (typeof window !== "undefined") window.history.back();
}
