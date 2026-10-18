"use client";

import { useEffect, useMemo, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  dateShort,
} from "../../../components/ui";

interface Account {
  id: string;
  accountName: string;
  rootType: string;
  isGroup: boolean;
  disabled: boolean;
}
interface PRItem {
  id: string;
  qty: string;
  rate: string;
  itemId: string;
}
interface PurchaseReceipt {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  supplier: { supplierName: string };
  items: PRItem[];
}

// Loaded from stock-service since PR list lives there. Uses env fallback like
// hr-service loads.
const STOCK = process.env.NEXT_PUBLIC_STOCK_SERVICE_URL ?? "/api/stock";
async function loadPurchaseReceipts(): Promise<PurchaseReceipt[]> {
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${STOCK}/purchase-receipts?status=Submitted`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load PRs (${res.status})`);
  return res.json();
}

interface TaxRow {
  description: string;
  expenseAccountId: string;
  amount: number;
}
const emptyTax = (): TaxRow => ({
  description: "Freight",
  expenseAccountId: "",
  amount: 0,
});

export default function NewLandedCostVoucherPage() {
  const [prs, setPrs] = useState<PurchaseReceipt[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedPrIds, setSelectedPrIds] = useState<string[]>([]);
  const [taxes, setTaxes] = useState<TaxRow[]>([emptyTax()]);
  const [postingDate, setPostingDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadPurchaseReceipts()
      .then(setPrs)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load PRs"));
    api
      .get<Account[]>("/accounts")
      .then((rs) => setAccounts(rs.filter((a) => !a.isGroup && !a.disabled)))
      .catch(() => {});
  }, []);

  // Smart defaults: freight/customs expense accounts are the same across
  // most vouchers in a session; pre-fill the first tax row's account.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ expenseAccountId: string }>(
    "accounting-web:landed-cost-voucher-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (!smart.last?.expenseAccountId) return;
    setTaxes((prev) =>
      prev.map((t, i) => (i === 0 && !t.expenseAccountId ? { ...t, expenseAccountId: smart.last!.expenseAccountId } : t)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.expenseAccountId]);

  const totalCost = useMemo(
    () => taxes.reduce((s, t) => s + Number(t.amount || 0), 0),
    [taxes],
  );

  const selectedPRs = useMemo(
    () => prs.filter((p) => selectedPrIds.includes(p.id)),
    [prs, selectedPrIds],
  );
  const totalBase = useMemo(
    () =>
      selectedPRs
        .flatMap((p) => p.items)
        .reduce((s, it) => s + Number(it.qty) * Number(it.rate), 0),
    [selectedPRs],
  );

  function togglePR(id: string) {
    setSelectedPrIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function updateTax(i: number, patch: Partial<TaxRow>) {
    setTaxes((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function removeTax(i: number) {
    setTaxes((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        postingDate: new Date(postingDate).toISOString(),
        remarks: remarks || undefined,
        purchaseReceiptIds: selectedPrIds,
        taxes,
      };
      const r = await api.post<{ id: string }>("/landed-cost-vouchers", body);
      const firstAcc = taxes.find((t) => t.expenseAccountId)?.expenseAccountId;
      if (firstAcc) smart.remember({ expenseAccountId: firstAcc });
      location.href = `/accounting/landed-cost-vouchers/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-4xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Landed Cost Vouchers", href: "/accounting/landed-cost-vouchers" },
          { label: "New" },
        ]}
        title="New landed cost voucher"
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <Card className="p-4">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Posting date" required>
              <input
                type="date"
                required
                value={postingDate}
                onChange={(e) => setPostingDate(e.target.value)}
                className="input"
              />
            </FormField>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1">
              Purchase receipts to allocate onto
            </div>
            <div className="border border-ink-muted/10 rounded max-h-56 overflow-auto text-sm">
              {prs.length === 0 ? (
                <div className="p-2 text-ink-muted">No submitted purchase receipts.</div>
              ) : (
                prs.map((p) => {
                  const base = p.items.reduce(
                    (s, it) => s + Number(it.qty) * Number(it.rate),
                    0,
                  );
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 border-b border-ink-muted/10 p-2 last:border-0 cursor-pointer hover:bg-surface-sunken"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPrIds.includes(p.id)}
                        onChange={() => togglePR(p.id)}
                      />
                      <span className="font-mono text-xs">{p.name}</span>
                      <span className="text-xs text-ink-muted">
                        {dateShort(p.postingDate)}
                      </span>
                      <span className="text-xs">{p.supplier.supplierName}</span>
                      <span className="ms-auto text-xs font-mono tabular-nums">
                        {base.toFixed(2)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Additional costs</div>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setTaxes((t) => [...t, emptyTax()])}
              >
                + Add cost
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-start">
                <tr>
                  <th className="py-1">Description</th>
                  <th className="py-1">Source expense account</th>
                  <th className="py-1 w-32 text-end">Amount</th>
                  <th className="py-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {taxes.map((t, i) => (
                  <tr key={i}>
                    <td className="py-1 pe-2">
                      <input
                        required
                        className="input"
                        value={t.description}
                        onChange={(e) => updateTax(i, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <select
                        required
                        className="input"
                        value={t.expenseAccountId}
                        onChange={(e) =>
                          updateTax(i, { expenseAccountId: e.target.value })
                        }
                      >
                        <option value="">Select account...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountName} ({a.rootType})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        step="any"
                        min={0.01}
                        required
                        className="input text-end tabular-nums"
                        value={t.amount}
                        onChange={(e) =>
                          updateTax(i, { amount: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-1 text-center">
                      <button
                        type="button"
                        disabled={taxes.length === 1}
                        onClick={() => removeTax(i)}
                        className="text-red-600 disabled:text-ink-muted text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <FormField label="Remarks">
            <textarea
              className="input"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>

          <div className="border-t border-ink-muted/10 pt-3 flex items-center justify-between text-sm">
            <div className="text-ink-soft">
              Total cost:{" "}
              <b className="tabular-nums">{totalCost.toFixed(2)}</b> to be distributed across{" "}
              <b>{selectedPrIds.length}</b> receipts (base value:{" "}
              <b className="tabular-nums">{totalBase.toFixed(2)}</b>).
            </div>
            <Button
              variant="primary"
              type="submit"
              disabled={
                busy || selectedPrIds.length === 0 || totalCost <= 0 || totalBase <= 0
              }
            >
              {busy ? "Saving..." : "Save draft"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
