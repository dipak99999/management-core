"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  Skeleton,
  dateShort,
  money,
} from "../../../components/ui";

interface GLEntryLite {
  id: string;
  voucherType: string;
  voucherName: string | null;
  debit: string;
  credit: string;
  postingDate: string;
  remarks: string | null;
  // Populated by the scored /candidates endpoint (0-100 + reasons[]).
  // Optional so the matchedGlEntry field on a bank txn (which comes from
  // /statements/:id/full and doesn't run the scorer) still fits this shape.
  score?: number;
  reasons?: string[];
}

interface PartyRef {
  id: string;
  name: string;
}
interface BankTxn {
  id: string;
  transactionDate: string;
  description: string;
  referenceNumber: string | null;
  amount: string;
  runningBalance: string | null;
  matchedGlEntryId: string | null;
  matchStatus: string;
  reconciledAt: string | null;
  notes: string | null;
  matchedGlEntry: GLEntryLite | null;
}
interface Statement {
  id: string;
  fileName: string;
  fromDate: string;
  toDate: string;
  openingBalance: string;
  closingBalance: string;
  account: { accountName: string };
  transactions: BankTxn[];
}

function TxnStatusBadge({ status }: { status: string }) {
  const cls =
    status === "Matched"
      ? "badge-green"
      : status === "AutoSuggested"
        ? "badge-blue"
        : status === "Ignored"
          ? "badge-gray"
          : "badge-amber";
  return <span className={cls}>{status}</span>;
}

