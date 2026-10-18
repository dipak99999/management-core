"use client";

import { Suspense, Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface Customer { id: string; customerName: string }
interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  hasSerialNo?: boolean;
  hasBatchNo?: boolean;
}
interface Batch {
  id: string;
  batchNo: string;
  itemId: string;
  batchQty: string;
  expiryDate: string | null;
}
interface Warehouse { id: string; warehouseName: string; isGroup: boolean }

interface Line {
  itemId: string;
  warehouseId: string;
  qty: number;
  rate: number;
  serialsRaw: string;
  batchNo: string;
}

const emptyLine: Line = {
  itemId: "",
  warehouseId: "",
  qty: 1,
  rate: 0,
  serialsRaw: "",
  batchNo: "",
};

interface ExistingDN {
  status: string;
  customerId: string;
  remarks: string | null;
  items: {
    itemId: string;
    warehouseId: string;
    qty: string;
    rate: string;
    serialNumbersInput: string[];
    batchNo: string | null;
  }[];
}

function InnerNewDeliveryNotePage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api.get<Warehouse[]>("/warehouses").then(setWarehouses).catch(() => {});
    api.get<Batch[]>("/batches").then(setBatches).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingDN>(`/delivery-notes/${editId}`)
      .then((dn) => {
        if (dn.status !== "Draft") {
          setError(`Cannot edit DN in status ${dn.status}`);
          return;
        }
        setCustomerId(dn.customerId);
        setRemarks(dn.remarks ?? "");
        setLines(
          dn.items.length
            ? dn.items.map((it) => ({
                itemId: it.itemId,
                warehouseId: it.warehouseId,
                qty: Number(it.qty),
                rate: Number(it.rate),
                serialsRaw: (it.serialNumbersInput ?? []).join("\n"),
                batchNo: it.batchNo ?? "",
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
        customerId,
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
            };
          }),
      };
      if (editId) {
        await api.put(`/delivery-notes/${editId}`, body);
        location.href = `/stock/delivery-notes/${editId}`;
      } else {
        await api.post("/delivery-notes", body);
        location.href = "/stock/delivery-notes";
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
          { label: "Delivery Notes", href: "/stock/delivery-notes" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Delivery Note" : "New Delivery Note"}
        subtitle="On submit, stock leaves the source warehouse (moving-avg valuation) and COGS is debited / Stock-in-Hand credited for the consumed value."
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
        <div>
          <label className="text-sm text-gray-600">Customer</label>
          <select
            required
            className="w-full border rounded px-3 py-2"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Select customer...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.customerName}
              </option>
            ))}
          </select>
        </div>

        <table className="w-full text-sm">
          <thead className="text-gray-500 text-start">
            <tr>
              <th className="py-1">Item</th>
              <th className="py-1 w-40">Source Warehouse</th>
              <th className="py-1 w-20">Qty</th>
              <th className="py-1 w-24">Rate (bill)</th>
              <th className="py-1 w-24 text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const item = items.find((i) => i.id === l.itemId);
              const serialTracked = !!item?.hasSerialNo;
              const batchTracked = !!item?.hasBatchNo;
              const eligibleBatches = batchTracked
                ? batches.filter((b) => b.itemId === l.itemId && Number(b.batchQty) > 0)
                : [];
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
                          Serial numbers to ship — one per line (need {Math.floor(l.qty)})
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
                        <label className="text-xs text-gray-500 block mb-1">
                          Batch to ship from *
                        </label>
                        <select
                          className="w-full max-w-md border rounded px-2 py-1"
                          value={l.batchNo}
                          onChange={(e) =>
                            updateLine(idx, { batchNo: e.target.value })
                          }
                        >
                          <option value="">Select batch...</option>
                          {eligibleBatches.map((b) => (
                            <option key={b.id} value={b.batchNo}>
                              {b.batchNo} — {Number(b.batchQty).toFixed(2)} avail
                              {b.expiryDate
                                ? ` · exp ${new Date(b.expiryDate).toLocaleDateString()}`
                                : ""}
                            </option>
                          ))}
                        </select>
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

        <div>
          <label className="text-sm text-gray-600">Remarks</label>
          <textarea
            className="w-full border rounded px-3 py-2"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between border-t border-ink-muted/10 pt-3">
          <div className="text-sm text-ink-muted">
            Billed value (info only): <b className="tabular-nums text-ink">{total.toFixed(2)}</b>
          </div>
          <Button variant="primary" disabled={busy} type="submit">
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </form></Card>
    </main>
  );
}

export default function NewDeliveryNotePage() {
  return (
    <Suspense fallback={null}>
      <InnerNewDeliveryNotePage />
    </Suspense>
  );
}
