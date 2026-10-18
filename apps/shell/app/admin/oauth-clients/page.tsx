"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { loadSession, hasRole } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface OAuthClient {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: string[];
  isPublic: boolean;
  isTrusted: boolean;
  createdAt: string;
}
interface Registration {
  id: string;
  clientId: string;
  clientSecret: string | null;
  warning: string;
}

const GRANTS = ["authorization_code", "refresh_token", "client_credentials"] as const;

export default function OAuthClientsPage() {
  const [rows, setRows] = useState<OAuthClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  // Default the redirect URI to the shell's own origin so copy-pasting
  // doesn't leave a dangling localhost:3000 in production registrations.
  const [uris, setUris] = useState(() =>
    typeof window === "undefined"
      ? "https://your-app.example.com/oauth/callback"
      : `${window.location.origin}/oauth/callback`,
  );
  const [selectedGrants, setSelectedGrants] = useState<string[]>([
    "authorization_code",
    "refresh_token",
  ]);
  const [scopes, setScopes] = useState("read write");
  const [isPublic, setIsPublic] = useState(false);
  const [isTrusted, setIsTrusted] = useState(false);
  const [issued, setIssued] = useState<Registration | null>(null);

  async function load() {
    try {
      setRows(await api.get<OAuthClient[]>("/oauth/clients"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    const s = loadSession();
    if (!s || !hasRole(s, "SystemManager")) {
      location.href = "/";
      return;
    }
    load();
  }, []);

  useListPageCommands({
    singular: "Oauth Client",
    plural: "Oauth Clients",
    refresh: load,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        name,
        redirectUris: uris.split(/\s+/).filter(Boolean),
        grantTypes: selectedGrants,
        scopes: scopes.split(/\s+/).filter(Boolean),
        isPublic,
        isTrusted,
      };
      const r = await api.post<Registration>("/oauth/clients", body);
      setIssued(r);
      setName("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this client? All its tokens will be invalidated.")) return;
    try {
      await api.delete(`/oauth/clients/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function toggleGrant(g: string) {
    setSelectedGrants((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "OAuth clients" }]}
        title="OAuth clients"
        subtitle="Register third-party apps that request access via OAuth 2. Supports authorization_code (with PKCE), refresh_token, and client_credentials."
        actions={
          <Button variant="brand" onClick={() => setShowForm((v) => !v)} type="button">
            {showForm ? "Cancel" : "+ Register client"}
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">

      {issued && (
        <div className="rounded border border-green-300 bg-green-50 p-4 space-y-2 max-w-2xl">
          <div className="font-semibold text-green-800">Client registered</div>
          <div>
            <div className="text-xs text-gray-600">client_id</div>
            <code className="block text-xs bg-white border rounded px-3 py-2 font-mono">
              {issued.clientId}
            </code>
          </div>
          {issued.clientSecret && (
            <div>
              <div className="text-xs text-gray-600">
                client_secret <span className="text-red-600">(shown once)</span>
              </div>
              <code className="block text-xs bg-white border rounded px-3 py-2 font-mono break-all">
                {issued.clientSecret}
              </code>
            </div>
          )}
          <div className="text-xs text-green-800">{issued.warning}</div>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="text-xs text-gray-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={save} className="bg-white rounded shadow p-4 space-y-3 max-w-2xl">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Client name</label>
            <input
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My integration"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">
              Redirect URIs (space or newline separated)
            </label>
            <textarea
              required
              rows={2}
              className="w-full border rounded px-3 py-2 text-sm font-mono"
              value={uris}
              onChange={(e) => setUris(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Grant types</label>
            <div className="flex flex-wrap gap-2">
              {GRANTS.map((g) => (
                <label key={g} className="text-sm flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selectedGrants.includes(g)}
                    onChange={() => toggleGrant(g)}
                  />
                  <code className="text-xs">{g}</code>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">
              Scopes (space-separated)
            </label>
            <input
              className="w-full border rounded px-3 py-2 text-sm font-mono"
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
            />
          </div>
          <div className="flex gap-4">
            <label className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Public client (SPA/mobile — no secret; requires PKCE)
            </label>
            <label className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                checked={isTrusted}
                onChange={(e) => setIsTrusted(e.target.checked)}
              />
              Trusted (skip consent screen)
            </label>
          </div>
          <button className="bg-brand-600 text-white px-4 py-2 rounded text-sm">
            Register
          </button>
        </form>
      )}

      <table className="w-full bg-white rounded shadow overflow-hidden text-sm">
        <thead className="bg-gray-100 text-start text-gray-600">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">client_id</th>
            <th className="px-3 py-2">Grants</th>
            <th className="px-3 py-2">Scopes</th>
            <th className="px-3 py-2">Flags</th>
            <th className="px-3 py-2 text-end"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t align-top">
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{c.clientId}</td>
              <td className="px-3 py-2 text-xs">
                {c.grantTypes.map((g) => (
                  <div key={g}>{g}</div>
                ))}
              </td>
              <td className="px-3 py-2 text-xs">{c.scopes.join(" ")}</td>
              <td className="px-3 py-2 text-xs">
                {c.isPublic && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 me-1">
                    public
                  </span>
                )}
                {c.isTrusted && (
                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                    trusted
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-end">
                <button
                  onClick={() => del(c.id)}
                  className="text-red-600 hover:underline text-xs"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                No clients registered.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </AppShell>
  );
}
