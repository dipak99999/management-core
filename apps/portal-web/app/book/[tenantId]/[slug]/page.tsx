"use client";

// Public booking page — the invitee-facing "pick a slot" UI. No auth.
// URL: /book/:tenantId/:slug
//
// Flow:
//   1. Load meeting type + first 14 days of slots.
//   2. Invitee picks a date (day column) → time (slot chip).
//   3. Invitee fills name/email → we POST /public/bookings/.../book and
//      show a confirmation (with a cancel link).

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { bookingApi, type BookingConfirmation, type BookingSlot, type PublicMeetingType } from "../../../../lib/api";

function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

function fmtLongDate(day: string, tz: string): string {
  // Interpret as a date at noon UTC to avoid tz drift on parsing.
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
}

export default function PublicBookingPage() {
  const params = useParams<{ tenantId: string; slug: string }>();
  const tenantId = params?.tenantId ?? "";
  const slug = params?.slug ?? "";
  const inviteeTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const [mt, setMt] = useState<PublicMeetingType | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pickedSlot, setPickedSlot] = useState<BookingSlot | null>(null);
  const [form, setForm] = useState({ inviteeName: "", inviteeEmail: "", inviteePhone: "", inviteeNotes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<BookingConfirmation | null>(null);

  useEffect(() => {
    if (!tenantId || !slug) return;
    setLoading(true);
    (async () => {
      try {
        const type = await bookingApi.getType(tenantId, slug);
        if (!type) {
          setError("This booking page doesn't exist or is no longer active.");
          return;
        }
        setMt(type);
        const from = new Date(Date.now() + type.minNoticeMinutes * 60000);
        const days = Math.min(type.maxAdvanceDays, 21);
        const to = new Date(Date.now() + days * 24 * 3600 * 1000);
        const s = await bookingApi.listSlots(tenantId, slug, from, to);
        setSlots(s?.slots ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId, slug]);

  // Group slots by local (invitee TZ) day for the two-pane layout.
  const slotsByDay = useMemo(() => {
    const map = new Map<string, BookingSlot[]>();
    for (const s of slots) {
      const localDay = new Date(s.startsAt).toLocaleDateString("en-CA", { timeZone: inviteeTz });
      const arr = map.get(localDay) ?? [];
      arr.push(s);
      map.set(localDay, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots, inviteeTz]);

  // Auto-pick the first day with slots when data lands.
  useEffect(() => {
    if (!pickedDay && slotsByDay.length > 0) setPickedDay(slotsByDay[0][0]);
  }, [pickedDay, slotsByDay]);

  async function submit(): Promise<void> {
    if (!pickedSlot || !mt) return;
    setSubmitting(true);
    setError(null);
    try {
      const conf = await bookingApi.book(tenantId, slug, {
        startsAt: pickedSlot.startsAt,
        inviteeName: form.inviteeName.trim(),
        inviteeEmail: form.inviteeEmail.trim(),
        inviteePhone: form.inviteePhone.trim() || null,
        inviteeNotes: form.inviteeNotes.trim() || null,
        inviteeTimezone: inviteeTz,
      });
      setConfirmed(conf);
      if (conf.redirectUrl) {
        window.location.href = conf.redirectUrl;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main style={{ padding: 40 }}>Loading…</main>;
  }
  if (error && !mt) {
    return <main style={{ padding: 40, color: "#b91c1c" }}>{error}</main>;
  }
  if (!mt) {
    return <main style={{ padding: 40 }}>Not found.</main>;
  }
  if (confirmed) {
    return (
      <main style={{ maxWidth: 560, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 22 }}>You're booked</h1>
        <p style={{ color: "#374151" }}>
          {new Date(confirmed.startsAt).toLocaleString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          })}
        </p>
        {confirmed.meetingUrl ? (
          <p>
            <a href={confirmed.meetingUrl} target="_blank" rel="noreferrer">Join link</a>
          </p>
        ) : null}
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 20 }}>
          Need to cancel? Use{" "}
          <a href={`/book/cancel/${confirmed.cancellationToken}`}>this link</a>.
        </p>
      </main>
    );
  }

  const daySlots = pickedDay ? (slotsByDay.find(([d]) => d === pickedDay)?.[1] ?? []) : [];

  return (
    <main style={{ maxWidth: 960, margin: "24px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ borderLeft: `4px solid ${mt.colorHex ?? "#4f46e5"}`, paddingLeft: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{mt.title}</h1>
        <div style={{ color: "#6b7280", fontSize: 14 }}>
          {mt.durationMinutes} min · {mt.locationType}
        </div>
        {mt.description ? (
          <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{mt.description}</p>
        ) : null}
      </div>

      {pickedSlot ? (
        <section>
          <button
            type="button"
            onClick={() => setPickedSlot(null)}
            style={{ background: "none", border: "none", color: "#4f46e5", cursor: "pointer", padding: 0, fontSize: 14 }}
          >
            ← Choose a different time
          </button>
          <h2 style={{ marginTop: 12 }}>
            {new Date(pickedSlot.startsAt).toLocaleString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </h2>
          <div style={{ display: "grid", gap: 12, marginTop: 16, maxWidth: 480 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Your name *</span>
              <input value={form.inviteeName} onChange={(e) => setForm({ ...form, inviteeName: e.target.value })} required style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Email *</span>
              <input type="email" value={form.inviteeEmail} onChange={(e) => setForm({ ...form, inviteeEmail: e.target.value })} required style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Phone</span>
              <input value={form.inviteePhone} onChange={(e) => setForm({ ...form, inviteePhone: e.target.value })} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>What would you like to discuss?</span>
              <textarea rows={3} value={form.inviteeNotes} onChange={(e) => setForm({ ...form, inviteeNotes: e.target.value })} style={inputStyle} />
            </label>
            {error ? <div style={{ color: "#b91c1c", fontSize: 13 }}>{error}</div> : null}
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !form.inviteeName.trim() || !form.inviteeEmail.trim()}
              style={{
                background: "#4f46e5",
                color: "white",
                border: "none",
                padding: "10px 16px",
                borderRadius: 6,
                cursor: submitting ? "wait" : "pointer",
                fontSize: 15,
                opacity: submitting || !form.inviteeName.trim() || !form.inviteeEmail.trim() ? 0.5 : 1,
              }}
            >
              {submitting ? "Booking…" : "Confirm booking"}
            </button>
          </div>
        </section>
      ) : (
        <section style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24 }}>
          <div>
            <h3 style={{ marginTop: 0, fontSize: 14, textTransform: "uppercase", color: "#6b7280", letterSpacing: 0.5 }}>Date</h3>
            {slotsByDay.length === 0 ? (
              <p style={{ fontSize: 14, color: "#6b7280" }}>No availability in the next few weeks.</p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {slotsByDay.map(([day, arr]) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setPickedDay(day)}
                    style={{
                      textAlign: "left",
                      padding: "8px 12px",
                      border: `1px solid ${pickedDay === day ? "#4f46e5" : "#e5e7eb"}`,
                      background: pickedDay === day ? "#eef2ff" : "white",
                      color: pickedDay === day ? "#4338ca" : "#111827",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{fmtLongDate(day, inviteeTz)}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{arr.length} slot{arr.length === 1 ? "" : "s"}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 style={{ marginTop: 0, fontSize: 14, textTransform: "uppercase", color: "#6b7280", letterSpacing: 0.5 }}>
              Time · {inviteeTz}
            </h3>
            {daySlots.length === 0 ? (
              <p style={{ fontSize: 14, color: "#6b7280" }}>Pick a date on the left.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                {daySlots.map((s) => (
                  <button
                    key={s.startsAt}
                    type="button"
                    onClick={() => setPickedSlot(s)}
                    style={{
                      padding: "10px 12px",
                      border: "1px solid #4f46e5",
                      background: "white",
                      color: "#4338ca",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {fmtTime(s.startsAt, inviteeTz)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 14,
};
