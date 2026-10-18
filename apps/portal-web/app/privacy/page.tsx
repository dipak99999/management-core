"use client";

import { showToast } from "../../lib/toast";

import { useEffect, useState } from "react";
import { accApi, loadSession } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  relativeTime,
  type Column,
} from "../../components/ui";

interface DsrRow {
  id: string;
  name: string;
  kind: "Export" | "Erasure";
  status: "Received" | "InProgress" | "Completed" | "Rejected";
  completedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

interface ConsentRow {
  id: string;
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
  createdAt: string;
}

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

async function downloadExport(id: string, name: string): Promise<void> {
  const raw = localStorage.getItem("lumaara.portal");
  const token = raw ? (JSON.parse(raw) as { token?: string }).token ?? "" : "";
  const r = await fetch(`${ACC}/portal/dsr/${id}/export`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    showToast(`Download failed: ${r.status}`, "error");
    return;
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PrivacyPage() {
  const [rows, setRows] = useState<DsrRow[] | null>(null);
  const [consent, setConsent] = useState<ConsentRow | null>(null);
  const [kind, setKind] = useState<"Export" | "Erasure">("Export");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load(): Promise<void> {
    const [dsrs, c] = await Promise.all([
      accApi.get<DsrRow[]>("/portal/dsr"),
      accApi.get<ConsentRow | null>("/portal/consent"),
    ]);
    setRows(dsrs);
    setConsent(c);
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      window.location.href = "/login";
      return;
    }
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  async function saveConsent(
    analytics: boolean,
    marketing: boolean,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await accApi.post<ConsentRow>("/portal/consent", { analytics, marketing });
      setMsg("Preferences updated");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await accApi.post("/portal/dsr", { kind, notes: notes || null });
      setNotes("");
      setMsg("Request submitted — staff will review shortly");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<DsrRow>[] = [
    {
      header: "Request",
      cell: (r) => <span className="font-mono text-sm text-ink">{r.name}</span>,
    },
    { header: "Type", cell: (r) => r.kind },
    {
      header: "Status",
      cell: (r) => (
        <div>
          <StatusBadge status={r.status} />
          {r.rejectedReason && (
            <div className="text-xs text-red-700 mt-1">{r.rejectedReason}</div>
          )}
        </div>
      ),
    },
    {
      header: "Submitted",
      cell: (r) => (
        <span className="text-ink-soft">{relativeTime(r.createdAt)}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.kind === "Export" && r.status === "Completed" ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => downloadExport(r.id, r.name)}
          >
            Download JSON
          </Button>
        ) : null,
    },
  ];

  if (rows === null && !error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "Privacy & data" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-24 w-full" rounded="rounded-lg" />
        <Skeleton className="h-40 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Privacy & data" },
        ]}
        title="Privacy & data"
        subtitle="Manage cookie preferences, and submit a request to export or erase your personal data."
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => history.back()}
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast
          kind="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {msg && (
        <Toast
          kind="success"
          message={msg}
          onDismiss={() => setMsg(null)}
        />
      )}

      <Card className="p-5">
        <SectionHeader title="Cookie & tracking preferences" />
        <p className="text-xs text-ink-muted mb-4">
          Essential cookies are always on. Toggle optional categories below.
          {consent && (
            <span className="ms-1">
              Last updated {dateShort(consent.createdAt)}.
            </span>
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-ink-muted/10 rounded-lg p-3">
            <div className="text-sm font-medium text-ink">Essential</div>
            <div className="text-xs text-ink-muted mt-1">
              Sign-in session & security. Required.
            </div>
            <div className="text-xs mt-2 text-green-700 font-medium">
              Always on
            </div>
          </div>
          <label className="border border-ink-muted/10 rounded-lg p-3 flex flex-col cursor-pointer hover:border-brand-200 transition">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink">Analytics</div>
              <input
                type="checkbox"
                checked={consent?.analytics ?? false}
                onChange={(e) =>
                  saveConsent(e.target.checked, consent?.marketing ?? false)
                }
                disabled={busy}
              />
            </div>
            <div className="text-xs text-ink-muted mt-1">
              Anonymous usage data to improve the portal.
            </div>
          </label>
          <label className="border border-ink-muted/10 rounded-lg p-3 flex flex-col cursor-pointer hover:border-brand-200 transition">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink">Marketing</div>
              <input
                type="checkbox"
                checked={consent?.marketing ?? false}
                onChange={(e) =>
                  saveConsent(consent?.analytics ?? false, e.target.checked)
                }
                disabled={busy}
              />
            </div>
            <div className="text-xs text-ink-muted mt-1">
              Product updates & promotional emails.
            </div>
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader title="Submit a data request" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <FormField label="Request type" required>
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as "Export" | "Erasure")
              }
              className="input"
            >
              <option value="Export">Export my data</option>
              <option value="Erasure">Erase my data</option>
            </select>
          </FormField>
          <FormField label="Notes (optional)">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason or additional context…"
              className="input"
            />
          </FormField>
          <div>
            <Button
              variant="primary"
              type="button"
              onClick={submit}
              disabled={busy}
              className="w-full"
            >
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </div>
        {kind === "Erasure" && (
          <div className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
            Erasure removes your personal contact details from our records.
            Historical invoices and transactions remain (they are legally
            required to be retained), but your name, email, phone, and address
            will be anonymized.
          </div>
        )}
      </Card>

      <section>
        <SectionHeader title="Your requests" />
        <DataTable<DsrRow>
          columns={columns}
          rows={rows ?? []}
          rowKey={(r) => r.id}
          empty={{
            title: "No requests yet",
            description:
              "You have not submitted any data export or erasure requests.",
          }}
        />
      </section>
    </main>
  );
}