export default function ReconcileStatementPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidatesFor, setCandidatesFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<GLEntryLite[]>([]);
  // Create-Payment-Entry modal state. `txn` triggers the form; `parties`
  // are fetched lazily on modal open.
  const [createPeFor, setCreatePeFor] = useState<BankTxn | null>(null);
  const [customers, setCustomers] = useState<PartyRef[]>([]);
  const [suppliers, setSuppliers] = useState<PartyRef[]>([]);
  const [createPeForm, setCreatePeForm] = useState<{
    partyType: "Customer" | "Supplier";
    partyId: string;
    modeOfPayment: string;
  }>({ partyType: "Customer", partyId: "", modeOfPayment: "Bank" });

  async function load() {
    try {
      setData(await api.get<Statement>(`/bank-reconciliation/statements/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function autoMatch() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ matched: number; considered: number }>(
        `/bank-reconciliation/statements/${params.id}/auto-match`,
        {},
      );
      showToast(`Auto-matched ${r.matched} of ${r.considered} unmatched transactions.`, "success");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates(txnId: string) {
    setCandidatesFor(txnId);
    setCandidates([]);
    try {
      setCandidates(
        await api.get<GLEntryLite[]>(`/bank-reconciliation/transactions/${txnId}/candidates`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function match(txnId: string, glEntryId: string) {
    try {
      await api.post(`/bank-reconciliation/transactions/${txnId}/match`, { glEntryId });
      setCandidatesFor(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  async function unmatch(txnId: string) {
    try {
      await api.post(`/bank-reconciliation/transactions/${txnId}/unmatch`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  async function ignoreTxn(txnId: string) {
    const notes = prompt("Reason (optional):");
    try {
      await api.post(`/bank-reconciliation/transactions/${txnId}/ignore`, { notes });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  async function confirm(txnId: string) {
    try {
      await api.post(`/bank-reconciliation/transactions/${txnId}/confirm`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  // Lazy-load party lists the first time the Create-PE modal opens. Kept
  // out of the initial page load — most sessions only reconcile matched
  // txns and never need these dropdowns.
  async function openCreatePe(txn: BankTxn) {
    setCreatePeFor(txn);
    const partyType = Number(txn.amount) > 0 ? "Customer" : "Supplier";
    setCreatePeForm({ partyType, partyId: "", modeOfPayment: "Bank" });
    if (partyType === "Customer" && customers.length === 0) {
      try {
        const rows = await api.get<{ id: string; customerName: string }[]>("/customers");
        setCustomers(rows.map((r) => ({ id: r.id, name: r.customerName })));
      } catch {
        // Non-blocking — the operator can still cancel + retry.
      }
    }
    if (partyType === "Supplier" && suppliers.length === 0) {
      try {
        const rows = await api.get<{ id: string; supplierName: string }[]>("/suppliers");
        setSuppliers(rows.map((r) => ({ id: r.id, name: r.supplierName })));
      } catch {
        // Non-blocking.
      }
    }
  }

  async function submitCreatePe() {
    if (!createPeFor || !createPeForm.partyId) return;
    try {
      const r = await api.post<{ paymentEntryId: string; paymentEntryName: string }>(
        `/bank-reconciliation/transactions/${createPeFor.id}/create-payment-entry`,
        {
          paymentType: Number(createPeFor.amount) > 0 ? "Receive" : "Pay",
          partyType: createPeForm.partyType,
          partyId: createPeForm.partyId,
          modeOfPayment: createPeForm.modeOfPayment,
        },
      );
      setCreatePeFor(null);
      showToast(
        `Draft Payment Entry ${r.paymentEntryName} created. Open it from /accounting/payments to review and submit.`,
        "success",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const summary = useMemo(() => {
    if (!data) return { total: 0, matched: 0, ignored: 0, unmatched: 0, autoSuggested: 0 };
    const s = { total: data.transactions.length, matched: 0, ignored: 0, unmatched: 0, autoSuggested: 0 };
    for (const t of data.transactions) {
      if (t.matchStatus === "Matched") s.matched += 1;
      else if (t.matchStatus === "Ignored") s.ignored += 1;
      else if (t.matchStatus === "AutoSuggested") s.autoSuggested += 1;
      else s.unmatched += 1;
    }
    return s;
  }, [data]);

  if (error && !data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Bank Reconciliation", href: "/accounting/bank-reconciliation" }]}
          title="Statement"
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
          breadcrumb={[{ label: "Bank Reconciliation", href: "/accounting/bank-reconciliation" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Bank Reconciliation", href: "/accounting/bank-reconciliation" },
          { label: data.account.accountName },
        ]}
        title={data.account.accountName}
        subtitle={`${dateShort(data.fromDate)} → ${dateShort(data.toDate)} · ${data.fileName}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <Button
              variant="primary"
              onClick={autoMatch}
              disabled={busy || summary.unmatched === 0}
              type="button"
            >
              {busy ? "…" : "Auto-match remaining"}
            </Button>
          </>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <div className="grid grid-cols-6 gap-3 text-sm">
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Opening</div>
          <div className="font-semibold tabular-nums mt-0.5">{money(Number(data.openingBalance))}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Closing</div>
          <div className="font-semibold tabular-nums mt-0.5">{money(Number(data.closingBalance))}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Matched</div>
          <div className="font-semibold text-green-700 mt-0.5 tabular-nums">{summary.matched}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Suggested</div>
          <div className="font-semibold text-blue-700 mt-0.5 tabular-nums">{summary.autoSuggested}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Unmatched</div>
          <div className="font-semibold text-amber-700 mt-0.5 tabular-nums">{summary.unmatched}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Ignored</div>
          <div className="font-semibold text-ink-muted mt-0.5 tabular-nums">{summary.ignored}</div>
        </Card>
      </div>

      <div className="table-wrap overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Ref</th>
              <th className="text-end">Amount</th>
              <th>Status / Match</th>
              <th className="text-end"></th>
            </tr>
          </thead>
          <tbody>
            {data.transactions.map((t) => (
              <Fragment key={t.id}>
                <tr className="align-top">
                  <td className="text-xs">{dateShort(t.transactionDate)}</td>
                  <td className="text-sm max-w-xs truncate">{t.description}</td>
                  <td className="text-xs">{t.referenceNumber ?? "—"}</td>
                  <td
                    className={`text-end font-mono tabular-nums ${
                      Number(t.amount) > 0 ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {Number(t.amount) > 0 ? "+" : ""}
                    {Number(t.amount).toFixed(2)}
                  </td>
                  <td className="text-xs">
                    <TxnStatusBadge status={t.matchStatus} />
                    {t.matchedGlEntry && (
                      <div className="mt-1 text-ink-soft">
                        → {t.matchedGlEntry.voucherType}{" "}
                        <span className="font-mono">{t.matchedGlEntry.voucherName}</span>
                      </div>
                    )}
                    {t.notes && (
                      <div className="mt-1 text-ink-muted italic">{t.notes}</div>
                    )}
                  </td>
                  <td className="text-end text-xs space-x-2">
                    {t.matchStatus === "Matched" || t.matchStatus === "Ignored" ? (
                      <button
                        onClick={() => unmatch(t.id)}
                        className="text-red-600 hover:underline"
                      >
                        Undo
                      </button>
                    ) : (
                      <>
                        {t.matchStatus === "AutoSuggested" && (
                          <button
                            onClick={() => confirm(t.id)}
                            className="text-green-700 hover:underline"
                          >
                            Confirm
                          </button>
                        )}
                        <button
                          onClick={() => loadCandidates(t.id)}
                          className="text-brand-600 hover:underline"
                        >
                          {candidatesFor === t.id ? "Hide" : "Find match"}
                        </button>
                        <button
                          onClick={() => openCreatePe(t)}
                          className="text-brand-600 hover:underline"
                        >
                          Create PE
                        </button>
                        <button
                          onClick={() => ignoreTxn(t.id)}
                          className="text-ink-muted hover:underline"
                        >
                          Ignore
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {candidatesFor === t.id && (
                  <tr className="bg-surface-sunken">
                    <td colSpan={6} className="px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1">
                        Candidate GL entries — ranked by match confidence
                      </div>
                      {candidates.length === 0 ? (
                        <div className="text-xs text-ink-muted">
                          No matching GL entries found. Post the corresponding voucher
                          first, click <strong>Create PE</strong> to mint a Payment
                          Entry directly, or mark this transaction Ignored.
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {candidates.map((c) => {
                            const score = c.score ?? 0;
                            const scoreColor =
                              score >= 90
                                ? "text-green-700"
                                : score >= 70
                                  ? "text-blue-700"
                                  : "text-amber-700";
                            return (
                              <li key={c.id} className="text-xs flex items-center gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  type="button"
                                  onClick={() => match(t.id, c.id)}
                                >
                                  Match
                                </Button>
                                <span
                                  className={`font-mono font-semibold ${scoreColor}`}
                                  title={c.reasons?.join(" · ")}
                                >
                                  {score}%
                                </span>
                                <span className="font-mono">
                                  {c.voucherType} {c.voucherName ?? c.id.slice(0, 8)}
                                </span>
                                <span className="text-ink-muted">
                                  {dateShort(c.postingDate)}
                                </span>
                                {c.reasons && c.reasons.length > 0 && (
                                  <span className="text-ink-muted italic truncate">
                                    · {c.reasons.join(" · ")}
                                  </span>
                                )}
                                <span className="ms-auto font-mono tabular-nums">
                                  {Number(c.debit) > 0
                                    ? `DR ${Number(c.debit).toFixed(2)}`
                                    : `CR ${Number(c.credit).toFixed(2)}`}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create-Payment-Entry modal — opens on unmatched bank txns to
          mint a Draft PE with amount/date/party pre-filled. Direction
          (Receive vs Pay) is inferred from the txn's sign. */}
      {createPeFor && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setCreatePeFor(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-[440px] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Create Payment Entry</h2>
              <button
                onClick={() => setCreatePeFor(null)}
                className="text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
            <div className="text-sm text-ink-soft">
              Mint a Draft {Number(createPeFor.amount) > 0 ? "Receive" : "Pay"}{" "}
              Payment Entry for{" "}
              <span className="font-mono font-semibold text-ink">
                {money(Math.abs(Number(createPeFor.amount)))}
              </span>{" "}
              on {dateShort(createPeFor.transactionDate)}.
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {createPeForm.partyType}
              </label>
              <select
                className="input w-full"
                value={createPeForm.partyId}
                onChange={(e) =>
                  setCreatePeForm({ ...createPeForm, partyId: e.target.value })
                }
              >
                <option value="">
                  Select {createPeForm.partyType.toLowerCase()}…
                </option>
                {(createPeForm.partyType === "Customer" ? customers : suppliers).map(
                  (p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                Mode of payment
              </label>
              <select
                className="input w-full"
                value={createPeForm.modeOfPayment}
                onChange={(e) =>
                  setCreatePeForm({ ...createPeForm, modeOfPayment: e.target.value })
                }
              >
                <option>Bank</option>
                <option>Cash</option>
                <option>UPI</option>
                <option>Card</option>
              </select>
            </div>
            <div className="text-[11px] text-ink-muted">
              The PE lands as Draft. Review + submit from the Payment Entries
              page, then re-run "Find match" here to link the resulting GL
              entry to this bank transaction.
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => setCreatePeFor(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={submitCreatePe}
                disabled={!createPeForm.partyId}
                className="flex-1"
              >
                Create draft
              </Button>
            </div>
          </div>
        </div>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="BankReconciliation" docId={params.id} />
      </div>
</main>
  );
}
