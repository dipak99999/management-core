"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { Icon } from "../../components/app-shell";

interface SerialNo {
  id: string;
  serialNo: string;
  status: string;
  createdAt: string;
  item: { itemCode: string; itemName: string };
  warehouse: { warehouseName: string } | null;
}

type StatusFilter = "" | "Active" | "Delivered" | "Cancelled";

export default function SerialNumbersPage() {
  const [rows, setRows] = useState<SerialNo[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("");
  const [q, setQ] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      setRows(await api.get<SerialNo[]>(`/serial-numbers?${params.toString()}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [status, q]);
  useEffect(() => {
    load();
  }, [load]);

  useListPageCommands({
    singular: "Serial",
    plural: "Serials",
    refresh: load,
  });

  const columns: Column<SerialNo>[] = [
    {
      header: "Serial No",
      cell: (r) => <span className="font-mono text-sm text-ink">{r.serialNo}</span>,
    },
    {
      header: "Item",
      cell: (r) => (
        <span>
          <span className="font-medium text-ink">{r.item.itemName}</span>
          <span className="text-xs text-ink-muted ms-2 font-mono">{r.item.itemCode}</span>
        </span>
      ),
    },
    {
      header: "Warehouse",
      cell: (r) => <span className="text-ink-soft">{r.warehouse?.warehouseName ?? "—"}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { header: "Created", cell: (r) => <span className="text-ink-soft">{dateShort(r.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Serial Numbers"
        subtitle={`${rows.length} serial${rows.length === 1 ? "" : "s"}`}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: "Search serial number…" }}
          filters={
            <Segmented
              value={status}
              onChange={(v) => setStatus(v)}
              options={[
                { value: "",          label: "All" },
                { value: "Active",    label: "Active" },
                { value: "Delivered", label: "Delivered" },
                { value: "Cancelled", label: "Cancelled" },
              ]}
            />
          }
          actions={
            <>
              <button onClick={load} className="btn-secondary btn-sm">Search</button>
              <SavedViewsControls
                listKey="stock-web:serial-numbers"
                current={{ q, status }}
                onApply={(fv) => { setQ(fv.q); setStatus(fv.status); }}
              />
            </>
          }
        />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.tag,
            title: "No serial numbers",
            description: "No serials match the current filter.",
          }}
        />
      </div>
    </>
  );
}
