"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, FormField, Toast } from "../../components/ui";

const AUTH = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

function InnerResetPasswordPage() {
  const params = useSearchParams();
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = params.get("token");
    if (t) setToken(t);
  }, [params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${AUTH}/password-reset/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Reset failed");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
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
            Set a new password
          </h1>
        </div>

        <div className="card shadow-brand-sm p-7 space-y-4">
          {done ? (
            <div className="text-center py-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-green-100 text-green-600 grid place-items-center mb-3">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-ink">Password updated</h2>
              <p className="text-sm text-ink-muted mt-2">You can now sign in with your new password.</p>
              <a href="/login" className="btn-brand mt-4 inline-flex">
                Go to sign in →
              </a>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {error && <Toast kind="error" message={error} onDismiss={() => setError(null)} />}
              <FormField label="Reset token" required hint="Copy from the email you received">
                <input className="input font-mono text-xs" placeholder="Paste token" value={token} onChange={(e) => setToken(e.target.value)} required />
              </FormField>
              <FormField label="New password" required hint="At least 8 characters">
                <input className="input" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </FormField>
              <FormField label="Confirm new password" required>
                <input className="input" type="password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </FormField>
              <Button type="submit" variant="brand" disabled={busy} className="w-full">
                {busy ? "Setting…" : "Set new password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <InnerResetPasswordPage />
    </Suspense>
  );
}
