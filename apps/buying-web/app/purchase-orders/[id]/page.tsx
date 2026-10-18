"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel, NextActionsPanel } from "@lumaara/web-ui";
import { authApi } from "../../../lib/auth-api";
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
  money,
  type Column,
} from "../../../components/ui";

interface POItem {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  receivedQty: string;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string } | null;
}
interface POTax {
  description: string;
  rate: string;
  taxAmount: string;
  account: { accountName: string };
}
interface PO {
  id: string;
  name: string;
  status: string;
  transactionDate: string;
  deliveryDate: string | null;
  currency: string;
  netTotal: string;
  totalTaxes: string;
  grandTotal: string;
  remarks: string | null;
  isSubcontracted: boolean;
  supplierWarehouseId: string | null;
  sourceWarehouseId: string | null;
  supplier: { id: string; supplierName: string };
  items: POItem[];
  taxes: POTax[];
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [po, setPO] = useState<PO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setPO(await api.get<PO>(`/purchase-orders/${params.id}`));
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
      await api.post(`/purchase-orders/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this PO?")) return;
    setBusy(true);
    try {
      await api.post(`/purchase-orders/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // C10: Subcontracting — fetch RM transfer payload from accounting-service,
  // POST to stock-service `/stock-entries` as a Material Transfer, navigate
  // to the created SE. User submits the SE to actually move the stock.
  async function sendRMToSupplier() {
    setBusy(true);
    setError(null);
    try {
      const payload = await api.post<{
        entryType: string;
        postingDate: string;
        remarks: string;
        items: unknown[];
      }>(`/purchase-orders/${params.id}/subcontract-transfer-payload`, {});
      const STOCK =
        process.env.NEXT_PUBLIC_STOCK_SERVICE_URL ?? "/api/stock";
      const raw = localStorage.getItem("lumaara.session");
      const token = raw ? (JSON.parse(raw).token as string) : "";
      const res = await fetch(`${STOCK}/stock-entries`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `SE create failed (${res.status})`);
      }
      const se = await res.json();
      location.href = `/stock/stock-entries/${se.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // C1: Receive flow. Fetches the pre-fill payload from the accounting-service
  // PO route, then POSTs a Draft PR to stock-service. User then navigates to
  // the PR to submit + set warehouses if unset.
  async function receive() {
    setBusy(true);
    setError(null);
    try {
      const payload = await api.post<{
        supplierId: string;
        postingDate: string;
        remarks: string;
        items: {
          purchaseOrderItemId: string;
          itemId: string;
          warehouseId: string;
          qty: number;
          rate: number;
        }[];
      }>(`/purchase-orders/${params.id}/receive-payload`, {});
      // Cross-service POST to stock-service.
      const STOCK =
        process.env.NEXT_PUBLIC_STOCK_SERVICE_URL ?? "/api/stock";
      const raw = localStorage.getItem("lumaara.session");
      const token = raw ? (JSON.parse(raw).token as string) : "";
      const res = await fetch(`${STOCK}/purchase-receipts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `PR create failed (${res.status})`);
      }
      const pr = await res.json();
      location.href = `/stock/purchase-receipts/${pr.id}`;
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
          breadcrumb={[{ label: "Purchase Orders", href: "/buying/purchase-orders" }]}
          title="Purchase Order"
          actions={
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!po) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Purchase Orders", href: "/buying/purchase-orders" }]}
          title="Loading…"
          actions={
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
          }
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  const totalQty = po.items.reduce((s, i) => s + Number(i.qty), 0);
  const totalRec = po.items.reduce((s, i) => s + Number(i.receivedQty), 0);
  const subtitleParts = [
    dateShort(po.transactionDate),
    po.deliveryDate ? `deliver ${dateShort(po.deliveryDate)}` : null,
    po.isSubcontracted ? "Subcontracted" : null,
  ].filter(Boolean) as string[];

