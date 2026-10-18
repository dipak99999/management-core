"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
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
  type Column,
} from "../../../components/ui";

interface BOMChild {
  id: string;
  qty: string;
  uom: string;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface WOOperation {
  id: string;
  operationName: string;
  timeInMins: string;
  hourRate: string;
  completedQty: string;
  actualTimeMins: string;
  status: string;
  workstation: { id: string; name: string };
}
interface WorkOrder {
  id: string;
  name: string;
  status: string;
  qty: string;
  producedQty: string;
  createdAt: string;
  remarks: string | null;
  bom: {
    id: string;
    name: string;
    qty: string;
    uom: string;
    items: BOMChild[];
  };
  productionItem: { itemCode: string; itemName: string; stockUom: string };
  sourceWarehouse: { warehouseName: string };
  targetWarehouse: { warehouseName: string };
  operations?: WOOperation[];
}
interface SLEntry {
  id: string;
  createdAt: string;
  actualQty: string;
  qtyAfterTransaction: string;
  incomingRate: string;
  valuationRate: string;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string };
}
interface Payload {
  workOrder: WorkOrder;
  slEntries: SLEntry[];
}

// Group SLEs into "manufacture runs" — each POST /:id/manufacture posts a
// burst of SLEs within milliseconds. Cluster rows that share the same second.
function groupBatches(entries: SLEntry[]): { at: Date; rows: SLEntry[] }[] {
  const groups: { at: Date; rows: SLEntry[] }[] = [];
  for (const e of entries) {
    const at = new Date(e.createdAt);
    const last = groups[groups.length - 1];
    if (last && Math.abs(at.getTime() - last.at.getTime()) < 2000) {
      last.rows.push(e);
    } else {
      groups.push({ at, rows: [e] });
    }
  }
  return groups;
}

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/work-orders/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function manufacture() {
    if (!data) return;
    const remaining = Number(data.workOrder.qty) - Number(data.workOrder.producedQty);
    const input = prompt(`Qty to manufacture (remaining: ${remaining}):`, String(remaining));
    if (!input) return;
    const qty = Number(input);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/work-orders/${params.id}/manufacture`, { qtyToManufacture: qty });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Manufacture failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancelWO(reverse: boolean) {
    if (
      !confirm(
        reverse
          ? "Cancel + reverse all manufacturing SLEs?"
          : "Cancel Work Order (leaves stock movements in place)?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/work-orders/${params.id}/${reverse ? "cancel-and-reverse" : "cancel"}`,
        {},
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  const batches = useMemo(() => (data ? groupBatches(data.slEntries) : []), [data]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Work Orders", href: "/stock/work-orders" }]}
          title="Work Order"
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
          breadcrumb={[{ label: "Work Orders", href: "/stock/work-orders" }]}
          title="Loading…"
        />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  const wo = data.workOrder;
  const producedPct =
    Number(wo.qty) > 0 ? (Number(wo.producedQty) / Number(wo.qty)) * 100 : 0;
  const remaining = Number(wo.qty) - Number(wo.producedQty);
  const canManufacture =
    wo.status !== "Cancelled" && wo.status !== "Completed" && remaining > 0;

  const bomCols: Column<BOMChild>[] = [
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
      header: `Qty per ${Number(wo.bom.qty)} FG`,
      align: "right",
      cell: (b) => <span className="tabular-nums">{Number(b.qty)}</span>,
    },
    { header: "UOM", cell: (b) => b.uom },
  ];

  const opCols: Column<WOOperation>[] = [
    { header: "Operation", cell: (op) => op.operationName },
    {
      header: "Workstation",
      cell: (op) => <span className="text-xs">{op.workstation.name}</span>,
    },
    {
      header: "Planned (min)",
      align: "right",
      cell: (op) => (
        <span className="tabular-nums font-mono">
          {Number(op.timeInMins).toFixed(2)}
        </span>
      ),
    },
    {
      header: "Hour rate",
      align: "right",
      cell: (op) => (
        <span className="tabular-nums font-mono">
          {Number(op.hourRate).toFixed(2)}
        </span>
      ),
    },
    {
      header: "Completed qty",
      align: "right",
      cell: (op) => (
        <span className="tabular-nums font-mono">
          {Number(op.completedQty).toFixed(2)} / {Number(wo.qty)}
        </span>
      ),
    },
    {
      header: "Actual (min)",
      align: "right",
      cell: (op) => {
        const overrun = Number(op.actualTimeMins) > Number(op.timeInMins);
        return (
          <span
            className={`tabular-nums font-mono ${overrun ? "text-red-700" : ""}`}
          >
            {Number(op.actualTimeMins).toFixed(2)}
          </span>
        );
      },
    },
    {
      header: "Status",
      cell: (op) => <StatusBadge status={op.status} />,
    },
  ];

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Work Orders", href: "/stock/work-orders" },
          { label: wo.name },
        ]}
        title={wo.name}
        subtitle={
          <span className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={wo.status} />
            <span>
              Producing{" "}
              <b>
                {wo.productionItem.itemCode} — {wo.productionItem.itemName}
              </b>
            </span>
            <span>
              via{" "}
              <a
                href={`/stock/boms/${wo.bom.id}`}
                className="font-mono text-brand-600 hover:underline"
              >
                {wo.bom.name}
              </a>
            </span>
          </span>
        }
        actions={
          <div className="print:hidden flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {wo.status === "Not Started" && Number(wo.producedQty) === 0 && (
              <a href={`/stock/work-orders/new?editId=${wo.id}`}>
                <Button variant="secondary" type="button">Edit</Button>
              </a>
            )}
            {canManufacture && (
              <Button
                variant="primary"
                onClick={manufacture}
                disabled={busy}
                type="button"
              >
                Manufacture
              </Button>
            )}
            {wo.status !== "Cancelled" && (
              <>
                <Button
                  variant="danger"
                  onClick={() => cancelWO(false)}
                  disabled={busy}
                  type="button"
                >
                  Cancel
                </Button>
                {Number(wo.producedQty) > 0 && (
                  <Button
                    variant="danger"
                    onClick={() => cancelWO(true)}
                    disabled={busy}
                    type="button"
                    title="Also reverse all manufacturing SLEs"
                  >
                    Cancel + Reverse
                  </Button>
                )}
              </>
            )}
            <Button variant="secondary" onClick={() => window.print()} type="button">
              Print
            </Button>
          </div>
        }
      />

      <div className="print:hidden">
        <WorkflowActions doctype="WorkOrder" docId={wo.id} onChange={load} />
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-ink-muted">Production progress</div>
          <div className="text-sm text-ink">
            <b className="tabular-nums">{Number(wo.producedQty)}</b> /{" "}
            <span className="tabular-nums">{Number(wo.qty)}</span> {wo.productionItem.stockUom}
          </div>
        </div>
        <div className="w-full bg-surface-sunken rounded h-3 overflow-hidden">
          <div
            className={`h-full transition-all ${
              producedPct >= 100 ? "bg-green-500" : "bg-brand-500"
            }`}
            style={{ width: `${Math.min(100, producedPct)}%` }}
          />
        </div>
        <div className="text-xs text-ink-muted">
          {producedPct.toFixed(0)}% complete
          {remaining > 0 && ` · ${remaining} remaining`}
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Raw materials from
          </div>
          <div className="font-semibold text-ink mt-1">{wo.sourceWarehouse.warehouseName}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Finished goods to
          </div>
          <div className="font-semibold text-ink mt-1">{wo.targetWarehouse.warehouseName}</div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Recipe per BOM run" />
        <div className="hidden md:block">
          <DataTable<BOMChild>
            columns={bomCols}
            rows={wo.bom.items}
            rowKey={(b) => b.id}
            empty={{ title: "No components" }}
          />
        </div>
        {wo.bom.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No components
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {wo.bom.items.map((b) => (
              <li key={b.id} className="px-4 py-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{b.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{b.item.itemCode}</div>
                </div>
                <div className="font-mono text-ink tabular-nums text-end">
                  {Number(b.qty).toFixed(2)} {b.uom}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {wo.operations && wo.operations.length > 0 && (
        <section>
          <SectionHeader
            title="Operations (snapshotted from BOM, scaled to WO qty)"
            actions={
              <a
                href={`/stock/job-cards?workOrderId=${wo.id}`}
                className="text-sm text-brand-600 hover:underline"
              >
                Manage job cards →
              </a>
            }
          />
          <div className="hidden md:block">
            <DataTable<WOOperation>
              columns={opCols}
              rows={wo.operations}
              rowKey={(op) => op.id}
              empty={{ title: "No operations" }}
            />
          </div>
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {wo.operations.map((op) => (
              <li key={op.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{op.operationName}</div>
                    <div className="text-xs text-ink-muted truncate">{op.workstation.name}</div>
                  </div>
                  <span className="text-xs text-ink-muted rounded bg-surface-sunken px-2 py-0.5">
                    {op.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-ink-muted tabular-nums">
                  {Number(op.actualTimeMins).toFixed(0)}/{Number(op.timeInMins).toFixed(0)} min
                  {" · "}
                  {Number(op.completedQty).toFixed(2)} completed
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="print:hidden">
        <SectionHeader
          title={`Manufacturing runs (${batches.length} batch${
            batches.length !== 1 ? "es" : ""
          })`}
        />
        {batches.length === 0 && (
          <Card className="p-6 text-center text-ink-muted text-sm">
            No manufacturing runs yet. Click <b>Manufacture</b> to consume raw materials
            and produce finished goods.
          </Card>
        )}
        <div className="space-y-3">
          {batches.map((batch, idx) => {
            const consumed = batch.rows.filter((r) => Number(r.actualQty) < 0);
            const produced = batch.rows.filter((r) => Number(r.actualQty) > 0);
            const totalConsumedValue = consumed.reduce(
              (s, r) => s + Math.abs(Number(r.actualQty)) * Number(r.valuationRate),
              0,
            );
            const totalProducedQty = produced.reduce(
              (s, r) => s + Number(r.actualQty),
              0,
            );
            return (
              <Card key={idx} className="overflow-hidden">
                <div className="bg-surface-sunken px-4 py-2 flex items-baseline justify-between border-b border-ink-muted/10">
                  <div>
                    <b className="text-ink">Batch {idx + 1}</b>
                    <span className="text-sm text-ink-muted ms-2">
                      {batch.at.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-ink-muted tabular-nums">
                    +{totalProducedQty} FG at cost {totalConsumedValue.toFixed(2)}
                    {totalProducedQty > 0 &&
                      ` (rate ${(totalConsumedValue / totalProducedQty).toFixed(4)})`}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-ink-muted text-start">
                    <tr>
                      <th className="px-4 py-1"></th>
                      <th className="px-4 py-1">Item</th>
                      <th className="px-4 py-1">Warehouse</th>
                      <th className="px-4 py-1 text-end">Qty change</th>
                      <th className="px-4 py-1 text-end">Rate</th>
                      <th className="px-4 py-1 text-end">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumed.map((r) => (
                      <tr key={r.id} className="border-t border-ink-muted/10">
                        <td className="px-4 py-1 text-xs text-red-700">consumed</td>
                        <td className="px-4 py-1 font-mono text-xs">
                          {r.item.itemCode}
                        </td>
                        <td className="px-4 py-1 text-xs">{r.warehouse.warehouseName}</td>
                        <td className="px-4 py-1 text-end font-mono text-red-700 tabular-nums">
                          {Number(r.actualQty).toFixed(4)}
                        </td>
                        <td className="px-4 py-1 text-end tabular-nums">
                          {Number(r.valuationRate).toFixed(4)}
                        </td>
                        <td className="px-4 py-1 text-end font-mono tabular-nums">
                          {(
                            Math.abs(Number(r.actualQty)) * Number(r.valuationRate)
                          ).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {produced.map((r) => (
                      <tr key={r.id} className="border-t border-ink-muted/10 bg-green-50">
                        <td className="px-4 py-1 text-xs text-green-700">produced</td>
                        <td className="px-4 py-1 font-mono text-xs">
                          {r.item.itemCode}
                        </td>
                        <td className="px-4 py-1 text-xs">{r.warehouse.warehouseName}</td>
                        <td className="px-4 py-1 text-end font-mono text-green-700 tabular-nums">
                          +{Number(r.actualQty).toFixed(4)}
                        </td>
                        <td className="px-4 py-1 text-end tabular-nums">
                          {Number(r.incomingRate).toFixed(4)}
                        </td>
                        <td className="px-4 py-1 text-end font-mono tabular-nums">
                          {(Number(r.actualQty) * Number(r.incomingRate)).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      </section>

      {wo.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm text-ink whitespace-pre-wrap">{wo.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="WorkOrder" docId={wo.id} />
        <CommentsPanel
          doctype="WorkOrder"
          docId={wo.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
