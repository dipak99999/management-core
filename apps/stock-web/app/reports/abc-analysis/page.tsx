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

// C14: ABC analysis. Items ranked by revenue in the period, cumulative %
// buckets: A ≤ 80% / B ≤ 95% / C rest.

interface Row {
  itemCode: string;
  itemName: string;
  stockUom: string;
  qty: number;
  revenue: number;
  cumulativePct: number;
  abcClass: "A" | "B" | "C";
}
interface Envelope {
  rows: Row[];
  totalRevenue: number;
  from: string;
  to: string;
}

export default function ABCAnalysisPage() {
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(new Date().setMonth(new Date().getMonth() - 12))
    .toISOString()
    .slice(0, 10);
  const [from, setFrom] = useState(yearAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Envelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setData(
        await api.get<Envelope>(
          `/reports/abc-analysis?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useListPageCommands({
    singular: "Abc Analysi",
    plural: "Abc Analysis",
    refresh: load,
  });

  const counts = data
    ? {
        A: data.rows.filter((r) => r.abcClass === "A").length,
        B: data.rows.filter((r) => r.abcClass === "B").length,
        C: data.rows.filter((r) => r.abcClass === "C").length,
      }
    : { A: 0, B: 0, C: 0 };

  const cols: Column<Row>[] = [
    {
      header: "Class",
      align: "center",
      width: "70px",
      cell: (r) => (
        <span
          className={
            r.abcClass === "A"
              ? "badge-green"
              : r.abcClass === "B"
                ? "badge-amber"
                : "badge-gray"
          }
        >
          {r.abcClass}
        </span>
      ),
    },
    {
      header: "Item",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.itemCode}</div>
        </div>
      ),
    },
    {
      header: "Qty sold",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.qty.toFixed(2)} {r.stockUom}
        </span>
      ),
    },
    {
      header: "Revenue",
      align: "right",
      cell: (r) => <span className="tabular-nums font-mono">{r.revenue.toFixed(2)}</span>,
    },
    {
      header: "Cumul %",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{r.cumulativePct.toFixed(2)}%</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Stock", href: "/stock" },
          { label: "ABC Analysis" },
        ]}
        title="ABC Analysis"
        subtitle="Items ranked by sales revenue in the period. A = top 80% of revenue (usually 20% of items) — the ones that most deserve tight stock + replenishment attention."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      )}

      <Card className="p-3 flex items-end gap-3 flex-wrap">
        <div>
          <FormField label="From">
            <input
              type="date"
              className="input"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </FormField>
        </div>
        <div>
          <FormField label="To">
            <input
              type="date"
              className="input"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </FormField>
        </div>
        <Button variant="primary" onClick={load} type="button">
          Refresh
        </Button>
        {data && (
          <div className="ms-auto flex gap-2 items-center text-sm">
            <span className="badge-green">A: {counts.A}</span>
            <span className="badge-amber">B: {counts.B}</span>
            <span className="badge-gray">C: {counts.C}</span>
            <span className="text-ink-muted ms-2">
              Total revenue:{" "}
              <b className="tabular-nums text-ink">{data.totalRevenue.toFixed(2)}</b>
            </span>
          </div>
        )}
      </Card>

      <DataTable<Row>
        columns={cols}
        rows={data?.rows ?? []}
        rowKey={(r) => r.itemCode}
        loading={loading}
        empty={{ title: "No sales in period" }}
      />
    </main>
  );
}
