"use client";

import { useState } from "react";
import { Button, FormField } from "../../components/ui";

const AUTH = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

export default function ForgotPasswordPage() {
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${AUTH}/password-reset/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, tenantSlug }),
      });
      const data = await res.json().catch(() => ({}));
      // The previous code called setDone(true) even on 5xx — silently
      // lying to the user that the email was sent. Now: 5xx surfaces the
      // error; 4xx we still treat as "done" (the API deliberately returns
      // the same shape for "email not found" to avoid leaking whether an
      // account exists — same-response is the security posture).
      if (res.status >= 500) {
        setError(
          (data && typeof data.error === "string" && data.error) ||
            "Something went wrong. Please try again.",
        );
        return;
      }
      setDone(true);
      if (data.devToken) setDevToken(data.devToken);
    } catch {
      setError("Network error. Check your connection and try again.");
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
            Reset your password
          </h1>
        </div>

        <div className="card shadow-brand-sm p-7 space-y-4">
          {done ? (
            <>
              <div className="text-center py-4">
                <div className="mx-auto h-12 w-12 rounded-full bg-green-100 text-green-600 grid place-items-center mb-3">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-ink">Check your inbox</h2>
                <p className="text-sm text-ink-muted mt-2">
                  If an account exists for that email, we&apos;ve sent a reset link. It&apos;s valid for one hour.
                </p>
              </div>
              {devToken && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                  <div className="font-semibold text-amber-800 mb-1">Development token</div>
                  <code className="break-all font-mono block text-amber-900">{devToken}</code>
                  <a href={`/reset-password?token=${devToken}`} className="text-brand-600 hover:text-brand-700 font-medium mt-2 inline-block">
                    Open reset page →
                  </a>
                </div>
              )}
              <a href="/login" className="block text-center text-sm text-brand-600 hover:text-brand-700 font-medium pt-2">
                ← Back to sign in
              </a>
            </>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-ink-muted">
                Enter your workspace + email and we&apos;ll send you a reset link.
              </p>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <FormField label="Workspace" required>
                <input className="input" placeholder="acme" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} required />
              </FormField>
              <FormField label="Email" required>
                <input className="input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </FormField>
              <Button type="submit" variant="brand" disabled={busy} className="w-full">
                {busy ? "Sending…" : "Send reset link"}
              </Button>
              <a href="/login" className="block text-center text-sm text-brand-600 hover:text-brand-700 font-medium">
                ← Back to sign in
              </a>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
