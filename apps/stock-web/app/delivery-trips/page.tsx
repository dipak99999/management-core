"use client";

import { useEffect, useMemo, useState } from "react";
import { Tour, useListPageCommands, type TourStep, useRealtimeList, SavedViewsControls } from "@lumaara/web-ui";
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

interface TripRow {
  id: string;
  name: string;
  driverName: string | null;
  vehicleNo: string | null;
  scheduledStart: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: string;
  _count: { stops: number };
}

interface DNOption {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  customer: { customerName: string };
}

// Module 47 — Delivery Trip list + create-from-DNs + start.
export default function DeliveryTripsPage() {
  const [rows, setRows] = useState<TripRow[]>([]);
  const [dns, setDNs] = useState<DNOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickedDnIds, setPickedDnIds] = useState<string[]>([]);
  const [form, setForm] = useState({ driverName: "", vehicleNo: "", scheduledStart: "" });
  const { qs } = useCompanyScope();

  async function load() {
    setLoading(true);
    try {
      const [t, d] = await Promise.all([
        api.get<TripRow[]>(`/delivery-trips${qs}`),
        api.get<DNOption[]>("/delivery-notes"),
      ]);
      setRows(t);
      setDNs(d.filter((x) => x.status === "Draft" || x.status === "Submitted"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  useListPageCommands({
    singular: "Delivery Trip",
    plural: "Delivery Trips",
    refresh: load,
  });
  useRealtimeList("delivery-trip", load);

  const tourSteps: TourStep[] = [
    {
      target: "[data-tour=dt-header]",
      title: "Delivery trips",
      body: "A trip bundles delivery notes for a single driver + vehicle on a day. Each stop auto-rolls up to Completed when every stop settles.",
      placement: "bottom",
    },
    {
      target: "[data-tour=dt-filter]",
      title: "Status filters",
      body: "Switch between Scheduled, InProgress, and Completed to focus on the trips that need you right now.",
      placement: "bottom",
    },
  ];

  function openCreate() {
    setPickedDnIds([]);
    setForm({ driverName: "", vehicleNo: "", scheduledStart: "" });
    setShowForm(true);
  }

  function toggleDN(id: string) {
    setPickedDnIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function moveStop(id: string, dir: -1 | 1) {
    setPickedDnIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pickedDnIds.length === 0) {
      setError("Pick at least one DN");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post("/delivery-trips/from-dns", {
        deliveryNoteIds: pickedDnIds,
        driverName: form.driverName || null,
        vehicleNo: form.vehicleNo || null,
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : null,
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function startTrip(t: TripRow, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/delivery-trips/${t.id}/start`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function cancelTrip(t: TripRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Cancel ${t.name}?`)) return;
    try {
      await api.post(`/delivery-trips/${t.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.driverName?.toLowerCase().includes(q) ?? false),
    );
  }, [rows, search]);

  const columns: Column<TripRow>[] = [
    {
      header: "Name",
      cell: (t) => (
        <a href={`/stock/delivery-trips/${t.id}`} className="font-medium text-brand-600 hover:underline">
          {t.name}
        </a>
      ),
    },
    { header: "Driver", cell: (t) => <span className="text-sm">{t.driverName ?? "—"}</span> },
    {
      header: "Vehicle",
      cell: (t) => <span className="text-sm font-mono">{t.vehicleNo ?? "—"}</span>,
    },
    {
      header: "Scheduled",
      cell: (t) => (
        <span className="text-sm">{t.scheduledStart ? dateShort(t.scheduledStart) : "—"}</span>
      ),
    },
    { header: "Stops", align: "right", cell: (t) => <span className="font-mono">{t._count.stops}</span> },
    { header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <div className="flex items-center justify-end gap-1">
          {t.status === "Scheduled" && (
            <button onClick={(e) => startTrip(t, e)} className="btn-ghost btn-sm">Start trip</button>
          )}
          {(t.status === "Scheduled" || t.status === "InProgress") && (
            <button onClick={(e) => cancelTrip(t, e)} className="btn-ghost btn-sm text-red-600">
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="stock-web.delivery-trips.v1" steps={tourSteps} />
      <div data-tour="dt-header">
      <PageHeader
        title="Delivery Trips"
        subtitle="Group outgoing DNs into a driver's route. Sequence stops in the create dialog or on the detail page."
        actions={<Button variant="brand" onClick={openCreate}>+ New trip</Button>}
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="dt-filter">
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: "Search trip / driver…" }}
            actions={<SavedViewsControls listKey="stock-web:delivery-trips" current={{ search }} onApply={(f) => setSearch(f.search)} />}
          />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.send,
            title: search ? "No matching trips" : "No delivery trips yet",
            description: "Group outgoing DNs into a route for a driver.",
            action: !search && <Button variant="brand" onClick={openCreate}>+ New trip</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New delivery trip"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => submit(e as unknown as React.FormEvent)}>
              Create trip
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Driver">
              <input
                className="input"
                value={form.driverName}
                onChange={(e) => setForm({ ...form, driverName: e.target.value })}
              />
            </FormField>
            <FormField label="Vehicle">
              <input
                className="input font-mono"
                value={form.vehicleNo}
                onChange={(e) => setForm({ ...form, vehicleNo: e.target.value.toUpperCase() })}
              />
            </FormField>
          </div>
          <FormField label="Scheduled start">
            <input
              type="datetime-local"
              className="input"
              value={form.scheduledStart}
              onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })}
            />
          </FormField>
          <FormField label="Delivery notes (order = stop sequence)" required>
            <div className="border border-line rounded max-h-96 overflow-y-auto">
              {dns.map((dn) => {
                const idx = pickedDnIds.indexOf(dn.id);
                const picked = idx >= 0;
                return (
                  <div
                    key={dn.id}
                    className="flex items-center gap-2 p-2 border-b border-line last:border-0 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggleDN(dn.id)}
                    />
                    <span className="font-medium text-ink">{dn.name}</span>
                    <span className="text-xs text-ink-muted">{dn.customer.customerName}</span>
                    {picked && (
                      <div className="ms-auto flex items-center gap-1">
                        <span className="text-xs font-mono text-brand-600">#{idx + 1}</span>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => moveStop(dn.id, -1)}
                          disabled={idx === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => moveStop(dn.id, 1)}
                          disabled={idx === pickedDnIds.length - 1}
                        >
                          ↓
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {dns.length === 0 && (
                <div className="p-3 text-sm text-ink-muted italic">No deliverable DNs.</div>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-muted">{pickedDnIds.length} stops</div>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
