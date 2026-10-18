"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  Toast,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface BOMItem {
  id: string;
  qty: string;
  uom: string;
  item: { itemCode: string; itemName: string };
}
interface BOM {
  id: string;
  name: string;
  qty: string;
  uom: string;
  isActive: boolean;
  isDefault: boolean;
  productionItem: { itemCode: string; itemName: string };
  items: BOMItem[];
}

type StatusFilter = "all" | "Active" | "Inactive";

export default function BOMsPage() {
  const [rows, setRows] = useState<BOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    setLoading(true);
    api
      .get<BOM[]>("/boms")
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "Active" && !r.isActive) return false;
      if (statusFilter === "Inactive" && r.isActive) return false;
      if (q && !`${r.name} ${r.productionItem.itemCode} ${r.productionItem.itemName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:      rows.length,
    Active:   rows.filter((r) => r.isActive).length,
    Inactive: rows.filter((r) => !r.isActive).length,
  }), [rows]);

  const columns: Column<BOM>[] = [
    {
      header: "BOM",
      cell: (r) => (
        <a
          href={`/stock/boms/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Produces",
      cell: (r) => (
        <span className="font-medium text-ink">
          {r.productionItem.itemCode} — {r.productionItem.itemName}
        </span>
      ),
    },
    {
      header: "Yield",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink">{Number(r.qty)} {r.uom}</span>
      ),
    },
    {
      header: "Raw materials",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.items.map((i) => `${i.item.itemCode} × ${Number(i.qty)} ${i.uom}`).join(", ")}
        </span>
      ),
    },
    {
      header: "Flags",
      cell: (r) => (
        <span className="space-x-1">
          {r.isDefault && <span className="badge-brand">Default</span>}
          {r.isActive ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="BOMs"
        subtitle={`${rows.length} bill${rows.length === 1 ? "" : "s"} of materials`}
        actions={
          <a href="/stock/boms/new" className="btn-brand">+ New BOM</a>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search BOM # or produced item…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",      label: "All",      count: counts.all },
                { value: "Active",   label: "Active",   count: counts.Active },
                { value: "Inactive", label: "Inactive", count: counts.Inactive },
              ]}
            />
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/stock/boms/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search || statusFilter !== "all" ? "No matching BOMs" : "No BOMs yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Define a BOM to plan production.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/boms/new" className="btn-brand">+ New BOM</a>
            ),
          }}
        />
      </div>
    </>
  );
}
