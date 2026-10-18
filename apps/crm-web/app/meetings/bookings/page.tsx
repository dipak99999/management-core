"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";

// Meeting Scheduler — booked-meeting inbox for the owner. Cancel /
// mark completed / mark no-show from here.

interface BookedMeeting {
  id: string;
  startsAt: string;
  endsAt: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteePhone: string | null;
  inviteeNotes: string | null;
  inviteeTimezone: string | null;
  status: "Booked" | "Cancelled" | "Completed" | "NoShow";
  cancellationReason: string | null;
  meetingUrl: string | null;
  meetingType: { title: string; slug: string; colorHex: string | null } | null;
  createdAt: string;
}

type StatusFilter = "all" | "upcoming" | "past" | "cancelled";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${dateShort(iso)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function BookingsPage() {
  const [rows, setRows] = useState<BookedMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("upcoming");

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const params: string[] = [];
      if (statusFilter === "cancelled") params.push("status=Cancelled");
      else if (statusFilter === "upcoming") params.push(`from=${new Date().toISOString()}`);
      else if (statusFilter === "past") params.push(`to=${new Date().toISOString()}`);
      const qs = params.length ? `?${params.join("&")}` : "";
      setRows(await api.get<BookedMeeting[]>(`/booked-meetings${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useListPageCommands({
    singular: "Booking",
    plural: "Bookings",
    refresh: load,
  });

  async function setStatus(id: string, status: BookedMeeting["status"], reason?: string): Promise<void> {
    try {
      await api.patch(`/booked-meetings/${id}/status`, {
        status,
        cancellationReason: reason ?? null,
      });
      await load();
      setToast({ kind: "success", message: `Marked as ${status}` });
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Failed" });
    }
  }

  const filtered = useMemo(() => rows, [rows]);

  const columns: Column<BookedMeeting>[] = [
    {
      header: "When",
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{fmtDateTime(r.startsAt)}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {Math.round((new Date(r.endsAt).getTime() - new Date(r.startsAt).getTime()) / 60000)}m
            {r.inviteeTimezone ? ` · invitee ${r.inviteeTimezone}` : ""}
          </div>
        </div>
      ),
    },
    { header: "Type", cell: (r) => r.meetingType?.title ?? "-" },
    {
      header: "Invitee",
      cell: (r) => (
        <div>
          <div>{r.inviteeName}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>{r.inviteeEmail}</div>
        </div>
      ),
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      cell: (r) => {
        if (r.status !== "Booked") return null;
        const now = new Date();
        const start = new Date(r.startsAt);
        const isPast = start < now;
        return (
          <div style={{ display: "flex", gap: 6 }}>
            {isPast ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setStatus(r.id, "Completed")}>Completed</Button>
                <Button variant="secondary" size="sm" onClick={() => setStatus(r.id, "NoShow")}>No-show</Button>
              </>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  const reason = prompt("Cancellation reason? (optional)") ?? "";
                  void setStatus(r.id, "Cancelled", reason);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title="Booked meetings" subtitle="Every slot booked through your public pages." />
      <FilterBar
        filters={
          <Segmented
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "upcoming", label: "Upcoming" },
              { value: "past", label: "Past" },
              { value: "cancelled", label: "Cancelled" },
              { value: "all", label: "All" },
            ]}
          />
        }
        actions={<SavedViewsControls listKey="crm-web:meetings-bookings" current={{ statusFilter }} onApply={(fv) => { setStatusFilter(fv.statusFilter); }} />}
      />
      {error ? <div style={{ color: "#b91c1c", padding: 12 }}>{error}</div> : null}
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        empty={{ title: "No bookings yet" }}
      />
      {toast ? <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}
