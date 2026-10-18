"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { accApi } from "../../lib/api";
import {
  Button,
  Card,
  EmptyState,
  FilterBar,
  PageHeader,
  Segmented,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  money,
} from "../../components/ui";

interface QuoteItem {
  qty: string;
  rate: string;
  amount: string;
  item: { itemCode: string; itemName: string };
}

interface Quote {
  id: string;
  name: string;
  quotationDate: string;
  validTill: string | null;
  status: string;
  grandTotal: string;
  currency: string;
  items: QuoteItem[];
  lostReason: string | null;
}

type Tab = "all" | "open" | "accepted" | "lost";

export default function QuotationsPage() {
  const [rows, setRows] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");

  async function load() {
    try {
      setRows(await accApi.get<Quote[]>("/portal/quotations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Quotation",
    plural: "Quotations",
    refresh: load,
  });
  async function accept(id: string) {
    if (!confirm("Accept this quotation? Staff will be notified.")) return;
    setBusy(true);
    try {
      await accApi.post(`/portal/quotations/${id}/accept`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    const lostReason = prompt("Reason for rejection?");
    if (!lostReason) return;
    setBusy(true);
    try {
      await accApi.post(`/portal/quotations/${id}/reject`, { lostReason });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      all: list.length,
      open: list.filter((q) => q.status === "Submitted").length,
      accepted: list.filter((q) => q.status === "Ordered").length,
      lost: list.filter((q) => q.status === "Lost").length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((row) => {
      if (tab === "open" && row.status !== "Submitted") return false;
      if (tab === "accepted" && row.status !== "Ordered") return false;
      if (tab === "lost" && row.status !== "Lost") return false;
      if (q && !row.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tab, search]);

  if (error && !rows) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Home", href: "/" }, { label: "Quotations" }]}
          title="Quotations"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">
          {error}
        </Card>
      </main>
    );
  }

  if (rows === null) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Home", href: "/" }, { label: "Quotations" }]}
          title="Loading…"
        />
        <Skeleton className="h-12 w-full" rounded="rounded-lg" />
        <Skeleton className="h-40 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Quotations" }]}
        title="Quotations"
        subtitle="Review and respond to quotes we've sent you."
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => history.back()}
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast
          kind="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search quotation number…",
        }}
        filters={
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "All", count: counts.all },
              { value: "open", label: "Open", count: counts.open },
              {
                value: "accepted",
                label: "Accepted",
                count: counts.accepted,
              },
              { value: "lost", label: "Lost", count: counts.lost },
            ]}
          />
        }
        actions={<SavedViewsControls listKey="portal-web:quotations" current={{ search, tab }} onApply={(fv) => { setSearch(fv.search); setTab(fv.tab); }} />}
      />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No quotations to show"
            description={
              tab === "all"
                ? "You have no quotations yet. Once we send you a quote it will appear here."
                : "Try switching the tab or clearing the search."
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((q) => (
            <Card key={q.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono text-sm text-ink">{q.name}</div>
                  <div className="text-xs text-ink-muted mt-1">
                    Dated {dateShort(q.quotationDate)}
                    {q.validTill && ` · valid till ${dateShort(q.validTill)}`}
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-2xl font-semibold tabular-nums text-ink">
                    {money(Number(q.grandTotal), q.currency)}
                  </div>
                  <div className="mt-1">
                    <StatusBadge status={q.status} />
                  </div>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="table text-xs">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-end">Qty</th>
                      <th className="text-end">Rate</th>
                      <th className="text-end">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.items.map((it, i) => (
                      <tr key={i}>
                        <td>
                          <span className="font-mono text-ink-muted">
                            {it.item.itemCode}
                          </span>{" "}
                          <span className="text-ink">{it.item.itemName}</span>
                        </td>
                        <td className="text-end tabular-nums">
                          {Number(it.qty)}
                        </td>
                        <td className="text-end tabular-nums">
                          {money(Number(it.rate), q.currency)}
                        </td>
                        <td className="text-end tabular-nums">
                          {money(Number(it.amount), q.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {q.status === "Submitted" && (
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="danger"
                    type="button"
                    disabled={busy}
                    onClick={() => reject(q.id)}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    type="button"
                    disabled={busy}
                    onClick={() => accept(q.id)}
                  >
                    Accept quotation
                  </Button>
                </div>
              )}
              {q.status === "Lost" && q.lostReason && (
                <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  Reason: {q.lostReason}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
