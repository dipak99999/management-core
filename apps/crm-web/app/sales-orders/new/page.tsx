"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { accountingApi, api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
  money,
} from "../../../components/ui";

interface Customer { id: string; customerName: string }
interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  // Fetched to (a) disable Dropship on lines whose item has no supplier,
  // and (b) surface the supplier name in the row hint so the operator
  // knows who's about to receive a PO.
  defaultSupplierId: string | null;
}
interface TaxTemplate {
  id: string;
  name: string;
  rate: string | null;
  templateType: string;
  rows: { id: string; description: string; rate: string; accountId: string }[];
}

interface Line { itemId: string; qty: number; rate: number; isDropship: boolean }
const emptyLine: Line = { itemId: "", qty: 1, rate: 0, isDropship: false };

interface ExistingSO {
  status: string;
  customerId: string;
  deliveryDate: string | null;
  taxTemplateId: string | null;
  remarks: string | null;
  items: { itemId: string; qty: string; rate: string; isDropship?: boolean }[];
}

async function loadSalesTaxTemplates(): Promise<TaxTemplate[]> {
  const ACC = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${ACC}/tax-templates?type=Sales`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load tax templates (${res.status})`);
  return res.json();
}

function InnerNewSalesOrderPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  // Currency: crm-service defaults to the tenant's base when unset. Options
  // list is owned by accounting-service; cross-service raw fetch keeps this
  // as a single source of truth for enabled currencies per tenant.
  const [currency, setCurrency] = useState<string>("");
  const [currencies, setCurrencies] = useState<Array<{ code: string; name: string }>>([]);
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [remarks, setRemarks] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  const [taxTemplateId, setTaxTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Smart defaults: SOs tend to come in batches for the same customer; pre-fill
  // the last picked one so the first field is already set.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ customerId: string }>(
    "crm-web:sales-order-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (editId || customerId || !smart.last?.customerId) return;
    setCustomerId(smart.last.customerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.customerId]);

  useEffect(() => {
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    loadSalesTaxTemplates().then(setTaxTemplates).catch(() => {});
    // Cross-service currency fetch. See quotations/new/page.tsx for the
    // reasoning — accountingApi keeps auth + 401 handling consistent.
    accountingApi
      .get<{ baseCurrency: string; rows: Array<{ code: string; name: string }> }>(
        "/currencies",
      )
      .then((j) => {
        setCurrencies(
          j.rows.length ? j.rows : [{ code: j.baseCurrency, name: j.baseCurrency }],
        );
        if (!editId && !currency) setCurrency(j.baseCurrency);
      })
      .catch(() => {});
  }, [editId, currency]);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingSO>(`/sales-orders/${editId}`)
      .then((so) => {
        if (so.status !== "Draft") {
          setError(`Cannot edit SO in status ${so.status}`);
          return;
        }
        setCustomerId(so.customerId);
        setDeliveryDate(so.deliveryDate ? so.deliveryDate.slice(0, 10) : "");
        setTaxTemplateId(so.taxTemplateId ?? "");
        setRemarks(so.remarks ?? "");
        setLines(
          so.items.length
            ? so.items.map((it) => ({
                itemId: it.itemId,
                qty: Number(it.qty),
                rate: Number(it.rate),
                isDropship: it.isDropship ?? false,
              }))
            : [{ ...emptyLine }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function onItemChange(idx: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(idx, { itemId, rate: item ? Number(item.standardRate) : 0 });
  }
  const netTotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const selectedTax = taxTemplates.find((t) => t.id === taxTemplateId) ?? null;
  const taxRows = selectedTax
    ? (selectedTax.rows.length > 0
        ? selectedTax.rows.map((r) => ({
            description: r.description,
            rate: Number(r.rate),
            amount: netTotal * (Number(r.rate) / 100),
          }))
        : selectedTax.rate != null
          ? [
              {
                description: `${selectedTax.name} @ ${Number(selectedTax.rate).toFixed(2)}%`,
                rate: Number(selectedTax.rate),
                amount: netTotal * (Number(selectedTax.rate) / 100),
              },
            ]
          : [])
    : [];
  const totalTaxes = taxRows.reduce((s, r) => s + r.amount, 0);
  const grandTotal = netTotal + totalTaxes;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validItems = lines.filter((l) => l.itemId);
    if (validItems.length === 0) {
      setError("Add at least one item line before saving.");
      return;
    }
    if (!customerId) {
      setError("Pick a customer before saving.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        customerId,
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : undefined,
        taxTemplateId: taxTemplateId || undefined,
        currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
        remarks,
        items: validItems.map((l) => ({ ...l })),
      };
      if (editId) {
        await api.put(`/sales-orders/${editId}`, body);
        location.href = `/crm/sales-orders/${editId}`;
      } else {
        await api.post("/sales-orders", body);
        smart.remember({ customerId });
        location.href = "/crm/sales-orders";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Sales Orders", href: "/crm/sales-orders" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Sales Order" : "New Sales Order"}
        actions={
          <Button
            variant="secondary"
            onClick={() => history.back()}
            type="button"
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <form onSubmit={submit}>
        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Customer" required>
              <select
                required
                className="input"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customerName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Delivery date">
              <input
                type="date"
                className="input"
                value={deliveryDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </FormField>
            <FormField label="Currency">
              <select
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencies.length === 0 && <option value="">— Loading —</option>}
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div>
            <SectionHeader title="Line items" />
            <div className="table-wrap overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: 100 }}>Qty</th>
                    <th style={{ width: 120 }}>Rate</th>
                    <th className="text-end" style={{ width: 120 }}>
                      Amount
                    </th>
                    <th style={{ width: 110 }}>Dropship</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    // Look up the picked Item so we know whether it has a
                    // default supplier — the Dropship checkbox is disabled
                    // (and force-cleared) when it doesn't, so submit-time
                    // errors are prevented at data-entry time.
                    const pickedItem = items.find((i) => i.id === l.itemId);
                    const canDropship = !!pickedItem?.defaultSupplierId;
                    return (
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
                            step="any"
                            min={0.0001}
                            className="input"
                            value={l.qty}
                            onChange={(e) =>
                              updateLine(idx, { qty: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            className="input"
                            value={l.rate}
                            onChange={(e) =>
                              updateLine(idx, { rate: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="text-end tabular-nums">
                          {money(l.qty * l.rate)}
                        </td>
                        <td>
                          <label
                            className="flex items-center gap-1.5 cursor-pointer text-xs"
                            title={
                              canDropship
                                ? "Auto-create a Purchase Order on SO submit"
                                : "Set Item.defaultSupplier to enable dropship"
                            }
                          >
                            <input
                              type="checkbox"
                              disabled={!canDropship}
                              checked={canDropship && l.isDropship}
                              onChange={(e) =>
                                updateLine(idx, { isDropship: e.target.checked })
                              }
                            />
                            <span className={canDropship ? "" : "text-ink-muted"}>
                              Dropship
                            </span>
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setLines([...lines, { ...emptyLine }])}
              className="mt-2 text-brand-600"
            >
              + Add line
            </Button>
          </div>

          <FormField label="Remarks">
            <textarea
              className="input"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>

          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-sm text-brew hover:underline"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? "Hide advanced options" : "Show advanced options (tax template)"}
          </button>
          {showAdvanced && (
          <FormField label="Tax template (optional)">
            <select
              className="input"
              value={taxTemplateId}
              onChange={(e) => setTaxTemplateId(e.target.value)}
            >
              <option value="">No tax</option>
              {taxTemplates.map((t) => {
                const totalPct =
                  t.rows.length > 0
                    ? t.rows.reduce((s, r) => s + Number(r.rate), 0)
                    : Number(t.rate ?? 0);
                const label =
                  t.rows.length > 1
                    ? ` (${t.rows.length} rows, ${totalPct.toFixed(2)}%)`
                    : ` (${totalPct.toFixed(2)}%)`;
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {label}
                  </option>
                );
              })}
            </select>
          </FormField>
          )}

          <div className="flex items-center justify-between border-t border-ink-muted/10 pt-3">
            <div className="text-sm space-y-0.5 text-end w-64">
              <div className="flex justify-between">
                <span className="text-ink-muted">Net total:</span>
                <span className="tabular-nums">{money(netTotal)}</span>
              </div>
              {taxRows.map((r, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-ink-muted">{r.description}:</span>
                  <span className="tabular-nums">{money(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold border-t border-ink-muted/10 pt-1">
                <span>Grand total:</span>
                <span className="tabular-nums">{money(grandTotal)}</span>
              </div>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !customerId}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      </form>
    </main>
  );
}

export default function NewSalesOrderPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewSalesOrderPage />
    </Suspense>
  );
}
