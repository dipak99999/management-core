"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

// C11: Production Plan new-form. Supports auto-suggest from open SO demand
// (fetches suggestions, lets user accept subset). On save, server computes
// required raw materials from each FG's default BOM + current stock.

interface Item { id: string; itemCode: string; itemName: string }
interface SOSuggestion {
  itemId: string;
  itemCode: string;
  itemName: string;
  salesOrderItemId: string;
  salesOrderName: string;
  pendingQty: number;
}
interface Line {
  itemId: string;
  plannedQty: number;
  salesOrderItemId: string;
  fromSO: string; // display-only
}

const emptyLine: Line = { itemId: "", plannedQty: 1, salesOrderItemId: "", fromSO: "" };

export default function NewProductionPlanPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [suggestions, setSuggestions] = useState<SOSuggestion[]>([]);
  const [postingDate, setPostingDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api
      .get<SOSuggestion[]>("/production-plans/suggest/from-sales-orders")
      .then(setSuggestions)
      .catch(() => {});
  }, []);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function acceptSuggestion(s: SOSuggestion) {
    // Blank first line? Fill it in. Otherwise append.
    const isEmpty = lines.length === 1 && !lines[0].itemId;
    const newLine: Line = {
      itemId: s.itemId,
      plannedQty: s.pendingQty,
      salesOrderItemId: s.salesOrderItemId,
      fromSO: s.salesOrderName,
    };
    setLines(isEmpty ? [newLine] : [...lines, newLine]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        postingDate: new Date(postingDate).toISOString(),
        remarks,
        items: lines
          .filter((l) => l.itemId && l.plannedQty > 0)
          .map((l) => ({
            itemId: l.itemId,
            plannedQty: l.plannedQty,
            ...(l.salesOrderItemId ? { salesOrderItemId: l.salesOrderItemId } : {}),
          })),
      };
      const pp = await api.post<{ id: string }>("/production-plans", body);
      location.href = `/stock/production-plans/${pp.id}`;
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
          { label: "Production Plans", href: "/stock/production-plans" },
          { label: "New" },
        ]}
        title="New Production Plan"
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      {suggestions.length > 0 && (
        <Card className="p-3">
          <div className="text-sm font-semibold text-ink mb-2">
            Open SO demand ({suggestions.length})
          </div>
          <div className="text-xs text-ink-muted mb-2">
            Click a row to add it to the plan with the pending qty pre-filled.
          </div>
          <div className="max-h-60 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-start">
                <tr>
                  <th className="py-1">Item</th>
                  <th className="py-1">Sales Order</th>
                  <th className="py-1 text-end">Pending qty</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.salesOrderItemId} className="border-t">
                    <td className="py-1">
                      {s.itemName}
                      <span className="text-xs text-gray-500 ms-2 font-mono">
                        {s.itemCode}
                      </span>
                    </td>
                    <td className="py-1 font-mono">{s.salesOrderName}</td>
                    <td className="py-1 text-end">{s.pendingQty.toFixed(2)}</td>
                    <td className="py-1 text-end">
                      <button
                        type="button"
                        onClick={() => acceptSuggestion(s)}
                        className="text-brand-600 text-sm"
                      >
                        + Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-4"><form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-gray-600">Posting date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600">Items to produce</label>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-start">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1 w-24">Planned qty</th>
                <th className="py-1 w-32">From SO</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="py-1 pe-2">
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={l.itemId}
                      onChange={(e) => updateLine(idx, { itemId: e.target.value, salesOrderItemId: "", fromSO: "" })}
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
                      value={l.plannedQty}
                      onChange={(e) =>
                        updateLine(idx, { plannedQty: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td className="py-1 text-xs text-gray-600 font-mono">
                    {l.fromSO || "—"}
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
            + Add line
          </button>
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
