"use client";

import { useState } from "react";
import { saveSession } from "../../lib/auth";

// Same-origin proxy path — shell/next.config.js rewrites /api/auth/* to the
// auth-service on 4001. Using same-origin avoids CORS + "Failed to fetch"
// in port-isolated environments (VS Code webviews, tunnels, etc).
const AUTH = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

export default function LoginPage() {
  const [tenantSlug, setTenantSlug] = useState("demo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${AUTH}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantSlug, email, password }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Login failed");
      const data = await res.json();
      if (data.require2fa) {
        setChallengeToken(data.challengeToken);
      } else {
        saveSession(data);
        location.href = new URLSearchParams(location.search).get("returnTo") ?? "/";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onChallenge(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${AUTH}/auth/2fa/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken, code }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Verification failed");
      saveSession(await res.json());
      location.href = new URLSearchParams(location.search).get("returnTo") ?? "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-soft grid place-items-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient shadow-brand-glow grid place-items-center">
            <span className="text-white text-2xl font-bold tracking-tight">L</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-brand-gradient bg-clip-text text-transparent">
            Lumaara
          </h1>
        </div>

        {challengeToken ? (
          <form onSubmit={onChallenge} className="card shadow-brand-sm p-7 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Two-factor code</h2>
              <p className="text-sm text-ink-muted mt-1">
                Enter the 6-digit code from your authenticator app, or a backup code.
              </p>
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {error}
              </div>
            )}
            <div>
              <label className="label">Verification code</label>
              <input
                className="input font-mono text-center tracking-widest text-lg"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                required
                autoFocus
              />
            </div>
            <button
              disabled={busy || code.length < 6}
              className="btn-brand w-full"
            >
              {busy ? "Verifying…" : "Verify and sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setChallengeToken(null);
                setCode("");
              }}
              className="btn-ghost w-full text-xs"
            >
              ← Back to login
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="card shadow-brand-sm p-7 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Welcome back</h2>
              <p className="text-sm text-ink-muted mt-1">
                Sign in to your workspace to continue.
              </p>
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {error}
              </div>
            )}
            <div>
              <label className="label">Workspace</label>
              <input
                className="input"
                placeholder="e.g. acme"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label flex items-center justify-between">
                <span>Password</span>
                <a href="/forgot-password" className="text-brand-600 hover:text-brand-700 text-xs font-normal">
                  Forgot?
                </a>
              </label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button disabled={busy} className="btn-brand w-full">
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <div className="text-center text-sm text-ink-muted pt-1">
              New here?{" "}
              <a href="/signup" className="text-brand-600 hover:text-brand-700 font-medium">
                Create a workspace
              </a>
            </div>
          </form>
        )}

        {process.env.NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS === "1" && (
          <p className="text-center text-xs text-ink-muted">
            Demo: <span className="font-mono">demo@lumaara.local · demo1234</span> (workspace: demo)
          </p>
        )}
      </div>
    </main>
  );
}
