"use client";

import { useEffect, useState } from "react";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
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

interface SEItem {
  id: string;
  qty: string;
  basicRate: string;
  item: { itemCode: string; itemName: string; stockUom: string };
  sourceWarehouse: { warehouseName: string } | null;
  targetWarehouse: { warehouseName: string } | null;
}
interface StockEntry {
  id: string;
  name: string;
  entryType: string;
  postingDate: string;
  status: string;
  remarks: string | null;
  inTransitWarehouseId: string | null;
  inTransitWarehouse: { warehouseName: string } | null;
  receivedAt: string | null;
  items: SEItem[];
}
interface SLEntry {
  id: string;
  actualQty: string;
  qtyAfterTransaction: string;
  incomingRate: string;
  valuationRate: string;
  stockValue: string;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string };
}
interface Payload {
  stockEntry: StockEntry;
  slEntries: SLEntry[];
}

export default function StockEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/stock-entries/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/stock-entries/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this stock entry? SLE will be reversed and Bins rebuilt."))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/stock-entries/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }
  async function receive() {
    if (!confirm("Mark as received? Stock moves from the in-transit warehouse to the target."))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/stock-entries/${params.id}/receive`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receive failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Stock Entries", href: "/stock/stock-entries" }]}
          title="Stock Entry"
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
          breadcrumb={[{ label: "Stock Entries", href: "/stock/stock-entries" }]}
          title="Loading…"
        />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  const se = data.stockEntry;

  const itemCols: Column<SEItem>[] = [
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
      header: "From",
      cell: (it) => (
        <span className="text-sm">{it.sourceWarehouse?.warehouseName ?? "—"}</span>
      ),
    },
    {
      header: "To",
      cell: (it) => (
        <span className="text-sm">{it.targetWarehouse?.warehouseName ?? "—"}</span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">
          {Number(it.qty)} {it.item.stockUom}
        </span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">
          {Number(it.basicRate) > 0 ? Number(it.basicRate).toFixed(2) : "—"}
        </span>
      ),
    },
  ];

  const sleCols: Column<SLEntry>[] = [
    {
      header: "Item",
      cell: (s) => (
        <div>
          <span className="font-mono text-sm">{s.item.itemCode}</span>{" "}
          <span className="text-ink-muted text-sm">— {s.item.itemName}</span>
        </div>
      ),
    },
    { header: "Warehouse", cell: (s) => s.warehouse.warehouseName },
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
      header: "Balance after",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono">
          {Number(s.qtyAfterTransaction).toFixed(4)}
        </span>
      ),
    },
    {
      header: "Rate (avg)",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums">{Number(s.valuationRate).toFixed(4)}</span>
      ),
    },
    {
      header: "Stock value",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono">
          {Number(s.stockValue).toFixed(2)}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Stock Entries", href: "/stock/stock-entries" },
          { label: se.name },
        ]}
        title={se.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={se.status} />
            <span>
              {dateShort(se.postingDate)} · {se.entryType}
            </span>
            {se.inTransitWarehouse ? (
              <span className="text-ink-muted text-sm">
                via {se.inTransitWarehouse.warehouseName}
                {se.receivedAt ? ` · received ${dateShort(se.receivedAt)}` : ""}
              </span>
            ) : null}
          </span>
        }
        actions={
          <div className="print:hidden flex items-center gap-2">
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {se.status === "Draft" && (
              <>
                <a href={`/stock/stock-entries/new?editId=${se.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button variant="primary" onClick={submit} disabled={busy} type="button">
                  Submit
                </Button>
              </>
            )}
            {se.status === "In Transit" && (
              <Button variant="primary" onClick={receive} disabled={busy} type="button">
                Mark received
              </Button>
            )}
            {se.status !== "Cancelled" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                downloadPdf(`/print/stock-entries/${se.id}`, `${se.name}.pdf`).catch(
                  (e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"),
                )
              }
            >
              PDF
            </Button>
            <Button variant="secondary" onClick={() => window.print()} type="button">
              Print
            </Button>
          </div>
        }
      />

      <div className="print:hidden">
        <WorkflowActions doctype="StockEntry" docId={se.id} onChange={load} />
      </div>

      <section>
        <SectionHeader title="Line items" />
        {/* Desktop: dense table; Mobile: tap-friendly stacked cards.  */}
        <div className="hidden md:block">
          <DataTable<SEItem>
            columns={itemCols}
            rows={se.items}
            rowKey={(it) => it.id}
            empty={{ title: "No line items" }}
          />
        </div>
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {se.items.length === 0 && (
            <li className="p-4 text-sm text-ink-muted">No line items</li>
          )}
          {se.items.map((it) => (
            <li key={it.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">
                    {it.item.itemCode}
                  </div>
                </div>
                <div className="text-end">
                  <div className="font-mono text-ink">
                    {Number(it.qty).toFixed(2)}{" "}
                    <span className="text-ink-muted">{it.item.stockUom}</span>
                  </div>
                  <div className="text-[11px] text-ink-muted">
                    @ {Number(it.basicRate).toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="mt-1 text-xs text-ink-muted truncate">
                {it.sourceWarehouse?.warehouseName && (
                  <>From <span className="text-ink">{it.sourceWarehouse.warehouseName}</span></>
                )}
                {it.sourceWarehouse && it.targetWarehouse && " · "}
                {it.targetWarehouse?.warehouseName && (
                  <>To <span className="text-ink">{it.targetWarehouse.warehouseName}</span></>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="print:hidden">
        <SectionHeader
          title={`Stock movements (${data.slEntries.length} SLE row${
            data.slEntries.length !== 1 ? "s" : ""
          })`}
        />
        <DataTable<SLEntry>
          columns={sleCols}
          rows={data.slEntries}
          rowKey={(s) => s.id}
          empty={{ title: "Not posted yet" }}
        />
        <p className="text-xs text-ink-muted mt-2">
          Note: Stock Entries don&apos;t post to GL; only Delivery Notes and Purchase
          Receipts do perpetual-inventory accounting.
        </p>
      </section>

      {se.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm text-ink whitespace-pre-wrap">{se.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="StockEntry" docId={se.id} />
        <CommentsPanel
          doctype="StockEntry"
          docId={se.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
