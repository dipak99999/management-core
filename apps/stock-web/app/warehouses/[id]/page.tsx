"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Warehouse {
  id: string;
  warehouseName: string;
  isGroup: boolean;
  disabled: boolean;
  parent: { id: string; warehouseName: string } | null;
  children: { id: string; warehouseName: string }[];
}
interface Bin {
  id: string;
  actualQty: string;
  valuationRate: string;
  stockValue: string;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface SLE {
  id: string;
  postingDate: string;
  actualQty: string;
  qtyAfterTransaction: string;
  valuationRate: string;
  voucherType: string;
  voucherName: string | null;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface Payload {
  warehouse: Warehouse;
  stats: { totalStockValue: number; distinctItems: number };
  bins: Bin[];
  recentSLE: SLE[];
}

export default function WarehouseDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Payload>(`/warehouses/${params.id}/full`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [params.id]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Warehouses", href: "/stock/warehouses" }]}
          title="Warehouse"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Warehouses", href: "/stock/warehouses" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  const w = data.warehouse;

  const binCols: Column<Bin>[] = [
    {
      header: "Item",
      cell: (b) => (
        <div>
          <span className="font-mono text-sm">{b.item.itemCode}</span>{" "}
          <span className="text-ink-muted text-sm">— {b.item.itemName}</span>
        </div>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums">
          {Number(b.actualQty).toFixed(4)} {b.item.stockUom}
        </span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums">{Number(b.valuationRate).toFixed(4)}</span>
      ),
    },
    {
      header: "Value",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums font-mono">
          {Number(b.stockValue).toFixed(2)}
        </span>
      ),
    },
  ];

  const sleCols: Column<SLE>[] = [
    { header: "Date", cell: (s) => dateShort(s.postingDate) },
    {
      header: "Item",
      cell: (s) => (
        <div>
          <span className="font-mono text-xs">{s.item.itemCode}</span>{" "}
          <span className="text-ink-muted text-xs">— {s.item.itemName}</span>
        </div>
      ),
    },
    {
      header: "Voucher",
      cell: (s) => (
        <div>
          <div className="text-xs text-ink-muted">{s.voucherType}</div>
          <span className="font-mono text-xs">
            {s.voucherName ?? s.id.slice(0, 8)}
          </span>
        </div>
      ),
    },
    {
      header: "Qty change",
      align: "right",
      cell: (s) => {
        const qty = Number(s.actualQty);
        return (
          <span
            className={`tabular-nums font-mono ${qty > 0 ? "text-green-700" : "text-red-700"}`}
          >
            {qty > 0 ? "+" : ""}
            {qty.toFixed(4)}
          </span>
        );
      },
    },
    {
      header: "Balance",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono">
          {Number(s.qtyAfterTransaction).toFixed(4)}
        </span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums">{Number(s.valuationRate).toFixed(4)}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Warehouses", href: "/stock/warehouses" },
          { label: w.warehouseName },
        ]}
        title={w.warehouseName}
        subtitle={
          <span className="flex items-center gap-2">
            {w.isGroup ? (
              <span className="badge-gray">Group</span>
            ) : (
              <span className="badge-green">Leaf</span>
            )}
            {w.disabled && <span className="badge-red">Disabled</span>}
            {w.parent && (
              <span className="text-ink-muted">
                under{" "}
                <a
                  href={`/stock/warehouses/${w.parent.id}`}
                  className="text-brand-600 hover:underline"
                >
                  {w.parent.warehouseName}
                </a>
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <a href={`/stock/warehouses?editId=${w.id}`}>
              <Button variant="primary" type="button">Edit</Button>
            </a>
          </>
        }
      />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Distinct items
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {data.stats.distinctItems}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Total stock value
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {money(data.stats.totalStockValue)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Child warehouses
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {w.children.length}
          </div>
          {w.children.length > 0 && (
            <div className="mt-1 text-xs text-ink-muted truncate">
              {w.children.map((c) => c.warehouseName).join(", ")}
            </div>
          )}
        </Card>
      </section>

      {w.children.length > 0 && (
        <section>
          <SectionHeader title="Child warehouses" />
          <div className="grid grid-cols-3 gap-2">
            {w.children.map((c) => (
              <a
                key={c.id}
                href={`/stock/warehouses/${c.id}`}
                className="block"
              >
                <Card className="p-3 hover:bg-brand-50 transition-colors">
                  <div className="font-semibold text-ink">{c.warehouseName}</div>
                </Card>
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeader title="Stock on hand" />
        <div className="hidden md:block">
          <DataTable<Bin>
            columns={binCols}
            rows={data.bins}
            rowKey={(b) => b.id}
            empty={{ title: "Nothing in stock here" }}
          />
        </div>
        {data.bins.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            Nothing in stock here
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.bins.map((b) => (
              <li key={b.id} className="px-4 py-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{b.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{b.item.itemCode}</div>
                </div>
                <div className="text-end">
                  <div className="font-mono text-ink tabular-nums">
                    {Number(b.actualQty).toFixed(2)} {b.item.stockUom}
                  </div>
                  <div className="text-xs text-ink-muted tabular-nums">{Number(b.stockValue).toFixed(2)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="Recent movements (latest 30)" />
        <div className="hidden md:block">
          <DataTable<SLE>
            columns={sleCols}
            rows={data.recentSLE}
            rowKey={(s) => s.id}
            empty={{ title: "No movements yet" }}
          />
        </div>
        {data.recentSLE.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No movements yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.recentSLE.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{s.item.itemName}</div>
                    <div className="text-xs text-ink-muted">
                      {dateShort(s.postingDate)} · {s.voucherType}
                      {s.voucherName && <span className="font-mono ms-1">{s.voucherName}</span>}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className={`font-mono tabular-nums ${Number(s.actualQty) < 0 ? "text-red-600" : "text-ink"}`}>
                      {Number(s.actualQty) > 0 ? "+" : ""}{Number(s.actualQty).toFixed(2)}
                    </div>
                    <div className="text-xs text-ink-muted tabular-nums">→ {Number(s.qtyAfterTransaction).toFixed(2)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Warehouse" docId={w.id} />
        <CommentsPanel
          doctype="Warehouse"
          docId={w.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
