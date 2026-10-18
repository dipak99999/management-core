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
  money,
  type Column,
} from "../../../components/ui";

interface PRItem {
  id: string;
  qty: string;
  rate: string;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string };
}
interface PurchaseReceipt {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  supplierDeliveryNo: string | null;
  remarks: string | null;
  supplier: {
    id: string;
    supplierName: string;
    email: string | null;
    mobile: string | null;
  };
  items: PRItem[];
}
interface GLEntry {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  remarks: string | null;
  account: { accountName: string; rootType: string };
}
interface SLEntry {
  id: string;
  actualQty: string;
  qtyAfterTransaction: string;
  valuationRate: string;
  incomingRate: string;
  stockValue: string;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string };
}
interface Payload {
  purchaseReceipt: PurchaseReceipt;
  glEntries: GLEntry[];
  slEntries: SLEntry[];
}

function glLink(accountId: string) {
  return `/accounting/reports/general-ledger?accountId=${accountId}`;
}

export default function PurchaseReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/purchase-receipts/${params.id}/full`));
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
      await api.post(`/purchase-receipts/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this receipt? Stock movements + GL will be reversed."))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/purchase-receipts/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }
  async function billReceipt() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ purchaseInvoice: { id: string } }>(
        `/purchase-receipts/${params.id}/convert-to-invoice`,
        {},
      );
      // PI lives in buying-web (accounting-service).
      window.location.href = `/buying/purchase-invoices/${res.purchaseInvoice.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Purchase Receipts", href: "/stock/purchase-receipts" },
          ]}
          title="Purchase Receipt"
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
          breadcrumb={[
            { label: "Purchase Receipts", href: "/stock/purchase-receipts" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-64" rounded="rounded-lg" />
      </main>
    );
  }

  const pr = data.purchaseReceipt;
  const totalQty = pr.items.reduce((s, i) => s + Number(i.qty), 0);
  const totalValue = pr.items.reduce((s, i) => s + Number(i.qty) * Number(i.rate), 0);

  const itemCols: Column<PRItem>[] = [
    {
      header: "Item",
      cell: (it) => (
        <div>
          <div className="font-mono text-sm text-ink">{it.item.itemCode}</div>
          <div className="text-ink-muted text-sm">{it.item.itemName}</div>
        </div>
      ),
    },
    { header: "To warehouse", cell: (it) => it.warehouse.warehouseName },
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
        <span className="tabular-nums">{Number(it.rate).toFixed(2)}</span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (it) => (
        <span className="tabular-nums font-mono">
          {(Number(it.qty) * Number(it.rate)).toFixed(2)}
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
      header: "Qty in",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono text-green-700">
          +{Number(s.actualQty).toFixed(4)}
        </span>
      ),
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
      header: "Incoming rate",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums">{Number(s.incomingRate).toFixed(4)}</span>
      ),
    },
    {
      header: "Avg after",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums">{Number(s.valuationRate).toFixed(4)}</span>
      ),
    },
  ];

  const glCols: Column<GLEntry>[] = [
    {
      header: "Account",
      cell: (g) => (
        <>
          <a href={glLink(g.accountId)} className="text-brand-600 hover:underline">
            {g.account.accountName}
          </a>
          <span className="text-xs text-ink-muted ms-1">({g.account.rootType})</span>
        </>
      ),
    },
    {
      header: "Remarks",
      cell: (g) => <span className="text-xs text-ink-muted">{g.remarks ?? "—"}</span>,
    },
    {
      header: "Debit",
      align: "right",
      cell: (g) => (
        <span className="tabular-nums font-mono">
          {Number(g.debit) > 0 ? Number(g.debit).toFixed(2) : ""}
        </span>
      ),
    },
    {
      header: "Credit",
      align: "right",
      cell: (g) => (
        <span className="tabular-nums font-mono">
          {Number(g.credit) > 0 ? Number(g.credit).toFixed(2) : ""}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Purchase Receipts", href: "/stock/purchase-receipts" },
          { label: pr.name },
        ]}
        title={pr.name}
        subtitle={
          <span className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={pr.status} />
            <span>{dateShort(pr.postingDate)}</span>
            {pr.supplierDeliveryNo && (
              <span>
                Supplier DN#:{" "}
                <span className="font-mono">{pr.supplierDeliveryNo}</span>
              </span>
            )}
          </span>
        }
        actions={
          <div className="print:hidden flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {pr.status === "Draft" && (
              <>
                <a href={`/stock/purchase-receipts/new?editId=${pr.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button variant="primary" onClick={submit} disabled={busy} type="button">
                  Submit
                </Button>
              </>
            )}
            {pr.status === "Submitted" && (
              <Button
                variant="brand"
                onClick={billReceipt}
                disabled={busy}
                type="button"
                title="Create a Draft Purchase Invoice from this receipt (SRBNB → Creditors on PI submit)"
              >
                Bill this receipt
              </Button>
            )}
            {pr.status !== "Cancelled" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                downloadPdf(`/print/purchase-receipts/${pr.id}`, `${pr.name}.pdf`).catch(
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
        <WorkflowActions doctype="PurchaseReceipt" docId={pr.id} onChange={load} />
      </div>

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Received from
          </div>
          <div className="font-semibold text-ink mt-1">{pr.supplier.supplierName}</div>
          {pr.supplier.email && (
            <div className="text-sm text-ink-muted">{pr.supplier.email}</div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Items received
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">{totalQty}</div>
          <div className="text-xs text-ink-muted">{pr.items.length} line(s)</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Total value
          </div>
          <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
            {money(totalValue)}
          </div>
          <div className="text-xs text-ink-muted">at receipt rates</div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Line items" />
        <div className="hidden md:block">
          <DataTable<PRItem>
            columns={itemCols}
            rows={pr.items}
            rowKey={(it) => it.id}
            empty={{ title: "No line items" }}
          />
        </div>
        {pr.items.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No line items
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {pr.items.map((it) => (
              <li key={it.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{it.item.itemName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{it.item.itemCode}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">
                      {Number(it.qty).toFixed(2)} {it.item.stockUom}
                    </div>
                    <div className="text-xs text-ink-muted tabular-nums">
                      @ {Number(it.rate).toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  Into <span className="text-ink">{it.warehouse.warehouseName}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="print:hidden">
        <SectionHeader title="Stock movements (from this receipt)" />
        <DataTable<SLEntry>
          columns={sleCols}
          rows={data.slEntries}
          rowKey={(s) => s.id}
          empty={{ title: "Not posted yet" }}
        />
      </section>

      <section className="print:hidden">
        <SectionHeader title="GL entries (perpetual inventory)" />
        <DataTable<GLEntry>
          columns={glCols}
          rows={data.glEntries}
          rowKey={(g) => g.id}
          empty={{ title: "Not posted yet" }}
        />
      </section>

      {pr.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="text-sm text-ink whitespace-pre-wrap">{pr.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="PurchaseReceipt" docId={pr.id} />
        <CommentsPanel
          doctype="PurchaseReceipt"
          docId={pr.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
