"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { showToast } from "../../../lib/toast";
import {
  Button,
  Card,
  FormField,
  PageHeader,
} from "../../../components/ui";
import { AiInvoiceDraft } from "../../../components/ai-invoice-draft";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";

interface Customer {
  id: string;
  customerName: string;
  defaultPaymentTermsTemplateId?: string | null;
}
interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  // B11: pre-seeded onto new line when item is picked (falls back to invoice-
  // level template on the server if left null).
  defaultSalesTaxTemplateId?: string | null;
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
  // Legacy single-rate — kept for backward compat display.
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
  // D3: title of the PricingRule that produced `rate` when the lookup
  // fired. Purely for UI hint — the discount is already baked into `rate`.
  appliedRuleTitle?: string | null;
}

// Existing SI response shape used only for editing (subset of what /sales-invoices/:id returns).
interface ExistingSI {
  status: string;
  customerId: string;
  currency: string;
  conversionRate: string;
  taxTemplateId: string | null;
  paymentTermsTemplateId?: string | null;
  couponCode?: string | null;
  remarks: string | null;
  postingDate?: string | null;
  dueDate?: string | null;
  salesPersonId?: string | null;
  commissionPercent?: string | number | null;
  items: { itemId: string; qty: string; rate: string; taxTemplateId: string | null }[];
}

