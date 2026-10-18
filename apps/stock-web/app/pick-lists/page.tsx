"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { useCompanyScope } from "../../components/company-scope";
import {
  BulkActionBar,
  SavedViewsMenu,
  SelectCheckbox,
  Tour,
  useBulkSelect,
  useListPageCommands,
  useOptionalUIBackends,
  useRealtime,
  useSavedViews,
  type BulkAction,
  type TourStep,
} from "@lumaara/web-ui";
import { useRouter } from "next/navigation";

interface PickListRow {
  id: string;
  name: string;
  purpose: string;
  postingDate: string;
  pickedBy: string | null;
  status: string;
  _count: { items: number };
}

interface DNOption {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  customer: { customerName: string };
  items: { id: string; qty: string }[];
}

// Module 47 — Pick List list + create-from-DNs.
//
// Primary workflow: operator ticks a set of DNs, hits "Create from DNs",
// route walks the lines, sorts them by warehouse pick-order, creates a
// Draft PickList. Detail page (link) handles submit + mark-picked.
export default function PickListsPage() {
  const [rows, setRows] = useState<PickListRow[]>([]);
  const [dns, setDNs] = useState<DNOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickedDnIds, setPickedDnIds] = useState<Set<string>>(new Set());
  const [pickedBy, setPickedBy] = useState("");
  const { qs } = useCompanyScope();
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d] = await Promise.all([
        api.get<PickListRow[]>(`/pick-lists${qs}`),
        api.get<DNOption[]>("/delivery-notes"),
      ]);
      setRows(p);
      // Only offer draft/submitted DNs — cancelled ones can't be picked.
      setDNs(d.filter((x) => x.status === "Draft" || x.status === "Submitted"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  useListPageCommands({
    singular: "Pick List",
    plural: "Pick Lists",
    onNew: () => openCreate(),
    refresh: load,
  });

  const backends = useOptionalUIBackends();
  const views = useSavedViews<{ search: string }>(
    "stock-web:pick-lists",
    backends?.views,
  );

  // Realtime: another worker submits/cancels a pick list → silently refetch.
  // EventSource can't send auth headers, so the Bearer token rides as a
  // query param — the /stream route elevates ?token= into Authorization
  // before requireAuth runs.
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("lumaara.session");
    if (!raw) return;
    try {
      const token = (JSON.parse(raw) as { token?: string }).token;
      if (!token) return;
      const base = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";
      setStreamUrl(
        `${base}/stream?channel=pick-list&token=${encodeURIComponent(token)}`,
      );
    } catch { /* no session yet */ }
  }, []);
  useRealtime({
    url: streamUrl ?? "",
    enabled: !!streamUrl,
    events: ["pick-list"],
    onMessage: () => void load(),
  });

  function openCreate() {
    setPickedDnIds(new Set());
    setPickedBy("");
    setShowForm(true);
  }

  function toggleDN(id: string) {
    setPickedDnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pickedDnIds.size === 0) {
      setError("Pick at least one delivery note");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post("/pick-lists/aggregate-from-dns", {
        deliveryNoteIds: Array.from(pickedDnIds),
        pickedBy: pickedBy || null,
        purpose: "Delivery",
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitPL(r: PickListRow, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    try {
      await api.post(`/pick-lists/${r.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }

  async function cancelPL(r: PickListRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Cancel ${r.name}? DN lines will be released back to the pool.`)) return;
    try {
      await api.post(`/pick-lists/${r.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const bulk = useBulkSelect(filtered);

  const bulkActions: BulkAction<PickListRow>[] = [
    {
      id: "submit",
      label: "Submit",
      disabled: (sel) => !sel.every((r) => r.status === "Draft"),
      run: async (sel) => {
        for (const r of sel) {
          try { await api.post(`/pick-lists/${r.id}/submit`, {}); } catch { /* keep going */ }
        }
        bulk.clear();
        await load();
      },
    },
    {
      id: "cancel",
      label: "Cancel",
      destructive: true,
      disabled: (sel) => !sel.every((r) => r.status === "Draft" || r.status === "Submitted"),
      run: async (sel) => {
        if (!confirm(`Cancel ${sel.length} pick list${sel.length === 1 ? "" : "s"}?`)) return;
        for (const r of sel) {
          try { await api.post(`/pick-lists/${r.id}/cancel`, {}); } catch { /* keep going */ }
        }
        bulk.clear();
        await load();
      },
    },
  ];

  // First-run tour. Fires once per user per browser (localStorage); the
  // Tour component auto-skips any step whose selector isn't present on
  // the DOM so visible options vary with the user's data without errors.
  const tourSteps: TourStep[] = [
    {
      target: "[data-tour=pick-lists-header]",
      title: "Pick lists",
      body: "A pick list is a warehouse-walk sheet that aggregates one or more delivery notes, sorted by warehouse pick order. Workers tick items off as they pull them.",
      placement: "bottom",
    },
    {
      target: "[data-tour=pick-lists-new]",
      title: "Create your first pick list",
      body: "Pick a batch of delivery notes to combine into a single walk sheet. Lines are sorted by warehouse so one worker can pull them in one pass.",
      placement: "bottom",
    },
    {
      target: "[data-tour=pick-lists-filter]",
      title: "Save your workbench view",
      body: "Filter by status or warehouse, then click the Views menu to save it. Views persist to your account so they're there on your next shift and on another device.",
      placement: "bottom",
    },
  ];

  const columns: Column<PickListRow>[] = [
    {
      header: (
        <SelectCheckbox
          checked={bulk.allSelected}
          indeterminate={bulk.someSelected}
          onChange={bulk.toggleAll}
          aria-label="Select all pick lists"
        />
      ),
      cell: (r) => (
        <SelectCheckbox
          checked={bulk.isSelected(r.id)}
          onChange={() => bulk.toggle(r.id)}
          aria-label={`Select ${r.name}`}
        />
      ),
    },
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/stock/pick-lists/${r.id}`}
          onClick={(e) => {
            e.preventDefault();
            router.push(`/stock/pick-lists/${r.id}`);
          }}
          className="font-medium text-brand-600 hover:underline"
        >
          {r.name}
        </a>
      ),
    },
    { header: "Purpose", cell: (r) => <span className="text-sm">{r.purpose}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{dateShort(r.postingDate)}</span> },
    { header: "Picker", cell: (r) => <span className="text-sm text-ink-soft">{r.pickedBy ?? "—"}</span> },
    { header: "Rows", align: "right", cell: (r) => <span className="font-mono">{r._count.items}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Draft" && (
            <button onClick={(e) => submitPL(r, e)} className="btn-ghost btn-sm">Submit</button>
          )}
          {(r.status === "Draft" || r.status === "Submitted") && (
            <button onClick={(e) => cancelPL(r, e)} className="btn-ghost btn-sm text-red-600">Cancel</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="stock-web.pick-lists.v1" steps={tourSteps} />
      <div data-tour="pick-lists-header">
      <PageHeader
        title="Pick Lists"
        subtitle="Aggregate multiple delivery notes into a single warehouse-walk sheet, sorted by warehouse."
        actions={
          <span data-tour="pick-lists-new">
            <Button variant="brand" onClick={openCreate}>+ From delivery notes</Button>
          </span>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="pick-lists-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search pick-list number…" }}
          actions={
            <SavedViewsMenu
              controller={views}
              currentFilters={{ search }}
              onApply={(f) => setSearch(f.search)}
            />
          }
        />
        </div>
        <BulkActionBar
          count={bulk.selectedRows.length}
          selected={bulk.selectedRows}
          actions={bulkActions}
          onClear={bulk.clear}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search ? "No matching pick lists" : "No pick lists yet",
            description: "Select some delivery notes and create a pick list to give the warehouse worker an ordered walk sheet.",
            action: !search && <Button variant="brand" onClick={openCreate}>+ From delivery notes</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Create pick list from delivery notes"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => submit(e as unknown as React.FormEvent)}>
              Create pick list
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Picker (optional)">
            <input
              className="input"
              value={pickedBy}
              onChange={(e) => setPickedBy(e.target.value)}
              placeholder="Worker's name"
            />
          </FormField>
          <FormField label="Delivery notes" required>
            <div className="border border-line rounded max-h-96 overflow-y-auto">
              {dns.map((dn) => (
                <label
                  key={dn.id}
                  className="flex items-center gap-2 p-2 border-b border-line last:border-0 hover:bg-surface-sunken cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={pickedDnIds.has(dn.id)}
                    onChange={() => toggleDN(dn.id)}
                  />
                  <span className="font-medium text-ink">{dn.name}</span>
                  <span className="text-xs text-ink-muted">{dn.customer.customerName}</span>
                  <span className="text-xs text-ink-muted ms-auto">
                    {dn.items.length} line{dn.items.length === 1 ? "" : "s"} · {dateShort(dn.postingDate)}
                  </span>
                </label>
              ))}
              {dns.length === 0 && (
                <div className="p-3 text-sm text-ink-muted italic">No pickable delivery notes.</div>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-muted">{pickedDnIds.size} selected</div>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
