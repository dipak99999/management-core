"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  Segmented,
} from "../../../components/ui";

interface Party { id: string; name: string }
interface Invoice {
  id: string;
  name: string;
  outstandingAmt: string;
  status: string;
  postingDate: string;
  partyId: string; // customerId or supplierId, normalized below
}

type PaymentType = "Receive" | "Pay";
type PartyType = "Customer" | "Supplier" | "Employee";

interface CustomerRaw { id: string; customerName: string }
interface SupplierRaw {
  id: string;
  supplierName: string;
  taxWithholdingCategoryId?: string | null;
}
interface TdsCategoryLite {
  id: string;
  name: string;
  rate: string;
  thresholdAmount: string;
  disabled: boolean;
}
interface EmployeeRaw { id: string; employeeCode: string; employeeName: string }
interface SIRaw { id: string; name: string; outstandingAmt: string; status: string; postingDate: string; customerId: string }
interface PIRaw { id: string; name: string; outstandingAmt: string; status: string; postingDate: string; supplierId: string }
interface CurrencyRaw { id: string; code: string; symbol?: string | null; currencyCode?: string; isBaseCurrency?: boolean }
// GET /currencies returns { baseCurrency, rows: [...] } (accounting-service
// wraps the list with the tenant's base-currency code for convenience).
interface CurrencyListResponse { baseCurrency: string; rows: CurrencyRaw[] }

interface ExistingPE {
  status: string;
  paymentType: PaymentType;
  partyType: string;
  partyId: string;
  paidAmount: string;
  currency: string;
  conversionRate: string;
  modeOfPayment: string;
  remarks: string | null;
  withholdingCategoryId: string | null;
  withholdingAmount: string;
  references: {
    referenceDoctype: string;
    referenceId: string;
    allocatedAmount: string;
  }[];
}

// Employees live on hr-service; expose them via a read-through here.
// Fallback: try the accounting-service `/employees` path (won't exist yet) and
// bail to hr-service directly on failure. We just hit the hr-service host env
// so we don't depend on a shell rewrite.
async function loadEmployees(): Promise<EmployeeRaw[]> {
  const HR = process.env.NEXT_PUBLIC_HR_SERVICE_URL ?? "/api/hr";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${HR}/employees`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load employees (${res.status})`);
  return res.json();
}

function InnerNewPaymentPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const [initialLoaded, setInitialLoaded] = useState(false);

  const [paymentType, setPaymentType] = useState<PaymentType>("Receive");
  const [partyType, setPartyType] = useState<PartyType>("Customer");
  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [partyId, setPartyId] = useState("");
  const [paidAmount, setPaidAmount] = useState(0);
  const [currency, setCurrency] = useState("INR");
  const [conversionRate, setConversionRate] = useState(1);
  const [currencies, setCurrencies] = useState<CurrencyRaw[]>([]);
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [modeOfPayment, setMode] = useState("Cash");
  const [remarks, setRemarks] = useState("");
  const [allocs, setAllocs] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // B13 TDS state — only used for Pay+Supplier. `tdsCategoryId` is the effective
  // choice (starts empty; auto-set when the picked supplier has a default
  // category; user can override). `tdsAmountOverride` lets the user pin a
  // specific TDS amount instead of the rate × paidAmount default.
  const [tdsCategories, setTdsCategories] = useState<TdsCategoryLite[]>([]);
  const [suppliersFull, setSuppliersFull] = useState<SupplierRaw[]>([]);
  const [tdsCategoryId, setTdsCategoryId] = useState<string>("");
  const [tdsAmountOverride, setTdsAmountOverride] = useState<number | "">("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reference doctype is only meaningful for Customer/Supplier — Employee
  // settlements post on-account against Employee Payable.
  const referenceDoctype =
    partyType === "Customer"
      ? "SalesInvoice"
      : partyType === "Supplier"
        ? "PurchaseInvoice"
        : null;

  // When paymentType changes, snap partyType back to the default for that
  // direction so we don't leave an incompatible selection dangling.
  useEffect(() => {
    if (initialLoaded) return;
    if (paymentType === "Receive" && partyType !== "Customer") {
      setPartyType("Customer");
    }
    if (paymentType === "Pay" && partyType === "Customer") {
      setPartyType("Supplier");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType]);

  // Load currencies once + note baseCurrency. The endpoint returns a
  // {baseCurrency, rows} wrapper — handle both shapes for resilience.
  useEffect(() => {
    api
      .get<CurrencyListResponse | CurrencyRaw[]>("/currencies")
      .then((data) => {
        const cs = Array.isArray(data) ? data : (data.rows ?? []);
        setCurrencies(cs);
        const base =
          (!Array.isArray(data) && data.baseCurrency) ||
          cs.find((c) => c.isBaseCurrency)?.currencyCode ||
          cs.find((c) => c.isBaseCurrency)?.code;
        if (base) setBaseCurrency(base);
      })
      .catch(() => {});
    // B13: load TDS categories once (used only for Pay+Supplier).
    api
      .get<TdsCategoryLite[]>("/tax-withholding-categories")
      .then(setTdsCategories)
      .catch(() => {});
  }, []);

  // Load parties + invoices whenever partyType changes.
  useEffect(() => {
    if (!initialLoaded) {
      setPartyId("");
      setAllocs({});
    }
    (async () => {
      try {
        if (partyType === "Customer") {
          const [cs, invs] = await Promise.all([
            api.get<CustomerRaw[]>("/customers"),
            api.get<SIRaw[]>("/sales-invoices"),
          ]);
          setParties(cs.map((c) => ({ id: c.id, name: c.customerName })));
          setInvoices(
            invs.map((i) => ({
              id: i.id,
              name: i.name,
              outstandingAmt: i.outstandingAmt,
              status: i.status,
              postingDate: i.postingDate,
              partyId: i.customerId,
            })),
          );
        } else if (partyType === "Supplier") {
          const [ss, invs] = await Promise.all([
            api.get<SupplierRaw[]>("/suppliers"),
            api.get<PIRaw[]>("/purchase-invoices"),
          ]);
          setSuppliersFull(ss);
          setParties(ss.map((s) => ({ id: s.id, name: s.supplierName })));
          setInvoices(
            invs.map((i) => ({
              id: i.id,
              name: i.name,
              outstandingAmt: i.outstandingAmt,
              status: i.status,
              postingDate: i.postingDate,
              partyId: i.supplierId,
            })),
          );
        } else if (partyType === "Employee") {
          const es = await loadEmployees();
          setParties(
            es.map((e) => ({ id: e.id, name: `${e.employeeName} (${e.employeeCode})` })),
          );
          setInvoices([]); // No invoice-refs for Employee.
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [partyType, initialLoaded]);

  // Pre-fill from existing PE when editing.
  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingPE>(`/payment-entries/${editId}`)
      .then((pe) => {
        if (pe.status !== "Draft") {
          setError(`Cannot edit payment in status ${pe.status}`);
          return;
        }
        setPaymentType(pe.paymentType);
        setPartyType(pe.partyType as PartyType);
        setPartyId(pe.partyId);
        setPaidAmount(Number(pe.paidAmount));
        setCurrency(pe.currency);
        setConversionRate(Number(pe.conversionRate));
        setMode(pe.modeOfPayment);
        setRemarks(pe.remarks ?? "");
        setTdsCategoryId(pe.withholdingCategoryId ?? "");
        setTdsAmountOverride(
          pe.withholdingAmount != null && Number(pe.withholdingAmount) > 0
            ? Number(pe.withholdingAmount)
            : "",
        );
        const allocMap: Record<string, number> = {};
        for (const r of pe.references) allocMap[r.referenceId] = Number(r.allocatedAmount);
        setAllocs(allocMap);
        setInitialLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  const eligibleInvoices = useMemo(
    () =>
      invoices.filter(
        (i) =>
          i.partyId === partyId &&
          i.status !== "Cancelled" &&
          i.status !== "Draft" &&
          Number(i.outstandingAmt) > 0,
      ),
    [invoices, partyId],
  );

  const totalAllocated = useMemo(
    () => Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0),
    [allocs],
  );

  useEffect(() => {
    if (initialLoaded) {
      setInitialLoaded(false);
      return;
    }
    setAllocs({});
    // B13: when partyId changes to a Supplier that carries a default TDS
    // category, seed the picker. User can still clear or override.
    if (paymentType === "Pay" && partyType === "Supplier" && partyId) {
      const s = suppliersFull.find((x) => x.id === partyId);
      setTdsCategoryId(s?.taxWithholdingCategoryId ?? "");
      setTdsAmountOverride("");
    } else {
      setTdsCategoryId("");
      setTdsAmountOverride("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, initialLoaded]);

  const showTds = paymentType === "Pay" && partyType === "Supplier";
  const tdsCategory = tdsCategories.find((c) => c.id === tdsCategoryId);
  // Threshold: if paidAmount < category.thresholdAmount, no TDS.
  const tdsBelowThreshold =
    !!tdsCategory && paidAmount < Number(tdsCategory.thresholdAmount);
  const tdsAutoAmount =
    tdsCategory && !tdsBelowThreshold ? (paidAmount * Number(tdsCategory.rate)) / 100 : 0;
  const tdsEffective =
    tdsAmountOverride !== "" ? Number(tdsAmountOverride) : tdsAutoAmount;

  function autoAllocate() {
    let remaining = paidAmount;
    const sorted = [...eligibleInvoices].sort(
      (a, b) => new Date(a.postingDate).getTime() - new Date(b.postingDate).getTime(),
    );
    const next: Record<string, number> = {};
    for (const inv of sorted) {
      if (remaining <= 0) break;
      const outstanding = Number(inv.outstandingAmt);
      const alloc = Math.min(remaining, outstanding);
      next[inv.id] = Number(alloc.toFixed(2));
      remaining -= alloc;
    }
    setAllocs(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        paymentType,
        partyType,
        partyId,
        paidAmount,
        currency,
        conversionRate,
        modeOfPayment,
        remarks,
        // B13: pass explicit choices when we're on Pay+Supplier so server can
        // snapshot the category. When category is unset, TDS is skipped.
        ...(showTds && tdsCategoryId
          ? {
              withholdingCategoryId: tdsCategoryId,
              ...(tdsAmountOverride !== ""
                ? { withholdingAmount: Number(tdsAmountOverride) }
                : {}),
            }
          : {}),
        references:
          referenceDoctype === null
            ? []
            : Object.entries(allocs)
                .filter(([, v]) => Number(v) > 0)
                .map(([invoiceId, allocatedAmount]) => ({
                  referenceDoctype,
                  referenceId: invoiceId,
                  allocatedAmount: Number(allocatedAmount),
                })),
      };
      if (editId) {
        await api.put(`/payment-entries/${editId}`, body);
        location.href = `/accounting/payments/${editId}`;
      } else {
        await api.post("/payment-entries", body);
        location.href = "/accounting/payments";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const showAllocations = referenceDoctype !== null;
  const isFx = currency !== baseCurrency;
  const partyOptions: PartyType[] =
    paymentType === "Receive" ? ["Customer"] : ["Supplier", "Employee"];

  return (
    <main className="p-8 max-w-3xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Payments", href: "/accounting/payments" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Payment" : "New Payment"}
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <Segmented<PaymentType>
        value={paymentType}
        onChange={setPaymentType}
        options={[
          { value: "Receive", label: "Receive" },
          { value: "Pay", label: "Pay" },
        ]}
      />

      <Card className="p-4">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Party type">
              <select
                className="input"
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as PartyType)}
              >
                {partyOptions.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="col-span-2">
              <FormField label={partyType} required>
                <select
                  required
                  className="input"
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                >
                  <option value="">Select {partyType.toLowerCase()}...</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Mode">
              <select
                className="input"
                value={modeOfPayment}
                onChange={(e) => setMode(e.target.value)}
              >
                <option>Cash</option>
                <option>Bank</option>
                <option>UPI</option>
                <option>Card</option>
              </select>
            </FormField>
            <FormField label={paymentType === "Receive" ? "Amount received" : "Amount paid"} required>
              <input
                type="number"
                step="any"
                min={0.01}
                required
                className="input tabular-nums"
                value={paidAmount}
                onChange={(e) => setPaidAmount(Number(e.target.value))}
              />
            </FormField>
          </div>

          <div className="flex items-center justify-between border-t border-ink-muted/10 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-ink-muted hover:text-ink-soft transition-colors"
            >
              {showAdvanced ? "− Hide" : "+ Show"} currency & FX rate
            </button>
            {isFx && !showAdvanced && (
              <span className="text-[11px] text-amber-700">FX rate auto-fetched for {currency}</span>
            )}
          </div>

          {(showAdvanced || isFx) && (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Currency">
                <select
                  className="input"
                  value={currency}
                  onChange={async (e) => {
                    const c = e.target.value;
                    setCurrency(c);
                    if (c === baseCurrency) {
                      setConversionRate(1);
                      return;
                    }
                    try {
                      const r = await api.get<{ rate: number | null }>(
                        `/exchange-rates/latest?from=${c}&to=${baseCurrency}`,
                      );
                      if (r.rate) setConversionRate(r.rate);
                    } catch {
                      // silent
                    }
                  }}
                >
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => {
                    const code = c.code ?? c.currencyCode ?? "";
                    return (
                      <option key={c.id} value={code}>
                        {code}
                        {code === baseCurrency ? " (base)" : ""}
                      </option>
                    );
                  })}
                </select>
              </FormField>
              <FormField label={`FX rate → ${baseCurrency}`}>
                <input
                  type="number"
                  step="any"
                  min={0}
                  disabled={!isFx}
                  className="input tabular-nums disabled:bg-surface-sunken"
                  value={conversionRate}
                  onChange={(e) => setConversionRate(Number(e.target.value))}
                />
              </FormField>
            </div>
          )}

          {isFx && (
            <div className="text-xs text-ink-soft">
              Base value: <b className="tabular-nums">{(paidAmount * conversionRate).toFixed(2)}</b>{" "}
              {baseCurrency}. GL will be posted at this rate; any difference vs the
              allocated invoices' own rates becomes FX gain/loss.
            </div>
          )}

          {partyType === "Employee" && (
            <Card className="p-2 text-xs bg-amber-50 border-amber-200 text-amber-800">
              Employee payments post on-account against Employee Payable. Invoice
              allocations are not supported — use this to settle salary slips,
              expense claims, or loan repayments in one lump.
            </Card>
          )}

          {showAllocations && partyId && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="label">
                  Allocate to outstanding{" "}
                  {paymentType === "Receive" ? "sales" : "purchase"} invoices
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={autoAllocate}
                  disabled={paidAmount <= 0 || eligibleInvoices.length === 0}
                >
                  Auto-allocate (FIFO)
                </Button>
              </div>
              {eligibleInvoices.length === 0 ? (
                <Card className="p-4 text-center text-sm text-ink-muted">
                  No outstanding invoices for this {partyType.toLowerCase()}
                </Card>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-ink-muted text-start">
                    <tr>
                      <th className="py-1">Invoice</th>
                      <th className="py-1 w-28 text-end">Outstanding</th>
                      <th className="py-1 w-28">Allocate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-1 font-mono">{inv.name}</td>
                        <td className="py-1 text-end tabular-nums">
                          {Number(inv.outstandingAmt).toFixed(2)}
                        </td>
                        <td className="py-1">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            max={Number(inv.outstandingAmt)}
                            className="input tabular-nums"
                            value={allocs[inv.id] ?? ""}
                            onChange={(e) =>
                              setAllocs((a) => ({ ...a, [inv.id]: Number(e.target.value) }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="text-sm text-ink-soft mt-2 text-end">
                Allocated: <b className="tabular-nums">{totalAllocated.toFixed(2)}</b> / {paidAmount.toFixed(2)}
                {totalAllocated > paidAmount && (
                  <span className="text-red-600 ms-2">Exceeds amount</span>
                )}
              </div>
            </div>
          )}

          {showTds && (
            <Card className="p-3 space-y-2 bg-surface-sunken">
              <div className="text-sm font-semibold text-ink-soft">
                TDS (Withholding tax)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FormField label="Category">
                  <select
                    className="input"
                    value={tdsCategoryId}
                    onChange={(e) => {
                      setTdsCategoryId(e.target.value);
                      setTdsAmountOverride("");
                    }}
                  >
                    <option value="">— None (no TDS) —</option>
                    {tdsCategories
                      .filter((c) => !c.disabled)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({Number(c.rate).toFixed(2)}%)
                        </option>
                      ))}
                  </select>
                </FormField>
                <FormField label="TDS amount (override optional)">
                  <input
                    type="number"
                    step="any"
                    min={0}
                    disabled={!tdsCategoryId}
                    className="input tabular-nums disabled:bg-surface-sunken"
                    placeholder={
                      tdsCategoryId ? tdsAutoAmount.toFixed(2) : "0.00"
                    }
                    value={tdsAmountOverride}
                    onChange={(e) =>
                      setTdsAmountOverride(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </FormField>
              </div>
              {tdsCategoryId && (
                <div className="text-xs text-ink-soft">
                  {tdsBelowThreshold ? (
                    <>
                      Payment ({paidAmount.toFixed(2)}) is below category
                      threshold ({Number(tdsCategory?.thresholdAmount).toFixed(2)})
                      — server will skip TDS.
                    </>
                  ) : (
                    <>
                      Cash/Bank outflow will be{" "}
                      <b className="tabular-nums">{(paidAmount - tdsEffective).toFixed(2)}</b> {currency};{" "}
                      <b className="tabular-nums">{tdsEffective.toFixed(2)}</b> {currency} credits the TDS
                      Payable account. Supplier considered settled for the full{" "}
                      <b className="tabular-nums">{paidAmount.toFixed(2)}</b>.
                    </>
                  )}
                </div>
              )}
            </Card>
          )}

          <FormField label="Remarks">
            <textarea
              className="input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>

          <div className="flex justify-end border-t border-ink-muted/10 pt-3">
            <Button
              variant="primary"
              type="submit"
              disabled={
                busy ||
                !partyId ||
                paidAmount <= 0 ||
                (showAllocations && totalAllocated > paidAmount)
              }
            >
              {busy ? "Saving..." : "Save Payment"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

export default function NewPaymentPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewPaymentPage />
    </Suspense>
  );
}
