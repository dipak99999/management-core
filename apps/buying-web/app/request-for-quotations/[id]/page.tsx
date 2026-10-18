"use client";

import { use, useCallback, useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../components/ui";

// Module 45 — RFQ detail + compare-quotes.
//
// The detail page has three panes:
//   1. Header: name, dates, invited suppliers, current status.
//   2. Compare grid: rows = RFQ items, columns = supplier quotes,
//      each cell showing rate + optional lead time. Cheapest cell per
//      row highlighted; per-supplier totals in the footer.
//   3. Award action: an "Award to <supplier>" button per submitted
//      quote. Clicking triggers POST /:id/award which flips the RFQ
//      to Awarded + creates a PO. Post-award, the header shows a
//      link to the generated PO.

interface CompareCell {
  quotationId: string;
  quotationName: string;
  supplierName: string;
  rate: number;
  amount: number;
  leadTimeDays: number | null;
}

interface CompareResp {
  rfq: {
    id: string;
    name: string;
    status: string;
    transactionDate: string;
    responseDueDate: string | null;
    awardedSupplierQuotationId: string | null;
    awardedPurchaseOrderId: string | null;
  };
  items: Array<{
    rfqItemId: string;
    itemCode: string;
    itemName: string;
    qty: number;
    quotes: CompareCell[];
  }>;
  totals: Array<{
    quotationId: string;
    supplierName: string;
    netTotal: number;
    itemsQuoted: number;
    supplierScore: number | null;
    supplierStanding: string | null;
    supplierScoredAsOf: string | null;
  }>;
}

export default function RFQDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<CompareResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [awardedPO, setAwardedPO] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<CompareResp>(`/request-for-quotations/${id}/compare`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function award(quotationId: string, supplierName: string) {
    if (!confirm(`Award this RFQ to ${supplierName}? Creates a Purchase Order against their quote.`)) return;
    setError(null);
    setBusy(quotationId);
    try {
      const r = await api.post<{
        rfq: { status: string };
        purchaseOrder: { id: string; name: string };
      }>(`/request-for-quotations/${id}/award`, { supplierQuotationId: quotationId });
      setAwardedPO(r.purchaseOrder);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Award failed");
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <main className="p-8 space-y-4">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "RFQ", href: "/buying/request-for-quotations" },
            { label: "Loading…" },
          ]}
          title="Loading…"
        />
        {error && <Toast kind="error" message={error} />}
      </main>
    );
  }

  const { rfq, items, totals } = data;
  const cheapestByRow = new Map<string, string>();
  for (const row of items) {
    if (row.quotes.length === 0) continue;
    cheapestByRow.set(row.rfqItemId, row.quotes[0].quotationId);
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "RFQ", href: "/buying/request-for-quotations" },
          { label: rfq.name },
        ]}
        title={rfq.name}
        subtitle={`Transaction ${dateShort(rfq.transactionDate)}${rfq.responseDueDate ? ` · Response due ${dateShort(rfq.responseDueDate)}` : ""}`}
        actions={<StatusBadge status={rfq.status} />}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {awardedPO && (
        <div className="mb-4">
          <Toast
            kind="success"
            message={`Awarded. Purchase Order ${awardedPO.name} created — open it under Purchase Orders.`}
            onDismiss={() => setAwardedPO(null)}
          />
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="sticky start-0 bg-panel z-10 min-w-[220px]">Item</th>
                <th className="text-end">Qty</th>
                {totals.map((t) => (
                  <th key={t.quotationId} className="text-end min-w-[160px]">
                    <div className="font-medium text-ink">{t.supplierName}</div>
                    <div className="text-xs text-ink-muted">
                      {t.itemsQuoted} line{t.itemsQuoted === 1 ? "" : "s"}
                    </div>
                    {t.supplierScore !== null && (
                      <div className="text-xs mt-1">
                        <span
                          className={
                            t.supplierStanding === "Very Good" || t.supplierStanding === "Good"
                              ? "text-green-700"
                              : t.supplierStanding === "Average"
                                ? "text-amber-700"
                                : "text-red-700"
                          }
                        >
                          {t.supplierScore.toFixed(0)}
                          {" · "}
                          {t.supplierStanding}
                        </span>
                      </div>
                    )}
                    {t.supplierScore === null && (
                      <div className="text-xs mt-1 text-ink-muted italic">no scorecard</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.rfqItemId}>
                  <td className="sticky start-0 bg-panel z-10">
                    <div className="font-medium text-ink">{row.itemName}</div>
                    <div className="text-xs text-ink-muted font-mono">{row.itemCode}</div>
                  </td>
                  <td className="text-end font-mono">{row.qty}</td>
                  {totals.map((t) => {
                    const cell = row.quotes.find((q) => q.quotationId === t.quotationId);
                    if (!cell) return <td key={t.quotationId} className="text-end text-ink-muted">—</td>;
                    const cheapest = cheapestByRow.get(row.rfqItemId) === t.quotationId && row.quotes.length > 1;
                    return (
                      <td
                        key={t.quotationId}
                        className={`text-end font-mono tabular-nums ${cheapest ? "bg-green-50 text-green-800" : ""}`}
                      >
                        <div>{cell.rate.toFixed(2)}</div>
                        {cell.leadTimeDays !== null && (
                          <div className="text-xs text-ink-muted">{cell.leadTimeDays}d lead</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-sunken font-semibold">
              <tr>
                <td className="sticky start-0 bg-surface-sunken z-10">Net total</td>
                <td></td>
                {totals.map((t) => {
                  const cheapestTotal = totals.length > 0 && t.netTotal === Math.min(...totals.map((x) => x.netTotal));
                  return (
                    <td
                      key={t.quotationId}
                      className={`text-end font-mono tabular-nums ${cheapestTotal ? "text-green-700" : ""}`}
                    >
                      {t.netTotal.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td colSpan={2}></td>
                {totals.map((t) => (
                  <td key={t.quotationId} className="text-end">
                    {rfq.status !== "Awarded" && rfq.status !== "Cancelled" && (
                      <Button
                        variant={cheapestByRow.get(items[0]?.rfqItemId ?? "") === t.quotationId ? "brand" : "secondary"}
                        onClick={() => award(t.quotationId, t.supplierName)}
                        disabled={busy !== null}
                      >
                        {busy === t.quotationId ? "Awarding…" : "Award"}
                      </Button>
                    )}
                    {rfq.awardedSupplierQuotationId === t.quotationId && (
                      <span className="badge-blue">Awarded</span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        {items.length === 0 && (
          <div className="p-10 text-center text-ink-muted">No RFQ items.</div>
        )}
        {totals.length === 0 && items.length > 0 && (
          <div className="p-6 text-center text-ink-muted text-sm">
            No submitted supplier quotes yet. Suppliers file quotes via{" "}
            <a href="/buying/supplier-quotations" className="text-brand-600 underline">
              /supplier-quotations
            </a>
            .
          </div>
        )}
      </Card>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="RequestForQuotation" docId={id} />
      </div>
    </>
  );
}
