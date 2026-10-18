"use client";

import { showToast } from "../../../lib/toast";
import { useListPageCommands } from "@lumaara/web-ui";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { loadSession } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}
interface IssueResult {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  token: string;
  warning: string;
}

export default function ApiTokensPage() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [name, setName] = useState("");
  const [expDays, setExpDays] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justIssued, setJustIssued] = useState<IssueResult | null>(null);

  async function load() {
    try {
      setRows(await api.get<TokenRow[]>("/api-tokens"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    if (!loadSession()) {
      location.href = "/login";
      return;
    }
    load();
  }, []);

  useListPageCommands({
    singular: "Api Token",
    plural: "Api Tokens",
    refresh: load,
  });

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<IssueResult>("/api-tokens", {
        name: name.trim(),
        ...(expDays ? { expiresInDays: Number(expDays) } : {}),
      });
      setJustIssued(result);
      setName("");
      setExpDays("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? It will stop working immediately.")) return;
    try {
      await api.post(`/api-tokens/${id}/revoke`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this revoked token permanently?")) return;
    try {
      await api.delete(`/api-tokens/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Settings" }, { label: "API tokens" }]}
        title="API tokens"
        subtitle={
          <>
            Machine-to-machine tokens (format <code className="text-xs">ont_...</code>).
            Use in the Authorization header: <code className="text-xs">Bearer ont_...</code>.
          </>
        }
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

      <div className="max-w-4xl space-y-6">

      {justIssued && (
        <div className="rounded border border-green-300 bg-green-50 p-4 space-y-2">
          <div className="font-semibold text-green-800">
            Token issued: {justIssued.name}
          </div>
          <div className="text-xs text-green-800">{justIssued.warning}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white border px-3 py-2 text-xs font-mono break-all">
              {justIssued.token}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(justIssued.token);
                showToast("Copied to clipboard", "success");
              }}
              className="border px-3 py-2 rounded text-xs"
            >
              Copy
            </button>
          </div>
          <button
            type="button"
            onClick={() => setJustIssued(null)}
            className="text-xs text-gray-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={issue} className="bg-white rounded shadow p-4 space-y-3">
        <div className="text-xs uppercase text-gray-500">Issue new token</div>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
            placeholder="Token name (e.g. GitHub Actions)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="number"
            min={1}
            max={1825}
            className="w-32 border rounded px-3 py-2 text-sm"
            placeholder="Days (∞)"
            value={expDays}
            onChange={(e) =>
              setExpDays(e.target.value === "" ? "" : Number(e.target.value))
            }
          />
          <button
            disabled={busy || !name.trim()}
            className="bg-brand-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {busy ? "Issuing..." : "Issue"}
          </button>
        </div>
      </form>

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-start text-gray-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Prefix</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Last used</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-end"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600">
                  {t.prefix}…
                </td>
                <td className="px-3 py-2 text-xs">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-xs">
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "Never"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {t.revokedAt ? (
                    <span className="px-2 py-0.5 rounded bg-red-100 text-red-800">
                      Revoked
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-end text-xs space-x-2">
                  {!t.revokedAt ? (
                    <button
                      onClick={() => revoke(t.id)}
                      className="text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  ) : (
                    <button
                      onClick={() => del(t.id)}
                      className="text-gray-500 hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  No tokens yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
    </AppShell>
  );
}
