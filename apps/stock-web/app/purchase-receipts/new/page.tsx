"use client";

import { Suspense, Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface Supplier { id: string; supplierName: string }
interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  hasSerialNo?: boolean;
  hasBatchNo?: boolean;
  hasExpiryDate?: boolean;
}
interface Warehouse { id: string; warehouseName: string; isGroup: boolean }

interface Line {
  itemId: string;
  warehouseId: string;
  qty: number;
  rate: number;
  // C5: newline-separated serial numbers (raw text; split on submit).
  serialsRaw: string;
  // C6: batch fields.
  batchNo: string;
  manufactureDate: string; // YYYY-MM-DD
  expiryDate: string;
}

const emptyLine: Line = {
  itemId: "",
  warehouseId: "",
  qty: 1,
  rate: 0,
  serialsRaw: "",
  batchNo: "",
  manufactureDate: "",
  expiryDate: "",
};

interface ExistingPR {
  status: string;
  supplierId: string;
  supplierDeliveryNo: string | null;
  remarks: string | null;
  items: {
    itemId: string;
    warehouseId: string;
    qty: string;
    rate: string;
    serialNumbersInput: string[];
    batchNo: string | null;
    manufactureDate: string | null;
    expiryDate: string | null;
  }[];
}

function InnerNewPurchaseReceiptPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierDeliveryNo, setSupplierDN] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Smart defaults: PRs usually arrive in waves from the same supplier +
  // land in the same receiving warehouse; pre-fill both.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ supplierId: string; warehouseId: string }>(
    "stock-web:purchase-receipt-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (editId || !smart.last) return;
    if (!supplierId && smart.last.supplierId) setSupplierId(smart.last.supplierId);
    if (smart.last.warehouseId) {
      setLines((ls) =>
        ls.map((l, i) => (i === 0 && !l.warehouseId ? { ...l, warehouseId: smart.last!.warehouseId } : l)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.supplierId, smart.last?.warehouseId]);

  useEffect(() => {
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api.get<Warehouse[]>("/warehouses").then(setWarehouses).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingPR>(`/purchase-receipts/${editId}`)
      .then((pr) => {
        if (pr.status !== "Draft") {
          setError(`Cannot edit PR in status ${pr.status}`);
          return;
        }
        setSupplierId(pr.supplierId);
        setSupplierDN(pr.supplierDeliveryNo ?? "");
        setRemarks(pr.remarks ?? "");
        setLines(
          pr.items.length
            ? pr.items.map((it) => ({
                itemId: it.itemId,
                warehouseId: it.warehouseId,
                qty: Number(it.qty),
                rate: Number(it.rate),
                serialsRaw: (it.serialNumbersInput ?? []).join("\n"),
                batchNo: it.batchNo ?? "",
                manufactureDate: it.manufactureDate ? it.manufactureDate.slice(0, 10) : "",
                expiryDate: it.expiryDate ? it.expiryDate.slice(0, 10) : "",
              }))
            : [{ ...emptyLine }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  const leaves = warehouses.filter((w) => !w.isGroup);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function onItemChange(idx: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(idx, { itemId, rate: item ? Number(item.standardRate) : 0 });
  }

  const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        supplierId,
        supplierDeliveryNo: supplierDeliveryNo || undefined,
        remarks,
        items: lines
          .filter((l) => l.itemId && l.warehouseId && l.qty > 0)
          .map((l) => {
            const serials = l.serialsRaw
              .split(/[\n,]/)
              .map((s) => s.trim())
              .filter(Boolean);
            return {
              itemId: l.itemId,
              warehouseId: l.warehouseId,
              qty: l.qty,
              rate: l.rate,
              ...(serials.length ? { serialNumbers: serials } : {}),
              ...(l.batchNo ? { batchNo: l.batchNo } : {}),
              ...(l.manufactureDate
                ? { manufactureDate: new Date(l.manufactureDate).toISOString() }
                : {}),
              ...(l.expiryDate
                ? { expiryDate: new Date(l.expiryDate).toISOString() }
                : {}),
            };
          }),
      };
      if (editId) {
        await api.put(`/purchase-receipts/${editId}`, body);
        location.href = `/stock/purchase-receipts/${editId}`;
      } else {
        await api.post("/purchase-receipts", body);
        const firstWarehouse = lines.find((l) => l.warehouseId)?.warehouseId ?? "";
        smart.remember({ supplierId, warehouseId: firstWarehouse });
        location.href = "/stock/purchase-receipts";
      }
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
          { label: "Purchase Receipts", href: "/stock/purchase-receipts" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Purchase Receipt" : "New Purchase Receipt"}
        subtitle="On submit, stock arrives at target warehouse (line rate feeds moving-avg) and Stock-in-Hand is debited / Stock Received But Not Billed is credited for the total."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <Card className="p-4"><form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-gray-600">Supplier</label>
            <select
              required
              className="w-full border rounded px-3 py-2"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Select supplier...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.supplierName}
                </option>
              ))}
            </select>
          </div>
          {showAdvanced && (
            <div>
              <label className="text-sm text-gray-600">Supplier DN No. (optional)</label>
              <input
                className="w-full border rounded px-3 py-2"
                value={supplierDeliveryNo}
                onChange={(e) => setSupplierDN(e.target.value)}
              />
            </div>
          )}
        </div>

        <table className="w-full text-sm">
          <thead className="text-gray-500 text-start">
            <tr>
              <th className="py-1">Item</th>
              <th className="py-1 w-40">Target Warehouse</th>
              <th className="py-1 w-20">Qty</th>
              <th className="py-1 w-24">Rate</th>
              <th className="py-1 w-24 text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const item = items.find((i) => i.id === l.itemId);
              const serialTracked = !!item?.hasSerialNo;
              const batchTracked = !!item?.hasBatchNo;
              const hasExpiry = !!item?.hasExpiryDate;
              return (
                <Fragment key={idx}>
                  <tr>
                    <td className="py-1 pe-2">
                      <select
                        className="w-full border rounded px-2 py-1"
                        value={l.itemId}
                        onChange={(e) => onItemChange(idx, e.target.value)}
                      >
                        <option value="">Select...</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.itemCode} — {i.itemName}
                            {i.hasSerialNo ? " · serial-tracked" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-2">
                      <select
                        className="w-full border rounded px-2 py-1"
                        value={l.warehouseId}
                        onChange={(e) => updateLine(idx, { warehouseId: e.target.value })}
                      >
                        <option value="">Select...</option>
                        {leaves.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.warehouseName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        step="any"
                        min={0.0001}
                        className="w-full border rounded px-2 py-1"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="w-full border rounded px-2 py-1"
                        value={l.rate}
                        onChange={(e) => updateLine(idx, { rate: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 text-end">{(l.qty * l.rate).toFixed(2)}</td>
                  </tr>
                  {serialTracked && (
                    <tr>
                      <td colSpan={5} className="pb-2">
                        <label className="text-xs text-gray-500 block mb-1">
                          Serial numbers — one per line (need {Math.floor(l.qty)} for qty {l.qty})
                        </label>
                        <textarea
                          className="w-full border rounded px-2 py-1 font-mono text-xs"
                          rows={Math.min(6, Math.max(3, Math.floor(l.qty)))}
                          placeholder={"SN0001\nSN0002\nSN0003"}
                          value={l.serialsRaw}
                          onChange={(e) =>
                            updateLine(idx, { serialsRaw: e.target.value })
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {batchTracked && (
                    <tr>
                      <td colSpan={5} className="pb-2">
                        <div className="grid grid-cols-3 gap-2 items-end">
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">
                              Batch number *
                            </label>
                            <input
                              className="w-full border rounded px-2 py-1 font-mono text-xs"
                              placeholder="e.g. LOT-2025-01"
                              value={l.batchNo}
                              onChange={(e) =>
                                updateLine(idx, { batchNo: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">
                              Manufactured
                            </label>
                            <input
                              type="date"
                              className="w-full border rounded px-2 py-1"
                              value={l.manufactureDate}
                              onChange={(e) =>
                                updateLine(idx, { manufactureDate: e.target.value })
                              }
                            />
                          </div>
                          {hasExpiry && (
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">
                                Expires
                              </label>
                              <input
                                type="date"
                                className="w-full border rounded px-2 py-1"
                                value={l.expiryDate}
                                onChange={(e) =>
                                  updateLine(idx, { expiryDate: e.target.value })
                                }
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => setLines([...lines, { ...emptyLine }])}
          className="text-sm text-brand-600"
        >
          + Add line
        </button>

        {showAdvanced && (
          <div>
            <label className="text-sm text-gray-600">Remarks</label>
            <textarea
              className="w-full border rounded px-3 py-2"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-ink-muted/10 pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-ink-muted hover:text-ink-soft transition-colors"
          >
            {showAdvanced ? "− Hide" : "+ Show"} supplier DN & remarks
          </button>
          <div className="text-lg text-ink">
            Total: <b className="tabular-nums">{total.toFixed(2)}</b>
          </div>
          <Button variant="primary" disabled={busy} type="submit">
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </form></Card>
    </main>
  );
}

export default function NewPurchaseReceiptPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewPurchaseReceiptPage />
    </Suspense>
  );
}
