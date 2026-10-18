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

interface MRItem {
  id: string;
  qty: string;
  orderedQty: string;
  requiredDate: string | null;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string } | null;
}
interface MR {
  id: string;
  name: string;
  status: string;
  materialRequestType: string;
  transactionDate: string;
  requiredDate: string | null;
  remarks: string | null;
  items: MRItem[];
}
interface SupplierLite { id: string; supplierName: string }

export default function MaterialRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const [mr, setMR] = useState<MR | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setMR(await api.get<MR>(`/material-requests/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    api.get<SupplierLite[]>("/suppliers").then(setSuppliers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function doSubmit() {
    setBusy(true);
    try {
      await api.post(`/material-requests/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function doCancel() {
    if (!confirm("Cancel this MR?")) return;
    setBusy(true);
    try {
      await api.post(`/material-requests/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // C2: MR → PO flow. Prompt for supplier, fetch pre-fill payload from
  // stock-service, then cross-service POST to accounting-service to create
  // a Draft PO. Navigate to it.
  async function convertToPO() {
    if (suppliers.length === 0)
      return setError("No suppliers found — create one first");
    const supplierId = window.prompt(
      `Supplier id (${suppliers.map((s) => `${s.id.slice(0, 6)}=${s.supplierName}`).join(", ")}):`,
      suppliers[0].id,
    );
    if (!supplierId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await api.post<{
        supplierId: string;
        transactionDate: string;
        remarks: string;
        items: unknown[];
      }>(`/material-requests/${params.id}/order-payload`, { supplierId });
      const ACC =
        process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
      const raw = localStorage.getItem("lumaara.session");
      const token = raw ? (JSON.parse(raw).token as string) : "";
      const res = await fetch(`${ACC}/purchase-orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `PO create failed (${res.status})`);
      }
      const po = await res.json();
      location.href = `/buying/purchase-orders/${po.id}`;
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
            { label: "Material Requests", href: "/stock/material-requests" },
          ]}
          title="Material Request"
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
  if (!mr) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Material Requests", href: "/stock/material-requests" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  const totalQty = mr.items.reduce((s, i) => s + Number(i.qty), 0);
  const totalOrd = mr.items.reduce((s, i) => s + Number(i.orderedQty), 0);

  const itemCols: Column<MRItem>[] = [
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
      header: "Qty",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">
          {Number(it.qty).toFixed(2)} {it.item.stockUom}
        </span>
      ),
    },
    {
      header: "Ordered",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">{Number(it.orderedQty).toFixed(2)}</span>
      ),
    },
    {
      header: "Target warehouse",
      cell: (it) => it.warehouse?.warehouseName ?? "—",
    },
    {
      header: "Required by",
      cell: (it) => dateShort(it.requiredDate),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Material Requests", href: "/stock/material-requests" },
          { label: mr.name },
        ]}
        title={mr.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={mr.status} />
            <span>{mr.materialRequestType}</span>
            <span>
              {dateShort(mr.transactionDate)}
              {mr.requiredDate && ` · required ${dateShort(mr.requiredDate)}`}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {mr.status === "Draft" && (
              <>
                <a href={`/stock/material-requests/new?editId=${mr.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button variant="primary" onClick={doSubmit} disabled={busy} type="button">
                  Submit
                </Button>
              </>
            )}
            {(mr.status === "Submitted" || mr.status === "Ordered") &&
              mr.materialRequestType === "Purchase" && (
                <Button
                  variant="brand"
                  onClick={convertToPO}
                  disabled={busy}
                  type="button"
                >
                  Convert to PO
                </Button>
              )}
            {mr.status !== "Cancelled" && mr.status !== "Received" && (
              <Button variant="danger" onClick={doCancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
          </>
        }
      />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4 col-span-2">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Fulfillment
          </div>
          <div className="text-lg font-semibold tabular-nums mt-1 text-ink">
            {totalOrd.toFixed(2)} / {totalQty.toFixed(2)}
          </div>
          <div className="text-sm text-ink-muted">
            {totalQty > 0 ? Math.round((totalOrd / totalQty) * 100) : 0}% ordered
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Line items" />
        <div className="hidden md:block">
          <DataTable<MRItem>
            columns={itemCols}
            rows={mr.items}
            rowKey={(it) => it.id}
            empty={{ title: "No line items" }}
          />
        </div>
        {mr.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No line items
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {mr.items.map((it) => (
              <li key={it.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">
                      {Number(it.orderedQty).toFixed(2)}/{Number(it.qty).toFixed(2)}{" "}
                      <span className="text-ink-muted">{it.item.stockUom}</span>
                    </div>
                  </div>
                </div>
                {(it.warehouse || it.requiredDate) && (
                  <div className="mt-1 text-xs text-ink-muted">
                    {it.warehouse && <>Warehouse <span className="text-ink">{it.warehouse.warehouseName}</span></>}
                    {it.warehouse && it.requiredDate && " · "}
                    {it.requiredDate && <>Required by {dateShort(it.requiredDate)}</>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mr.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm text-ink whitespace-pre-wrap">{mr.remarks}</div>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="MaterialRequest" docId={params.id} />
      </div>
</main>
  );
}
