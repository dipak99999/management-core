"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { AppShell, Icon } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  relativeTime,
  type Column,
} from "../../../../components/ui";

// Marketing P3 — MarketingApproval inbox.
//
// Design pattern reference: project-opennext-erp-design-pattern.
// PageHeader + Segmented + DataTable + Drawer, no bespoke Tailwind.
//
// Talks directly to crm-service /approvals — same base-URL trick the other
// marketing admin pages use so the shell's api client (auth-service) is not
// required for a service that lives elsewhere.

const CRM_BASE =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

function crmToken(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

// Auto-clear stale JWT + bounce to /login on 401 — per
// feedback-stale-jwt-401 memory. Otherwise every admin call would 401-loop
// with an "Invalid token" error the user can't recover from.
function handle401(res: Response) {
  if (res.status !== 401) return;
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("lumaara.session");
  } catch {
    // ignore
  }
  window.location.href = "/login";
}

async function crmFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${CRM_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${crmToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    handle401(res);
    throw new Error("Unauthenticated");
  }
  if (res.status === 204) return undefined as unknown as T;
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// ─── Types ──────────────────────────────────────────────────────────────

type ApprovalStatus = "Pending" | "Approved" | "Rejected" | "Withdrawn";
type ApprovableDoctype = "Campaign" | "SocialPost" | "Broadcast";

interface DocSummary {
  id: string;
  name: string;
  subject: string | null;
  status: string;
}

interface Approval {
  id: string;
  tenantId: string;
  doctype: ApprovableDoctype;
  docId: string;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  doc: DocSummary | null;
}

interface TenantConfig {
  requireMarketingApproval: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

// The underlying doc pages live in different apps — this hop encodes which
// app the shell should send the reviewer to when they click a doc name.
function detailUrlFor(doctype: ApprovableDoctype, docId: string): string {
  switch (doctype) {
    case "Campaign":
      return `/crm/campaigns/${docId}`;
    case "SocialPost":
      return `/crm/social`;
    case "Broadcast":
      return `/admin/broadcasts`;
    default:
      return "#";
  }
}

function DoctypeBadge({ doctype }: { doctype: ApprovableDoctype }) {
  // Neutral badges — StatusBadge palette is aimed at workflow states, but the
  // doctype axis reads as metadata rather than status. Keeps colours calm.
  const label =
    doctype === "SocialPost" ? "Social" : doctype === "Broadcast" ? "Broadcast" : "Campaign";
  return <span className="badge-gray">{label}</span>;
}

// ─── Page ───────────────────────────────────────────────────────────────

type StatusFilter = "Pending" | "All" | "Approved" | "Rejected" | "Withdrawn";

export default function ApprovalsInboxPage() {
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<
    { kind: "info" | "success" | "error"; message: string } | null
  >(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Pending");

  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Approve/Reject drawer
  const [showAction, setShowAction] = useState<null | {
    row: Approval;
    kind: "approve" | "reject";
  }>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        statusFilter === "All" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
      const [rs, cfg] = await Promise.all([
        crmFetch<Approval[]>(`/approvals${qs}`),
        crmFetch<TenantConfig>(`/approvals/config/tenant`).catch(() => null),
      ]);
      setRows(Array.isArray(rs) ? rs : []);
      if (cfg) setConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useListPageCommands({
    singular: "Approval",
    plural: "Approvals",
    refresh: load,
  });

  // ─── Counts (for Segmented badges) ────────────────────────────────────
  // We only get the currently-filtered slice from the API, so counts show
  // the visible rows for the active filter and blank otherwise. For the
  // reviewer, "Pending" is the workflow number that matters — that's the
  // default filter and gets its own live count.
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      All: rows.length,
      Pending: 0,
      Approved: 0,
      Rejected: 0,
      Withdrawn: 0,
    };
    for (const r of rows) {
      c[r.status as StatusFilter] = (c[r.status as StatusFilter] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  async function toggleRequire(newVal: boolean) {
    if (savingConfig) return;
    setSavingConfig(true);
    try {
      const cfg = await crmFetch<TenantConfig>(`/approvals/config/tenant`, {
        method: "PATCH",
        body: JSON.stringify({ requireMarketingApproval: newVal }),
      });
      setConfig(cfg);
      setToast({
        kind: "success",
        message: newVal
          ? "Marketing approvals are now required before sending"
          : "Marketing approvals are optional — sends will proceed without one",
      });
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to update setting",
      });
    } finally {
      setSavingConfig(false);
    }
  }

  async function openApprove(row: Approval) {
    setShowAction({ row, kind: "approve" });
    setNotes("");
    setReason("");
  }

  async function openReject(row: Approval) {
    setShowAction({ row, kind: "reject" });
    setNotes("");
    setReason("");
  }

  async function submitAction() {
    if (!showAction || busy) return;
    setBusy(true);
    try {
      const { row, kind } = showAction;
      if (kind === "approve") {
        await crmFetch(`/approvals/${row.id}/approve`, {
          method: "POST",
          body: JSON.stringify({ notes: notes || null }),
        });
        setToast({ kind: "success", message: "Approval granted" });
      } else {
        if (!reason.trim()) {
          setToast({ kind: "error", message: "A rejection reason is required" });
          setBusy(false);
          return;
        }
        await crmFetch(`/approvals/${row.id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason, notes: notes || null }),
        });
        setToast({ kind: "info", message: "Approval rejected — requester notified" });
      }
      setShowAction(null);
      await load();
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Action failed",
      });
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Approval>[] = [
    {
      header: "When",
      cell: (r) => (
        <span className="text-xs text-ink-muted" title={dateShort(r.requestedAt)}>
          {relativeTime(r.requestedAt)}
        </span>
      ),
    },
    {
      header: "Doctype",
      cell: (r) => <DoctypeBadge doctype={r.doctype} />,
    },
    {
      header: "Document",
      cell: (r) => (
        <div>
          <a
            href={detailUrlFor(r.doctype, r.docId)}
            className="font-medium text-ink hover:text-brand-700"
          >
            {r.doc?.name ?? r.docId}
          </a>
          {r.doc?.subject && (
            <div className="text-xs text-ink-muted truncate max-w-[380px]">
              {r.doc.subject}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Requester",
      cell: (r) => (
        <span className="text-xs text-ink-soft font-mono">{r.requestedBy}</span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Pending" ? (
          <div className="flex items-center gap-1 justify-end">
            <Button size="sm" variant="secondary" onClick={() => openReject(r)}>
              Reject
            </Button>
            <Button size="sm" variant="brand" onClick={() => openApprove(r)}>
              Approve
            </Button>
          </div>
        ) : r.status === "Rejected" && r.rejectionReason ? (
          <span
            className="text-xs text-ink-muted truncate max-w-[200px] block"
            title={r.rejectionReason}
          >
            {r.rejectionReason}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Approvals"
        subtitle="Pending marketing sign-offs — Campaigns, Social Posts, and Broadcasts awaiting reviewer approval."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing", href: "/admin/marketing" },
          { label: "Approvals" },
        ]}
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => load()} disabled={loading}>
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
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
        {/* ── Tenant setting card ────────────────────────────────────── */}
        {config && (
          <Card className="p-4">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="font-semibold text-ink mb-1">
                  Require approval before sending
                </div>
                <p className="text-sm text-ink-soft max-w-xl">
                  When on, Campaigns / Social Posts / Broadcasts refuse to
                  leave Draft/Scheduled without an active MarketingApproval
                  (approved within the last 30 days). Turning this off restores
                  the default no-gate behaviour immediately.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={config.requireMarketingApproval}
                  disabled={savingConfig}
                  onChange={(e) => toggleRequire(e.target.checked)}
                />
                <span className="text-ink">
                  {config.requireMarketingApproval ? "Required" : "Optional"}
                </span>
              </label>
            </div>
          </Card>
        )}

        {/* ── Filter ─────────────────────────────────────────────────── */}
        <Segmented<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "Pending", label: "Pending", count: statusFilter === "Pending" ? counts.Pending : undefined },
            { value: "All", label: "All", count: statusFilter === "All" ? counts.All : undefined },
            { value: "Approved", label: "Approved", count: statusFilter === "Approved" ? counts.Approved : undefined },
            { value: "Rejected", label: "Rejected", count: statusFilter === "Rejected" ? counts.Rejected : undefined },
            { value: "Withdrawn", label: "Withdrawn", count: statusFilter === "Withdrawn" ? counts.Withdrawn : undefined },
          ]}
        />

        {/* ── Table ─────────────────────────────────────────────────── */}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.shield,
            title:
              statusFilter === "Pending"
                ? "No pending approvals"
                : "No approvals to show",
            description:
              statusFilter === "Pending"
                ? "You're all caught up. New requests will land here — take a coffee break."
                : "Try a different filter or ask a marketer to submit something for review.",
          }}
        />
      </div>

      {/* ── Approve/Reject drawer ─────────────────────────────────── */}
      <Drawer
        open={!!showAction}
        onClose={() => setShowAction(null)}
        title={
          showAction?.kind === "approve"
            ? `Approve ${showAction.row.doctype} "${showAction.row.doc?.name ?? showAction.row.docId}"`
            : `Reject ${showAction?.row.doctype ?? ""} "${showAction?.row.doc?.name ?? ""}"`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAction(null)}>
              Cancel
            </Button>
            <Button
              variant={showAction?.kind === "approve" ? "brand" : "danger"}
              onClick={() => void submitAction()}
              disabled={busy || (showAction?.kind === "reject" && !reason.trim())}
            >
              {busy
                ? "Working…"
                : showAction?.kind === "approve"
                  ? "Approve"
                  : "Reject"}
            </Button>
          </>
        }
      >
        {showAction && (
          <div className="space-y-4">
            <Card className="p-3 text-xs text-ink-soft">
              <div className="font-medium text-ink mb-1">
                {showAction.row.doc?.name ?? showAction.row.docId}
              </div>
              {showAction.row.doc?.subject && (
                <div className="text-ink-muted">{showAction.row.doc.subject}</div>
              )}
              <div className="mt-2 text-ink-muted">
                Requested {relativeTime(showAction.row.requestedAt)} by{" "}
                <span className="font-mono">{showAction.row.requestedBy}</span>
              </div>
              {showAction.row.notes && (
                <div className="mt-2 whitespace-pre-wrap text-ink-soft">
                  <span className="font-medium text-ink">Requester notes: </span>
                  {showAction.row.notes}
                </div>
              )}
            </Card>

            {showAction.kind === "reject" && (
              <FormField label="Reason" required hint="Shown to the requester in-app + email.">
                <input
                  className="input"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Body has unresolved merge var {{first_name}}"
                />
              </FormField>
            )}

            <FormField
              label="Notes"
              hint={
                showAction.kind === "approve"
                  ? "Optional — appended to the approval record."
                  : "Optional — additional context beyond the reason."
              }
            >
              <textarea
                className="input"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </FormField>
          </div>
        )}
      </Drawer>
    </AppShell>
  );
}
