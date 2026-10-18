"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../components/ui";

interface Supplier {
  id: string;
  supplierName: string;
  defaultPaymentTermsTemplateId?: string | null;
}
interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  // B11: pre-seeded onto new PI line when item is picked.
  defaultPurchaseTaxTemplateId?: string | null;
}
interface Currency { id: string; code: string; name: string; symbol: string }
interface CurrenciesEnvelope { baseCurrency: string; rows: Currency[] }
interface TaxTemplateRow {
  id: string;
  description: string;
  rate: string;
  accountId: string;
  chargeType?: string | null;
  amount?: string | null;
}
interface TaxTemplate {
  id: string;
  name: string;
  rate: string | null;
  templateType: string;
  rows: TaxTemplateRow[];
}

interface Line {
  itemId: string;
  qty: number;
  rate: number;
  // B11: per-line tax override. "" → fall back to invoice-level template.
  taxTemplateId: string;
}
interface ExistingPI {
  status: string;
  supplierId: string;
  supplierInvoiceNo: string | null;
  currency: string;
  conversionRate: string;
  taxTemplateId: string | null;
  paymentTermsTemplateId?: string | null;
  remarks: string | null;
  items: { itemId: string; qty: string; rate: string; taxTemplateId: string | null }[];
}

function InnerNewPurchaseInvoicePage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  // B15: Debit Note pre-fill flow. `?returnAgainstId=<piId>` opens the form
  // with same supplier + currency + negated items.
  const returnAgainstId = searchParams.get("returnAgainstId");
  const [isReturn, setIsReturn] = useState(false);
  const [sourceInvoiceName, setSourceInvoiceName] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  const [priceLists, setPriceLists] = useState<{ id: string; name: string }[]>([]);
  const [priceListId, setPriceListId] = useState<string>("");
  // D10: Payment terms templates. When set, PI submit materializes the
  // schedule and dueDate is overwritten to the latest installment.
  const [paymentTermsTemplates, setPaymentTermsTemplates] = useState<
    { id: string; name: string; terms: { invoicePortion: string; dueDays: number }[] }[]
  >([]);
  const [paymentTermsTemplateId, setPaymentTermsTemplateId] = useState<string>("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [conversionRate, setConversionRate] = useState(1);
  const [taxTemplateId, setTaxTemplateId] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([
    { itemId: "", qty: 1, rate: 0, taxTemplateId: "" },
  ]);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Collapse Tax template + Payment terms behind a toggle — the common path
  // (supplier + lines + due date + remarks) stays visible by default.
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Smart defaults: PIs tend to come from the same supplier in a session;
  // pre-fill the last picked supplier so the first field is already set.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ supplierId: string }>(
    "buying-web:purchase-invoice-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (editId || supplierId || !smart.last?.supplierId) return;
    setSupplierId(smart.last.supplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.supplierId]);

  useEffect(() => {
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api
      .get<CurrenciesEnvelope>("/currencies")
      .then((d) => {
        setCurrencies(d.rows);
        setBaseCurrency(d.baseCurrency);
        if (!editId) setCurrency(d.baseCurrency);
      })
      .catch(() => {});
    api
      .get<TaxTemplate[]>("/tax-templates?type=Purchase")
      .then(setTaxTemplates)
      .catch(() => {});
    // C4: Buying price lists + tenant default.
    api
      .get<{ id: string; name: string; isDefault: boolean }[]>(
        "/price-lists?type=Buying",
      )
      .then((pls) => {
        setPriceLists(pls);
        const def = pls.find((p) => p.isDefault);
        if (def && !editId) setPriceListId(def.id);
      })
      .catch(() => {});
    // D10: load enabled Payment Terms Templates for the selector.
    api
      .get<{ id: string; name: string; enabled: boolean; terms: { invoicePortion: string; dueDays: number }[] }[]>(
        "/payment-terms-templates",
      )
      .then((rows) => setPaymentTermsTemplates(rows.filter((r) => r.enabled)))
      .catch(() => {});
  }, [editId]);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingPI>(`/purchase-invoices/${editId}`)
      .then((pi) => {
        if (pi.status !== "Draft") {
          setError(`Cannot edit invoice in status ${pi.status}`);
          return;
        }
        setSupplierId(pi.supplierId);
        setSupplierInvoiceNo(pi.supplierInvoiceNo ?? "");
        setCurrency(pi.currency);
        setConversionRate(Number(pi.conversionRate));
        setTaxTemplateId(pi.taxTemplateId ?? "");
        setPaymentTermsTemplateId(pi.paymentTermsTemplateId ?? "");
        setRemarks(pi.remarks ?? "");
        setLines(
          pi.items.length
            ? pi.items.map((it) => ({
                itemId: it.itemId,
                qty: Number(it.qty),
                rate: Number(it.rate),
                taxTemplateId: it.taxTemplateId ?? "",
              }))
            : [{ itemId: "", qty: 1, rate: 0, taxTemplateId: "" }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  // B15: pre-fill Debit Note from source PI.
  useEffect(() => {
    if (!returnAgainstId) return;
    interface PISource {
      name: string;
      supplierId: string;
      supplierInvoiceNo: string | null;
      currency: string;
      conversionRate: string;
      taxTemplateId: string | null;
      items: { itemId: string; qty: string; rate: string; taxTemplateId: string | null }[];
    }
    api
      .get<PISource>(`/purchase-invoices/${returnAgainstId}`)
      .then((pi) => {
        setIsReturn(true);
        setSourceInvoiceName(pi.name);
        setSupplierId(pi.supplierId);
        setSupplierInvoiceNo(pi.supplierInvoiceNo ?? "");
        setCurrency(pi.currency);
        setConversionRate(Number(pi.conversionRate));
        setTaxTemplateId(pi.taxTemplateId ?? "");
        setRemarks(`Debit note against ${pi.name}`);
        setLines(
          pi.items.map((it) => ({
            itemId: it.itemId,
            qty: -Math.abs(Number(it.qty)),
            rate: Number(it.rate),
            taxTemplateId: it.taxTemplateId ?? "",
          })),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load source"));
  }, [returnAgainstId]);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  async function onItemChange(idx: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    let rate = item ? Number(item.standardRate) : 0;
    if (item && priceListId) {
      try {
        const r = await api.get<{ rate: number | null }>(
          `/item-prices/lookup?itemId=${itemId}&priceListId=${priceListId}`,
        );
        if (r.rate != null) rate = r.rate;
      } catch {
        // silent
      }
    }
    updateLine(idx, {
      itemId,
      rate,
      // B11: seed from item's default purchase tax template.
      taxTemplateId: item?.defaultPurchaseTaxTemplateId ?? "",
    });
  }

  const netTotal = useMemo(() => lines.reduce((s, l) => s + l.qty * l.rate, 0), [lines]);

  function templateEffectiveRows(t: TaxTemplate) {
    if (t.rows.length > 0) {
      return t.rows.map((r) => ({
        description: r.description,
        rate: Number(r.rate),
        chargeType: (r.chargeType ?? "On Net Total") as
          | "On Net Total"
          | "On Previous Row Total"
          | "Actual",
        amount: Number(r.amount ?? 0),
      }));
    }
    if (t.rate != null) {
      return [
        {
          description: `${t.name} @ ${Number(t.rate).toFixed(2)}%`,
          rate: Number(t.rate),
          chargeType: "On Net Total" as const,
          amount: 0,
        },
      ];
    }
    return [];
  }
  function computeRowAmount(
    r: { rate: number; chargeType: string; amount: number },
    base: number,
    priorSum: number,
  ) {
    if (r.chargeType === "Actual") return r.amount;
    if (r.chargeType === "On Previous Row Total")
      return (base + priorSum) * (r.rate / 100);
    return base * (r.rate / 100);
  }

  // B11 preview: mirrors computeInvoiceTaxLines on the server.
  const taxRows: { description: string; rate: number; amount: number }[] = useMemo(() => {
    const groups = new Map<string, number>();
    for (const l of lines) {
      const eff = l.taxTemplateId || taxTemplateId || "";
      if (!eff) continue;
      groups.set(eff, (groups.get(eff) ?? 0) + l.qty * l.rate);
    }
    const merged = new Map<
      string,
      { description: string; rate: number; amount: number }
    >();
    for (const [tid, base] of groups) {
      const t = taxTemplates.find((x) => x.id === tid);
      if (!t) continue;
      const effRows = templateEffectiveRows(t);
      let prior = 0;
      for (const r of effRows) {
        const amt = computeRowAmount(r, base, prior);
        prior += amt;
        const key = `${r.description}|${r.rate}|${r.chargeType}`;
        const prev = merged.get(key);
        if (prev) prev.amount += amt;
        else
          merged.set(key, {
            description: r.description,
            rate: r.rate,
            amount: amt,
          });
      }
    }
    return [...merged.values()];
  }, [lines, taxTemplateId, taxTemplates]);
  const taxAmount = taxRows.reduce((s, r) => s + r.amount, 0);
  const grandTotal = netTotal + taxAmount;
  const grandTotalInBase = grandTotal * conversionRate;
  const isBase = currency === baseCurrency;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        supplierId,
        supplierInvoiceNo: supplierInvoiceNo || undefined,
        currency,
        conversionRate: isBase ? 1 : conversionRate,
        taxTemplateId: taxTemplateId || undefined,
        paymentTermsTemplateId: paymentTermsTemplateId || undefined,
        remarks,
        isReturn,
        returnAgainstId: returnAgainstId || undefined,
        items: lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            rate: l.rate,
            ...(l.taxTemplateId ? { taxTemplateId: l.taxTemplateId } : {}),
          })),
      };
      if (editId) {
        await api.put(`/purchase-invoices/${editId}`, body);
        location.href = `/buying/purchase-invoices/${editId}`;
      } else {
        await api.post("/purchase-invoices", body);
        smart.remember({ supplierId });
        location.href = "/buying/purchase-invoices";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const title = editId
    ? "Edit Purchase Invoice"
    : isReturn
      ? `New Debit Note${sourceInvoiceName ? ` against ${sourceInvoiceName}` : ""}`
      : "New Purchase Invoice";

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Purchase Invoices", href: "/buying/purchase-invoices" },
          { label: editId ? "Edit" : isReturn ? "Debit Note" : "New" },
        ]}
        title={title}
        actions={
          <Button variant="secondary" type="button" onClick={() => history.back()}>
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <form onSubmit={submit} className="max-w-4xl space-y-4">
        <Card className="p-4 space-y-4">
          <SectionHeader title="Invoice details" />

          {priceLists.length > 0 && (
            <FormField label="Price list" hint="Rates auto-fill on item pick">
              <select
                className="input max-w-sm"
                value={priceListId}
                onChange={(e) => setPriceListId(e.target.value)}
              >
                <option value="">— No price list (use standard rate) —</option>
                {priceLists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Supplier" required>
              <select
                required
                className="input"
                value={supplierId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSupplierId(id);
                  // D10: preselect supplier's default payment terms so the
                  // schedule materializes on submit without an extra click.
                  // Only preselect on FRESH picks — don't clobber the current
                  // selection when editing (editId path re-loads from the PI itself).
                  if (id && !editId) {
                    const s = suppliers.find((x) => x.id === id);
                    if (s?.defaultPaymentTermsTemplateId) {
                      setPaymentTermsTemplateId(s.defaultPaymentTermsTemplateId);
                    }
                  }
                }}
              >
                <option value="">Select supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.supplierName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Supplier Bill No." hint="Optional">
              <input
                className="input"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
              />
            </FormField>
          </div>

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
                {currencies.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            {!isBase && (
              <FormField label={`Rate to ${baseCurrency}`}>
                <input
                  type="number"
                  step="any"
                  min={0.000001}
                  className="input"
                  value={conversionRate}
                  onChange={(e) => setConversionRate(Number(e.target.value))}
                />
              </FormField>
            )}
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <SectionHeader title={`Line items (${currency})`} />
          <div className="table-wrap overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: "80px" }}>Qty</th>
                  <th style={{ width: "100px" }}>Rate</th>
                  <th style={{ width: "160px" }}>Tax</th>
                  <th className="text-end" style={{ width: "110px" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td>
                      <select
                        className="input"
                        value={l.itemId}
                        onChange={(e) => onItemChange(idx, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.itemCode} — {i.itemName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input"
                        value={l.qty}
                        min={0.0001}
                        step="any"
                        onChange={(e) =>
                          updateLine(idx, { qty: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input"
                        value={l.rate}
                        min={0}
                        step="any"
                        onChange={(e) =>
                          updateLine(idx, { rate: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={l.taxTemplateId}
                        onChange={(e) =>
                          updateLine(idx, { taxTemplateId: e.target.value })
                        }
                      >
                        <option value="">(default)</option>
                        {taxTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-end tabular-nums">
                      {(l.qty * l.rate).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() =>
              setLines([
                ...lines,
                { itemId: "", qty: 1, rate: 0, taxTemplateId: "" },
              ])
            }
          >
            + Add line
          </Button>
        </Card>

        <Card className="p-4 space-y-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-sm text-brew hover:underline"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? "Hide advanced options" : "Show advanced options (tax template, payment terms)"}
          </button>
          {showAdvanced && (
          <>
          <FormField label="Tax template (invoice-level default)">
            <select
              className="input"
              value={taxTemplateId}
              onChange={(e) => setTaxTemplateId(e.target.value)}
            >
              <option value="">No tax</option>
              {taxTemplates.map((t) => {
                const total =
                  t.rows.length > 0
                    ? t.rows.reduce((s, r) => s + Number(r.rate), 0)
                    : Number(t.rate ?? 0);
                const label =
                  t.rows.length > 1
                    ? ` (${t.rows.length} rows, ${total.toFixed(2)}%)`
                    : ` (${total.toFixed(2)}%)`;
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {label}
                  </option>
                );
              })}
            </select>
          </FormField>
          <FormField label="Payment terms (materializes a schedule on submit)">
            <select
              className="input"
              value={paymentTermsTemplateId}
              onChange={(e) => setPaymentTermsTemplateId(e.target.value)}
            >
              <option value="">Single payment (no schedule)</option>
              {paymentTermsTemplates.map((t) => {
                const summary = t.terms
                  .map((tt) => `${Number(tt.invoicePortion)}%@${tt.dueDays}d`)
                  .join(" / ");
                return (
                  <option key={t.id} value={t.id}>
                    {t.name} {summary ? `— ${summary}` : ""}
                  </option>
                );
              })}
            </select>
          </FormField>
          </>
          )}
          <FormField label="Remarks">
            <textarea
              className="input"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </Card>

        <Card className="p-4 flex items-start justify-between">
          <div className="text-sm space-y-0.5 w-72">
            <div className="flex justify-between">
              <span className="text-ink-muted">Net total</span>
              <span className="tabular-nums">
                {netTotal.toFixed(2)} {currency}
              </span>
            </div>
            {taxRows.map((r, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-ink-muted">{r.description}</span>
                <span className="tabular-nums">
                  {r.amount.toFixed(2)} {currency}
                </span>
              </div>
            ))}
            <div className="flex justify-between font-semibold border-t border-ink-muted/10 pt-1">
              <span>Grand total</span>
              <span className="tabular-nums">
                {grandTotal.toFixed(2)} {currency}
              </span>
            </div>
            {Math.round(grandTotal) - grandTotal !== 0 && (
              <>
                <div className="flex justify-between text-ink-muted">
                  <span>Rounding</span>
                  <span className="tabular-nums">
                    {(Math.round(grandTotal) - grandTotal).toFixed(2)} {currency}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Rounded total</span>
                  <span className="tabular-nums">
                    {Math.round(grandTotal).toFixed(2)} {currency}
                  </span>
                </div>
              </>
            )}
            {!isBase && (
              <div className="text-xs text-ink-muted flex justify-between">
                <span>In {baseCurrency}</span>
                <span className="tabular-nums">
                  {grandTotalInBase.toFixed(2)}
                </span>
              </div>
            )}
          </div>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save Invoice"}
          </Button>
        </Card>
      </form>
    </main>
  );
}

export default function NewPurchaseInvoicePage() {
  return (
    <Suspense fallback={null}>
      <InnerNewPurchaseInvoicePage />
    </Suspense>
  );
}
