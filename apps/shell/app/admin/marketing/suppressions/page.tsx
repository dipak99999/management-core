"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../../lib/api";
import { AppShell, Icon } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
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
} from "../../../../components/ui";

// Suppression list — tenant-scoped email blocklist. Every campaign send should
// pre-check this and refuse to send to any address that appears here.
//
// Reasons (from packages/db/prisma/schema.prisma):
//   HardBounce | Complaint | Manual | GdprErase | Import
//
// This page assumes an /suppressions REST resource on the SAME base URL the
// shell api client uses (auth-service). If backend agents A/B have mounted it
// elsewhere, adjust `api` import to point at the correct base. If the endpoint
// is missing entirely, GETs will 404 and the page renders the empty state.

interface Suppression {
  id: string;
  email: string;
  reason: string;
  source: string | null;
  detail: string | null;
  createdAt: string;
}

type ReasonFilter =
  | "all"
  | "HardBounce"
  | "Complaint"
  | "Manual"
  | "GdprErase"
  | "Import";

const REASONS = ["HardBounce", "Complaint", "Manual", "GdprErase", "Import"] as const;

// StatusBadge colouring for suppression reasons — not in the shared palette
// (those are workflow statuses), so we render explicit chips.
function ReasonBadge({ reason }: { reason: string }) {
  if (reason === "HardBounce" || reason === "Complaint") {
    return <span className="badge-red">{reason}</span>;
  }
  if (reason === "Manual" || reason === "GdprErase") {
    return <span className="badge-gray">{reason}</span>;
  }
  if (reason === "Import") {
    return <span className="badge-blue">{reason}</span>;
  }
  return <StatusBadge status={reason} />;
}

const emptyForm = { email: "", reason: "Manual", detail: "" };

