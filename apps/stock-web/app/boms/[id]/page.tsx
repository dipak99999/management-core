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
  StatusBadge,
  dateShort,
  type Column,
} from "../../../components/ui";

interface BOMItem {
  id: string;
  qty: string;
  uom: string;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface BOM {
  id: string;
  name: string;
  qty: string;
  uom: string;
  isActive: boolean;
  isDefault: boolean;
  productionItem: { id: string; itemCode: string; itemName: string; stockUom: string };
  items: BOMItem[];
}
interface WORow {
  id: string;
  name: string;
  status: string;
  qty: string;
  producedQty: string;
  createdAt: string;
}
interface Payload {
  bom: BOM;
  workOrders: WORow[];
}

export default function BOMDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Payload>(`/boms/${params.id}/full`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [params.id]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "BOMs", href: "/stock/boms" }]}
          title="BOM"
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
          breadcrumb={[{ label: "BOMs", href: "/stock/boms" }]}
          title="Loading…"
        />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  const bom = data.bom;
  const runsUsingThisBOM = data.workOrders.length;
  const producedFromThisBOM = data.workOrders.reduce(
    (s, w) => s + Number(w.producedQty),
    0,
  );

  const bomCols: Column<BOMItem>[] = [
    {
      header: "Item",
      cell: (it) => (
        <div>
          <div className="font-mono text-sm text-ink">{it.item.itemCode}</div>
          <div className="text-ink-muted text-sm">{it.item.itemName}</div>
        </div>
      ),
    },
    {
      header: "Qty per BOM",
      align: "right",
      cell: (it) => <span className="tabular-nums">{Number(it.qty)}</span>,
    },
    { header: "UOM", cell: (it) => it.uom },
  ];

  const woCols: Column<WORow>[] = [
    {
      header: "WO",
      cell: (w) => (
        <a
          href={`/stock/work-orders/${w.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {w.name}
        </a>
      ),
    },
    { header: "Created", cell: (w) => dateShort(w.createdAt) },
    {
      header: "Qty planned",
      align: "right",
      cell: (w) => <span className="tabular-nums">{Number(w.qty)}</span>,
    },
    {
      header: "Produced",
      align: "right",
      cell: (w) => <span className="tabular-nums">{Number(w.producedQty)}</span>,
    },
    { header: "Status", cell: (w) => <StatusBadge status={w.status} /> },
  ];

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "BOMs", href: "/stock/boms" },
          { label: bom.name },
        ]}
        title={bom.name}
        subtitle={
          <span className="flex items-center gap-2">
            {bom.isDefault && (
              <span className="badge-brand">Default</span>
            )}
            {bom.isActive ? (
              <span className="badge-green">Active</span>
            ) : (
              <span className="badge-gray">Inactive</span>
            )}
          </span>
        }
        actions={
          <div className="print:hidden flex items-center gap-2">
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => window.print()} type="button">
              Print
            </Button>
          </div>
        }
      />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Produces
          </div>
          <div className="font-mono text-sm mt-1">{bom.productionItem.itemCode}</div>
          <div className="text-ink">{bom.productionItem.itemName}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Yield per BOM
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {Number(bom.qty)} <span className="text-sm text-ink-muted">{bom.uom}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Ever produced
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {producedFromThisBOM.toFixed(2)}
          </div>
          <div className="text-xs text-ink-muted">
            across {runsUsingThisBOM} work order{runsUsingThisBOM !== 1 ? "s" : ""}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Raw materials" />
        <div className="hidden md:block">
          <DataTable<BOMItem>
            columns={bomCols}
            rows={bom.items}
            rowKey={(it) => it.id}
            empty={{ title: "No components" }}
          />
        </div>
        {bom.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No components
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {bom.items.map((it) => (
              <li key={it.id} className="px-4 py-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                </div>
                <div className="font-mono text-ink tabular-nums text-end">
                  {Number(it.qty).toFixed(2)} {it.uom}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="print:hidden">
        <SectionHeader title={`Work Orders using this BOM (${data.workOrders.length})`} />
        <div className="hidden md:block">
          <DataTable<WORow>
            columns={woCols}
            rows={data.workOrders}
            rowKey={(w) => w.id}
            empty={{ title: "Not used in any work order yet" }}
          />
        </div>
        {data.workOrders.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            Not used in any work order yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.workOrders.map((w) => (
              <li key={w.id}>
                <a href={`/stock/work-orders/${w.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{w.name}</div>
                      <div className="text-xs text-ink-muted">
                        {dateShort(w.createdAt)} · {w.status}
                      </div>
                    </div>
                    <div className="font-mono text-ink tabular-nums text-end">
                      {Number(w.producedQty).toFixed(2)}/{Number(w.qty).toFixed(2)}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="BOM" docId={bom.id} />
        <CommentsPanel
          doctype="BOM"
          docId={bom.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
