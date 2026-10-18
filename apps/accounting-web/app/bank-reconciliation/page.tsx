"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface StatementSummary {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string;
  fromDate: string;
  toDate: string;
  openingBalance: string;
  closingBalance: string;
  importedAt: string;
  transactionCount: number;
  matchedCount: number;
  reconciled: boolean;
}

export default function BankReconciliationListPage() {
  const [rows, setRows] = useState<StatementSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<StatementSummary[]>("/bank-reconciliation/statements"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Bank Reconciliation",
    plural: "Bank Reconciliation",
    refresh: load,
  });

  async function del(id: string) {
    if (!confirm("Delete this statement and all its transactions?")) return;
    try {
      await api.del(`/bank-reconciliation/statements/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const cols: Column<StatementSummary>[] = [
    { header: "Account", cell: (s) => <span className="font-medium">{s.accountName}</span> },
    {
      header: "Period",
      cell: (s) => (
        <span className="text-xs">
          {dateShort(s.fromDate)} → {dateShort(s.toDate)}
        </span>
      ),
    },
    { header: "File", cell: (s) => <span className="text-xs text-ink-muted">{s.fileName}</span> },
    {
      header: "Opening",
      align: "right",
      cell: (s) => <span className="font-mono tabular-nums">{money(Number(s.openingBalance))}</span>,
    },
    {
      header: "Closing",
      align: "right",
      cell: (s) => <span className="font-mono tabular-nums">{money(Number(s.closingBalance))}</span>,
    },
    {
      header: "Progress",
      cell: (s) => (
        <span className="text-xs">
          {s.matchedCount} / {s.transactionCount}
          {s.reconciled && <span className="ms-2 badge-green">Reconciled</span>}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <span className="space-x-2 text-xs">
          <a
            href={`/accounting/bank-reconciliation/${s.id}`}
            className="text-brand-600 hover:underline"
          >
            Reconcile →
          </a>
          <button
            onClick={() => del(s.id)}
            className="text-red-600 hover:underline"
          >
            Delete
          </button>
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Bank Reconciliation" },
        ]}
        title="Bank reconciliation"
        subtitle="Import your bank statement CSV, then match each line against posted GL entries. Auto-match handles obvious 1-to-1 matches; the rest you resolve manually."
        actions={
          <a href="/accounting/bank-reconciliation/import">
            <Button variant="primary" type="button">+ Import statement</Button>
          </a>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <DataTable<StatementSummary>
        columns={cols}
        rows={rows}
        rowKey={(s) => s.id}
        empty={{ title: "No statements imported yet" }}
      />
    </main>
  );
}
