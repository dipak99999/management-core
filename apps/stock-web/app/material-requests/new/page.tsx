"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface Item { id: string; itemCode: string; itemName: string }
interface Warehouse { id: string; warehouseName: string; isGroup: boolean }
interface Line { itemId: string; qty: number; warehouseId: string }
interface ExistingMR {
  status: string;
  materialRequestType: string;
  transactionDate: string;
  requiredDate: string | null;
  remarks: string | null;
  items: {
    itemId: string;
    qty: string;
    warehouseId: string | null;
  }[];
}

const MR_TYPES = [
  "Purchase",
  "Material Transfer",
  "Material Issue",
  "Manufacture",
] as const;

function InnerNewMaterialRequestPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [mrType, setMrType] = useState<(typeof MR_TYPES)[number]>("Purchase");
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [requiredDate, setRequiredDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: 1, warehouseId: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Smart defaults: MRs usually repeat the same type (Purchase for buyers,
  // Material Transfer for stock movers) + target the same warehouse.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ mrType: (typeof MR_TYPES)[number]; warehouseId: string }>(
    "stock-web:material-request-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (editId || !smart.last) return;
    if (smart.last.mrType) setMrType(smart.last.mrType);
    if (smart.last.warehouseId) {
      setLines((ls) =>
        ls.map((l, i) => (i === 0 && !l.warehouseId ? { ...l, warehouseId: smart.last!.warehouseId } : l)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.mrType, smart.last?.warehouseId]);

  useEffect(() => {
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api
      .get<Warehouse[]>("/warehouses")
      .then((w) => setWarehouses(w.filter((x) => !x.isGroup)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingMR>(`/material-requests/${editId}`)
      .then((mr) => {
        if (mr.status !== "Draft") {
          setError(`Cannot edit MR in status ${mr.status}`);
          return;
        }
        setMrType(mr.materialRequestType as (typeof MR_TYPES)[number]);
        setTransactionDate(mr.transactionDate.slice(0, 10));
        setRequiredDate(mr.requiredDate ? mr.requiredDate.slice(0, 10) : "");
        setRemarks(mr.remarks ?? "");
        setLines(
          mr.items.length
            ? mr.items.map((it) => ({
                itemId: it.itemId,
                qty: Number(it.qty),
                warehouseId: it.warehouseId ?? "",
              }))
            : [{ itemId: "", qty: 1, warehouseId: "" }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        materialRequestType: mrType,
        transactionDate: new Date(transactionDate).toISOString(),
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : null,
        remarks,
        items: lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            ...(l.warehouseId ? { warehouseId: l.warehouseId } : {}),
          })),
      };
      if (editId) {
        await api.put(`/material-requests/${editId}`, body);
        location.href = `/stock/material-requests/${editId}`;
      } else {
        await api.post("/material-requests", body);
        const firstWarehouse = lines.find((l) => l.warehouseId)?.warehouseId ?? "";
        smart.remember({ mrType, warehouseId: firstWarehouse });
        location.href = "/stock/material-requests";
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
          { label: "Material Requests", href: "/stock/material-requests" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Material Request" : "New Material Request"}
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
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm text-gray-600">Type</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={mrType}
              onChange={(e) => setMrType(e.target.value as (typeof MR_TYPES)[number])}
            >
              {MR_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Transaction date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
            />
          </div>
          {showAdvanced && (
            <div>
              <label className="text-sm text-gray-600">Required by</label>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
              />
            </div>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-600">Line items</label>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-start">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1 w-24">Qty</th>
                <th className="py-1 w-40">Target warehouse</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="py-1 pe-2">
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={l.itemId}
                      onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                    >
                      <option value="">Select...</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.itemCode} — {i.itemName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pe-2">
                    <input
                      type="number"
                      className="w-full border rounded px-2 py-1"
                      value={l.qty}
                      min={0.0001}
                      step="any"
                      onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                    />
                  </td>
                  <td className="py-1 pe-2">
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={l.warehouseId}
                      onChange={(e) =>
                        updateLine(idx, { warehouseId: e.target.value })
                      }
                    >
                      <option value="">(optional)</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.warehouseName}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() =>
              setLines([...lines, { itemId: "", qty: 1, warehouseId: "" }])
            }
            className="text-sm text-brand-600 mt-2"
          >
            + Add line
          </button>
        </div>

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
            {showAdvanced ? "− Hide" : "+ Show"} required-date & remarks
          </button>
        </div>

        <div className="flex justify-end border-t border-ink-muted/10 pt-3">
          <Button variant="primary" disabled={busy} type="submit">
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </form></Card>
    </main>
  );
}

export default function NewMaterialRequestPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewMaterialRequestPage />
    </Suspense>
  );
}
