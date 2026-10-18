"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { Icon } from "../../components/app-shell";

interface Batch {
  id: string;
  batchNo: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  batchQty: string;
  item: { itemCode: string; itemName: string };
}

type ExpiryFilter = "" | "7" | "30" | "90";

export default function BatchesPage() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiringWithinDays, setExpiring] = useState<ExpiryFilter>("");
  const [q, setQ] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (expiringWithinDays) params.set("expiringWithinDays", expiringWithinDays);
      if (q) params.set("q", q);
      setRows(await api.get<Batch[]>(`/batches?${params.toString()}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [expiringWithinDays, q]);
  useEffect(() => {
    load();
  }, [load]);

  useListPageCommands({
    singular: "Batch",
    plural: "Batches",
    refresh: load,
  });

  const columns: Column<Batch>[] = [
    {
      header: "Batch",
      cell: (b) => <span className="font-mono text-sm text-ink">{b.batchNo}</span>,
    },
    {
      header: "Item",
      cell: (b) => (
        <span>
          <span className="font-medium text-ink">{b.item.itemName}</span>
          <span className="text-xs text-ink-muted ms-2 font-mono">{b.item.itemCode}</span>
        </span>
      ),
    },
    {
      header: "Remaining qty",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums text-ink">{Number(b.batchQty).toFixed(2)}</span>
      ),
    },
    {
      header: "Manufactured",
      cell: (b) => <span className="text-ink-soft">{dateShort(b.manufactureDate)}</span>,
    },
    {
      header: "Expires",
      cell: (b) => {
        const daysLeft = b.expiryDate
          ? Math.round((new Date(b.expiryDate).getTime() - Date.now()) / 86400000)
          : null;
        const expiringSoon = daysLeft != null && daysLeft <= 30;
        return (
          <span className={expiringSoon ? "text-amber-700 font-medium" : "text-ink-soft"}>
            {b.expiryDate
              ? `${dateShort(b.expiryDate)}${daysLeft != null ? ` (${daysLeft}d)` : ""}`
              : "—"}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Batches"
        subtitle={`${rows.length} batch${rows.length === 1 ? "" : "es"}`}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: q,
            onChange: (v) => {
              setQ(v);
            },
            placeholder: "Search batch number…",
          }}
          filters={
            <Segmented
              value={expiringWithinDays}
              onChange={(v) => setExpiring(v)}
              options={[
                { value: "",   label: "All" },
                { value: "7",  label: "≤ 7d" },
                { value: "30", label: "≤ 30d" },
                { value: "90", label: "≤ 90d" },
              ]}
            />
          }
          actions={
            <>
              <button onClick={load} className="btn-secondary btn-sm">Search</button>
              <SavedViewsControls
                listKey="stock-web:batches"
                current={{ q, expiringWithinDays }}
                onApply={(fv) => { setQ(fv.q); setExpiring(fv.expiringWithinDays); }}
              />
            </>
          }
        />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: "No batches",
            description: "No batches match the current filter.",
          }}
        />
      </div>
    </>
  );
}
