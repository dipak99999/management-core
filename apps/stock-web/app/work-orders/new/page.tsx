"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface BOMItemDetail {
  id: string;
  qty: string;
  uom: string;
  item: { itemCode: string; itemName: string };
}
interface BOM {
  id: string;
  name: string;
  qty: string;
  uom: string;
  isActive: boolean;
  isDefault: boolean;
  productionItem: { itemCode: string; itemName: string };
  items: BOMItemDetail[];
}
interface Warehouse { id: string; warehouseName: string; isGroup: boolean }

interface ExistingWO {
  status: string;
  producedQty: string;
  bomId: string;
  qty: string;
  sourceWarehouseId: string;
  targetWarehouseId: string;
  remarks: string | null;
}

function InnerNewWorkOrderPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [boms, setBoms] = useState<BOM[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [bomId, setBomId] = useState("");
  const [qty, setQty] = useState(1);
  const [sourceWarehouseId, setSource] = useState("");
  const [targetWarehouseId, setTarget] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<BOM[]>("/boms").then((rs) => setBoms(rs.filter((b) => b.isActive))).catch(() => {});
    api.get<Warehouse[]>("/warehouses").then(setWarehouses).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingWO>(`/work-orders/${editId}`)
      .then((wo) => {
        if (wo.status !== "Not Started") {
          setError(`Cannot edit WO in status ${wo.status}`);
          return;
        }
        if (Number(wo.producedQty) > 0) {
          setError("Cannot edit: manufacturing has already begun");
          return;
        }
        setBomId(wo.bomId);
        setQty(Number(wo.qty));
        setSource(wo.sourceWarehouseId);
        setTarget(wo.targetWarehouseId);
        setRemarks(wo.remarks ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  const leaves = warehouses.filter((w) => !w.isGroup);
  const selectedBom = useMemo(() => boms.find((b) => b.id === bomId), [boms, bomId]);

  const projectedConsumption = useMemo(() => {
    if (!selectedBom) return [];
    const bomYield = Number(selectedBom.qty);
    if (bomYield <= 0) return [];
    const ratio = qty / bomYield;
    return selectedBom.items.map((bi) => ({
      itemCode: bi.item.itemCode,
      itemName: bi.item.itemName,
      qty: Number(bi.qty) * ratio,
      uom: bi.uom,
    }));
  }, [selectedBom, qty]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = { bomId, qty, sourceWarehouseId, targetWarehouseId, remarks };
      if (editId) {
        await api.put(`/work-orders/${editId}`, body);
        location.href = `/stock/work-orders/${editId}`;
      } else {
        await api.post("/work-orders", body);
        location.href = "/stock/work-orders";
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
          { label: "Work Orders", href: "/stock/work-orders" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Work Order" : "New Work Order"}
        subtitle="Creates a plan. Actual raw material consumption + FG production happens when you click Manufacture on the Work Order list."
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
          <label className="text-sm text-gray-600">BOM</label>
          <select
            required
            className="w-full border rounded px-3 py-2"
            value={bomId}
            onChange={(e) => setBomId(e.target.value)}
          >
            <option value="">Select BOM...</option>
            {boms.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} → {b.productionItem.itemCode} × {Number(b.qty)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm text-gray-600">Qty to produce</label>
            <input
              type="number"
              step="any"
              min={0.0001}
              className="w-full border rounded px-3 py-2"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              required
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Raw materials from</label>
            <select
              required
              className="w-full border rounded px-3 py-2"
              value={sourceWarehouseId}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">Select...</option>
              {leaves.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.warehouseName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Finished goods to</label>
            <select
              required
              className="w-full border rounded px-3 py-2"
              value={targetWarehouseId}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Select...</option>
              {leaves.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.warehouseName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {projectedConsumption.length > 0 && (
          <div className="bg-surface-sunken rounded p-3 border border-ink-muted/10">
            <div className="text-sm text-ink-muted mb-2">
              Projected raw material consumption to produce {qty}:
            </div>
            <ul className="text-sm">
              {projectedConsumption.map((c, i) => (
                <li key={i} className="font-mono">
                  {c.itemCode} — {c.qty.toFixed(4)} {c.uom}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="text-sm text-gray-600">Remarks</label>
          <textarea
            className="w-full border rounded px-3 py-2"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>

        <div className="flex justify-end border-t border-ink-muted/10 pt-3">
          <Button
            variant="primary"
            disabled={busy || !bomId || !sourceWarehouseId || !targetWarehouseId}
            type="submit"
          >
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </form></Card>
    </main>
  );
}

export default function NewWorkOrderPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewWorkOrderPage />
    </Suspense>
  );
}
