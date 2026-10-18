"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  relativeTime,
  type Column,
} from "../../components/ui";

// Meeting Scheduler — Zoho-Bookings-style CRUD for the owner.
// Two things live here:
//   1. Meeting Types (the bookable definition — duration, buffer, slug).
//   2. Availability Windows (weekly recurring hours the owner is free).
// Booked meetings are viewed at /meetings/bookings.

interface MeetingType {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  colorHex: string | null;
  locationType: "Video" | "Phone" | "InPerson" | "Custom";
  locationDetails: string | null;
  redirectUrl: string | null;
  active: boolean;
  updatedAt: string;
}

interface AvailabilityWindow {
  id: string;
  meetingTypeId: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
}

type StatusFilter = "all" | "active" | "draft";

interface TypeFormState {
  slug: string;
  title: string;
  description: string;
  durationMinutes: string;
  bufferMinutes: string;
  minNoticeMinutes: string;
  maxAdvanceDays: string;
  colorHex: string;
  locationType: "Video" | "Phone" | "InPerson" | "Custom";
  locationDetails: string;
  redirectUrl: string;
  active: boolean;
}

const emptyType: TypeFormState = {
  slug: "",
  title: "",
  description: "",
  durationMinutes: "30",
  bufferMinutes: "0",
  minNoticeMinutes: "60",
  maxAdvanceDays: "30",
  colorHex: "",
  locationType: "Video",
  locationDetails: "",
  redirectUrl: "",
  active: true,
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

function publicBookingUrl(slug: string, tenantId: string | null): string {
  const base = process.env.NEXT_PUBLIC_PORTAL_URL ?? "";
  if (!tenantId) return `${base}/book/<tenantId>/${slug}`;
  return `${base}/book/${tenantId}/${slug}`;
}

export default function MeetingsPage() {
  const [rows, setRows] = useState<MeetingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TypeFormState>(emptyType);
  const [saving, setSaving] = useState(false);

  const [windowsOpen, setWindowsOpen] = useState(false);
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [newWindow, setNewWindow] = useState({
    dayOfWeek: "1",
    startHHMM: "09:00",
    endHHMM: "17:00",
    timezone: (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "Asia/Kolkata",
    meetingTypeId: "",
  });

  const [tenantId, setTenantId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("lumaara.session");
      if (raw) setTenantId(JSON.parse(raw).tenantId ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.get<MeetingType[]>("/meeting-types"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  useListPageCommands({
    singular: "Meeting",
    plural: "Meetings",
    refresh: load,
  });
  async function loadWindows(): Promise<void> {
    try {
      setWindows(await api.get<AvailabilityWindow[]>("/meeting-types/windows/list"));
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Failed to load windows" });
    }
  }

  function openCreate(): void {
    setEditingId(null);
    setForm(emptyType);
    setDrawerOpen(true);
  }
  function openEdit(row: MeetingType): void {
    setEditingId(row.id);
    setForm({
      slug: row.slug,
      title: row.title,
      description: row.description ?? "",
      durationMinutes: String(row.durationMinutes),
      bufferMinutes: String(row.bufferMinutes),
      minNoticeMinutes: String(row.minNoticeMinutes),
      maxAdvanceDays: String(row.maxAdvanceDays),
      colorHex: row.colorHex ?? "",
      locationType: row.locationType,
      locationDetails: row.locationDetails ?? "",
      redirectUrl: row.redirectUrl ?? "",
      active: row.active,
    });
    setDrawerOpen(true);
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const body = {
        slug: form.slug.trim().toLowerCase(),
        title: form.title.trim(),
        description: form.description.trim() || null,
        durationMinutes: Number(form.durationMinutes),
        bufferMinutes: Number(form.bufferMinutes),
        minNoticeMinutes: Number(form.minNoticeMinutes),
        maxAdvanceDays: Number(form.maxAdvanceDays),
        colorHex: form.colorHex.trim() || null,
        locationType: form.locationType,
        locationDetails: form.locationDetails.trim() || null,
        redirectUrl: form.redirectUrl.trim() || null,
        active: form.active,
      };
      if (editingId) await api.patch(`/meeting-types/${editingId}`, body);
      else await api.post("/meeting-types", body);
      setDrawerOpen(false);
      await load();
      setToast({ kind: "success", message: editingId ? "Meeting type updated" : "Meeting type created" });
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm("Delete this meeting type? Existing bookings will remain.")) return;
    try {
      await api.del(`/meeting-types/${id}`);
      await load();
      setToast({ kind: "success", message: "Deleted" });
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Delete failed" });
    }
  }

  async function openWindows(): Promise<void> {
    setWindowsOpen(true);
    await loadWindows();
  }
  async function addWindow(): Promise<void> {
    try {
      await api.post("/meeting-types/windows", {
        dayOfWeek: Number(newWindow.dayOfWeek),
        startMinute: hhmmToMinutes(newWindow.startHHMM),
        endMinute: hhmmToMinutes(newWindow.endHHMM),
        timezone: newWindow.timezone,
        meetingTypeId: newWindow.meetingTypeId || null,
      });
      await loadWindows();
      setToast({ kind: "success", message: "Window added" });
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Failed" });
    }
  }
  async function removeWindow(id: string): Promise<void> {
    try {
      await api.del(`/meeting-types/windows/${id}`);
      await loadWindows();
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Failed" });
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "active" && !r.active) return false;
      if (statusFilter === "draft" && r.active) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q);
    });
  }, [rows, statusFilter, search]);

  const columns: Column<MeetingType>[] = [
    {
      header: "Title",
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.title}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>/{r.slug}</div>
        </div>
      ),
    },
    {
      header: "Duration",
      cell: (r) => `${r.durationMinutes}m${r.bufferMinutes ? ` +${r.bufferMinutes}m buf` : ""}`,
    },
    { header: "Location", cell: (r) => r.locationType },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.active ? "Active" : "Draft"} />,
    },
    { header: "Updated", cell: (r) => relativeTime(r.updatedAt) },
    {
      header: "Public URL",
      cell: (r) => (
        <button
          type="button"
          onClick={() => {
            const url = publicBookingUrl(r.slug, tenantId);
            navigator.clipboard.writeText(url).then(
              () => setToast({ kind: "success", message: "URL copied" }),
              () => setToast({ kind: "error", message: "Copy failed" }),
            );
          }}
          style={{ background: "none", border: "1px solid #d1d5db", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
        >
          Copy
        </button>
      ),
    },
    {
      header: "",
      cell: (r) => (
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => openEdit(r)}>Edit</Button>
          <Button variant="danger" size="sm" onClick={() => remove(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Meetings"
        subtitle="Public booking pages — like Calendly. Share a slug and prospects pick a slot."
        actions={
          <>
            <Button variant="secondary" onClick={openWindows}>My availability</Button>
            <Button onClick={openCreate}>New meeting type</Button>
          </>
        }
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search title or slug" }}
        filters={
          <Segmented
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "draft", label: "Draft" },
            ]}
        />
        }
        actions={<SavedViewsControls listKey="crm-web:meetings" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
      />
      {error ? <div style={{ color: "#b91c1c", padding: 12 }}>{error}</div> : null}
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        empty={{ title: "No meeting types yet", description: "Create one to start accepting bookings." }}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Edit meeting type" : "New meeting type"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editingId ? "Save" : "Create"}</Button>
          </>
        }
      >
        <FormField label="Title" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="30-minute discovery call" />
        </FormField>
        <FormField label="Slug" hint="Public URL segment. Lowercase, dashes, digits only.">
          <input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="discovery-call" />
        </FormField>
        <FormField label="Description">
          <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Duration (min)" required>
            <input className="input" type="number" min={5} max={1440} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
          </FormField>
          <FormField label="Buffer (min)" hint="Gap before + after each booking">
            <input className="input" type="number" min={0} max={240} value={form.bufferMinutes} onChange={(e) => setForm({ ...form, bufferMinutes: e.target.value })} />
          </FormField>
          <FormField label="Min notice (min)" hint="Earliest bookable slot from now">
            <input className="input" type="number" min={0} value={form.minNoticeMinutes} onChange={(e) => setForm({ ...form, minNoticeMinutes: e.target.value })} />
          </FormField>
          <FormField label="Max advance (days)" hint="Farthest bookable slot from now">
            <input className="input" type="number" min={1} max={365} value={form.maxAdvanceDays} onChange={(e) => setForm({ ...form, maxAdvanceDays: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Location">
          <select className="input" value={form.locationType} onChange={(e) => setForm({ ...form, locationType: e.target.value as TypeFormState["locationType"] })}>
            <option value="Video">Video call</option>
            <option value="Phone">Phone</option>
            <option value="InPerson">In-person</option>
            <option value="Custom">Custom</option>
          </select>
        </FormField>
        <FormField label="Location details" hint="e.g. Zoom link, phone number, address">
          <input className="input" value={form.locationDetails} onChange={(e) => setForm({ ...form, locationDetails: e.target.value })} />
        </FormField>
        <FormField label="Redirect URL" hint="Where to send the invitee after booking (optional)">
          <input className="input" value={form.redirectUrl} onChange={(e) => setForm({ ...form, redirectUrl: e.target.value })} placeholder="https://…" />
        </FormField>
        <FormField label="Color">
          <input type="color" value={form.colorHex || "#4f46e5"} onChange={(e) => setForm({ ...form, colorHex: e.target.value })} style={{ width: 60, height: 32 }} />
        </FormField>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active (accepts new bookings)
        </label>
      </Drawer>

      <Drawer
        open={windowsOpen}
        onClose={() => setWindowsOpen(false)}
        title="My availability"
        footer={<Button variant="secondary" onClick={() => setWindowsOpen(false)}>Done</Button>}
      >
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 0 }}>
          Windows apply to all your meeting types by default. Assign one to a specific type to
          override — useful for after-hours availability that only applies to demos.
        </p>

        <h4>Add window</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Day">
            <select className="input" value={newWindow.dayOfWeek} onChange={(e) => setNewWindow({ ...newWindow, dayOfWeek: e.target.value })}>
              {DOW_LABELS.map((l, i) => (
                <option key={i} value={i}>{l}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Timezone">
            <input className="input" value={newWindow.timezone} onChange={(e) => setNewWindow({ ...newWindow, timezone: e.target.value })} />
          </FormField>
          <FormField label="Start">
            <input className="input" type="time" value={newWindow.startHHMM} onChange={(e) => setNewWindow({ ...newWindow, startHHMM: e.target.value })} />
          </FormField>
          <FormField label="End">
            <input className="input" type="time" value={newWindow.endHHMM} onChange={(e) => setNewWindow({ ...newWindow, endHHMM: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Applies to" hint="Empty = all of your meeting types">
          <select className="input" value={newWindow.meetingTypeId} onChange={(e) => setNewWindow({ ...newWindow, meetingTypeId: e.target.value })}>
            <option value="">All types</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
        </FormField>
        <Button onClick={addWindow}>Add window</Button>

        <h4 style={{ marginTop: 24 }}>Current windows</h4>
        {windows.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 13 }}>No windows configured — nothing will be bookable.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={{ textAlign: "left", padding: 6 }}>Day</th>
                <th style={{ textAlign: "left", padding: 6 }}>Hours</th>
                <th style={{ textAlign: "left", padding: 6 }}>TZ</th>
                <th style={{ textAlign: "left", padding: 6 }}>Applies to</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => {
                const mt = w.meetingTypeId ? rows.find((r) => r.id === w.meetingTypeId) : null;
                return (
                  <tr key={w.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 6 }}>{DOW_LABELS[w.dayOfWeek]}</td>
                    <td style={{ padding: 6 }}>
                      {minutesToHHMM(w.startMinute)} – {minutesToHHMM(w.endMinute)}
                    </td>
                    <td style={{ padding: 6, fontFamily: "monospace" }}>{w.timezone}</td>
                    <td style={{ padding: 6 }}>{mt ? mt.title : "All types"}</td>
                    <td style={{ padding: 6 }}>
                      <button
                        type="button"
                        onClick={() => removeWindow(w.id)}
                        style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Drawer>

      {toast ? <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}
