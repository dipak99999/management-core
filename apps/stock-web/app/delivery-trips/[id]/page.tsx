"use client";

import { use, useCallback, useEffect, useState } from "react";
import { authApi } from "../../../lib/auth-api";
import { DocActivityPanel, NextActionsPanel } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../components/ui";

interface Stop {
  id: string;
  sequence: number;
  customerName: string;
  addressLine: string | null;
  status: string;
  arrivedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  deliveryNote: { name: string };
}

interface Trip {
  id: string;
  name: string;
  driverName: string | null;
  vehicleNo: string | null;
  scheduledStart: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: string;
  remarks: string | null;
  stops: Stop[];
}

// Module 47 — Delivery Trip detail. Renders the ordered stops with
// per-stop action buttons for the driver: Arrived / Delivered / Failed.
// When every stop settles, the trip auto-completes on the backend.
export default function DeliveryTripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Trip>(`/delivery-trips/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function startTrip() {
    try {
      await api.post(`/delivery-trips/${id}/start`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function markStop(stopId: string, status: "Arrived" | "Delivered" | "Failed") {
    setBusy(stopId);
    setError(null);
    try {
      const notes =
        status === "Failed"
          ? (prompt("Reason for failed delivery?") ?? "")
          : null;
      await api.post(`/delivery-trips/${id}/stops/${stopId}`, {
        status,
        notes: notes || null,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <main className="p-8 space-y-4">
        <PageHeader title="Loading…" />
        {error && <Toast kind="error" message={error} />}
      </main>
    );
  }

  const doneCount = data.stops.filter(
    (s) => s.status === "Delivered" || s.status === "Failed",
  ).length;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Delivery Trips", href: "/stock/delivery-trips" },
          { label: data.name },
        ]}
        title={data.name}
        subtitle={`${data.driverName ?? "—"}${data.vehicleNo ? ` · ${data.vehicleNo}` : ""} · ${doneCount}/${data.stops.length} stops complete${data.scheduledStart ? ` · Scheduled ${dateShort(data.scheduledStart)}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            {data.status === "Scheduled" && (
              <Button variant="brand" onClick={startTrip}>Start trip</Button>
            )}
          </div>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <NextActionsPanel
        doctype="DeliveryTrip"
        docId={id}
        heading="What next?"
        fetchChips={() => authApi.post("/ai/next-actions", { doctype: "DeliveryTrip", docId: id })}
        callService={(method, path, body) => {
          if (method === "POST") return api.post(path, body ?? {});
          if (method === "PUT") return api.put(path, body ?? {});
          if (method === "DELETE") return api.del(path);
          return Promise.resolve();
        }}
        onDone={load}
      />

            <Card className="p-0 overflow-hidden">
        {/* Desktop: dense table. Mobile: tap-friendly stop cards. */}
        <div className="hidden md:block">
          <table className="table">
            <thead>
              <tr>
                <th className="w-12 text-center">#</th>
                <th>DN</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Arrived</th>
                <th>Completed</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.stops.map((stop) => (
                <tr key={stop.id}>
                  <td className="text-center font-mono">{stop.sequence}</td>
                  <td className="font-mono text-sm">{stop.deliveryNote.name}</td>
                  <td>
                    <div className="text-sm text-ink">{stop.customerName}</div>
                    {stop.notes && <div className="text-xs text-ink-muted">{stop.notes}</div>}
                  </td>
                  <td>
                    <StatusBadge status={stop.status} />
                  </td>
                  <td className="text-xs text-ink-muted">
                    {stop.arrivedAt ? new Date(stop.arrivedAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="text-xs text-ink-muted">
                    {stop.completedAt ? new Date(stop.completedAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="text-end">
                    {data.status === "InProgress" && stop.status !== "Delivered" && stop.status !== "Failed" && (
                      <div className="flex items-center justify-end gap-1">
                        {stop.status === "Pending" && (
                          <button
                            onClick={() => markStop(stop.id, "Arrived")}
                            className="btn-ghost btn-sm"
                            disabled={busy === stop.id}
                          >
                            Arrived
                          </button>
                        )}
                        <button
                          onClick={() => markStop(stop.id, "Delivered")}
                          className="btn-ghost btn-sm text-green-700"
                          disabled={busy === stop.id}
                        >
                          Delivered
                        </button>
                        <button
                          onClick={() => markStop(stop.id, "Failed")}
                          className="btn-ghost btn-sm text-red-600"
                          disabled={busy === stop.id}
                        >
                          Failed
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="md:hidden divide-y divide-line">
          {data.stops.map((stop) => {
            const settled = stop.status === "Delivered" || stop.status === "Failed";
            return (
              <li
                key={stop.id}
                className={`px-4 py-3 ${
                  stop.status === "Delivered"
                    ? "bg-green-50"
                    : stop.status === "Failed"
                      ? "bg-red-50"
                      : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink/5 text-xs font-semibold font-mono text-ink"
                    aria-hidden
                  >
                    {stop.sequence}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">{stop.customerName}</div>
                        <div className="text-xs text-ink-muted font-mono truncate">
                          {stop.deliveryNote.name}
                        </div>
                      </div>
                      <StatusBadge status={stop.status} />
                    </div>
                    {stop.notes && (
                      <div className="mt-1 text-xs text-ink-muted">{stop.notes}</div>
                    )}
                    {(stop.arrivedAt || stop.completedAt) && (
                      <div className="mt-1 text-[11px] text-ink-muted">
                        {stop.arrivedAt && (
                          <span>Arr {new Date(stop.arrivedAt).toLocaleTimeString()}</span>
                        )}
                        {stop.arrivedAt && stop.completedAt && <span> · </span>}
                        {stop.completedAt && (
                          <span>Done {new Date(stop.completedAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {data.status === "InProgress" && !settled && (
                  <div className="mt-3 flex items-center gap-2">
                    {stop.status === "Pending" && (
                      <button
                        onClick={() => markStop(stop.id, "Arrived")}
                        disabled={busy === stop.id}
                        className="btn-secondary btn-sm h-10 flex-1"
                      >
                        Arrived
                      </button>
                    )}
                    <button
                      onClick={() => markStop(stop.id, "Delivered")}
                      disabled={busy === stop.id}
                      className="btn-brand btn-sm h-10 flex-1"
                    >
                      Delivered
                    </button>
                    <button
                      onClick={() => markStop(stop.id, "Failed")}
                      disabled={busy === stop.id}
                      className="btn-secondary btn-sm h-10 flex-1 text-red-700"
                    >
                      Failed
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="DeliveryTrip" docId={id} />
      </div>
    </>
  );
}
