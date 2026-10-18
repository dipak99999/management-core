"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { loadSession, hasRole } from "../../../lib/auth";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  Card,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
} from "../../../components/ui";

interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  method: string;
  path: string;
  doctype: string | null;
  docId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  statusCode: number;
  payload: unknown;
  createdAt: string;
}
interface Envelope {
  items: AuditLog[];
  nextCursor: string | null;
  truncated: boolean;
}

const METHOD_COLOR: Record<string, string> = {
  POST:   "badge-green",
  PUT:    "badge-blue",
  DELETE: "badge-red",
  PATCH:  "badge-amber",
};

function methodClass(m: string): string {
  const base = m.split("-")[0];
  return METHOD_COLOR[base] ?? "badge-gray";
}

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doctype, setDoctype] = useState("");
  const [userId, setUserId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chainResult, setChainResult] = useState<{
    ok: boolean;
    total: number;
    firstBrokenSequence: number | null;
    reason?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function verifyChain() {
    setVerifying(true);
    setChainResult(null);
    setError(null);
    try {
      const res = await api.get<{
        ok: boolean;
        total: number;
        firstBrokenSequence: number | null;
        reason?: string;
      }>(`/audit-logs/verify`);
      setChainResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function loadPage(reset = false) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (doctype) params.set("doctype", doctype);
      if (userId) params.set("userId", userId);
      if (!reset && nextCursor) params.set("cursor", nextCursor);
      const env = await api.get<Envelope>(`/audit-logs?${params.toString()}`);
      setRows((prev) => (reset ? env.items : [...prev, ...env.items]));
      setNextCursor(env.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const s = loadSession();
    if (!s || !hasRole(s, "SystemManager")) {
      location.href = "/";
      return;
    }
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilter(e: React.FormEvent) {
    e.preventDefault();
    setNextCursor(null);
    loadPage(true);
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Audit Log"
        subtitle="Immutable hash-chained trail of every write action across the tenant. Every row hashes its content with the prior row's hash — tampering breaks the chain and is detectable via Verify integrity."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Audit Log" }]}
        actions={
          <Button
            variant="secondary"
            onClick={verifyChain}
            disabled={verifying}
            type="button"
          >
            {verifying ? "Verifying…" : "Verify integrity"}
          </Button>
        }
      />

      {chainResult && (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            chainResult.ok
              ? "border-success/30 bg-success-soft text-success"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {chainResult.ok ? (
            <>
              <strong>Chain intact.</strong> Verified {chainResult.total.toLocaleString()}{" "}
              audit rows — no gaps, no hash mismatches.
            </>
          ) : (
            <>
              <strong>Chain broken.</strong> Verified {chainResult.total.toLocaleString()}{" "}
              rows before the first anomaly at sequence #{chainResult.firstBrokenSequence}.{" "}
              {chainResult.reason}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          filters={
            <form onSubmit={applyFilter} className="flex flex-wrap items-end gap-2">
              <FormField label="Doctype">
                <input
                  className="input"
                  placeholder="e.g. SalesInvoice"
                  value={doctype}
                  onChange={(e) => setDoctype(e.target.value)}
                />
              </FormField>
              <FormField label="User ID">
                <input
                  className="input"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
              </FormField>
              <Button type="submit" variant="brand">Filter</Button>
              {(doctype || userId) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDoctype("");
                    setUserId("");
                    setNextCursor(null);
                    setTimeout(() => loadPage(true), 0);
                  }}
                >
                  Clear
                </Button>
              )}
            </form>
          }
        />

        <Card className="p-0 overflow-hidden">
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Doctype</th>
                  <th>Doc ID</th>
                  <th className="text-end">Status</th>
                  <th>IP</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td className="text-xs text-ink-soft">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="text-xs text-ink-soft">
                        {r.userEmail ?? <span className="text-ink-muted">—</span>}
                      </td>
                      <td>
                        <span className={methodClass(r.method)}>{r.method}</span>
                      </td>
                      <td className="text-xs text-ink-soft">{r.doctype ?? "—"}</td>
                      <td className="text-xs font-mono text-ink-soft">
                        {r.docId ? r.docId.slice(0, 10) : "—"}
                      </td>
                      <td
                        className={`text-xs text-end font-mono ${
                          r.statusCode >= 400 ? "text-red-600" : "text-ink-soft"
                        }`}
                      >
                        {r.statusCode}
                      </td>
                      <td className="text-xs text-ink-soft">{r.ipAddress ?? "—"}</td>
                      <td className="text-end">
                        <button
                          onClick={() => toggle(r.id)}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          {expanded.has(r.id) ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                    {expanded.has(r.id) && (
                      <tr>
                        <td colSpan={8} className="bg-surface-sunken text-xs">
                          <div className="text-ink-soft mb-1">Path: {r.path}</div>
                          {r.userAgent && (
                            <div className="text-ink-muted mb-1">UA: {r.userAgent}</div>
                          )}
                          {r.payload != null && (
                            <pre className="bg-white border border-ink-muted/10 p-2 rounded overflow-auto max-h-96 font-mono text-[11px]">
                              {JSON.stringify(r.payload, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <div className="empty-state">
                        <div className="empty-state-icon">{Icon.clock}</div>
                        <div className="empty-state-title">No audit entries</div>
                        <div className="empty-state-desc">Nothing matches your filters.</div>
                      </div>
                    </td>
                  </tr>
                )}
                {rows.length === 0 && loading && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-ink-muted text-sm">
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {nextCursor && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={() => loadPage(false)} disabled={loading}>
              {loading ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
