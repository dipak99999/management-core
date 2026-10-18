"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  StatusBadge,
  Toast,
  type Column,
} from "../../../components/ui";

interface Dsr {
  id: string;
  name: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  subjectEmail: string | null;
  status: string;
  createdAt: string;
  rejectedReason: string | null;
  completedAt: string | null;
}
interface Policy {
  id: string;
  doctype: string;
  retainDays: number;
  strategy: string;
  enabled: boolean;
  lastRunAt: string | null;
}

const DOCTYPES = ["Customer", "Supplier", "Employee", "AuditLog", "ErrorLog"];
const SUBJECT_TYPES = ["Customer", "Supplier", "Employee", "PortalUser"];

const emptyDsr = {
  kind: "Export" as "Export" | "Erasure",
  subjectType: "Customer",
  subjectId: "",
  subjectEmail: "",
  notes: "",
};

const emptyPol = {
  doctype: "Customer",
  retainDays: 730,
  strategy: "anonymize" as "delete" | "anonymize" | "archive",
  enabled: true,
};

export default function CompliancePage() {
  const [dsrs, setDsrs] = useState<Dsr[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [showDsrForm, setShowDsrForm] = useState(false);
  const [showPolForm, setShowPolForm] = useState(false);
  const [dsrForm, setDsrForm] = useState(emptyDsr);
  const [polForm, setPolForm] = useState(emptyPol);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportPayload, setExportPayload] = useState<Record<string, unknown> | null>(null);

  async function load() {
    try {
      const [d, p] = await Promise.all([
        dashboardApi.get<Dsr[]>("/dsr"),
        dashboardApi.get<Policy[]>("/retention"),
      ]);
      setDsrs(d);
      setPolicies(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Compliance",
    plural: "Compliance",
    refresh: load,
  });

  async function submitDsr(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post("/dsr", {
        ...dsrForm,
        subjectEmail: dsrForm.subjectEmail || null,
        notes: dsrForm.notes || null,
      });
      setDsrForm(emptyDsr);
      setShowDsrForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function fulfil(id: string) {
    if (!confirm("Fulfil this request? Erasures are permanent.")) return;
    setBusy(true);
    setError(null);
    setExportPayload(null);
    try {
      const r = await dashboardApi.post<{
        ok: boolean;
        kind: string;
        payload: Record<string, unknown> | null;
      }>(`/dsr/${id}/fulfil`, {});
      if (r.kind === "Export" && r.payload) {
        setExportPayload(r.payload);
      } else {
        setMsg("Erasure completed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    const reason = prompt("Rejection reason?");
    if (!reason) return;
    try {
      await dashboardApi.post(`/dsr/${id}/reject`, { reason });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function downloadExport() {
    if (!exportPayload) return;
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dsr-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function addPolicy(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await dashboardApi.post("/retention", polForm);
      setPolForm(emptyPol);
      setShowPolForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function togglePolicy(p: Policy) {
    try {
      await dashboardApi.put(`/retention/${p.id}`, { enabled: !p.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function runRetention() {
    if (!confirm("Run all enabled retention policies now?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await dashboardApi.post<{
        policiesEvaluated: number;
        results: { doctype: string; strategy: string; affected: number }[];
      }>("/retention/run", {});
      setMsg(
        `${r.policiesEvaluated} policies evaluated: ` +
          r.results.map((x) => `${x.doctype}=${x.affected}`).join(", "),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const dsrColumns: Column<Dsr>[] = [
    { header: "Name", cell: (d) => <span className="font-mono text-xs">{d.name}</span> },
    { header: "Kind", cell: (d) => <span className="text-ink-soft">{d.kind}</span> },
    {
      header: "Subject",
      cell: (d) => (
        <span className="text-xs text-ink-soft">
          {d.subjectType} · {d.subjectId.slice(0, 8)}…
        </span>
      ),
    },
    { header: "Email", cell: (d) => <span className="text-xs text-ink-soft">{d.subjectEmail ?? "—"}</span> },
    {
      header: "Status",
      cell: (d) => (
        <div>
          <StatusBadge status={d.status} />
          {d.rejectedReason && (
            <div className="text-xs text-red-500 mt-1">{d.rejectedReason}</div>
          )}
        </div>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (d) =>
        d.status !== "Completed" && d.status !== "Rejected" ? (
          <div className="flex justify-end gap-2 text-xs">
            <button onClick={() => fulfil(d.id)} className="text-brand-600 hover:underline">
              Fulfil
            </button>
            <button onClick={() => reject(d.id)} className="text-red-600 hover:underline">
              Reject
            </button>
          </div>
        ) : null,
    },
  ];

  const polColumns: Column<Policy>[] = [
    { header: "Doctype", cell: (p) => <span className="text-ink font-medium">{p.doctype}</span> },
    {
      header: "Retain days",
      align: "right",
      cell: (p) => <span className="tabular-nums text-ink-soft">{p.retainDays}</span>,
    },
    { header: "Strategy", cell: (p) => <span className="text-xs text-ink-soft">{p.strategy}</span> },
    {
      header: "Enabled",
      cell: (p) => (
        <button
          onClick={() => togglePolicy(p)}
          className={p.enabled ? "badge-green" : "badge-gray"}
        >
          {p.enabled ? "On" : "Off"}
        </button>
      ),
    },
    {
      header: "Last run",
      cell: (p) => (
        <span className="text-xs text-ink-muted">
          {p.lastRunAt ? new Date(p.lastRunAt).toLocaleString() : "never"}
        </span>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Compliance"
        subtitle="Data subject requests, retention policies, and audit exports."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Compliance" }]}
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Toast kind="success" message={msg} onDismiss={() => setMsg(null)} />
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Data Subject Requests"
            subtitle="Export or erasure requests for individuals."
            actions={
              <Button variant="brand" onClick={() => setShowDsrForm(true)}>
                + New request
              </Button>
            }
          />
          <DataTable
            columns={dsrColumns}
            rows={dsrs}
            rowKey={(d) => d.id}
            empty={{ title: "No requests", description: "Submit a data subject request above." }}
          />
          {exportPayload && (
            <div className="p-3 border-t border-ink-muted/10">
              <Toast
                kind="info"
                message="Export payload ready — click to download."
              />
              <div className="mt-2">
                <Button variant="brand" onClick={downloadExport}>
                  Download JSON
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Data Retention Policies"
            subtitle="Automatically anonymize, delete, or archive stale rows."
            actions={
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={runRetention} disabled={busy}>
                  Run policies now
                </Button>
                <Button variant="brand" onClick={() => setShowPolForm(true)}>
                  + Add policy
                </Button>
              </div>
            }
          />
          <DataTable
            columns={polColumns}
            rows={policies}
            rowKey={(p) => p.id}
            empty={{ title: "No policies", description: "Add a policy to retire stale data." }}
          />
        </Card>

        <Card>
          <CardHeader
            title="Audit log export"
            subtitle="Download all audit-log rows for a given date range."
          />
          <div className="p-4">
            <AuditExportForm />
          </div>
        </Card>
      </div>

      <Drawer
        open={showDsrForm}
        onClose={() => setShowDsrForm(false)}
        title="New data subject request"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDsrForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => submitDsr(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitDsr} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kind">
              <select
                className="input"
                value={dsrForm.kind}
                onChange={(e) =>
                  setDsrForm({ ...dsrForm, kind: e.target.value as "Export" | "Erasure" })
                }
              >
                <option>Export</option>
                <option>Erasure</option>
              </select>
            </FormField>
            <FormField label="Subject type">
              <select
                className="input"
                value={dsrForm.subjectType}
                onChange={(e) => setDsrForm({ ...dsrForm, subjectType: e.target.value })}
              >
                {SUBJECT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Subject ID" required>
            <input
              className="input font-mono"
              placeholder="uuid"
              value={dsrForm.subjectId}
              onChange={(e) => setDsrForm({ ...dsrForm, subjectId: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Subject email">
            <input
              className="input"
              placeholder="Optional"
              value={dsrForm.subjectEmail}
              onChange={(e) => setDsrForm({ ...dsrForm, subjectEmail: e.target.value })}
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              className="input"
              rows={3}
              value={dsrForm.notes}
              onChange={(e) => setDsrForm({ ...dsrForm, notes: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={showPolForm}
        onClose={() => setShowPolForm(false)}
        title="Add retention policy"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowPolForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => addPolicy(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Adding…" : "Add policy"}
            </Button>
          </>
        }
      >
        <form onSubmit={addPolicy} className="space-y-4">
          <FormField label="Doctype">
            <select
              className="input"
              value={polForm.doctype}
              onChange={(e) => setPolForm({ ...polForm, doctype: e.target.value })}
            >
              {DOCTYPES.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Retain days" required>
            <input
              type="number"
              min={1}
              className="input"
              value={polForm.retainDays}
              onChange={(e) => setPolForm({ ...polForm, retainDays: Number(e.target.value) })}
              required
            />
          </FormField>
          <FormField label="Strategy">
            <select
              className="input"
              value={polForm.strategy}
              onChange={(e) =>
                setPolForm({
                  ...polForm,
                  strategy: e.target.value as "delete" | "anonymize" | "archive",
                })
              }
            >
              <option value="anonymize">anonymize</option>
              <option value="delete">delete</option>
              <option value="archive">archive</option>
            </select>
          </FormField>
          <FormField label="Enabled">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={polForm.enabled}
                onChange={(e) => setPolForm({ ...polForm, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}

function AuditExportForm() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ACC =
    process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
  function download(format: "csv" | "json") {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("format", format);
    const token = (() => {
      if (typeof window === "undefined") return "";
      const raw = localStorage.getItem("lumaara.session");
      if (!raw) return "";
      try {
        return JSON.parse(raw).token as string;
      } catch {
        return "";
      }
    })();
    fetch(`${ACC}/audit-log/export?${params}`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FormField label="From">
        <input
          type="date"
          className="input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </FormField>
      <FormField label="To">
        <input
          type="date"
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </FormField>
      <Button variant="brand" onClick={() => download("csv")}>Download CSV</Button>
      <Button variant="secondary" onClick={() => download("json")}>JSON</Button>
    </div>
  );
}
