"use client";

// SCIM 2.0 provisioning tokens — issue + revoke screen.
//
// Each identity provider (Okta, Azure AD, Google Workspace, JumpCloud)
// needs its own long-lived bearer token to call /scim/v2. This page is
// the one place to generate + rotate them. Raw token is shown ONCE at
// issue; after that only the sha256 hash is stored, so the admin must
// paste it into the IdP connector before leaving the page.

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { showToast } from "../../../lib/toast";
import { AppShell, Icon, PageHeader } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button } from "../../../components/ui";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  defaultRole: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface IssueResult {
  id: string;
  name: string;
  prefix: string;
  defaultRole: string;
  createdAt: string;
  token: string; // the ONLY time we see this value
}

export default function ScimTokensPage() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [name, setName] = useState("");
  const [defaultRole, setDefaultRole] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [justIssued, setJustIssued] = useState<IssueResult | null>(null);

  async function load() {
    try {
      setRows(await api.get<TokenRow[]>("/scim-tokens"));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load SCIM tokens", "error");
    }
  }
  useEffect(() => { load(); }, []);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<IssueResult>("/scim-tokens", { name: name.trim(), defaultRole });
      setJustIssued(r);
      setName("");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to issue token", "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, label: string) {
    if (!confirm(`Revoke "${label}"? The identity provider using it will immediately stop being able to sync users.`)) return;
    try {
      await api.post(`/scim-tokens/${id}/revoke`, {});
      showToast("Token revoked", "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Revoke failed", "error");
    }
  }

  return (
    <AppShell moduleName="Settings" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.shield}
        eyebrow="Settings"
        title="SCIM Provisioning Tokens"
        subtitle="Issue a token per identity provider (Okta, Azure AD, Google Workspace, JumpCloud). Paste it into the IdP's SCIM connector so new/removed users auto-sync."
      />

      {justIssued && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 mb-6">
          <div className="text-sm font-semibold text-amber-900 mb-1">
            Copy this token now — it will NOT be shown again
          </div>
          <div className="text-xs text-amber-800 mb-3">
            After you close this banner the token can only be revoked, not retrieved.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-white border border-ink/10 rounded px-2 py-1.5 break-all">
              {justIssued.token}
            </code>
            <Button
              variant="brand"
              onClick={() => {
                navigator.clipboard.writeText(justIssued.token);
                showToast("Token copied to clipboard", "success");
              }}
            >
              Copy
            </Button>
            <Button variant="secondary" onClick={() => setJustIssued(null)}>
              Done
            </Button>
          </div>
          <div className="mt-3 text-[11px] text-amber-900">
            SCIM endpoint: <code className="font-mono">{typeof window !== "undefined" ? window.location.origin : ""}/api/auth-svc/scim/v2</code>
          </div>
        </div>
      )}

      <section className="mb-8">
        <h3 className="text-sm font-semibold text-ink mb-3">Issue a new token</h3>
        <form onSubmit={issue} className="flex flex-wrap items-end gap-3 max-w-2xl">
          <div className="flex-1 min-w-[240px]">
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Okta production"
              required
            />
          </div>
          <div className="w-[200px]">
            <label className="label">Default role for new users</label>
            <select
              className="input"
              value={defaultRole}
              onChange={(e) => setDefaultRole(e.target.value)}
            >
              <option value="admin">admin</option>
              <option value="user">user</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          <Button variant="brand" type="submit" disabled={busy || !name.trim()}>
            {busy ? "Issuing…" : "Issue token"}
          </Button>
        </form>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-3">Active + recent tokens</h3>
        {rows.length === 0 ? (
          <div className="text-sm text-ink-muted">No SCIM tokens issued yet.</div>
        ) : (
          <div className="rounded-xl border border-ink/8 bg-white divide-y divide-ink/5">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    r.revokedAt ? "bg-ink/20" : "bg-emerald-500"
                  }`}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{r.name}</div>
                  <div className="text-xs text-ink-muted">
                    <code className="font-mono">{r.prefix}…</code> · role {r.defaultRole} · issued{" "}
                    {new Date(r.createdAt).toLocaleDateString()}
                    {r.lastUsedAt && (
                      <> · last used {new Date(r.lastUsedAt).toLocaleString()}</>
                    )}
                  </div>
                </div>
                {r.revokedAt ? (
                  <span className="text-[11px] uppercase tracking-wider text-ink-muted">
                    Revoked {new Date(r.revokedAt).toLocaleDateString()}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => revoke(r.id, r.name)}
                    className="text-xs text-red-700 hover:text-red-800 font-medium"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
