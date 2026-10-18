"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { loadSession } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface SessionRow {
  id: string;
  jti: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  revokedAt: string | null;
  createdAt: string;
}
interface Envelope {
  sessions: SessionRow[];
  currentJti: string | null;
}

function browserFromUA(ua: string | null): string {
  if (!ua) return "Unknown";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome/.test(ua)) return "Chrome";
  if (/Safari/.test(ua)) return "Safari";
  if (/curl|Wget|python|Go-http-client/.test(ua)) return "CLI";
  return "Unknown";
}
function osFromUA(ua: string | null): string {
  if (!ua) return "";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  return "";
}

export default function SessionsPage() {
  const [env, setEnv] = useState<Envelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setEnv(await api.get<Envelope>("/sessions"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
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
    singular: "Session",
    plural: "Sessions",
    refresh: load,
  });

  async function revoke(id: string) {
    if (!confirm("Revoke this session? Whoever is signed in there will be signed out on their next request.")) return;
    setBusy(true);
    try {
      await api.post(`/sessions/${id}/revoke`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    if (!confirm("Sign out every device except this one?")) return;
    setBusy(true);
    try {
      await api.post("/sessions/revoke-others", {});
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
        breadcrumb={[{ label: "Settings" }, { label: "Active sessions" }]}
        title="Active sessions"
        subtitle="Every sign-in creates a session. Revoke one to sign that device out instantly. Sessions expire after 7 days of inactivity."
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {env && env.sessions.some((s) => !s.revokedAt) && (
              <Button
                variant="danger"
                onClick={revokeOthers}
                disabled={busy}
                type="button"
              >
                Sign out all other sessions
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-4xl space-y-4">

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-start text-gray-600">
            <tr>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Last active</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-end"></th>
            </tr>
          </thead>
          <tbody>
            {env?.sessions.map((s) => {
              const isCurrent = env.currentJti === s.jti;
              return (
                <tr key={s.id} className="border-t align-top">
                  <td className="px-3 py-2 text-xs">
                    <div className="font-medium">
                      {browserFromUA(s.userAgent)} · {osFromUA(s.userAgent)}
                    </div>
                    <div className="text-gray-500 truncate max-w-xs">
                      {s.userAgent ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">{s.ipAddress ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(s.lastActiveAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.revokedAt ? (
                      <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                        Revoked
                      </span>
                    ) : isCurrent ? (
                      <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                        Current
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end text-xs">
                    {!s.revokedAt && !isCurrent && (
                      <button
                        onClick={() => revoke(s.id)}
                        className="text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {(!env || env.sessions.length === 0) && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                  No sessions.
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
