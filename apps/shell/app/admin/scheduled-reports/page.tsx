"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface SavedReport { id: string; name: string; doctype: string }
interface Schedule {
  id: string;
  name: string;
  frequency: string;
  hourOfDay: number;
  dayOfWeek: number;
  dayOfMonth: number;
  emailTo: string;
  format: string;
  enabled: boolean;
  lastRunAt: string | null;
  savedReport: { id: string; name: string; doctype: string };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ScheduledReportsPage() {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [form, setForm] = useState({
    savedReportId: "",
    frequency: "Daily" as "Daily" | "Weekly" | "Monthly",
    hourOfDay: 9,
    dayOfWeek: 1,
    dayOfMonth: 1,
    emailTo: "",
    format: "csv" as "csv" | "json",
  });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [sr, sav] = await Promise.all([
        dashboardApi.get<Schedule[]>("/scheduled-reports"),
        dashboardApi.get<SavedReport[]>("/reports-builder/saved"),
      ]);
      setRows(sr);
      setSaved(sav);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Scheduled Report",
    plural: "Scheduled Reports",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post("/scheduled-reports", form);
      setForm({ ...form, savedReportId: "", emailTo: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: Schedule) {
    setBusy(true);
    try {
      await dashboardApi.put(`/scheduled-reports/${s.id}`, { enabled: !s.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete schedule?")) return;
    try {
      await dashboardApi.delete(`/scheduled-reports/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function runNow() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await dashboardApi.post<{ ran: number; skipped: number }>(
        "/scheduled-reports/run?force=1",
        {},
      );
      setMsg(`Ran ${r.ran} · skipped ${r.skipped}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Scheduled reports" }]}
        title="Scheduled reports"
        subtitle="Send saved reports by email on a recurring schedule."
        actions={
          <Button variant="brand" onClick={runNow} disabled={busy} type="button">
            Run all now
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Toast kind="success" message={msg} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">

      <form onSubmit={create} className="bg-white p-4 rounded shadow space-y-2">
        <div className="grid grid-cols-4 gap-2">
          <select
            className="col-span-2 border rounded px-3 py-2"
            value={form.savedReportId}
            onChange={(e) => setForm({ ...form, savedReportId: e.target.value })}
            required
          >
            <option value="">Saved report…</option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.doctype})
              </option>
            ))}
          </select>
          <select
            className="border rounded px-3 py-2"
            value={form.frequency}
            onChange={(e) =>
              setForm({ ...form, frequency: e.target.value as "Daily" | "Weekly" | "Monthly" })
            }
          >
            <option>Daily</option>
            <option>Weekly</option>
            <option>Monthly</option>
          </select>
          <input
            type="number"
            min={0}
            max={23}
            className="border rounded px-3 py-2"
            value={form.hourOfDay}
            onChange={(e) => setForm({ ...form, hourOfDay: Number(e.target.value) })}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
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
          {form.frequency === "Monthly" && (
            <input
              type="number"
              min={1}
              max={28}
              className="border rounded px-3 py-2"
              value={form.dayOfMonth}
              onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}
            />
          )}
          <input
            className="col-span-2 border rounded px-3 py-2"
            placeholder="Recipients (comma-separated emails)"
            value={form.emailTo}
            onChange={(e) => setForm({ ...form, emailTo: e.target.value })}
            required
          />
          <select
            className="border rounded px-3 py-2"
            value={form.format}
            onChange={(e) => setForm({ ...form, format: e.target.value as "csv" | "json" })}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <button
          disabled={busy}
          className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          Add schedule
        </button>
      </form>

      <table className="w-full bg-white rounded shadow overflow-hidden text-sm">
        <thead className="bg-gray-100 text-start text-gray-600">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Report</th>
            <th className="px-4 py-2">When</th>
            <th className="px-4 py-2">Recipients</th>
            <th className="px-4 py-2">Last run</th>
            <th className="px-4 py-2">Enabled</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2 font-mono">{r.name}</td>
              <td className="px-4 py-2">
                {r.savedReport.name}{" "}
                <span className="text-xs text-gray-500">({r.savedReport.doctype})</span>
              </td>
              <td className="px-4 py-2 text-xs">
                {r.frequency}
                {r.frequency === "Weekly" ? ` (${DAYS[r.dayOfWeek]})` : ""}
                {r.frequency === "Monthly" ? ` (day ${r.dayOfMonth})` : ""} @{" "}
                {r.hourOfDay}:00 UTC
              </td>
              <td className="px-4 py-2 text-xs">{r.emailTo}</td>
              <td className="px-4 py-2 text-xs">
                {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "never"}
              </td>
              <td className="px-4 py-2">
                <button
                  onClick={() => toggle(r)}
                  className={`px-2 py-0.5 rounded text-xs ${
                    r.enabled ? "bg-green-100 text-green-800" : "bg-gray-200"
                  }`}
                >
                  {r.enabled ? "On" : "Off"}
                </button>
              </td>
              <td className="px-4 py-2 text-end">
                <button onClick={() => del(r.id)} className="text-red-600 text-xs">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
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
