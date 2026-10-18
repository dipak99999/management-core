"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface Row {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  remarks: string | null;
  receiptCount: number;
  totalAmount: number;
}

export default function LandedCostVouchersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Row[]>("/landed-cost-vouchers")
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  const cols: Column<Row>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/accounting/landed-cost-vouchers/${r.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {r.name}
        </a>
      ),
    },
    { header: "Date", cell: (r) => <span className="text-xs">{dateShort(r.postingDate)}</span> },
    { header: "Receipts", cell: (r) => <span className="text-xs tabular-nums">{r.receiptCount}</span> },
    {
      header: "Total cost",
      align: "right",
      cell: (r) => <span className="font-mono tabular-nums">{money(r.totalAmount)}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <a
          href={`/accounting/landed-cost-vouchers/${r.id}`}
          className="text-brand-600 hover:underline text-xs"
        >
          Open →
        </a>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Landed Cost Vouchers" },
        ]}
        title="Landed cost vouchers"
        subtitle="Capitalize freight, customs, duty, or insurance costs onto items already received via Purchase Receipts. On submit: the cost moves from expense to inventory (Stock in Hand debited, source expenses credited), and each item's bin valuation is bumped pro-rata by its receipt-line value."
        actions={
          <a href="/accounting/landed-cost-vouchers/new">
            <Button variant="primary" type="button">+ New voucher</Button>
          </a>
        }
      />
      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <DataTable<Row>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No vouchers yet" }}
      />
    </main>
  );
}
