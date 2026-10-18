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

interface SRItem {
  id: string;
  currentQty: string;
  currentValuationRate: string;
  countedQty: string;
  countedValuationRate: string | null;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string };
}
interface SR {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  purpose: string;
  remarks: string | null;
  items: SRItem[];
}

export default function StockReconciliationDetailPage() {
  const params = useParams<{ id: string }>();
  const [sr, setSR] = useState<SR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setSR(await api.get<SR>(`/stock-reconciliations/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function doSubmit() {
    setBusy(true);
    try {
      await api.post(`/stock-reconciliations/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function doCancel() {
    if (!confirm("Cancel this SR? Any SLE + GL entries will be reversed.")) return;
    setBusy(true);
    try {
      await api.post(`/stock-reconciliations/${params.id}/cancel`, {});
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
            { label: "Stock Reconciliations", href: "/stock/stock-reconciliations" },
          ]}
          title="Stock Reconciliation"
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
  if (!sr) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Stock Reconciliations", href: "/stock/stock-reconciliations" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  let netDelta = 0;
  for (const it of sr.items) {
    const cur = Number(it.currentQty) * Number(it.currentValuationRate);
    const rate =
      it.countedValuationRate != null
        ? Number(it.countedValuationRate)
        : Number(it.currentValuationRate);
    const counted = Number(it.countedQty) * rate;
    netDelta += counted - cur;
  }

  const itemCols: Column<SRItem>[] = [
    {
      header: "Item",
      cell: (it) => (
        <div>
          <div className="font-medium text-ink">{it.item.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{it.item.itemCode}</div>
        </div>
      ),
    },
    { header: "Warehouse", cell: (it) => it.warehouse.warehouseName },
    {
      header: "Cur qty",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">{Number(it.currentQty).toFixed(2)}</span>
      ),
    },
    {
      header: "Cur rate",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">
          {Number(it.currentValuationRate).toFixed(2)}
        </span>
      ),
    },
    {
      header: "Counted qty",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">{Number(it.countedQty).toFixed(2)}</span>
      ),
    },
    {
      header: "Counted rate",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">
          {it.countedValuationRate != null
            ? Number(it.countedValuationRate).toFixed(2)
            : "—"}
        </span>
      ),
    },
    {
      header: "Delta value",
      align: "right",
      cell: (it) => {
        const cur = Number(it.currentQty) * Number(it.currentValuationRate);
        const rate =
          it.countedValuationRate != null
            ? Number(it.countedValuationRate)
            : Number(it.currentValuationRate);
        const counted = Number(it.countedQty) * rate;
        const delta = counted - cur;
        return (
          <span
            className={`tabular-nums font-mono ${
              delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : ""
            }`}
          >
            {delta.toFixed(2)}
          </span>
        );
      },
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Stock Reconciliations", href: "/stock/stock-reconciliations" },
          { label: sr.name },
        ]}
        title={sr.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={sr.status} />
            <span>{sr.purpose}</span>
            <span>{dateShort(sr.postingDate)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {sr.status === "Draft" && (
              <Button variant="primary" onClick={doSubmit} disabled={busy} type="button">
                Submit
              </Button>
            )}
            {sr.status !== "Cancelled" && (
              <Button variant="danger" onClick={doCancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
          </>
        }
      />

      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
          Net valuation delta
        </div>
        <div
          className={`text-lg font-semibold tabular-nums mt-1 ${
            netDelta > 0 ? "text-green-700" : netDelta < 0 ? "text-red-700" : "text-ink"
          }`}
        >
          {netDelta.toFixed(2)}
        </div>
        <div className="text-xs text-ink-muted mt-1">
          {sr.status === "Draft"
            ? "Preview — will be posted to Stock in Hand vs Stock Adjustment on submit"
            : sr.status === "Submitted"
              ? "Posted"
              : "Reversed"}
        </div>
      </Card>

      <section>
        <SectionHeader title="Line items" />
        <div className="hidden md:block">
          <DataTable<SRItem>
            columns={itemCols}
            rows={sr.items}
            rowKey={(it) => it.id}
            empty={{ title: "No line items" }}
          />
        </div>
        {sr.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No line items
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {sr.items.map((it) => {
              const diff = Number(it.countedQty) - Number(it.currentQty);
              return (
                <li key={it.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                      <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">
                        {Number(it.currentQty).toFixed(2)} → {Number(it.countedQty).toFixed(2)} {it.item.stockUom}
                      </div>
                      <div className={`text-xs tabular-nums ${diff < 0 ? "text-red-600" : diff > 0 ? "text-green-700" : "text-ink-muted"}`}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {it.warehouse.warehouseName}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sr.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm text-ink whitespace-pre-wrap">{sr.remarks}</div>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="StockReconciliation" docId={params.id} />
      </div>
</main>
  );
}
