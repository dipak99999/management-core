"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../components/ui";
import { AiDraftForm, useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { authApi } from "../../../lib/auth-api";

// C1: PO new/edit form. Simpler than PI — no tax rounding, no advance
// payments, no returns; just a supplier + line items with optional per-line
// warehouse + tax overrides.

interface Supplier {
  id: string;
  supplierName: string;
}
interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  defaultPurchaseTaxTemplateId?: string | null;
}
interface Warehouse {
  id: string;
  warehouseName: string;
  isGroup: boolean;
}
interface Currency {
  id: string;
  code: string;
  name: string;
}
interface CurrenciesEnvelope {
  baseCurrency: string;
  rows: Currency[];
}
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
  warehouseId: string;
  taxTemplateId: string;
}
// Warehouses live on stock-service; read them directly.
async function loadWarehouses(): Promise<Warehouse[]> {
  const STOCK =
    process.env.NEXT_PUBLIC_STOCK_SERVICE_URL ?? "/api/stock";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${STOCK}/warehouses`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load warehouses (${res.status})`);
  return res.json();
}

interface ExistingPO {
  status: string;
  supplierId: string;
  transactionDate: string;
  deliveryDate: string | null;
  currency: string;
  conversionRate: string;
  taxTemplateId: string | null;
  remarks: string | null;
  isSubcontracted: boolean;
  supplierWarehouseId: string | null;
  sourceWarehouseId: string | null;
  items: {
    itemId: string;
    qty: string;
    rate: string;
    warehouseId: string | null;
    taxTemplateId: string | null;
  }[];
}

function InnerNewPurchaseOrderPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  const [priceLists, setPriceLists] = useState<{ id: string; name: string }[]>([]);
  const [priceListId, setPriceListId] = useState<string>("");
  const [isSubcontracted, setIsSubcontracted] = useState(false);
  const [supplierWarehouseId, setSupplierWarehouseId] = useState("");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [deliveryDate, setDeliveryDate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [conversionRate, setConversionRate] = useState(1);
  const [taxTemplateId, setTaxTemplateId] = useState("");
  const [remarks, setRemarks] = useState("");
  // Progressive disclosure: hide tax template (optional) behind a toggle.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { itemId: "", qty: 1, rate: 0, warehouseId: "", taxTemplateId: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    loadWarehouses()
      .then((w) => setWarehouses(w.filter((x) => !x.isGroup)))
      .catch(() => {});
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
  }, [editId]);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingPO>(`/purchase-orders/${editId}`)
      .then((po) => {
        if (po.status !== "Draft") {
          setError(`Cannot edit PO in status ${po.status}`);
          return;
        }
        setSupplierId(po.supplierId);
        setTransactionDate(po.transactionDate.slice(0, 10));
        setDeliveryDate(po.deliveryDate ? po.deliveryDate.slice(0, 10) : "");
        setCurrency(po.currency);
        setConversionRate(Number(po.conversionRate));
        setTaxTemplateId(po.taxTemplateId ?? "");
        setRemarks(po.remarks ?? "");
        setIsSubcontracted(po.isSubcontracted);
        setSupplierWarehouseId(po.supplierWarehouseId ?? "");
        setSourceWarehouseId(po.sourceWarehouseId ?? "");
        setLines(
          po.items.length
            ? po.items.map((it) => ({
                itemId: it.itemId,
                qty: Number(it.qty),
                rate: Number(it.rate),
                warehouseId: it.warehouseId ?? "",
                taxTemplateId: it.taxTemplateId ?? "",
              }))
            : [{ itemId: "", qty: 1, rate: 0, warehouseId: "", taxTemplateId: "" }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

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
      taxTemplateId: item?.defaultPurchaseTaxTemplateId ?? "",
    });
  }

  const netTotal = useMemo(
    () => lines.reduce((s, l) => s + l.qty * l.rate, 0),
    [lines],
  );
  const isBase = currency === baseCurrency;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        supplierId,
        transactionDate: new Date(transactionDate).toISOString(),
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
        currency,
        conversionRate: isBase ? 1 : conversionRate,
        taxTemplateId: taxTemplateId || undefined,
        remarks,
        isSubcontracted,
        supplierWarehouseId: supplierWarehouseId || null,
        sourceWarehouseId: sourceWarehouseId || null,
        items: lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            rate: l.rate,
            ...(l.warehouseId ? { warehouseId: l.warehouseId } : {}),
            ...(l.taxTemplateId ? { taxTemplateId: l.taxTemplateId } : {}),
          })),
      };
      if (editId) {
        await api.put(`/purchase-orders/${editId}`, body);
        location.href = `/buying/purchase-orders/${editId}`;
      } else {
        await api.post("/purchase-orders", body);
        smart.remember({ supplierId, currency });
        location.href = "/buying/purchase-orders";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const title = editId ? "Edit Purchase Order" : "New Purchase Order";

  // Smart defaults: remember last supplier + currency across PO creates.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ supplierId: string; currency: string }>(
    "buying-web:po-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (editId) return;
    if (supplierId || !smart.last) return;
    if (smart.last.supplierId) setSupplierId(smart.last.supplierId);
    if (smart.last.currency) setCurrency(smart.last.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.supplierId, smart.last?.currency]);

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Purchase Orders", href: "/buying/purchase-orders" },
          { label: editId ? "Edit" : "New" },
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

      <AiDraftForm
        scope="buying-web:po-draft"
        doctypeHint="Purchase order to a supplier. `lines` is an array of { itemCode, itemName, qty, rate }. Dates are YYYY-MM-DD."
        placeholder="/ai Order 50× SKU-WIDGET from Acme Supply, due in 7 days"
        fields={["supplierName", "transactionDate", "currency", "lines"]}
        before={{
          supplierId: supplierId || null,
          currency: currency || null,
          transactionDate: transactionDate || null,
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
        post={(path, body) => authApi.post(path, body)}
        apply={(rows) => {
          for (const r of rows) {
            const after = r.after ?? "";
            if (r.field === "supplierName" && typeof after === "string") {
              const match = suppliers.find(
                (s) => s.supplierName.toLowerCase() === after.toLowerCase(),
              );
              if (match) setSupplierId(match.id);
            }
            if (r.field === "transactionDate" && typeof after === "string") setTransactionDate(after);
            if (r.field === "currency" && typeof after === "string") setCurrency(after);
            if (r.field === "lines") {
              try {
                const parsed = typeof after === "string" ? JSON.parse(after) : after;
                if (Array.isArray(parsed)) {
                  const resolved: Line[] = parsed
                    .map((l: { itemCode?: string; qty?: number; rate?: number }) => {
                      const found = l.itemCode
                        ? items.find(
                            (it) => it.itemCode.toUpperCase() === l.itemCode!.toUpperCase(),
                          )
                        : undefined;
                      if (!found) return null;
                      return {
                        itemId: found.id,
                        qty: Number(l.qty ?? 1),
                        rate: Number(l.rate ?? found.standardRate ?? 0),
                        warehouseId: warehouses[0]?.id ?? "",
                        taxTemplateId: "",
                      };
                    })
                    .filter((l): l is Line => l !== null);
                  if (resolved.length > 0) setLines(resolved);
                }
              } catch { /* malformed JSON */ }
            }
          }
        }}
      />

      <form onSubmit={submit} className="max-w-4xl space-y-4">
        <Card className="p-4 space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={isSubcontracted}
              onChange={(e) => setIsSubcontracted(e.target.checked)}
            />
            Subcontracted PO
          </label>
          {isSubcontracted && (
            <>
              <div className="text-xs text-ink-muted">
                We send raw materials from source warehouse to supplier
                warehouse; supplier assembles + returns the FG. All line items
                must be subcontracted items with a default BOM.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Source warehouse (our stock)" required>
                  <select
                    required={isSubcontracted}
                    className="input"
                    value={sourceWarehouseId}
                    onChange={(e) => setSourceWarehouseId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.warehouseName}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Supplier warehouse (holds RM at supplier)" required>
                  <select
                    required={isSubcontracted}
                    className="input"
                    value={supplierWarehouseId}
                    onChange={(e) => setSupplierWarehouseId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.warehouseName}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            </>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          <SectionHeader title="Order details" />

          {priceLists.length > 0 && (
            <FormField
              label="Price list"
              hint="Rates auto-fill on item pick"
            >
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

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Supplier" required>
              <select
                required
                className="input"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Select supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.supplierName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Transaction date">
              <input
                type="date"
                className="input"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
              />
            </FormField>
            <FormField label="Delivery date">
              <input
                type="date"
                className="input"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Currency">
              <select
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencies.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </FormField>
            {!isBase && (
              <FormField label={`FX rate → ${baseCurrency}`}>
                <input
                  type="number"
                  step="any"
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
                  <th style={{ width: "140px" }}>Warehouse</th>
                  <th style={{ width: "140px" }}>Tax</th>
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
                        value={l.warehouseId}
                        onChange={(e) =>
                          updateLine(idx, { warehouseId: e.target.value })
                        }
                      >
                        <option value="">(pick on receive)</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.warehouseName}
                          </option>
                        ))}
                      </select>
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
                { itemId: "", qty: 1, rate: 0, warehouseId: "", taxTemplateId: "" },
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
            {showAdvanced ? "Hide advanced options" : "Show advanced options (tax template)"}
          </button>
          {showAdvanced && (
          <FormField label="Tax template (default)">
            <select
              className="input"
              value={taxTemplateId}
              onChange={(e) => setTaxTemplateId(e.target.value)}
            >
              <option value="">No tax</option>
              {taxTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
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

        <Card className="p-4 flex items-center justify-between">
          <div className="text-sm w-64">
            <div className="flex justify-between">
              <span className="text-ink-muted">Net total</span>
              <span className="tabular-nums font-semibold">
                {netTotal.toFixed(2)} {currency}
              </span>
            </div>
          </div>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save Purchase Order"}
          </Button>
        </Card>
      </form>
    </main>
  );
}

export default function NewPurchaseOrderPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewPurchaseOrderPage />
    </Suspense>
  );
}
