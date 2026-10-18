"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface Warehouse { id: string; warehouseName: string; isGroup: boolean }
interface Item { id: string; itemCode: string; itemName: string; standardRate: string }

type EntryType =
  | "Material Receipt"
  | "Material Issue"
  | "Material Transfer"
  | "Repack";

interface Line {
  itemId: string;
  qty: number;
  basicRate: number;
  sourceWarehouseId: string;
  targetWarehouseId: string;
}

const emptyLine: Line = {
  itemId: "",
  qty: 1,
  basicRate: 0,
  sourceWarehouseId: "",
  targetWarehouseId: "",
};

interface ExistingSE {
  status: string;
  entryType: EntryType;
  remarks: string | null;
  postingDate: string | null;
  items: {
    itemId: string;
    qty: string;
    basicRate: string;
    sourceWarehouseId: string | null;
    targetWarehouseId: string | null;
  }[];
}

function InnerNewStockEntryPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [entryType, setEntryType] = useState<EntryType>("Material Receipt");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [remarks, setRemarks] = useState("");
  // Explicit posting date. Prior version used server-now() which prevented
  // backdated receipts (correction entries after a physical count).
  const [postingDate, setPostingDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Warehouse[]>("/warehouses").then(setWarehouses).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingSE>(`/stock-entries/${editId}`)
      .then((se) => {
        if (se.status !== "Draft") {
          setError(`Cannot edit SE in status ${se.status}`);
          return;
        }
        setEntryType(se.entryType);
        setRemarks(se.remarks ?? "");
        if (se.postingDate) setPostingDate(se.postingDate.slice(0, 10));
        setLines(
          se.items.length
            ? se.items.map((it) => ({
                itemId: it.itemId,
                qty: Number(it.qty),
                basicRate: Number(it.basicRate),
                sourceWarehouseId: it.sourceWarehouseId ?? "",
                targetWarehouseId: it.targetWarehouseId ?? "",
              }))
            : [{ ...emptyLine }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  const leafWarehouses = warehouses.filter((w) => !w.isGroup);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function onItemChange(idx: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(idx, {
      itemId,
      basicRate: item ? Number(item.standardRate) : 0,
    });
  }

  // Repack lines show both source + target columns; user leaves one blank per
  // line to mark it as RM (source-only) vs FG (target-only). Server validates.
  const showSource = entryType !== "Material Receipt";
  const showTarget = entryType !== "Material Issue";
  const showRate = entryType === "Material Receipt";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        entryType,
        remarks,
        postingDate: postingDate ? new Date(postingDate).toISOString() : undefined,
        items: lines
          .filter((l) => l.itemId && l.qty > 0)
          .map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            basicRate: showRate ? l.basicRate : 0,
            sourceWarehouseId: showSource ? l.sourceWarehouseId || null : null,
            targetWarehouseId: showTarget ? l.targetWarehouseId || null : null,
          })),
      };
      if (editId) {
        await api.put(`/stock-entries/${editId}`, body);
        location.href = `/stock/stock-entries/${editId}`;
      } else {
        await api.post("/stock-entries", body);
        location.href = "/stock/stock-entries";
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
          { label: "Stock Entries", href: "/stock/stock-entries" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Stock Entry" : "New Stock Entry"}
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <div className="inline-flex rounded overflow-hidden border border-ink-muted/10">
        {(
          [
            "Material Receipt",
            "Material Issue",
            "Material Transfer",
            "Repack",
          ] as const
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setEntryType(t)}
            className={`px-3 py-2 text-sm ${
              entryType === t ? "bg-brand-600 text-white" : "bg-surface-raised text-ink-soft"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {entryType === "Repack" && (
        <div className="text-sm bg-amber-50 border border-amber-200 rounded p-2 text-amber-800">
          Repack: for each line pick <b>Source WH only</b> (RM to consume) or{" "}
          <b>Target WH only</b> (FG to produce). Server enforces exactly one FG
          line and sets its rate to <code>totalConsumedValue / fgQty</code>.
        </div>
      )}

      <Card className="p-4"><form onSubmit={submit} className="space-y-4">
        <table className="w-full text-sm">
          <thead className="text-gray-500 text-start">
            <tr>
              <th className="py-1">Item</th>
              <th className="py-1 w-20">Qty</th>
              {showRate && <th className="py-1 w-24">Rate</th>}
              {showSource && <th className="py-1 w-40">Source WH</th>}
              {showTarget && <th className="py-1 w-40">Target WH</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
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
                {showRate && (
                  <td className="py-1 pe-2">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      className="w-full border rounded px-2 py-1"
                      value={l.basicRate}
                      onChange={(e) => updateLine(idx, { basicRate: Number(e.target.value) })}
                    />
                  </td>
                )}
                {showSource && (
                  <td className="py-1 pe-2">
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={l.sourceWarehouseId}
                      onChange={(e) => updateLine(idx, { sourceWarehouseId: e.target.value })}
                    >
                      <option value="">Select...</option>
                      {leafWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.warehouseName}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                {showTarget && (
                  <td className="py-1 pe-2">
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={l.targetWarehouseId}
                      onChange={(e) => updateLine(idx, { targetWarehouseId: e.target.value })}
                    >
                      <option value="">Select...</option>
                      {leafWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.warehouseName}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
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
          <label className="text-sm text-gray-600">Posting date</label>
          <input
            type="date"
            className="w-full border rounded px-3 py-2"
            value={postingDate}
            onChange={(e) => setPostingDate(e.target.value)}
          />
          <div className="text-xs text-gray-500 mt-1">
            Leave blank to post as today. Use to backdate a correction after a physical count.
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600">Remarks</label>
          <textarea
            className="w-full border rounded px-3 py-2"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
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

export default function NewStockEntryPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewStockEntryPage />
    </Suspense>
  );
}
