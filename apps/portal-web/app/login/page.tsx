"use client";

import { useState } from "react";
import { authApi, saveSession, type PortalSession } from "../../lib/api";
import { Button, Card, FormField, Toast } from "../../components/ui";

export default function PortalLoginPage() {
  const [form, setForm] = useState({
    tenantSlug: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await authApi.post<PortalSession>(
        "/portal-auth/login",
        form,
      );
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
              Lumaara Portal
            </div>
            <div className="text-xs text-ink-muted">
              Self-service for customers & suppliers
            </div>
          </div>
        </div>

        <Card className="p-6 shadow-brand-glow">
          <h1 className="text-lg font-semibold text-ink mb-4">Sign in</h1>
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
            <FormField label="Tenant slug" required hint="e.g. acme">
              <input
                className="input"
                value={form.tenantSlug}
                onChange={(e) =>
                  setForm({ ...form, tenantSlug: e.target.value })
                }
                autoComplete="organization"
                required
              />
            </FormField>
            <FormField label="Email" required>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoComplete="email"
                required
              />
            </FormField>
            <FormField label="Password" required>
              <input
                type="password"
                className="input"
                value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })
                }
                autoComplete="current-password"
                required
              />
            </FormField>
            <Button
              variant="primary"
              type="submit"
              disabled={busy}
              className="w-full mt-2"
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="text-xs text-ink-muted text-center mt-4 flex items-center justify-center gap-3">
            <a
              href="/accept-invite"
              className="text-brand-600 hover:underline"
            >
              Have an invite link?
            </a>
            <span className="text-ink-muted/60">·</span>
            <a
              href="/forgot-password"
              className="text-brand-600 hover:underline"
            >
              Forgot password?
            </a>
          </div>
        </Card>
      </div>
    </main>
  );
}
