"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
} from "../../../components/ui";

interface Tax {
  id: string;
  description: string;
  amount: string;
  expenseAccount: { accountName: string };
}
interface PRItem {
  id: string;
  qty: string;
  rate: string;
  item: { itemCode: string; itemName: string };
  warehouse: { warehouseName: string };
}
interface PR {
  id: string;
  name: string;
  postingDate: string;
  supplier: { supplierName: string };
  items: PRItem[];
}
interface PRRef {
  id: string;
  purchaseReceipt: PR;
}
interface LCV {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  remarks: string | null;
  taxes: Tax[];
  purchaseReceipts: PRRef[];
}

export default function LandedCostVoucherDetail() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<LCV | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<LCV>(`/landed-cost-vouchers/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    if (!confirm("Submit? This bumps bin valuations and posts GL. Cancel-able later.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/landed-cost-vouchers/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel? This reverses the valuation bump + GL.")) return;
    setBusy(true);
    try {
      await api.post(`/landed-cost-vouchers/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function del() {
    if (!confirm("Delete this draft voucher?")) return;
    try {
      await api.del(`/landed-cost-vouchers/${params.id}`);
      location.href = "/accounting/landed-cost-vouchers";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const totalCost = useMemo(
    () => data?.taxes.reduce((s, t) => s + Number(t.amount), 0) ?? 0,
    [data],
  );
  const totalBase = useMemo(() => {
    if (!data) return 0;
    return data.purchaseReceipts
      .flatMap((r) => r.purchaseReceipt.items)
      .reduce((s, it) => s + Number(it.qty) * Number(it.rate), 0);
  }, [data]);

  // Preview per-item allocation.
  const allocation = useMemo(() => {
    if (!data || totalBase <= 0) return [];
    return data.purchaseReceipts.flatMap((r) =>
      r.purchaseReceipt.items.map((it) => {
        const base = Number(it.qty) * Number(it.rate);
        const share = totalCost * (base / totalBase);
        return {
          key: `${r.id}-${it.id}`,
          prName: r.purchaseReceipt.name,
          itemCode: it.item.itemCode,
          itemName: it.item.itemName,
          warehouse: it.warehouse.warehouseName,
          qty: Number(it.qty),
          baseAmount: base,
          allocatedCost: share,
        };
      }),
    );
  }, [data, totalCost, totalBase]);

  if (error && !data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Landed Cost Vouchers", href: "/accounting/landed-cost-vouchers" },
          ]}
          title="Voucher"
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
            { label: "Landed Cost Vouchers", href: "/accounting/landed-cost-vouchers" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  return (
    <main className="p-8 space-y-4 max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Landed Cost Vouchers", href: "/accounting/landed-cost-vouchers" },
          { label: data.name },
        ]}
        title={data.name}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            <span>{dateShort(data.postingDate)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {data.status === "Draft" && (
              <>
                <Button variant="primary" onClick={submit} disabled={busy} type="button">
                  Submit
                </Button>
                <Button variant="danger" onClick={del} disabled={busy} type="button">
                  Delete
                </Button>
              </>
            )}
            {data.status === "Submitted" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
          </>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <Card className="p-4">
        <SectionHeader title="Additional costs" />
        <div className="hidden md:block table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Source expense</th>
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.taxes.map((t) => (
                <tr key={t.id}>
                  <td>{t.description}</td>
                  <td className="text-ink-soft">{t.expenseAccount.accountName}</td>
                  <td className="text-end font-mono tabular-nums">{money(Number(t.amount))}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-surface-sunken">
                <td>Total</td>
                <td></td>
                <td className="text-end font-mono tabular-nums">{money(totalCost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {data.taxes.map((t) => (
            <li key={t.id} className="px-4 py-3 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink truncate">{t.description}</div>
                <div className="text-xs text-ink-muted truncate">{t.expenseAccount.accountName}</div>
              </div>
              <div className="font-mono text-ink tabular-nums text-end">{money(Number(t.amount))}</div>
            </li>
          ))}
          <li className="px-4 py-3 bg-surface-sunken flex items-center justify-between font-semibold text-ink">
            <span>Total</span>
            <span className="font-mono tabular-nums">{money(totalCost)}</span>
          </li>
        </ul>
      </Card>

      <Card className="p-4">
        <SectionHeader title="Per-item allocation preview" />
        <div className="hidden md:block table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Item</th>
                <th>Warehouse</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Base value</th>
                <th className="text-end">Allocated cost</th>
              </tr>
            </thead>
            <tbody>
              {allocation.map((a) => (
                <tr key={a.key}>
                  <td className="font-mono text-xs">{a.prName}</td>
                  <td className="text-xs">
                    <span className="font-mono">{a.itemCode}</span> — {a.itemName}
                  </td>
                  <td className="text-xs">{a.warehouse}</td>
                  <td className="text-end font-mono tabular-nums">{a.qty.toFixed(2)}</td>
                  <td className="text-end font-mono tabular-nums">{money(a.baseAmount)}</td>
                  <td className="text-end font-mono tabular-nums">{money(a.allocatedCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {allocation.map((a) => (
            <li key={a.key} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{a.itemName}</div>
                  <div className="text-xs text-ink-muted font-mono truncate">{a.itemCode}</div>
                </div>
                <div className="text-end">
                  <div className="font-mono text-ink tabular-nums">{money(a.allocatedCost)}</div>
                  <div className="text-xs text-ink-muted tabular-nums">
                    on {money(a.baseAmount)}
                  </div>
                </div>
              </div>
              <div className="mt-1 text-xs text-ink-muted">
                <span className="font-mono">{a.prName}</span> · {a.warehouse} · qty {a.qty.toFixed(2)}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {data.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">{data.remarks}</div>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="LandedCostVoucher" docId={params.id} />
      </div>
</main>
  );
}
