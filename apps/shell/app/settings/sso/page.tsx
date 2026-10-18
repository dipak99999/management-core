"use client";

// Settings → Single Sign-On. Lets a tenant admin configure OIDC (Google,
// Microsoft, generic) + SAML 2.0 identity providers.
//
// For SAML there's a "Paste IdP metadata" helper that calls the backend
// parser to auto-fill entryPoint, cert, and logoutUrl so the admin doesn't
// have to copy four fields manually from Okta/Azure.

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { showToast } from "../../../lib/toast";
import { AppShell, Icon, PageHeader } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button } from "../../../components/ui";

type ProviderKind = "google" | "microsoft" | "oidc-generic" | "saml";

interface Provider {
  id: string;
  provider: ProviderKind;
  issuer: string;
  clientId: string;
  allowedEmailDomains: string[];
  autoProvision: boolean;
  defaultRole: string;
  isActive: boolean;
  createdAt: string;
  clientSecretSet: boolean;
}

interface MetadataParseResult {
  entityId: string | null;
  entryPoint: string | null;
  logoutUrl: string | null;
  cert: string | null;
  diagnostics: Record<string, unknown>;
}

export default function SsoSettingsPage() {
  const [rows, setRows] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ProviderKind>("saml");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [allowedEmailDomains, setAllowedEmailDomains] = useState("");
  const [autoProvision, setAutoProvision] = useState(true);
  const [defaultRole, setDefaultRole] = useState("user");
  // SAML-only extras
  const [samlEmailAttr, setSamlEmailAttr] = useState("");
  const [samlDisplayNameAttr, setSamlDisplayNameAttr] = useState("");
  const [samlWantAssertionsSigned, setSamlWantAssertionsSigned] = useState(true);
  const [samlLogoutUrl, setSamlLogoutUrl] = useState("");
  const [samlValidateInResponseTo, setSamlValidateInResponseTo] = useState<"always" | "ifPresent" | "never">("always");
  const [samlSpPrivateKey, setSamlSpPrivateKey] = useState("");
  const [samlSpCert, setSamlSpCert] = useState("");
  const [samlSignRequests, setSamlSignRequests] = useState(false);
  const [metadataXml, setMetadataXml] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<Provider[]>("/sso-providers"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load providers");
    }
  }
  useEffect(() => { load(); }, []);

  async function parseMetadata() {
    if (!metadataXml.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<MetadataParseResult>("/sso-providers/saml/parse-metadata", { metadataXml });
      if (r.entryPoint) setClientId(r.entryPoint);
      if (r.cert) setClientSecret(r.cert);
      if (r.logoutUrl) setSamlLogoutUrl(r.logoutUrl);
      if (r.entityId && !issuer) setIssuer(r.entityId); // their entityID → our `issuer` field label is a shared concept; admin can edit
      const filled = (["entryPoint","cert","logoutUrl","entityId"] as const).filter(k => r[k]);
      showToast(`Auto-filled: ${filled.join(", ")}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Metadata parse failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        provider: kind,
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        allowedEmailDomains: allowedEmailDomains.split(",").map((s) => s.trim()).filter(Boolean),
        autoProvision,
        defaultRole,
      };
      if (kind === "saml") {
        if (samlEmailAttr) body.samlEmailAttr = samlEmailAttr;
        if (samlDisplayNameAttr) body.samlDisplayNameAttr = samlDisplayNameAttr;
        body.samlWantAssertionsSigned = samlWantAssertionsSigned;
        if (samlLogoutUrl) body.samlLogoutUrl = samlLogoutUrl;
        body.samlValidateInResponseTo = samlValidateInResponseTo;
        if (samlSpPrivateKey) body.samlSpPrivateKey = samlSpPrivateKey;
        if (samlSpCert) body.samlSpCert = samlSpCert;
        body.samlSignRequests = samlSignRequests;
      }
      await api.post("/sso-providers", body);
      showToast(`${kind.toUpperCase()} provider saved`, "success");
      // Reset form
      setIssuer(""); setClientId(""); setClientSecret("");
      setMetadataXml("");
      setSamlLogoutUrl(""); setSamlSpPrivateKey(""); setSamlSpCert("");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Provider) {
    if (!confirm(`Delete the ${p.provider.toUpperCase()} provider? Users signed in via this provider stay signed in but can't re-authenticate.`)) return;
    try {
      await api.delete(`/sso-providers/${p.id}`);
      showToast("Provider removed", "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    }
  }

  const metadataUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth-svc/auth/sso/saml/${
          (JSON.parse(localStorage.getItem("lumaara.session") ?? "{}") as { tenant?: { slug?: string } }).tenant?.slug ?? "YOUR_TENANT_SLUG"
        }/metadata`
      : "";

  return (
    <AppShell moduleName="Settings" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.shield}
        eyebrow="Settings"
        title="Single Sign-On (SSO)"
        subtitle="Configure Google / Microsoft / generic OIDC + SAML 2.0 identity providers. SAML metadata paste auto-fills the IdP URL + certificate."
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-900 p-3 text-sm mb-4">
          {error}
        </div>
      )}

      <section className="mb-8">
        <h3 className="text-sm font-semibold text-ink mb-3">Active providers</h3>
        {rows.length === 0 ? (
          <div className="text-sm text-ink-muted">No SSO providers configured yet. Add one below.</div>
        ) : (
          <div className="rounded-xl border border-ink/8 bg-white divide-y divide-ink/5">
            {rows.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`h-2.5 w-2.5 rounded-full ${p.isActive ? "bg-emerald-500" : "bg-ink/20"}`} aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink uppercase tracking-wide">{p.provider}</div>
                  <div className="text-xs text-ink-muted truncate">
                    issuer: <code className="font-mono">{p.issuer}</code>
                    {p.allowedEmailDomains.length > 0 && (
                      <> · domains: {p.allowedEmailDomains.join(", ")}</>
                    )}
                    {" · role: "}{p.defaultRole}
                    {p.autoProvision ? " · auto-provision on" : " · invite-only"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(p)}
                  className="text-xs text-red-700 hover:text-red-800 font-medium"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-3">Add a provider</h3>
        <form onSubmit={save} className="space-y-5 max-w-3xl">
          <div className="flex gap-2 flex-wrap">
            {(["saml","google","microsoft","oidc-generic"] as ProviderKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 rounded-pill text-xs font-semibold uppercase tracking-widest border ${
                  kind === k ? "bg-ink text-white border-ink" : "bg-white border-ink/10 text-ink-muted hover:text-ink"
                }`}
              >
                {k === "oidc-generic" ? "OIDC" : k}
              </button>
            ))}
          </div>

          {kind === "saml" && (
            <div className="rounded-xl border border-gold-200 bg-gold-50/50 p-4">
              <label className="label">Paste IdP metadata XML (optional — auto-fills the SAML fields below)</label>
              <textarea
                value={metadataXml}
                onChange={(e) => setMetadataXml(e.target.value)}
                className="input font-mono text-xs"
                rows={5}
                placeholder={"<EntityDescriptor xmlns=\"urn:oasis:names:tc:SAML:2.0:metadata\"...>"}
              />
              <div className="mt-2 flex items-center gap-2">
                <Button variant="secondary" type="button" onClick={parseMetadata} disabled={busy || !metadataXml.trim()}>
                  {busy ? "Parsing…" : "Parse + auto-fill"}
                </Button>
                <span className="text-xs text-ink-muted">
                  Our SP metadata URL (give this to the IdP):{" "}
                  <code className="font-mono text-[11px]">{metadataUrl}</code>
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">
                {kind === "saml" ? "SP entityID (ours — any URL/URN)" : "Issuer URL"}
              </label>
              <input className="input" value={issuer} onChange={(e) => setIssuer(e.target.value)} required placeholder={kind === "saml" ? "https://yourapp.com/saml-sp" : "https://accounts.google.com"} />
            </div>
            <div>
              <label className="label">
                {kind === "saml" ? "IdP SSO entryPoint URL" : "Client ID"}
              </label>
              <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} required placeholder={kind === "saml" ? "https://okta.example.com/app/.../sso/saml" : "..."} />
            </div>
          </div>

          <div>
            <label className="label">
              {kind === "saml" ? "IdP signing certificate (PEM — encrypted at rest)" : "Client secret (encrypted at rest)"}
            </label>
            <textarea
              className="input font-mono text-xs"
              rows={kind === "saml" ? 4 : 2}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              required
              placeholder={kind === "saml" ? "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----" : "..."}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Allowed email domains (comma-separated, empty = any)</label>
              <input className="input" value={allowedEmailDomains} onChange={(e) => setAllowedEmailDomains(e.target.value)} placeholder="acme.com, acme.co.uk" />
            </div>
            <div>
              <label className="label">Default role for new users</label>
              <select className="input" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
                <option value="user">user</option>
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} className="h-4 w-4 accent-ink" />
              Auto-provision new users on first SSO login
            </label>
          </div>

          {kind === "saml" && (
            <details className="rounded-xl border border-ink/8 bg-canvas-warm/40 p-4" open>
              <summary className="cursor-pointer text-sm font-semibold text-ink">SAML advanced</summary>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="label">Email attribute name</label>
                  <input className="input" value={samlEmailAttr} onChange={(e) => setSamlEmailAttr(e.target.value)} placeholder="email (default)" />
                </div>
                <div>
                  <label className="label">Display name attribute</label>
                  <input className="input" value={samlDisplayNameAttr} onChange={(e) => setSamlDisplayNameAttr(e.target.value)} placeholder="displayName (default)" />
                </div>
                <div>
                  <label className="label">IdP Single Logout URL (optional)</label>
                  <input className="input" value={samlLogoutUrl} onChange={(e) => setSamlLogoutUrl(e.target.value)} placeholder="https://.../sso/saml/logout" />
                </div>
                <div>
                  <label className="label">Validate InResponseTo</label>
                  <select className="input" value={samlValidateInResponseTo} onChange={(e) => setSamlValidateInResponseTo(e.target.value as "always"|"ifPresent"|"never")}>
                    <option value="always">always (strict)</option>
                    <option value="ifPresent">if present (IdP-initiated OK)</option>
                    <option value="never">never (bypass replay check)</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={samlWantAssertionsSigned} onChange={(e) => setSamlWantAssertionsSigned(e.target.checked)} className="h-4 w-4 accent-ink" />
                  Require signed assertions (keep on in prod)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={samlSignRequests} onChange={(e) => setSamlSignRequests(e.target.checked)} className="h-4 w-4 accent-ink" />
                  Sign outbound AuthnRequests (requires SP keypair below)
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="label">SP private key (PEM)</label>
                  <textarea className="input font-mono text-xs" rows={3} value={samlSpPrivateKey} onChange={(e) => setSamlSpPrivateKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----\n..." />
                </div>
                <div>
                  <label className="label">SP certificate (PEM)</label>
                  <textarea className="input font-mono text-xs" rows={3} value={samlSpCert} onChange={(e) => setSamlSpCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----\n..." />
                </div>
              </div>
            </details>
          )}

          <div className="pt-2">
            <Button variant="brand" type="submit" disabled={busy}>
              {busy ? "Saving…" : `Save ${kind.toUpperCase()} provider`}
            </Button>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
