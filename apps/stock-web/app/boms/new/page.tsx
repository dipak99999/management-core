"use client";

import { useEffect, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface Item { id: string; itemCode: string; itemName: string; isStockItem: boolean }
interface Workstation { id: string; name: string; hourRate: string }

interface Line { itemId: string; qty: number; uom: string }
interface OpLine {
  operationName: string;
  workstationId: string;
  timeInMins: number;
  sortOrder: number;
}

const emptyLine: Line = { itemId: "", qty: 1, uom: "Nos" };
const emptyOp: OpLine = {
  operationName: "",
  workstationId: "",
  timeInMins: 0,
  sortOrder: 0,
};

export default function NewBOMPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [workstations, setWorkstations] = useState<Workstation[]>([]);
  const [productionItemId, setPI] = useState("");
  const [yieldQty, setYieldQty] = useState(1);
  const [isDefault, setIsDefault] = useState(true);
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }, { ...emptyLine }]);
  const [ops, setOps] = useState<OpLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api.get<Workstation[]>("/workstations").then(setWorkstations).catch(() => {});
  }, []);

  // Smart defaults: BOM authors tend to use the same UoM across sibling
  // recipes; pre-fill the first line's UoM from the last BOM.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ uom: string }>(
    "stock-web:bom-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (!smart.last?.uom) return;
    setLines((ls) =>
      ls.map((l, i) => (i === 0 && l.uom === "Nos" ? { ...l, uom: smart.last!.uom } : l)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.uom]);

  const stockItems = items.filter((i) => i.isStockItem);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const validOps = ops
        .filter((o) => o.operationName && o.workstationId && o.timeInMins > 0)
        .map((o, i) => ({ ...o, sortOrder: o.sortOrder || i }));
      await api.post("/boms", {
        productionItemId,
        qty: yieldQty,
        isDefault,
        items: lines
          .filter((l) => l.itemId && l.qty > 0)
          .map((l) => ({ itemId: l.itemId, qty: l.qty, uom: l.uom })),
        ...(validOps.length > 0 ? { operations: validOps } : {}),
      });
      const firstUom = lines.find((l) => l.itemId)?.uom ?? "";
      if (firstUom) smart.remember({ uom: firstUom });
      location.href = "/stock/boms";
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
          { label: "BOMs", href: "/stock/boms" },
          { label: "New" },
        ]}
        title="New BOM"
        subtitle="Defines the recipe for producing one or more units of a finished good from raw materials. Work Orders will reference this BOM to manufacture and scale quantities."
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
            <label className="text-sm text-gray-600">Finished good</label>
            <select
              required
              className="w-full border rounded px-3 py-2"
              value={productionItemId}
              onChange={(e) => setPI(e.target.value)}
            >
              <option value="">Select item...</option>
              {stockItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemCode} — {i.itemName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">This BOM yields (qty)</label>
            <input
              type="number"
              step="any"
              min={0.0001}
              className="w-full border rounded px-3 py-2"
              value={yieldQty}
              onChange={(e) => setYieldQty(Number(e.target.value))}
              required
            />
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600">Raw materials</label>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-start">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1 w-24">Qty per BOM</th>
                <th className="py-1 w-20">UOM</th>
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
                      {stockItems
                        .filter((i) => i.id !== productionItemId)
                        .map((i) => (
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
                  <td className="py-1 pe-2">
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={l.uom}
                      onChange={(e) => updateLine(idx, { uom: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setLines([...lines, { ...emptyLine }])}
            className="text-sm text-brand-600 mt-2"
          >
            + Add material
          </button>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label className="text-sm text-gray-600">
              Operations (routing) — optional
            </label>
            <button
              type="button"
              onClick={() => setOps([...ops, { ...emptyOp, sortOrder: ops.length }])}
              className="text-sm text-brand-600 disabled:opacity-40"
              disabled={workstations.length === 0}
            >
              + Add operation
            </button>
          </div>
          {workstations.length === 0 && (
            <div className="text-xs text-amber-700 mt-1">
              Create at least one{" "}
              <a href="/stock/workstations" className="underline">
                workstation
              </a>{" "}
              first — operations reference a workstation for hour-rate snapshot.
            </div>
          )}
          {ops.length > 0 && (
            <table className="w-full text-sm mt-1">
              <thead className="text-gray-500 text-start">
                <tr>
                  <th className="py-1">Operation</th>
                  <th className="py-1 w-48">Workstation</th>
                  <th className="py-1 w-32 text-end">Time (min) per BOM</th>
                  <th className="py-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {ops.map((op, i) => (
                  <tr key={i}>
                    <td className="py-1 pe-2">
                      <input
                        className="w-full border rounded px-2 py-1"
                        value={op.operationName}
                        onChange={(e) =>
                          setOps(ops.map((o, idx) => (idx === i ? { ...o, operationName: e.target.value } : o)))
                        }
                        placeholder="e.g. Cutting, Assembly"
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <select
                        className="w-full border rounded px-2 py-1"
                        value={op.workstationId}
                        onChange={(e) =>
                          setOps(ops.map((o, idx) => (idx === i ? { ...o, workstationId: e.target.value } : o)))
                        }
                      >
                        <option value="">Select...</option>
                        {workstations.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({Number(w.hourRate).toFixed(2)}/hr)
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        step="any"
                        min={0.1}
                        className="w-full border rounded px-2 py-1 text-end"
                        value={op.timeInMins}
                        onChange={(e) =>
                          setOps(ops.map((o, idx) => (idx === i ? { ...o, timeInMins: Number(e.target.value) } : o)))
                        }
                      />
                    </td>
                    <td className="py-1 text-end">
                      <button
                        type="button"
                        onClick={() => setOps(ops.filter((_, idx) => idx !== i))}
                        className="text-red-600 text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Set as default BOM for this item (any other default will be unset)
        </label>

        <div className="flex justify-end border-t border-ink-muted/10 pt-3">
          <Button variant="primary" disabled={busy || !productionItemId} type="submit">
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </form></Card>
    </main>
  );
}
