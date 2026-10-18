"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { accApi, loadSession } from "../../lib/api";
import {
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface DsrResponse {
  date: string;
  totalBilled: number;
  totalCollected: number;
  invoiceCount: number;
  paymentCount: number;
  collections: { modeOfPayment: string; amount: number }[];
  topItems: {
    itemCode: string;
    itemName: string;
    qty: number;
    amount: number;
  }[];
  invoices: {
    id: string;
    name: string;
    grandTotal: number;
    currency: string;
    status: string;
  }[];
}

type Row = DsrResponse["invoices"][number];
type Item = DsrResponse["topItems"][number];

export default function DsrPage() {
  const [date, setDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [dsr, setDsr] = useState<DsrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      window.location.href = "/login";
      return;
    }
    if (s.user.partyType !== "Customer") {
      setError("Daily Sales Report is customer-only");
      return;
    }
  }, []);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      setDsr(await accApi.get<DsrResponse>(`/portal/reports/dsr?date=${date}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useListPageCommands({
    singular: "Dsr",
    plural: "Dsr",
    refresh: load,
  });

  const invoiceCols: Column<Row>[] = [
    {
      header: "Invoice",
      cell: (i) => <span className="font-mono text-sm text-ink">{i.name}</span>,
    },
    {
      header: "Amount",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums">
          {money(Number(i.grandTotal), i.currency)}
        </span>
      ),
    },
    { header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
  ];

  const itemCols: Column<Item>[] = [
    {
      header: "Item",
      cell: (it) => (
        <>
          <span className="font-mono text-xs text-ink-muted">
            {it.itemCode}
          </span>{" "}
          <span className="text-ink">{it.itemName}</span>
        </>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (it) => <span className="tabular-nums">{it.qty}</span>,
    },
    {
      header: "Amount",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">{money(Number(it.amount))}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Daily sales report" },
        ]}
        title="Daily sales report"
        subtitle={`Sales snapshot for ${dateShort(date)}`}
        actions={
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input max-w-[10rem]"
          />
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">
          {error}
        </Card>
      )}

      {!dsr && !error && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" rounded="rounded-lg" />
          ))}
        </div>
      )}

      {dsr && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Billed
              </div>
              <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
                {money(dsr.totalBilled)}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {dsr.invoiceCount} invoice{dsr.invoiceCount === 1 ? "" : "s"}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Collected
              </div>
              <div className="font-semibold text-2xl text-green-700 mt-1 tabular-nums">
                {money(dsr.totalCollected)}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {dsr.paymentCount} payment
                {dsr.paymentCount === 1 ? "" : "s"}
              </div>
            </Card>
            <Card className="p-4 md:col-span-2">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
                Collections by mode
              </div>
              {dsr.collections.length === 0 ? (
                <div className="text-xs text-ink-muted">
                  No collections today
                </div>
              ) : (
                <ul className="text-sm space-y-1.5">
                  {dsr.collections.map((c) => (
                    <li
                      key={c.modeOfPayment}
                      className="flex justify-between items-center"
                    >
                      <span className="text-ink-soft">{c.modeOfPayment}</span>
                      <span className="font-medium tabular-nums text-ink">
                        {money(c.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section>
            <SectionHeader title="Invoices today" />
            <DataTable<Row>
              columns={invoiceCols}
              rows={dsr.invoices}
              rowKey={(i) => i.id}
              empty={{ title: "No invoices today" }}
              loading={loading}
            />
          </section>

          <section>
            <SectionHeader title="Top items today" />
            <DataTable<Item>
              columns={itemCols}
              rows={dsr.topItems}
              rowKey={(it) => it.itemCode}
              empty={{ title: "No sales activity today" }}
              loading={loading}
            />
          </section>
        </>
      )}
    </main>
  );
}
