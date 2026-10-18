"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface Item { id: string; itemCode: string; itemName: string; isStockItem: boolean }
interface Warehouse { id: string; warehouseName: string; isGroup: boolean }
interface Bin {
  itemId: string;
  warehouseId: string;
  actualQty: string;
  valuationRate: string;
}
interface Line {
  itemId: string;
  warehouseId: string;
  currentQty: number;
  currentRate: number;
  countedQty: number;
  countedRate: string; // "" = keep existing
}

// C3: SR new form. Adding a line snapshots the current Bin state as
// "current" columns; user edits "counted" to record the physical count.

export default function NewStockReconciliationPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [purpose, setPurpose] = useState<"Stock Reconciliation" | "Opening Stock">(
    "Stock Reconciliation",
  );
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Item[]>("/items")
      .then((its) => setItems(its.filter((i) => i.isStockItem)))
      .catch(() => {});
    api
      .get<Warehouse[]>("/warehouses")
      .then((w) => setWarehouses(w.filter((x) => !x.isGroup)))
      .catch(() => {});
  }, []);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function addLine() {
    // Push a blank row; user picks item + warehouse, then we snapshot the bin.
    setLines((ls) => [
      ...ls,
      {
        itemId: "",
        warehouseId: "",
        currentQty: 0,
        currentRate: 0,
        countedQty: 0,
        countedRate: "",
      },
    ]);
  }

  async function fetchBin(idx: number, itemId: string, warehouseId: string) {
    if (!itemId || !warehouseId) return;
    try {
      const env = await api.get<{ rows: Bin[] }>(
        `/reports/stock-balance?itemId=${itemId}&warehouseId=${warehouseId}`,
      );
      const b = env.rows.find(
        (r) => r.itemId === itemId && r.warehouseId === warehouseId,
      );
      updateLine(idx, {
        itemId,
        warehouseId,
        currentQty: b ? Number(b.actualQty) : 0,
        currentRate: b ? Number(b.valuationRate) : 0,
        countedQty: b ? Number(b.actualQty) : 0,
      });
    } catch {
      updateLine(idx, { itemId, warehouseId });
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        postingDate: new Date(postingDate).toISOString(),
        purpose,
        remarks,
        items: lines
          .filter((l) => l.itemId && l.warehouseId)
          .map((l) => ({
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            countedQty: l.countedQty,
            ...(l.countedRate !== ""
              ? { countedValuationRate: Number(l.countedRate) }
              : {}),
          })),
      };
      await api.post("/stock-reconciliations", body);
      location.href = "/stock/stock-reconciliations";
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
          { label: "Stock Reconciliations", href: "/stock/stock-reconciliations" },
          { label: "New" },
        ]}
        title="New Stock Reconciliation"
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <BulkImportPanel
        postingDate={postingDate}
        purpose={purpose}
        remarks={remarks}
      />

      <Card className="p-4"><form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm text-gray-600">Posting date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Purpose</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as typeof purpose)}
            >
              <option>Stock Reconciliation</option>
              <option>Opening Stock</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600">Line items</label>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-start">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1 w-32">Warehouse</th>
                <th className="py-1 w-20 text-end">Cur qty</th>
                <th className="py-1 w-20 text-end">Cur rate</th>
                <th className="py-1 w-20">Counted qty</th>
                <th className="py-1 w-20">Counted rate</th>
                <th className="py-1 w-20 text-end">Delta value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const rate = l.countedRate !== "" ? Number(l.countedRate) : l.currentRate;
                const delta =
                  l.countedQty * rate - l.currentQty * l.currentRate;
                return (
                  <tr key={idx}>
                    <td className="py-1 pe-2">
                      <select
                        className="w-full border rounded px-2 py-1"
                        value={l.itemId}
                        onChange={(e) =>
                          fetchBin(idx, e.target.value, l.warehouseId)
                        }
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
                      <select
                        className="w-full border rounded px-2 py-1"
                        value={l.warehouseId}
                        onChange={(e) => fetchBin(idx, l.itemId, e.target.value)}
                      >
                        <option value="">Select...</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.warehouseName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 text-end text-gray-600">
                      {l.currentQty.toFixed(2)}
                    </td>
                    <td className="py-1 text-end text-gray-600">
                      {l.currentRate.toFixed(2)}
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="w-full border rounded px-2 py-1"
                        value={l.countedQty}
                        onChange={(e) =>
                          updateLine(idx, { countedQty: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="text"
                        placeholder={l.currentRate.toFixed(2)}
                        className="w-full border rounded px-2 py-1"
                        value={l.countedRate}
                        onChange={(e) =>
                          updateLine(idx, { countedRate: e.target.value })
                        }
                      />
                    </td>
                    <td
                      className={`py-1 text-end ${
                        delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : ""
                      }`}
                    >
                      {delta.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button
            type="button"
            onClick={addLine}
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
            {busy ? "Saving..." : "Save (Draft)"}
          </Button>
        </div>
      </form></Card>
    </main>
  );
}

// C3+: Bulk import a scanner/spreadsheet CSV into a fresh Draft SR.
// Skips the interactive line-by-line form entirely. The server validates
// + resolves item/warehouse names and returns per-row warnings which
// render inline. On success we redirect to the created SR's detail page
// so staff can review + submit.
function BulkImportPanel(props: {
  postingDate: string;
  purpose: "Stock Reconciliation" | "Opening Stock";
  remarks: string;
}) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);

  async function onFile(f: File) {
    setCsv(await f.text());
    setErrors([]);
    setOk(null);
  }

  async function submit() {
    setBusy(true);
    setErrors([]);
    setOk(null);
    try {
      const r = await api.post<{
        id: string;
        name: string;
        itemCount: number;
        warnings: string[];
      }>("/stock-reconciliations/bulk-import", {
        csv,
        postingDate: new Date(props.postingDate).toISOString(),
        purpose: props.purpose,
        remarks: props.remarks || undefined,
      });
      if (r.warnings.length > 0) setErrors(r.warnings);
      setOk(
        `Imported ${r.itemCount} row${r.itemCount === 1 ? "" : "s"} into ${r.name}. Redirecting…`,
      );
      setTimeout(() => {
        location.href = `/stock/stock-reconciliations/${r.id}`;
      }, 900);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      // Server may return details[] on all-rows-invalid — parse for it.
      try {
        const j = JSON.parse(msg) as { details?: string[] };
        if (j.details) setErrors(j.details);
        else setErrors([msg]);
      } catch {
        setErrors([msg]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="text-sm font-medium text-ink">Import from CSV</div>
        <div className="text-xs text-ink-muted">
          Columns: <code>itemCode, warehouse, countedQty, countedRate</code>{" "}
          (last is optional). Item + warehouse names are case-insensitive.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <span className="text-xs text-ink-muted">or paste below:</span>
      </div>
      <textarea
        className="w-full border rounded px-3 py-2 font-mono text-xs"
        rows={4}
        placeholder="itemCode,warehouse,countedQty,countedRate&#10;WIDGET-A,Main Store,42,15.50"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <div className="text-xs">
          {ok && <span className="text-emerald-700">{ok}</span>}
        </div>
        <Button
          variant="secondary"
          type="button"
          disabled={busy || !csv.trim()}
          onClick={submit}
        >
          {busy ? "Importing…" : "Import as new Draft SR"}
        </Button>
      </div>
      {errors.length > 0 && (
        <div className="text-xs text-red-700 border border-red-200 bg-red-50 rounded p-2 max-h-40 overflow-auto">
          <div className="font-medium mb-1">
            {errors.length} issue{errors.length === 1 ? "" : "s"}:
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {errors.length > 20 && (
              <li className="text-ink-muted italic">…{errors.length - 20} more</li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}
