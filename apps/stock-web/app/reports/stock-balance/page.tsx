"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

interface Row {
  id: string;
  actualQty: string;
  valuationRate: string;
  stockValue: string;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string };
}
interface Balance {
  rows: Row[];
  totalStockValue: number;
}

interface Warehouse { id: string; warehouseName: string }

export default function StockBalancePage() {
  const [data, setData] = useState<Balance | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const path = warehouseId ? `/reports/stock-balance?warehouseId=${warehouseId}` : "/reports/stock-balance";
      setData(await api.get<Balance>(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get<Warehouse[]>("/warehouses").then(setWarehouses).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useListPageCommands({
    singular: "Stock Balance",
    plural: "Stock Balance",
    refresh: load,
  });

  const cols: Column<Row>[] = [
    {
      header: "Item",
      cell: (r) => (
        <div>
          <span className="font-mono text-sm">{r.item.itemCode}</span>{" "}
          <span className="text-ink-muted text-sm">— {r.item.itemName}</span>
        </div>
      ),
    },
    { header: "Warehouse", cell: (r) => r.warehouse.warehouseName },
    {
      header: "Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {Number(r.actualQty).toFixed(4)} {r.item.stockUom}
        </span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{Number(r.valuationRate).toFixed(4)}</span>
      ),
    },
    {
      header: "Stock value",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-mono">
          {Number(r.stockValue).toFixed(2)}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Stock", href: "/stock" },
          { label: "Stock Balance" },
        ]}
        eyebrow="Inventory · Overview"
        icon={Icon.box}
        title="Stock overview"
        subtitle="On-hand, reserved and available levels per warehouse. Adjust, transfer or follow the ledger."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      <Card className="p-3 flex items-end gap-3 flex-wrap">
        <div className="min-w-[220px]">
          <FormField label="Warehouse">
            <select
              className="input"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">All</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.warehouseName}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <Button variant="primary" onClick={load} type="button">
          Run
        </Button>
        {data && (
          <div className="ms-auto text-sm text-ink-muted">
            Total stock value:{" "}
            <b className="tabular-nums text-ink">
              {data.totalStockValue.toFixed(2)}
            </b>
          </div>
        )}
      </Card>

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      )}

      <DataTable<Row>
        columns={cols}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        empty={{ title: "No stock" }}
      />
    </main>
  );
}