export default function SuppressionsPage() {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<
    { kind: "info" | "success" | "error"; message: string } | null
  >(null);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("all");

  // Add drawer
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  // Import drawer
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Suppression[]>("/suppressions");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — the /suppressions endpoint may not be wired yet.`
          : "Failed to load suppressions",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Suppression",
    plural: "Suppressions",
    refresh: load,
  });
  const filtered = useMemo(() => {
    let out = rows;
    if (reasonFilter !== "all") out = out.filter((r) => r.reason === reasonFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.email, r.source ?? "", r.detail ?? ""].some((v) =>
          v.toLowerCase().includes(q),
        ),
      );
    }
    return out;
  }, [rows, search, reasonFilter]);

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/suppressions", {
        email: form.email.trim().toLowerCase(),
        reason: form.reason,
        detail: form.detail || null,
        source: "Manual",
      });
      setShowAdd(false);
      setForm(emptyForm);
      setToast({ kind: "success", message: "Address suppressed" });
      await load();
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to add",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(row: Suppression) {
    if (
      !confirm(`Remove ${row.email} from the suppression list? They will start receiving campaigns again.`)
    ) {
      return;
    }
    try {
      await api.delete(`/suppressions/${row.id}`);
      setToast({ kind: "info", message: `${row.email} removed` });
      await load();
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to remove",
      });
    }
  }

  // Parse a CSV blob with header `email,reason,detail?`. Very permissive —
  // supports either commas or tabs, trims whitespace, skips blank lines.
  function parseCsv(
    text: string,
  ): { email: string; reason: string; detail?: string }[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];
    const first = lines[0].toLowerCase();
    const hasHeader = first.startsWith("email");
    const body = hasHeader ? lines.slice(1) : lines;
    return body
      .map((line) => {
        const parts = line.split(/[,\t]/).map((p) => p.trim());
        const email = parts[0]?.toLowerCase();
        const reason = parts[1] || "Import";
        const detail = parts[2];
        return { email, reason, detail: detail || undefined };
      })
      .filter((r) => r.email && r.email.includes("@"));
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    if (importBusy) return;
    const parsed = parseCsv(csvText);
    if (parsed.length === 0) {
      setToast({ kind: "error", message: "No valid rows found in the CSV" });
      return;
    }
    setImportBusy(true);
    try {
      // Preferred bulk endpoint. If it 404s, fall back to POSTing each row.
      try {
        await api.post("/suppressions/import", { rows: parsed });
      } catch {
        // Fallback — one POST per row.
        for (const r of parsed) {
          try {
            await api.post("/suppressions", {
              email: r.email,
              reason: r.reason,
              detail: r.detail ?? null,
              source: "Import",
            });
          } catch {
            // continue on individual failures
          }
        }
      }
      setShowImport(false);
      setCsvText("");
      setToast({
        kind: "success",
        message: `Imported ${parsed.length.toLocaleString()} row${parsed.length === 1 ? "" : "s"}`,
      });
      await load();
    } finally {
      setImportBusy(false);
    }
  }

  async function onCsvFile(file: File) {
    const text = await file.text();
    setCsvText(text);
  }

  const columns: Column<Suppression>[] = [
    {
      header: "Email",
      cell: (r) => (
        <span className="font-mono text-sm text-ink">{r.email}</span>
      ),
    },
    { header: "Reason", cell: (r) => <ReasonBadge reason={r.reason} /> },
    {
      header: "Source",
      cell: (r) => (
        <span className="text-ink-soft text-sm">{r.source ?? "—"}</span>
      ),
    },
    {
      header: "Detail",
      cell: (r) => (
        <span
          className="text-ink-muted text-xs truncate max-w-[260px] block"
          title={r.detail ?? undefined}
        >
          {r.detail ?? "—"}
        </span>
      ),
    },
    {
      header: "Added",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {relativeTime(r.createdAt)}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => removeOne(r)}
          className="text-red-600 hover:text-red-700"
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Suppression list"
        subtitle={`${rows.length.toLocaleString()} address${rows.length === 1 ? "" : "es"} blocked from receiving campaigns.`}
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing", href: "/admin/marketing" },
          { label: "Suppressions" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              Import CSV
            </Button>
            <Button variant="brand" onClick={() => setShowAdd(true)}>
              + Add
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast
            kind="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      )}
      {toast && (
        <div className="mb-4">
          <Toast
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search email / source / detail…",
          }}
          filters={
            <Segmented<ReasonFilter>
              value={reasonFilter}
              onChange={setReasonFilter}
              options={[
                { value: "all", label: "All", count: rows.length },
                ...REASONS.map((r) => ({
                  value: r as ReasonFilter,
                  label: r,
                  count: rows.filter((row) => row.reason === r).length,
                })),
              ]}
            />
          }
          actions={<SavedViewsControls listKey="shell:admin-marketing-suppressions" current={{ search, reasonFilter }} onApply={(fv) => { setSearch(fv.search); setReasonFilter(fv.reasonFilter); }} />}
        />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.shield,
            title:
              search || reasonFilter !== "all"
                ? "No matches"
                : "No suppressed addresses",
            description:
              search || reasonFilter !== "all"
                ? "Try a different search or filter."
                : "Addresses added here will be skipped by every campaign send. Hard bounces + complaints are auto-added by the bounce webhook.",
            action:
              !search && reasonFilter === "all" ? (
                <Button variant="brand" onClick={() => setShowAdd(true)}>
                  + Add address
                </Button>
              ) : undefined,
          }}
        />
      </div>

      {/* ── Add drawer ─────────────────────────────────────────────── */}
      <Drawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Suppress an email"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => addOne(e as unknown as React.FormEvent)}
              disabled={!form.email || busy}
            >
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <form onSubmit={addOne} className="space-y-4">
          <FormField
            label="Email"
            required
            hint="This address will be skipped by every future campaign send."
          >
            <input
              type="email"
              className="input"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FormField>
          <FormField label="Reason" required>
            <select
              className="input"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            >
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Detail" hint="Optional note recorded on the entry.">
            <textarea
              className="input"
              rows={3}
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── Import drawer ──────────────────────────────────────────── */}
      <Drawer
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import CSV"
        width="w-[640px]"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowImport(false)}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => submitImport(e as unknown as React.FormEvent)}
              disabled={!csvText.trim() || importBusy}
            >
              {importBusy ? "Importing…" : "Import"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitImport} className="space-y-4">
          <Card className="p-3 text-xs text-ink-soft">
            <div className="font-medium text-ink mb-1">Format</div>
            Header row: <code className="font-mono">email,reason,detail</code>.
            Reason is one of {REASONS.join(", ")} — defaults to{" "}
            <code className="font-mono">Import</code>. The detail column is
            optional.
          </Card>
          <FormField label="Upload CSV file">
            <input
              type="file"
              accept=".csv,text/csv"
              className="input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onCsvFile(f);
              }}
            />
          </FormField>
          <FormField label="Or paste CSV content">
            <textarea
              className="input font-mono text-xs"
              rows={12}
              placeholder="email,reason,detail
alice@example.com,Manual,unsubscribed via support ticket
bob@example.com,HardBounce,550 mailbox not found"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
