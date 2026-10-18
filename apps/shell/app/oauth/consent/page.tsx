"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { loadSession } from "../../../lib/auth";
import { Button, Card } from "../../../components/ui";

// OAuth authorization page. Users land here from a 3rd-party OAuth flow:
//   https://lumaara/oauth/consent?client_id=...&redirect_uri=...&scope=...&state=...&code_challenge=...
// We call auth-service /oauth/authorize to validate params + check prior consent,
// then show accept/deny. On approve we POST /oauth/authorize/consent and
// redirect to the app's redirect_uri with ?code=... or ?error=...

interface AuthorizeInfo {
  client: { id: string; name: string; isTrusted: boolean };
  scopes: string[];
  redirectUri: string;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  consentRequired: boolean;
}

function InnerConsentPage() {
  const params = useSearchParams();
  const [info, setInfo] = useState<AuthorizeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loadSession()) {
      // Redirect back here after login.
      const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
      location.href = `/login?returnTo=${returnTo}`;
      return;
    }
    const qs = params.toString();
    api
      .get<AuthorizeInfo>(`/oauth/authorize?${qs}`)
      .then(async (r) => {
        setInfo(r);
        // If consent already recorded (or client is trusted), auto-approve.
        if (!r.consentRequired) {
          await approve(r, true);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve(i: AuthorizeInfo, autoRedirect: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ redirectUrl: string }>("/oauth/authorize/consent", {
        clientDbId: i.client.id,
        redirectUri: i.redirectUri,
        scopes: i.scopes,
        state: i.state,
        codeChallenge: i.codeChallenge,
        codeChallengeMethod: i.codeChallengeMethod,
        approve: true,
      });
      if (autoRedirect) location.href = r.redirectUrl;
      else location.href = r.redirectUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  async function deny() {
    if (!info) return;
    setBusy(true);
    try {
      const r = await api.post<{ redirectUrl: string }>("/oauth/authorize/consent", {
        clientDbId: info.client.id,
        redirectUri: info.redirectUri,
        scopes: info.scopes,
        state: info.state,
        approve: false,
      });
      location.href = r.redirectUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  if (error)
    return (
      <main className="min-h-screen bg-brand-soft grid place-items-center px-6 py-12">
        <Card className="p-6 max-w-md space-y-3">
          <div className="font-semibold text-red-700">Authorization error</div>
          <div className="text-sm text-ink-soft">{error}</div>
          <a href="/" className="text-sm text-brand-600 hover:underline">
            ← Back to home
          </a>
        </Card>
      </main>
    );

  if (!info)
    return (
      <main className="min-h-screen bg-brand-soft grid place-items-center text-ink-muted text-sm">
        Verifying…
      </main>
    );

  return (
    <main className="min-h-screen bg-brand-soft grid place-items-center px-6 py-12">
      <Card className="p-6 max-w-md w-full space-y-4 shadow-brand-sm">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            Authorize {info.client.name}
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            {info.client.name} is requesting access to your account.
          </p>
        </div>

        {info.scopes.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1">
              Permissions requested
            </div>
            <ul className="space-y-1">
              {info.scopes.map((s) => (
                <li key={s} className="text-sm">
                  <code className="text-xs px-1.5 py-0.5 bg-surface-sunken rounded">
                    {s}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="text-xs text-ink-muted">
          Redirect: <code className="font-mono">{info.redirectUri}</code>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="brand"
            onClick={() => approve(info, false)}
            disabled={busy}
            className="flex-1"
            type="button"
          >
            {busy ? "…" : "Authorize"}
          </Button>
          <Button
            variant="secondary"
            onClick={deny}
            disabled={busy}
            className="flex-1"
            type="button"
          >
            Deny
          </Button>
        </div>
      </Card>
    </main>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={null}>
      <InnerConsentPage />
    </Suspense>
  );
}
