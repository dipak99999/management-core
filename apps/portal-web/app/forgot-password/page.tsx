"use client";

import { useState } from "react";
import { authApi } from "../../lib/api";
import { Button, Card, FormField, Toast } from "../../components/ui";

export default function ForgotPasswordPage() {
  const [form, setForm] = useState({ tenantSlug: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await authApi.post<{ ok: boolean }>(
        "/portal-auth/forgot-password",
        form,
      );
      setMsg(
        "If an account exists for that email, we've sent a reset link. Check your inbox.",
      );
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
              Reset your password
            </div>
            <div className="text-xs text-ink-muted">
              We'll email you a reset link if we recognize the address.
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
          {msg && (
            <div className="mb-4">
              <Toast
                kind="success"
                message={msg}
                onDismiss={() => setMsg(null)}
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
            <Button
              variant="primary"
              type="submit"
              disabled={busy}
              className="w-full mt-2"
            >
              {busy ? "Sending…" : "Send reset link"}
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
