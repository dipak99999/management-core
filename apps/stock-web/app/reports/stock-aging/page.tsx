"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  type Column,
} from "../../../components/ui";

// C14: Stock Aging report. FIFO layer walk per (item, warehouse) bucketed
// into 0-30 / 30-60 / 60-90 / 90+ days from server.

interface Row {
  itemCode: string;
  itemName: string;
  stockUom: string;
  warehouseName: string;
  totalQty: number;
  oldestDays: number;
  buckets: {
    d0_30: number;
    d30_60: number;
    d60_90: number;
    d90_plus: number;
  };
}

export default function StockAgingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ rows: Row[] }>("/reports/stock-aging")
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  const cols: Column<Row>[] = [
    {
      header: "Item",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.itemCode}</div>
        </div>
      ),
    },
    { header: "Warehouse", cell: (r) => r.warehouseName },
    {
      header: "On hand",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.totalQty.toFixed(2)} {r.stockUom}
        </span>
      ),
    },
    {
      header: "Oldest (d)",
      align: "right",
      cell: (r) => (
        <span
          className={`tabular-nums ${
            r.oldestDays > 90 ? "text-red-700 font-medium" : ""
          }`}
        >
          {r.oldestDays}
        </span>
      ),
    },
    {
      header: "0–30d",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.buckets.d0_30.toFixed(2)}</span>,
    },
    {
      header: "30–60d",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.buckets.d30_60.toFixed(2)}</span>,
    },
    {
      header: "60–90d",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.buckets.d60_90.toFixed(2)}</span>,
    },
    {
      header: <span className="text-red-700">90+d</span>,
      align: "right",
      cell: (r) => (
        <span
          className={`tabular-nums ${
            r.buckets.d90_plus > 0 ? "text-red-700 font-medium" : ""
          }`}
        >
          {r.buckets.d90_plus.toFixed(2)}
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
          { label: "Stock Aging" },
        ]}
        title="Stock Aging"
        subtitle="FIFO-based age of on-hand stock. Layers past 90 days are strong candidates for markdown / write-off."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      )}

      <DataTable<Row>
        columns={cols}
        rows={rows}
        rowKey={(r) => `${r.itemCode}-${r.warehouseName}`}
        loading={loading}
        empty={{ title: "No stock" }}
      />
    </main>
  );
}
