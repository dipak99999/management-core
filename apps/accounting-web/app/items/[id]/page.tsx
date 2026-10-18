"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { trackRecent } from "../../../lib/recent";
import { CustomFieldsView } from "../../../lib/custom-fields";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { AiInsightCard } from "../../../components/ai-insight-card";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  NotFoundState,
  PageHeader,
  SectionHeader,
  Skeleton,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  itemGroup: string | null;
  stockUom: string;
  standardRate: string;
  isStockItem: boolean;
  description: string | null;
  customData: Record<string, unknown> | null;
}
interface Bin {
  id: string;
  actualQty: string;
  valuationRate: string;
  stockValue: string;
  warehouse: { warehouseName: string };
}
interface SLE {
  id: string;
  postingDate: string;
  actualQty: string;
  qtyAfterTransaction: string;
  valuationRate: string;
  voucherType: string;
  voucherName: string | null;
  warehouse: { warehouseName: string };
}
interface SILine {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  salesInvoice: {
    id: string;
    name: string;
    postingDate: string;
    status: string;
    customer: { customerName: string };
  };
}
interface PILine {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  purchaseInvoice: {
    id: string;
    name: string;
    postingDate: string;
    status: string;
    supplier: { supplierName: string };
  };
}
interface Payload {
  item: Item;
  stats: { totalQty: number; totalStockValue: number; avgRate: number };
  bins: Bin[];
  recentSLE: SLE[];
  recentSILines: SILine[];
  recentPILines: PILine[];
}

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Payload>(`/items/${params.id}/full`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [params.id]);
  useEffect(() => {
    const it = data?.item;
    if (it) {
      trackRecent({
        doctype: "Item",
        id: it.id,
        label: it.itemName ?? it.itemCode,
        href: `/accounting/items/${it.id}`,
      });
    }
    // deliberately keyed on item.id only — label changes shouldn't refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.item?.id]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Items", href: "/accounting/items" }]}
          title="Item"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        {/not found/i.test(error) || /404/.test(error) ? (
          <NotFoundState doctype="Item" listHref="/accounting/items" listLabel="Items" />
        ) : (
          <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
        )}
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Items", href: "/accounting/items" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const it = data.item;

  const binCols: Column<Bin>[] = [
    { header: "Warehouse", cell: (b) => b.warehouse.warehouseName },
    {
      header: "Qty",
      align: "right",
      cell: (b) => <span className="tabular-nums">{Number(b.actualQty).toFixed(4)}</span>,
    },
    {
      header: "Avg rate",
      align: "right",
      cell: (b) => <span className="tabular-nums">{Number(b.valuationRate).toFixed(4)}</span>,
    },
    {
      header: "Stock value",
      align: "right",
      cell: (b) => (
        <span className="font-mono tabular-nums">{money(Number(b.stockValue))}</span>
      ),
    },
  ];

  const sleCols: Column<SLE>[] = [
    { header: "Date", cell: (s) => dateShort(s.postingDate) },
    {
      header: "Voucher",
      cell: (s) => (
        <div>
          <div className="text-xs text-ink-muted">{s.voucherType}</div>
          <span className="font-mono text-xs">{s.voucherName ?? s.id.slice(0, 8)}</span>
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
          <span className={`font-mono tabular-nums ${qty > 0 ? "text-green-700" : "text-red-700"}`}>
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
        <span className="font-mono tabular-nums">
          {Number(s.qtyAfterTransaction).toFixed(4)}
        </span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (s) => <span className="tabular-nums">{Number(s.valuationRate).toFixed(4)}</span>,
    },
  ];

  const siCols: Column<SILine>[] = [
    {
      header: "Invoice",
      cell: (l) => (
        <div>
          <a
            href={`/accounting/sales-invoices/${l.salesInvoice.id}`}
            className="font-mono text-xs text-brand-600 hover:underline"
          >
            {l.salesInvoice.name}
          </a>
          <div className="text-xs text-ink-muted">{dateShort(l.salesInvoice.postingDate)}</div>
        </div>
      ),
    },
    { header: "Customer", cell: (l) => l.salesInvoice.customer.customerName },
    {
      header: "Qty",
      align: "right",
      cell: (l) => <span className="tabular-nums">{Number(l.qty)}</span>,
    },
    {
      header: "Rate",
      align: "right",
      cell: (l) => <span className="tabular-nums">{Number(l.rate).toFixed(2)}</span>,
    },
  ];

  const piCols: Column<PILine>[] = [
    {
      header: "Bill",
      cell: (l) => (
        <div>
          <a
            href={`/buying/purchase-invoices/${l.purchaseInvoice.id}`}
            className="font-mono text-xs text-brand-600 hover:underline"
          >
            {l.purchaseInvoice.name}
          </a>
          <div className="text-xs text-ink-muted">{dateShort(l.purchaseInvoice.postingDate)}</div>
        </div>
      ),
    },
    { header: "Supplier", cell: (l) => l.purchaseInvoice.supplier.supplierName },
    {
      header: "Qty",
      align: "right",
      cell: (l) => <span className="tabular-nums">{Number(l.qty)}</span>,
    },
    {
      header: "Rate",
      align: "right",
      cell: (l) => <span className="tabular-nums">{Number(l.rate).toFixed(2)}</span>,
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Items", href: "/accounting/items" },
          { label: it.itemName },
        ]}
        title={it.itemName}
        subtitle={
          <span className="flex items-center gap-2">
            <span className="font-mono text-ink-muted">{it.itemCode}</span>
            <span>·</span>
            <span>{it.itemGroup ?? "No group"}</span>
            <span>·</span>
            <span>UOM: {it.stockUom}</span>
            <span>·</span>
            <span>Standard: {Number(it.standardRate).toFixed(2)}</span>
            {!it.isStockItem && <span className="badge-gray">Non-stock</span>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <a href={`/accounting/items?editId=${it.id}`}>
              <Button variant="primary" type="button">Edit</Button>
            </a>
          </>
        }
      />

      <AiInsightCard doctype="Item" docId={it.id} />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Total stock
          </div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {data.stats.totalQty.toFixed(4)}{" "}
            <span className="text-sm text-ink-muted">{it.stockUom}</span>
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            across {data.bins.length} warehouse{data.bins.length !== 1 ? "s" : ""}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Stock value
          </div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {money(data.stats.totalStockValue)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Avg rate
          </div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {data.stats.avgRate.toFixed(4)}
          </div>
          <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
            standard: {Number(it.standardRate).toFixed(2)}
          </div>
        </Card>
      </section>

      <CustomFieldsView doctype="Item" data={it.customData} />

      <section>
        <SectionHeader title="Stock by warehouse" />
        <div className="hidden md:block">
          <DataTable<Bin>
            columns={binCols}
            rows={data.bins}
            rowKey={(b) => b.id}
            empty={{ title: "Not stocked anywhere" }}
          />
        </div>
        {data.bins.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            Not stocked anywhere
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.bins.map((b) => (
              <li key={b.id} className="px-4 py-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{b.warehouse.warehouseName}</div>
                  <div className="text-xs text-ink-muted tabular-nums">
                    @ {Number(b.valuationRate).toFixed(2)}
                  </div>
                </div>
                <div className="text-end">
                  <div className="font-mono text-ink tabular-nums">{Number(b.actualQty).toFixed(2)}</div>
                  <div className="text-xs text-ink-muted tabular-nums">{Number(b.stockValue).toFixed(2)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="Recent stock movements (latest 30)" />
        <div className="hidden md:block">
          <DataTable<SLE>
            columns={sleCols}
            rows={data.recentSLE}
            rowKey={(s) => s.id}
            empty={{ title: "No stock movements yet" }}
          />
        </div>
        {data.recentSLE.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No stock movements yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.recentSLE.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">
                      {s.voucherType}
                      {s.voucherName && <span className="font-mono text-xs text-ink-muted ms-2">{s.voucherName}</span>}
                    </div>
                    <div className="text-xs text-ink-muted">{dateShort(s.postingDate)} · {s.warehouse.warehouseName}</div>
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

      <section className="grid md:grid-cols-2 gap-4">
        <div>
          <SectionHeader title="Sold to (recent)" />
          <div className="hidden md:block">
            <DataTable<SILine>
              columns={siCols}
              rows={data.recentSILines}
              rowKey={(l) => l.id}
              empty={{ title: "Never sold" }}
            />
          </div>
          {data.recentSILines.length === 0 ? (
            <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
              Never sold
            </div>
          ) : (
            <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
              {data.recentSILines.map((l) => (
                <li key={l.id}>
                  <a href={`/accounting/sales-invoices/${l.salesInvoice.id}`} className="block px-4 py-3">
                    <div className="font-medium text-ink truncate">{l.salesInvoice.customer.customerName}</div>
                    <div className="text-xs text-ink-muted">
                      <span className="font-mono">{l.salesInvoice.name}</span> · {dateShort(l.salesInvoice.postingDate)}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted tabular-nums">
                      {Number(l.qty).toFixed(2)} × {Number(l.rate).toFixed(2)} = <span className="text-ink">{Number(l.amount).toFixed(2)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <SectionHeader title="Bought from (recent)" />
          <div className="hidden md:block">
            <DataTable<PILine>
              columns={piCols}
              rows={data.recentPILines}
              rowKey={(l) => l.id}
              empty={{ title: "Never purchased" }}
            />
          </div>
          {data.recentPILines.length === 0 ? (
            <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
              Never purchased
            </div>
          ) : (
            <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
              {data.recentPILines.map((l) => (
                <li key={l.id}>
                  <a href={`/buying/purchase-invoices/${l.purchaseInvoice.id}`} className="block px-4 py-3">
                    <div className="font-medium text-ink truncate">{l.purchaseInvoice.supplier.supplierName}</div>
                    <div className="text-xs text-ink-muted">
                      <span className="font-mono">{l.purchaseInvoice.name}</span> · {dateShort(l.purchaseInvoice.postingDate)}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted tabular-nums">
                      {Number(l.qty).toFixed(2)} × {Number(l.rate).toFixed(2)} = <span className="text-ink">{Number(l.amount).toFixed(2)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {it.description && (
        <Card className="p-4">
          <SectionHeader title="Description" />
          <div className="whitespace-pre-wrap text-sm text-ink">{it.description}</div>
        </Card>
      )}

      <UOMConversionsPanel itemId={it.id} stockUom={it.stockUom} />

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Item" docId={it.id} />
        <CommentsPanel
          doctype="Item"
          docId={it.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}

// C7: per-item UOM conversion inline CRUD. Rows are "1 <uom> equals <factor>
// <stockUom>". Stock UOM row is displayed but not editable.
interface UOMConversion {
  id: string;
  uom: string;
  conversionFactor: string;
}
function UOMConversionsPanel(props: { itemId: string; stockUom: string }) {
  const [rows, setRows] = useState<UOMConversion[]>([]);
  const [uom, setUom] = useState("");
  const [factor, setFactor] = useState<number>(1);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(
        await api.get<UOMConversion[]>(
          `/item-uom-conversions?itemId=${props.itemId}`,
        ),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.itemId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      await api.post("/item-uom-conversions", {
        itemId: props.itemId,
        uom,
        conversionFactor: factor,
      });
      setUom("");
      setFactor(1);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this UOM conversion?")) return;
    try {
      await api.del(`/item-uom-conversions/${id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section>
      <SectionHeader title="UOM Conversions" />
      {err && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm mb-2">{err}</Card>
      )}
      <Card>
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>UOM</th>
                <th className="text-end">Factor</th>
                <th>= 1 UOM equals</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-surface-sunken">
                <td className="font-medium">
                  {props.stockUom}{" "}
                  <span className="text-xs text-ink-muted">(stock UOM)</span>
                </td>
                <td className="text-end tabular-nums">1</td>
                <td className="text-ink-muted">1 {props.stockUom}</td>
                <td></td>
              </tr>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.uom}</td>
                  <td className="text-end tabular-nums">
                    {Number(r.conversionFactor).toFixed(4)}
                  </td>
                  <td className="text-ink-muted tabular-nums">
                    {Number(r.conversionFactor).toFixed(4)} {props.stockUom}
                  </td>
                  <td className="text-end">
                    <button onClick={() => remove(r.id)} className="text-sm text-red-600">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={add} className="flex gap-2 p-3 border-t border-ink-muted/10 bg-surface-sunken items-end">
          <FormField label="UOM">
            <input
              required
              className="input"
              placeholder="e.g. Dozen"
              value={uom}
              onChange={(e) => setUom(e.target.value)}
            />
          </FormField>
          <FormField label="Factor">
            <input
              required
              type="number"
              step="any"
              min={0.000001}
              className="input"
              value={factor}
              onChange={(e) => setFactor(Number(e.target.value))}
            />
          </FormField>
          <Button disabled={busy} variant="primary" type="submit">
            {busy ? "Adding…" : "Add"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
