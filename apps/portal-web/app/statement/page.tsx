"use client";

import { useEffect, useMemo, useState } from "react";
import { accApi, loadSession } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FilterBar,
  PageHeader,
  Skeleton,
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface Row {
  date: string;
  ref: string;
  kind: string;
  debit: number;
  credit: number;
  balance: number;
}

export default function StatementPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [closing, setClosing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      window.location.href = "/login";
      return;
    }
    (async () => {
      try {
        const r = await accApi.get<{ rows: Row[]; closingBalance: number }>(
          "/portal/statement",
        );
        setRows(r.rows);
        setClosing(r.closingBalance);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.ref.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of filtered) {
      debit += r.debit;
      credit += r.credit;
    }
    return { debit, credit };
  }, [filtered]);

  const columns: Column<Row & { _idx: number }>[] = [
    { header: "Date", cell: (r) => dateShort(r.date) },
    { header: "Kind", cell: (r) => r.kind },
    {
      header: "Reference",
      cell: (r) => <span className="font-mono text-xs">{r.ref}</span>,
    },
    {
      header: "Debit",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">
          {r.debit ? money(r.debit) : ""}
        </span>
      ),
    },
    {
      header: "Credit",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">
          {r.credit ? money(r.credit) : ""}
        </span>
      ),
    },
    {
      header: "Balance",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium text-ink">
          {money(r.balance)}
        </span>
      ),
    },
  ];

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Home", href: "/" }, { label: "Statement" }]}
          title="Account statement"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">
          {error}
        </Card>
      </main>
    );
  }

  if (rows === null) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Home", href: "/" }, { label: "Statement" }]}
          title="Loading…"
        />
        <Skeleton className="h-12 w-full" rounded="rounded-lg" />
        <Skeleton className="h-64 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  const withIdx = filtered.map((r, i) => ({ ...r, _idx: i }));

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Statement" }]}
        title="Account statement"
        subtitle="Ledger of invoices, payments, and adjustments on your account."
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => history.back()}
          >
            ← Back
          </Button>
        }
      />

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Total debits
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {money(totals.debit)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Total credits
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {money(totals.credit)}
          </div>
        </Card>
        <Card
          className={`p-4 ${closing > 0 ? "border-amber-200 bg-amber-50" : ""}`}
        >
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Closing balance
          </div>
          <div
            className={`font-semibold text-2xl mt-1 tabular-nums ${
              closing > 0 ? "text-amber-800" : "text-ink"
            }`}
          >
            {money(closing)}
          </div>
          {closing > 0 && (
            <div className="text-xs text-amber-700 mt-1">Amount you owe</div>
          )}
        </Card>
      </section>

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search reference or kind…",
        }}
      />

      <DataTable
        columns={columns}
        rows={withIdx}
        rowKey={(r) => `${r._idx}-${r.ref}`}
        empty={{
          title: "No transactions",
          description: "Your account ledger will appear here.",
        }}
      />
    </main>
  );
}