  const itemCols: Column<POItem>[] = [
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
          {Number(it.qty).toFixed(2)}{" "}
          <span className="text-ink-muted text-xs">{it.item.stockUom}</span>
        </span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums">{money(Number(it.rate), po.currency)}</span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums font-medium">
          {money(Number(it.amount), po.currency)}
        </span>
      ),
    },
    {
      header: "Received",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums text-ink-soft">
          {Number(it.receivedQty).toFixed(2)}
        </span>
      ),
    },
    {
      header: "Warehouse",
      cell: (it) => it.warehouse?.warehouseName ?? "—",
    },
  ];

  const taxCols: Column<POTax>[] = [
    { header: "Description", cell: (t) => t.description },
    { header: "Account", cell: (t) => t.account.accountName },
    {
      header: "Rate %",
      align: "right",
      cell: (t) => <span className="tabular-nums">{Number(t.rate).toFixed(2)}</span>,
    },
    {
      header: "Amount",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums">{money(Number(t.taxAmount), po.currency)}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Purchase Orders", href: "/buying/purchase-orders" },
          { label: po.name },
        ]}
        title={po.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={po.status} />
            <span>{subtitleParts.join(" · ")}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
            {po.status === "Draft" && (
              <>
                <a href={`/buying/purchase-orders/new?editId=${po.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button
                  variant="primary"
                  type="button"
                  onClick={submit}
                  disabled={busy}
                >
                  Submit
                </Button>
              </>
            )}
            {po.status === "To Receive" && po.isSubcontracted && (
              <Button
                variant="primary"
                type="button"
                onClick={sendRMToSupplier}
                disabled={busy}
              >
                Send RM → Supplier
              </Button>
            )}
            {po.status === "To Receive" && (
              <Button
                variant="primary"
                type="button"
                onClick={receive}
                disabled={busy}
              >
                Receive → PR
              </Button>
            )}
            {po.status !== "Cancelled" && po.status !== "Completed" && (
              <Button
                variant="danger"
                type="button"
                onClick={cancel}
                disabled={busy}
              >
                Cancel
              </Button>
            )}
          </>
        }
      />

      <NextActionsPanel
        doctype="PurchaseOrder"
        docId={params.id}
        heading="What next?"
        fetchChips={() => authApi.post("/ai/next-actions", { doctype: "PurchaseOrder", docId: params.id })}
        callService={(method, path, body) => {
          if (method === "POST") return api.post(path, body ?? {});
          if (method === "PUT") return api.put(path, body ?? {});
          if (method === "DELETE") return api.del(path);
          return Promise.resolve();
        }}
        onDone={load}
      />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Supplier
          </div>
          <div className="mt-1 font-semibold">
            <a
              href={`/buying/suppliers/${po.supplier.id}`}
              className="text-brand-600 hover:underline"
            >
              {po.supplier.supplierName}
            </a>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Received
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {totalRec.toFixed(2)} / {totalQty.toFixed(2)}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {totalQty > 0 ? Math.round((totalRec / totalQty) * 100) : 0}% complete
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Grand total
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {money(Number(po.grandTotal), po.currency)}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Line items" />
        <div className="hidden md:block">
          <DataTable<POItem>
            columns={itemCols}
            rows={po.items}
            rowKey={(it) => it.id}
            empty={{ title: "No line items" }}
          />
        </div>
        {po.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No line items
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {po.items.map((it) => (
              <li key={it.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">{money(Number(it.amount))}</div>
                    <div className="text-xs text-ink-muted tabular-nums">
                      {Number(it.receivedQty).toFixed(2)}/{Number(it.qty).toFixed(2)}{" "}
                      {it.item.stockUom}
                    </div>
                  </div>
                </div>
                {it.warehouse && (
                  <div className="mt-1 text-xs text-ink-muted">
                    Warehouse <span className="text-ink">{it.warehouse.warehouseName}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {po.taxes.length > 0 && (
        <section>
          <SectionHeader title="Taxes" />
          <DataTable<POTax>
            columns={taxCols}
            rows={po.taxes}
            rowKey={(t) => `${t.description}-${t.account.accountName}`}
            empty={{ title: "No taxes" }}
          />
        </section>
      )}

      {po.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm whitespace-pre-wrap text-ink">{po.remarks}</div>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="PurchaseOrder" docId={params.id} />
      </div>
</main>
  );
}
