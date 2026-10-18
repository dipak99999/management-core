"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
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

interface PPItem {
  id: string;
  plannedQty: string;
  producedQty: string;
  salesOrderItemId: string | null;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface PPRawMat {
  id: string;
  requiredQty: string;
  availableQty: string;
  shortfallQty: string;
  item: { itemCode: string; itemName: string; stockUom: string };
}
interface PP {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  remarks: string | null;
  items: PPItem[];
  rawMaterials: PPRawMat[];
}

export default function ProductionPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const [pp, setPP] = useState<PP | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setPP(await api.get<PP>(`/production-plans/${params.id}`));
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
    try {
      await api.post(`/production-plans/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this plan?")) return;
    setBusy(true);
    try {
      await api.post(`/production-plans/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Production Plans", href: "/stock/production-plans" },
          ]}
          title="Production Plan"
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
  if (!pp) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Production Plans", href: "/stock/production-plans" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  const totalShortfall = pp.rawMaterials.reduce(
    (s, r) => s + Number(r.shortfallQty),
    0,
  );

  const itemCols: Column<PPItem>[] = [
    {
      header: "Item",
      cell: (it) => (
        <div>
          <div className="font-medium text-ink">{it.item.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{it.item.itemCode}</div>
        </div>
      ),
    },
    {
      header: "Planned qty",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">
          {Number(it.plannedQty).toFixed(2)} {it.item.stockUom}
        </span>
      ),
    },
    {
      header: "Produced qty",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">{Number(it.producedQty).toFixed(2)}</span>
      ),
    },
    {
      header: "SO link",
      cell: (it) => (
        <span className="text-xs text-ink-muted font-mono">
          {it.salesOrderItemId ? "linked" : "—"}
        </span>
      ),
    },
  ];

  const rmCols: Column<PPRawMat>[] = [
    {
      header: "Item",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.item.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.item.itemCode}</div>
        </div>
      ),
    },
    {
      header: "Required",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {Number(r.requiredQty).toFixed(2)} {r.item.stockUom}
        </span>
      ),
    },
    {
      header: "Available",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{Number(r.availableQty).toFixed(2)}</span>
      ),
    },
    {
      header: "Shortfall",
      align: "right",
      cell: (r) => (
        <span
          className={`tabular-nums ${
            Number(r.shortfallQty) > 0 ? "text-red-700 font-medium" : "text-ink-muted"
          }`}
        >
          {Number(r.shortfallQty).toFixed(2)}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Production Plans", href: "/stock/production-plans" },
          { label: pp.name },
        ]}
        title={pp.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={pp.status} />
            <span>{dateShort(pp.postingDate)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {pp.status === "Draft" && (
              <>
                <a href={`/stock/production-plans/new?editId=${pp.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button variant="primary" onClick={submit} disabled={busy} type="button">
                  Submit
                </Button>
              </>
            )}
            {pp.status !== "Cancelled" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
          </>
        }
      />

      <section>
        <SectionHeader title="Items to produce" />
        <div className="hidden md:block">
          <DataTable<PPItem>
            columns={itemCols}
            rows={pp.items}
            rowKey={(it) => it.id}
            empty={{ title: "No items planned" }}
          />
        </div>
        {pp.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No items planned
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {pp.items.map((it) => (
              <li key={it.id} className="px-4 py-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                </div>
                <div className="font-mono text-ink tabular-nums text-end">
                  {Number(it.producedQty).toFixed(2)}/{Number(it.plannedQty).toFixed(2)} {it.item.stockUom}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="Raw materials (from default BOMs · shortfall at snapshot time)" />
        {totalShortfall > 0.0001 && (
          <div className="text-sm bg-amber-50 border border-amber-200 rounded p-2 text-amber-800 mb-2">
            Total shortfall: <b className="tabular-nums">{totalShortfall.toFixed(2)}</b> units — create
            Purchase Orders or Material Requests to cover.
          </div>
        )}
        <div className="hidden md:block">
          <DataTable<PPRawMat>
            columns={rmCols}
            rows={pp.rawMaterials}
            rowKey={(r) => r.id}
            empty={{
              title: "No raw materials",
              description: "Add FG items with default BOMs to roll up requirements.",
            }}
          />
        </div>
        {pp.rawMaterials.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No raw materials
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {pp.rawMaterials.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{r.item.itemName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{r.item.itemCode}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">
                      {Number(r.availableQty).toFixed(2)}/{Number(r.requiredQty).toFixed(2)} {r.item.stockUom}
                    </div>
                    {Number(r.shortfallQty) > 0.0001 && (
                      <div className="text-xs text-amber-700 tabular-nums">
                        Short {Number(r.shortfallQty).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pp.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm text-ink whitespace-pre-wrap">{pp.remarks}</div>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="ProductionPlan" docId={params.id} />
      </div>
</main>
  );
}