function InnerNewSalesInvoicePage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  // B15: `?returnAgainstId=<siId>` opens the form pre-filled as a Credit
  // Note against that invoice — same customer + currency + negated items.
  const returnAgainstId = searchParams.get("returnAgainstId");
  const [isReturn, setIsReturn] = useState(false);
  const [sourceInvoiceName, setSourceInvoiceName] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  // C4: Selling price lists + selected list. When set, picking an item auto-
  // fills its rate from the effective ItemPrice for this list.
  const [priceLists, setPriceLists] = useState<{ id: string; name: string }[]>([]);
  const [priceListId, setPriceListId] = useState<string>("");
  // D10: Payment terms templates. When set, submit materializes the schedule
  // and the invoice's dueDate is overwritten to the latest installment.
  const [paymentTermsTemplates, setPaymentTermsTemplates] = useState<
    { id: string; name: string; terms: { invoicePortion: string; dueDays: number }[] }[]
  >([]);
  const [paymentTermsTemplateId, setPaymentTermsTemplateId] = useState<string>("");
  // D4: coupon code. Optional text input the operator types + hits Apply on;
  // Apply calls /coupon-codes/apply → the linked rule + the previewed rate
  // → we broadcast the discount to all matching lines. The code string is
  // sent to /sales-invoices POST so submit can consume it atomically.
  const [couponCode, setCouponCode] = useState<string>("");
  const [couponInfo, setCouponInfo] = useState<{ ruleTitle: string; discountText: string } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [conversionRate, setConversionRate] = useState(1);
  const [taxTemplateId, setTaxTemplateId] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([
    { itemId: "", qty: 1, rate: 0, taxTemplateId: "" },
  ]);
  const [remarks, setRemarks] = useState("");
  // Explicit invoice dating — previously the API defaulted these server-side,
  // which stopped users from backdating or setting a custom due date.
  const [postingDate, setPostingDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  // Smart defaults: remember the last-used customer + currency on this form
  // so a repeat invoice is one keystroke. Server-persisted via /form-defaults
  // (falls back to localStorage without a session, e.g. during tests).
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ customerId: string; currency: string }>(
    "accounting-web:sales-invoice-create",
    uiBackends?.defaults,
  );
  // Hydrate from last-remembered on cold mount, but only if nothing's set
  // yet (don't clobber values the user already picked, or an edit payload).
  useEffect(() => {
    if (editId || isReturn) return;
    if (customerId || !smart.last) return;
    if (smart.last.customerId) setCustomerId(smart.last.customerId);
    if (smart.last.currency) setCurrency(smart.last.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.customerId, smart.last?.currency]);
  // D7: sales-person snapshot on the invoice. commissionPercent is auto-
  // derived from the sales-person's default on submit if left blank.
  const [salesPersons, setSalesPersons] = useState<
    { id: string; name: string; defaultCommissionPercent: string | number; enabled: boolean }[]
  >([]);
  const [salesPersonId, setSalesPersonId] = useState<string>("");
  const [commissionPercent, setCommissionPercent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Progressive disclosure: hide tax template, payment terms, coupon,
  // and sales person behind a "Show advanced" toggle. The common path
  // (customer + lines + due date + remarks) stays visible.
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api
      .get<CurrenciesEnvelope>("/currencies")
      .then((d) => {
        setCurrencies(d.rows);
        setBaseCurrency(d.baseCurrency);
        // Only default to base if we're not editing (an edit will overwrite anyway).
        if (!editId) setCurrency(d.baseCurrency);
      })
      .catch(() => {});
    api
      .get<TaxTemplate[]>("/tax-templates?type=Sales")
      .then(setTaxTemplates)
      .catch(() => {});
    // D7: load sales-person options — only enabled ones.
    api
      .get<Array<{ id: string; name: string; defaultCommissionPercent: string | number; enabled: boolean }>>(
        "/sales-persons",
      )
      .then((rows) => setSalesPersons(rows.filter((sp) => sp.enabled)))
      .catch(() => {});
    // C4: load Selling price lists + auto-pick tenant default.
    Promise.all([
      api.get<{ id: string; name: string; isDefault: boolean }[]>(
        "/price-lists?type=Selling",
      ),
    ])
      .then(([pls]) => {
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

  // Pre-fill form state when editing an existing Draft invoice.
  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingSI>(`/sales-invoices/${editId}`)
      .then((si) => {
        if (si.status !== "Draft") {
          setError(`Cannot edit invoice in status ${si.status}`);
          return;
        }
        setCustomerId(si.customerId);
        setCurrency(si.currency);
        setConversionRate(Number(si.conversionRate));
        setTaxTemplateId(si.taxTemplateId ?? "");
        setPaymentTermsTemplateId(si.paymentTermsTemplateId ?? "");
        setCouponCode(si.couponCode ?? "");
        setRemarks(si.remarks ?? "");
        // Dates: ISO → YYYY-MM-DD for the <input type="date"> control.
        if (si.postingDate) setPostingDate(si.postingDate.slice(0, 10));
        if (si.dueDate) setDueDate(si.dueDate.slice(0, 10));
        setSalesPersonId(si.salesPersonId ?? "");
        setCommissionPercent(
          si.commissionPercent === null || si.commissionPercent === undefined
            ? ""
            : String(si.commissionPercent),
        );
        setLines(
          si.items.length
            ? si.items.map((it) => ({
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

  // B15: pre-fill Credit Note from source invoice — same customer + tax
  // template, items with qty negated.
  useEffect(() => {
    if (!returnAgainstId) return;
    interface SISource {
      name: string;
      customerId: string;
      currency: string;
      conversionRate: string;
      taxTemplateId: string | null;
      items: { itemId: string; qty: string; rate: string; taxTemplateId: string | null }[];
    }
    api
      .get<SISource>(`/sales-invoices/${returnAgainstId}`)
      .then((si) => {
        setIsReturn(true);
        setSourceInvoiceName(si.name);
        setCustomerId(si.customerId);
        setCurrency(si.currency);
        setConversionRate(Number(si.conversionRate));
        setTaxTemplateId(si.taxTemplateId ?? "");
        setRemarks(`Credit note against ${si.name}`);
        setLines(
          si.items.map((it) => ({
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

  // D4: apply a coupon code. The /apply route is preview-only (doesn't
  // consume a use); it returns the linked PricingRule so we can broadcast
  // the discount across all lines currently on the form. The consumption
  // (usedCount++) happens on SI submit. Re-clicking Apply with a different
  // rate is fine — each apply overwrites line rates via applyPricingRule
  // math server-side.
  async function applyCoupon() {
    setCouponError(null);
    setCouponInfo(null);
    const trimmed = couponCode.trim();
    if (!trimmed) return;
    setCouponBusy(true);
    try {
      // Preview against a nominal ₹1 base so we can echo the discount
      // description to the operator ("15% off" / "flat ₹99"). Per-line
      // application below asks the server for each line's baseRate.
      const preview = await api.get<{
        rule: {
          title: string;
          ruleType: "Discount %" | "Rate";
          discountPercent: string;
          ratePrice: string;
        };
      }>(`/coupon-codes/apply?code=${encodeURIComponent(trimmed)}&baseRate=1`);
      const r = preview.rule;
      const discountText =
        r.ruleType === "Rate"
          ? `Flat ${Number(r.ratePrice).toFixed(2)}`
          : `${Number(r.discountPercent).toFixed(2)}% off`;
      setCouponInfo({ ruleTitle: r.title, discountText });

      // Re-price each line via the (already-existing) pricing-rule apply
      // math — since the coupon just gates a rule, the /pricing-rules/lookup
      // would ordinarily miss it. Instead we compute rate = base × (1-pct/100)
      // client-side for Discount%, or use r.ratePrice for Rate. Keeps the
      // form snappy without an N+1 round-trip.
      setLines((ls) =>
        ls.map((l) => {
          if (!l.itemId) return l;
          const applied =
            r.ruleType === "Rate"
              ? Math.max(0, Number(r.ratePrice))
              : Math.max(0, l.rate * (1 - Number(r.discountPercent) / 100));
          return { ...l, rate: applied, appliedRuleTitle: r.title };
        }),
      );
    } catch (e) {
      const msg =
        e instanceof Error && "message" in e ? e.message : "Coupon rejected";
      setCouponError(msg.replace(/^Error: /, ""));
    } finally {
      setCouponBusy(false);
    }
  }
  async function onItemChange(idx: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    let rate = item ? Number(item.standardRate) : 0;
    // C4: if a price list is selected, ask the server for the effective
    // ItemPrice at today's date. Fallback to standardRate on miss.
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
    // D3: apply best matching pricing rule (customer + item + qty). Uses
    // the line's current qty (default 1) and the rate we just computed.
    let appliedRuleTitle: string | null = null;
    if (item) {
      try {
        const params = new URLSearchParams();
        params.set("itemId", itemId);
        params.set("baseRate", String(rate));
        params.set("qty", String(lines[idx]?.qty ?? 1));
        if (customerId) params.set("customerId", customerId);
        const pr = await api.get<{
          rule: { id: string; title: string } | null;
          appliedRate: number;
        }>(`/pricing-rules/lookup?${params.toString()}`);
        if (pr.rule) {
          rate = pr.appliedRate;
          appliedRuleTitle = pr.rule.title;
        }
      } catch {
        // silent
      }
    }
    updateLine(idx, {
      itemId,
      rate,
      // B11: seed the line's tax template from the item's default so operators
      // don't have to pick every time. User can still override.
      taxTemplateId: item?.defaultSalesTaxTemplateId ?? "",
      appliedRuleTitle,
    });
  }

  const netTotal = useMemo(
    () => lines.reduce((s, l) => s + l.qty * l.rate, 0),
    [lines],
  );

  // Resolve a template id to its display rows using the effective row set
  // (multi-row preferred, legacy header rate as fallback).
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

  // Compute one row's tax amount respecting chargeType + running prior sum
  // (matches computeTaxLines in packages/db/src/tax.ts).
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

  // B11 preview: group lines by effective templateId, compute per group,
  // aggregate by (description|rate|chargeType) — mirrors what the server
  // stores as SI tax rows.
  const taxRows: { description: string; rate: number; amount: number }[] = useMemo(() => {
    // Group line-amounts by their effective template id.
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
        customerId,
        currency,
        conversionRate: isBase ? 1 : conversionRate,
        taxTemplateId: taxTemplateId || undefined,
        paymentTermsTemplateId: paymentTermsTemplateId || undefined,
        couponCode: couponCode.trim() || undefined,
        remarks,
        isReturn,
        returnAgainstId: returnAgainstId || undefined,
        // Zod expects ISO datetime; the <input type="date"> gives YYYY-MM-DD
        // so append a T00:00 to satisfy z.string().datetime(). Server treats
        // the calendar day as posting/due date.
        postingDate: postingDate ? new Date(postingDate).toISOString() : undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        salesPersonId: salesPersonId || undefined,
        commissionPercent:
          commissionPercent.trim() === "" ? undefined : Number(commissionPercent),
        items: lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            rate: l.rate,
            // B11: pass per-line override when set. Empty string → omit so
            // the server falls back to invoice-level template.
            ...(l.taxTemplateId ? { taxTemplateId: l.taxTemplateId } : {}),
          })),
      };
      if (editId) {
        await api.put(`/sales-invoices/${editId}`, body);
        showToast("Invoice updated", "success");
        setTimeout(() => {
          location.href = `/accounting/sales-invoices/${editId}`;
        }, 600);
      } else {
        await api.post("/sales-invoices", body);
        showToast("Invoice created", "success");
        // Remember customer + currency for the next invoice.
        smart.remember({ customerId, currency });
        setTimeout(() => {
          location.href = "/accounting/sales-invoices";
        }, 600);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Sales Invoices", href: "/accounting/sales-invoices" },
          { label: editId ? "Edit" : isReturn ? "Credit Note" : "New" },
        ]}
        title={
          editId
            ? "Edit Sales Invoice"
            : isReturn
              ? `New Credit Note${sourceInvoiceName ? ` against ${sourceInvoiceName}` : ""}`
              : "New Sales Invoice"
        }
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <AiInvoiceDraft
        before={{
          customerId: customerId || null,
          currency: currency || null,
          postingDate: postingDate || null,
          dueDate: dueDate || null,
          remarks: remarks || null,
          lines: lines
            .filter((l) => l.itemId)
            .map((l) => {
              const it = items.find((x) => x.id === l.itemId);
              return {
                itemCode: it?.itemCode,
                itemName: it?.itemName,
                qty: l.qty,
                rate: l.rate,
              };
            }),
        }}
        customersByName={
          new Map(customers.map((c) => [c.customerName.toLowerCase(), c.id]))
        }
        itemsByCode={new Map(items.map((it) => [it.itemCode.toUpperCase(), it.itemName]))}
        apply={(patch) => {
          if (patch.customerId) setCustomerId(patch.customerId);
          if (patch.currency) setCurrency(patch.currency);
          if (patch.postingDate) setPostingDate(patch.postingDate);
          if (patch.dueDate) setDueDate(patch.dueDate);
          if (patch.remarks) setRemarks(patch.remarks);
          if (patch.lines && patch.lines.length > 0) {
            setLines((cur) => {
              const resolved: Line[] = patch.lines!
                .map((l) => {
                  const found = l.itemCode
                    ? items.find((it) => it.itemCode.toUpperCase() === l.itemCode!.toUpperCase())
                    : undefined;
                  if (!found) return null;
                  return {
                    itemId: found.id,
                    qty: Number(l.qty ?? 1),
                    rate: Number(l.rate ?? found.standardRate ?? 0),
                    taxTemplateId: cur[0]?.taxTemplateId ?? "",
                  };
                })
                .filter((l): l is Line => l !== null);
              return resolved.length > 0 ? resolved : cur;
            });
          }
        }}
      />

      <Card className="p-4">
        <form onSubmit={submit} className="space-y-4">
          {priceLists.length > 0 && (
            <FormField label="Price list (rates auto-fill on item pick)">
              <select
                className="input max-w-xs"
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
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Customer" required>
              <select
                required
                className="input"
                value={customerId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCustomerId(id);
                  // D10: preselect customer's default payment terms so the
                  // schedule materializes on submit without an extra click.
                  // Only on FRESH picks — don't clobber selection during
                  // edit (editId path re-loads from the SI itself).
                  if (id && !editId) {
                    const c = customers.find((x) => x.id === id);
                    if (c?.defaultPaymentTermsTemplateId) {
                      setPaymentTermsTemplateId(c.defaultPaymentTermsTemplateId);
                    }
                  }
                }}
              >
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customerName}
                  </option>
                ))}
              </select>
            </FormField>
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
                  // Auto-lookup latest rate from ExchangeRate master. Silent on
                  // miss — user just types manually.
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
                  className="input tabular-nums"
                  value={conversionRate}
                  onChange={(e) => setConversionRate(Number(e.target.value))}
                />
              </FormField>
            )}
          </div>

          <div>
            <div className="label mb-1">Line items ({currency})</div>
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-start">
                <tr>
                  <th className="py-1">Item</th>
                  <th className="py-1 w-20">Qty</th>
                  <th className="py-1 w-24">Rate</th>
                  <th className="py-1 w-40">Tax</th>
                  <th className="py-1 w-24 text-end">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="py-1 pe-2">
                      <select
                        className="input"
                        value={l.itemId}
                        onChange={(e) => onItemChange(idx, e.target.value)}
                      >
                        <option value="">Select...</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.itemCode} — {i.itemName}
                          </option>
                        ))}
                      </select>
                      {l.appliedRuleTitle ? (
                        <div className="text-[11px] text-emerald-700 mt-0.5 truncate" title={l.appliedRuleTitle}>
                          Rule applied: {l.appliedRuleTitle}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        className="input tabular-nums"
                        value={l.qty}
                        min={0.0001}
                        step="any"
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        className="input tabular-nums"
                        value={l.rate}
                        min={0}
                        step="any"
                        onChange={(e) => updateLine(idx, { rate: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <select
                        className="input"
                        value={l.taxTemplateId}
                        onChange={(e) => updateLine(idx, { taxTemplateId: e.target.value })}
                      >
                        <option value="">(default)</option>
                        {taxTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 text-end tabular-nums">{(l.qty * l.rate).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="mt-2"
              onClick={() =>
                setLines([
                  ...lines,
                  { itemId: "", qty: 1, rate: 0, taxTemplateId: "" },
                ])
              }
            >
              + Add line
            </Button>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="text-sm text-brew hover:underline"
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? "Hide advanced options" : "Show advanced options (tax, payment terms, coupon, sales person)"}
            </button>
          </div>

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
                  t.rows.length > 1 ? ` (${t.rows.length} rows, ${total.toFixed(2)}%)` : ` (${total.toFixed(2)}%)`;
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

          <FormField label="Coupon code (optional)">
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                type="text"
                value={couponCode}
                placeholder="e.g. SUMMER25"
                onChange={(e) => {
                  setCouponCode(e.target.value);
                  setCouponInfo(null);
                  setCouponError(null);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={applyCoupon}
                disabled={couponBusy || !couponCode.trim()}
              >
                {couponBusy ? "Checking…" : "Apply"}
              </Button>
            </div>
            {couponInfo && (
              <div className="text-[11px] text-emerald-700 mt-1">
                {couponInfo.discountText} · rule: {couponInfo.ruleTitle} · applied to all lines
              </div>
            )}
            {couponError && (
              <div className="text-[11px] text-red-600 mt-1">{couponError}</div>
            )}
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Posting date"
              hint="Leave blank to use today. Backdating requires the appropriate role."
            >
              <input
                type="date"
                className="input"
                value={postingDate}
                onChange={(e) => setPostingDate(e.target.value)}
              />
            </FormField>
            <FormField
              label="Due date"
              hint="Auto-populated from payment terms if left blank + a template is selected."
            >
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Sales person">
              <select
                className="input"
                value={salesPersonId}
                onChange={(e) => setSalesPersonId(e.target.value)}
              >
                <option value="">— None —</option>
                {salesPersons.map((sp) => (
                  <option key={sp.id} value={sp.id}>{sp.name}</option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Commission %"
              hint="Leave blank to use the sales person's default."
            >
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                className="input"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                disabled={!salesPersonId}
              />
            </FormField>
          </div>
          </>
          )}

          <FormField label="Remarks">
            <textarea
              className="input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>

          <div className="flex items-center justify-between border-t border-ink-muted/10 pt-3">
            <div className="text-sm space-y-0.5 text-end w-64">
              <div className="flex justify-between">
                <span className="text-ink-soft">Net total:</span>
                <span className="tabular-nums">{netTotal.toFixed(2)} {currency}</span>
              </div>
              {taxRows.map((r, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-ink-soft">
                    {r.description}:
                  </span>
                  <span className="tabular-nums">{r.amount.toFixed(2)} {currency}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold border-t border-ink-muted/10 pt-1">
                <span>Grand total:</span>
                <span className="tabular-nums">{grandTotal.toFixed(2)} {currency}</span>
              </div>
              {/* B12: preview rounding delta if any. Server does the actual
                  posting to the Round Off account when configured. */}
              {Math.round(grandTotal) - grandTotal !== 0 && (
                <>
                  <div className="flex justify-between text-ink-soft">
                    <span>Rounding:</span>
                    <span className="tabular-nums">{(Math.round(grandTotal) - grandTotal).toFixed(2)} {currency}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Rounded total:</span>
                    <span className="tabular-nums">{Math.round(grandTotal).toFixed(2)} {currency}</span>
                  </div>
                </>
              )}
              {!isBase && (
                <div className="text-xs text-ink-muted flex justify-between">
                  <span>In {baseCurrency}:</span>
                  <span className="tabular-nums">{grandTotalInBase.toFixed(2)}</span>
                </div>
              )}
            </div>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving..." : "Save Invoice"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

export default function NewSalesInvoicePage() {
  return (
    <Suspense fallback={null}>
      <InnerNewSalesInvoicePage />
    </Suspense>
  );
}
