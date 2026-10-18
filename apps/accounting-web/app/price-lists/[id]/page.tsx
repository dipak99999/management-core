"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  dateShort,
  type Column,
} from "../../../components/ui";

// C4: Item Prices under a specific PriceList — inline CRUD.

interface PriceList {
  id: string;
  name: string;
  currency: string;
  buyingOrSelling: string;
}
interface ItemLite {
  id: string;
  itemCode: string;
  itemName: string;
}
interface ItemPrice {
  id: string;
  itemId: string;
  priceListRate: string;
  validFrom: string | null;
  validUpto: string | null;
  item: { itemCode: string; itemName: string };
}

export default function PriceListDetailPage() {
  const params = useParams<{ id: string }>();
  const [pl, setPL] = useState<PriceList | null>(null);
  const [prices, setPrices] = useState<ItemPrice[]>([]);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [itemId, setItemId] = useState("");
  const [rate, setRate] = useState<number>(0);
  const [validFrom, setValidFrom] = useState("");
  const [validUpto, setValidUpto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [p, prs] = await Promise.all([
        api.get<PriceList>(`/price-lists/${params.id}`),
        api.get<ItemPrice[]>(`/item-prices?priceListId=${params.id}`),
      ]);
      setPL(p);
      setPrices(prs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    api.get<ItemLite[]>("/items").then(setItems).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function addPrice(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/item-prices", {
        itemId,
        priceListId: params.id,
        priceListRate: rate,
        validFrom: validFrom ? new Date(validFrom).toISOString() : null,
        validUpto: validUpto ? new Date(validUpto).toISOString() : null,
      });
      setItemId("");
      setRate(0);
      setValidFrom("");
      setValidUpto("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this item price?")) return;
    try {
      await api.del(`/item-prices/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  if (!pl) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Price Lists", href: "/accounting/price-lists" }]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const cols: Column<ItemPrice>[] = [
    {
      header: "Item",
      cell: (p) => (
        <div>
          <div className="font-medium">{p.item.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{p.item.itemCode}</div>
        </div>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums">
          {Number(p.priceListRate).toFixed(2)} {pl.currency}
        </span>
      ),
    },
    { header: "Valid from", cell: (p) => dateShort(p.validFrom) },
    { header: "Valid upto", cell: (p) => dateShort(p.validUpto) },
    {
      header: "",
      align: "right",
      cell: (p) => (
        <button onClick={() => remove(p.id)} className="text-sm text-red-600">
          Delete
        </button>
      ),
    },
  ];

  return (
    <main className="p-8 max-w-3xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Price Lists", href: "/accounting/price-lists" },
          { label: pl.name },
        ]}
        title={pl.name}
        subtitle={
          <span className="text-ink-muted">
            {pl.buyingOrSelling} · {pl.currency}
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <Card className="p-4">
        <SectionHeader title="Add price" />
        <form onSubmit={addPrice} className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <FormField label="Item" required>
              <select
                required
                className="input"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="">Select item...</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemCode} — {i.itemName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={`Rate (${pl.currency})`} required>
              <input
                type="number"
                step="any"
                min={0}
                required
                className="input"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </FormField>
            <FormField label="Valid from">
              <input
                type="date"
                className="input"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </FormField>
            <FormField label="Valid upto">
              <input
                type="date"
                className="input"
                value={validUpto}
                onChange={(e) => setValidUpto(e.target.value)}
              />
            </FormField>
          </div>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add price"}
          </Button>
        </form>
      </Card>

      <div className="hidden md:block">
        <DataTable<ItemPrice>
          columns={cols}
          rows={prices}
          rowKey={(p) => p.id}
          empty={{ title: "No prices in this list yet" }}
        />
      </div>
      {prices.length === 0 ? (
        <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
          No prices in this list yet
        </div>
      ) : (
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {prices.map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{p.item.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{p.item.itemCode}</div>
                </div>
                <div className="font-mono text-ink tabular-nums text-end">
                  {Number(p.priceListRate).toFixed(2)}
                </div>
              </div>
              {(p.validFrom || p.validUpto) && (
                <div className="mt-1 text-xs text-ink-muted">
                  {p.validFrom && `From ${dateShort(p.validFrom)}`}
                  {p.validFrom && p.validUpto && " · "}
                  {p.validUpto && `Until ${dateShort(p.validUpto)}`}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="PriceList" docId={params.id} />
      </div>
</main>
  );
}
