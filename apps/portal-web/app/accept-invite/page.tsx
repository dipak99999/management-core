"use client";

import { useEffect, useState } from "react";
import { authApi, saveSession, type PortalSession } from "../../lib/api";
import { Button, Card, FormField, Toast } from "../../components/ui";

export default function AcceptInvitePage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("token");
    if (p) setToken(p);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await authApi.post<PortalSession>("/portal-auth/accept", {
        token,
        password,
      });
      saveSession(s);
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-soft flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <span className="h-12 w-12 rounded-xl bg-brand-gradient shadow-brand-sm grid place-items-center text-white font-bold text-lg">
            L
          </span>
          <div className="text-center">
            <div className="font-semibold text-ink tracking-tight text-lg">
              Activate your account
            </div>
            <div className="text-xs text-ink-muted">
              Set a password to complete sign-up.
            </div>
          </div>
        </div>

        <Card className="p-6 shadow-brand-glow">
          {error && (
            <div className="mb-4">
              <Toast
                kind="error"
                message={error}
                onDismiss={() => setError(null)}
              />
            </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            <FormField
              label="Invite token"
              required
              hint="Auto-filled from the URL"
            >
              <input
                className="input font-mono text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </FormField>
            <FormField
              label="New password"
              required
              hint="Minimum 8 characters"
            >
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />
            </FormField>
            <FormField label="Confirm password" required>
              <input
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </FormField>
            <Button
              variant="primary"
              type="submit"
              disabled={busy}
              className="w-full mt-2"
            >
              {busy ? "Activating…" : "Activate account"}
            </Button>
          </form>
          <div className="text-xs text-ink-muted text-center mt-4">
            <a href="/login" className="text-brand-600 hover:underline">
              ← Back to sign-in
            </a>
          </div>
        </Card>
      </div>
    </main>
  );
}
