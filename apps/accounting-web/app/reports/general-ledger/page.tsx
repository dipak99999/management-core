"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  dateShort,
} from "../../../components/ui";
import { useCompanyScope } from "../../../components/company-scope";

interface Account {
  id: string;
  accountName: string;
  rootType: string;
  accountType: string | null;
  isGroup: boolean;
}
interface GLEntry {
  id: string;
  postingDate: string;
  debit: string;
  credit: string;
  voucherType: string;
  voucherId: string;
  voucherName: string | null;
  partyType: string | null;
  partyId: string | null;
  remarks: string | null;
}
interface GLPayload {
  account: Account;
  openingBalance: number;
  entries: GLEntry[];
  totals: { debit: number; credit: number };
  closingBalance: number;
  from: string | null;
  to: string | null;
}

// Render a signed balance as "N Dr" or "N Cr" using accountant convention.
function drCr(n: number): string {
  if (Math.abs(n) < 0.005) return "—";
  return n > 0 ? `${n.toFixed(2)} Dr` : `${Math.abs(n).toFixed(2)} Cr`;
}

// Where a voucher lives in the UI. Best-effort — some voucher types live in
// different microfrontends. Users still see the voucher name even if the link
// isn't perfect.
function voucherHref(voucherType: string): string | null {
  switch (voucherType) {
    case "SalesInvoice":
      return "/accounting/sales-invoices";
    case "PurchaseInvoice":
      return "/buying/purchase-invoices";
    case "PaymentEntry":
      return "/accounting/payments";
    case "JournalEntry":
      return "/accounting/journal-entries";
    case "DeliveryNote":
      return "/stock/delivery-notes";
    case "PurchaseReceipt":
      return "/stock/purchase-receipts";
    case "SalarySlip":
      return "/hr/salary-slips";
    default:
      return null;
  }
}

export default function GeneralLedgerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<GLPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { companyId } = useCompanyScope();

  // Read initial ?accountId=&from=&to= from URL so Trial Balance et al. can
  // deep-link straight to a filtered view.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const a = params.get("accountId");
    const f = params.get("from");
    const t = params.get("to");
    if (a) setAccountId(a);
    if (f) setFrom(f);
    if (t) setTo(t);
  }, []);

  useEffect(() => {
    api
      .get<Account[]>("/accounts")
      .then((all) => setAccounts(all.filter((a) => !a.isGroup)))
      .catch(() => {});
  }, []);

  async function load() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ accountId });
      if (from) qs.set("from", new Date(from).toISOString());
      if (to) qs.set("to", new Date(to).toISOString());
      if (companyId) qs.set("companyId", companyId);
      setData(await api.get<GLPayload>(`/reports/general-ledger?${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  // Auto-run when accountId/from/to change (with a tiny debounce via effect ordering).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, from, to, companyId]);

  useListPageCommands({
    singular: "General Ledger",
    plural: "General Ledger",
    refresh: load,
  });

  const rowsWithBalance = useMemo(() => {
    if (!data) return [];
    let bal = data.openingBalance;
    return data.entries.map((e) => {
      bal += Number(e.debit) - Number(e.credit);
      return { ...e, runningBalance: bal };
    });
  }, [data]);

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "General Ledger" },
        ]}
        title="General Ledger"
      />

      <Card className="p-4 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-64">
          <FormField label="Account">
            <select
              required
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName} ({a.rootType})
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="From">
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </FormField>
        <FormField label="To">
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </FormField>
        <Button
          variant="primary"
          onClick={load}
          disabled={!accountId || loading}
          type="button"
        >
          {loading ? "Loading..." : "Refresh"}
        </Button>
      </Card>

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      {!accountId && (
        <Card className="p-6 text-center text-ink-muted">
          Pick an account to see its ledger.
        </Card>
      )}

      {data && accountId && (
        <>
          <Card className="p-3 flex flex-wrap gap-6 bg-surface-sunken">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Account</div>
              <div className="font-semibold">
                {data.account.accountName}{" "}
                <span className="text-ink-muted font-normal">({data.account.rootType})</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Opening</div>
              <div className="font-mono tabular-nums">{drCr(data.openingBalance)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Debits</div>
              <div className="font-mono tabular-nums">{data.totals.debit.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Credits</div>
              <div className="font-mono tabular-nums">{data.totals.credit.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Closing</div>
              <div className="font-mono tabular-nums font-semibold">{drCr(data.closingBalance)}</div>
            </div>
          </Card>

          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Party</th>
                  <th>Remarks</th>
                  <th className="text-end">Debit</th>
                  <th className="text-end">Credit</th>
                  <th className="text-end">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rowsWithBalance.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-ink-muted">
                      No entries in range
                    </td>
                  </tr>
                )}
                {rowsWithBalance.map((e) => {
                  const href = voucherHref(e.voucherType);
                  return (
                    <tr key={e.id}>
                      <td className="text-sm">{dateShort(e.postingDate)}</td>
                      <td className="text-sm">
                        <div className="text-xs text-ink-muted">{e.voucherType}</div>
                        {href ? (
                          <a
                            href={href}
                            className="font-mono text-brand-600 hover:underline"
                          >
                            {e.voucherName ?? e.voucherId.slice(0, 8)}
                          </a>
                        ) : (
                          <span className="font-mono">
                            {e.voucherName ?? e.voucherId.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td className="text-xs text-ink-soft">
                        {e.partyType && e.partyId
                          ? `${e.partyType}: ${e.partyId.slice(0, 8)}`
                          : "—"}
                      </td>
                      <td className="text-xs text-ink-soft">{e.remarks ?? "—"}</td>
                      <td className="text-end font-mono tabular-nums">
                        {Number(e.debit) > 0 ? Number(e.debit).toFixed(2) : ""}
                      </td>
                      <td className="text-end font-mono tabular-nums">
                        {Number(e.credit) > 0 ? Number(e.credit).toFixed(2) : ""}
                      </td>
                      <td className="text-end font-mono tabular-nums">
                        {drCr(e.runningBalance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-surface-sunken font-semibold">
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="text-end font-mono tabular-nums">
                    {data.totals.debit.toFixed(2)}
                  </td>
                  <td className="text-end font-mono tabular-nums">
                    {data.totals.credit.toFixed(2)}
                  </td>
                  <td className="text-end font-mono tabular-nums">
                    {drCr(data.closingBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
