"use client";

// Invitee-side booking cancellation. URL: /book/cancel/:token
// Token is issued at booking time and stored on the BookedMeeting row.

import { useState } from "react";
import { useParams } from "next/navigation";
import { bookingApi } from "../../../../lib/api";

export default function CancelBookingPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await bookingApi.cancel(token, reason || undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancellation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "80px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      {done ? (
        <>
          <h1 style={{ fontSize: 22 }}>Cancelled</h1>
          <p style={{ color: "#374151" }}>Your booking has been cancelled. The host has been notified.</p>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 22 }}>Cancel your booking</h1>
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            This will free the slot up for someone else. If you'd like to reschedule, please book a new time.
          </p>
          <label style={{ display: "grid", gap: 4, marginTop: 16 }}>
            <span style={{ fontSize: 13 }}>Reason (optional)</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 14 }} />
          </label>
          {error ? <p style={{ color: "#b91c1c", fontSize: 13 }}>{error}</p> : null}
          <button
            type="button"
            onClick={cancel}
            disabled={submitting}
            style={{
              marginTop: 16,
              background: "#b91c1c",
              color: "white",
              border: "none",
              padding: "10px 16px",
              borderRadius: 6,
              cursor: submitting ? "wait" : "pointer",
              fontSize: 15,
            }}
          >
            {submitting ? "Cancelling…" : "Cancel booking"}
          </button>
        </>
      )}
    </main>
  );
}
