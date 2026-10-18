"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";

// D14: SO fulfillment tracker. One row per SO line with pending delivery
// or billing. Sorted oldest-first so stalest orders float to the top.

interface Row {
  soId: string;
  soName: string;
  transactionDate: string;
  deliveryDate: string | null;
  soStatus: string;
  customerName: string;
  itemCode: string;
  itemName: string;
  stockUom: string;
  qty: number;
  deliveredQty: number;
  billedQty: number;
  pendingDelivery: number;
  pendingBilling: number;
}

export default function SOFulfillmentPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<{ rows: Row[] }>("/reports/so-fulfillment")
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  const totals = rows.reduce(
    (t, r) => {
      t.pendingDelivery += r.pendingDelivery;
      t.pendingBilling += r.pendingBilling;
      return t;
    },
    { pendingDelivery: 0, pendingBilling: 0 },
  );

  const columns: Column<Row>[] = [
    {
      header: "SO",
      cell: (r) => (
        <>
          <a
            href={`/crm/sales-orders/${r.soId}`}
            className="font-mono text-brand-600 hover:underline"
          >
            {r.soName}
          </a>
          <div className="text-xs text-ink-muted">
            {dateShort(r.transactionDate)}
            {r.deliveryDate && ` · deliver ${dateShort(r.deliveryDate)}`}
          </div>
        </>
      ),
    },
    { header: "Customer", cell: (r) => r.customerName },
    {
      header: "Item",
      cell: (r) => (
        <>
          <div className="font-medium text-ink">{r.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.itemCode}</div>
        </>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.qty.toFixed(2)} {r.stockUom}
        </span>
      ),
    },
    {
      header: "Delivered",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">
          {r.deliveredQty.toFixed(2)}
        </span>
      ),
    },
    {
      header: "Billed",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">
          {r.billedQty.toFixed(2)}
        </span>
      ),
    },
    {
      header: "Pending del",
      align: "right",
      cell: (r) => (
        <span
          className={`tabular-nums ${r.pendingDelivery > 0 ? "text-amber-800 font-medium" : ""}`}
        >
          {r.pendingDelivery.toFixed(2)}
        </span>
      ),
    },
    {
      header: "Pending bill",
      align: "right",
      cell: (r) => (
        <span
          className={`tabular-nums ${r.pendingBilling > 0 ? "text-amber-800 font-medium" : ""}`}
        >
          {r.pendingBilling.toFixed(2)}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Reports" },
          { label: "SO Fulfillment" },
        ]}
        title="SO Fulfillment"
        subtitle="Sales Order lines with pending delivery or billing — sorted oldest-first"
        actions={
          <Button
            variant="secondary"
            onClick={() => history.back()}
            type="button"
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Open lines
          </div>
          <div className="text-lg font-semibold tabular-nums text-ink">
            {rows.length}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Pending delivery qty
          </div>
          <div className="text-lg font-semibold tabular-nums text-ink">
            {totals.pendingDelivery.toFixed(2)}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Pending billing qty
          </div>
          <div className="text-lg font-semibold tabular-nums text-ink">
            {totals.pendingBilling.toFixed(2)}
          </div>
        </Card>
      </div>

      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.soId}-${r.itemCode}`}
        loading={loading}
        empty={{ title: "All SOs fully fulfilled" }}
      />
    </main>
  );
}
