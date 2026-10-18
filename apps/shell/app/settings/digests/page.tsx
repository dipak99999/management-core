"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface Schedule {
  id: string;
  frequency: string;
  sections: string[];
  hourOfDay: number;
  dayOfWeek: number;
  enabled: boolean;
  lastSentAt: string | null;
}

const SECTIONS = ["sales_invoices", "payments", "expense_claims", "leaves", "notifications"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function DigestSettingsPage() {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [form, setForm] = useState({
    frequency: "Daily" as "Daily" | "Weekly",
    sections: new Set<string>(["sales_invoices", "payments"]),
    hourOfDay: 9,
    dayOfWeek: 1,
    enabled: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<Schedule[]>("/digests"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Digest",
    plural: "Digests",
    refresh: load,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/digests", {
        frequency: form.frequency,
        sections: Array.from(form.sections),
        hourOfDay: form.hourOfDay,
        dayOfWeek: form.dayOfWeek,
        enabled: form.enabled,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);
  async function del(id: string) {
    if (deletingId) return; // ignore rapid clicks
    if (!confirm("Delete this digest schedule? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await api.delete(`/digests/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSec(s: string) {
    const next = new Set(form.sections);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setForm({ ...form, sections: next });
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Settings" }, { label: "Digest subscriptions" }]}
        title="Digest subscriptions"
        subtitle="Daily / weekly email rollups of activity in your tenant."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-3xl space-y-4">

      <form onSubmit={save} className="bg-white p-4 rounded shadow space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <select
            className="border rounded px-3 py-2"
            value={form.frequency}
            onChange={(e) =>
              setForm({ ...form, frequency: e.target.value as "Daily" | "Weekly" })
            }
          >
            <option>Daily</option>
            <option>Weekly</option>
          </select>
          <input
            type="number"
            min={0}
            max={23}
            className="border rounded px-3 py-2"
            placeholder="Hour (0..23 UTC)"
            value={form.hourOfDay}
            onChange={(e) => setForm({ ...form, hourOfDay: Number(e.target.value) })}
          />
          {form.frequency === "Weekly" && (
            <select
              className="border rounded px-3 py-2"
              value={form.dayOfWeek}
              onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="text-sm space-y-1">
          <div className="text-xs uppercase text-gray-500">Sections</div>
          {SECTIONS.map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.sections.has(s)}
                onChange={() => toggleSec(s)}
              />
              <span className="capitalize">{s.replace(/_/g, " ")}</span>
            </label>
          ))}
        </div>
        <button
          disabled={busy}
          className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          Save schedule
        </button>
      </form>

      <table className="w-full bg-white rounded shadow overflow-hidden text-sm">
        <thead className="bg-gray-100 text-start text-gray-600">
          <tr>
            <th className="px-4 py-2">Frequency</th>
            <th className="px-4 py-2">Sections</th>
            <th className="px-4 py-2">Next</th>
            <th className="px-4 py-2">Enabled</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2">
                {r.frequency}
                {r.frequency === "Weekly" ? ` (${DAYS[r.dayOfWeek]})` : ""} @{" "}
                {r.hourOfDay}:00 UTC
              </td>
              <td className="px-4 py-2 text-xs">{(r.sections || []).join(", ")}</td>
              <td className="px-4 py-2 text-xs">
                {r.lastSentAt
                  ? `Last ${new Date(r.lastSentAt).toLocaleString()}`
                  : "never"}
              </td>
              <td className="px-4 py-2 text-xs">{r.enabled ? "Yes" : "No"}</td>
              <td className="px-4 py-2 text-end">
                <button
                  onClick={() => del(r.id)}
                  disabled={deletingId === r.id}
                  className="text-red-600 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deletingId === r.id ? "Deleting…" : "Delete"}
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                No schedules yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </AppShell>
  );
}
