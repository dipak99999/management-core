"use client";

import { useState } from "react";
import { saveSession } from "../../lib/auth";
import { Button, FormField, Toast } from "../../components/ui";

const AUTH = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

export default function SignupPage() {
  const [form, setForm] = useState({
    tenantName: "",
    tenantSlug: "",
    fullName: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${AUTH}/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(typeof body.error === "string" ? body.error : "Signup failed");
      }
      const session = await res.json();
      saveSession(session);
      location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  const bind = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  // Auto-derive slug from company name — helps first-time users.
  function onNameChange(v: string) {
    setForm((f) => ({
      ...f,
      tenantName: v,
      tenantSlug: f.tenantSlug || v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    }));
  }

  return (
    <main className="min-h-screen bg-brand-soft grid place-items-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient shadow-brand-glow grid place-items-center">
            <span className="text-white text-2xl font-bold tracking-tight">L</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-brand-gradient bg-clip-text text-transparent">
            Create your workspace
          </h1>
          <p className="text-sm text-ink-muted">
            Start with a fresh Lumaara tenant — takes less than a minute.
          </p>
        </div>

        <form onSubmit={onSubmit} className="card shadow-brand-sm p-7 space-y-4">
          {error && <Toast kind="error" message={error} onDismiss={() => setError(null)} />}

          <FormField label="Company name" required>
            <input
              className="input"
              placeholder="Acme Corp"
              value={form.tenantName}
              onChange={(e) => onNameChange(e.target.value)}
              required
              autoFocus
            />
          </FormField>

          <FormField label="Workspace URL" required hint="Lowercase letters, numbers and hyphens only">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-ink-muted">lumaara.app/</span>
              <input
                className="input flex-1 font-mono"
                placeholder="acme"
                pattern="[a-z0-9\-]+"
                {...bind("tenantSlug")}
                required
              />
            </div>
          </FormField>

          <FormField label="Your name" required>
            <input className="input" placeholder="Jane Doe" {...bind("fullName")} required />
          </FormField>

          <FormField label="Work email" required>
            <input className="input" type="email" placeholder="jane@acme.com" {...bind("email")} required />
          </FormField>

          <FormField label="Password" required hint="At least 8 characters">
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              minLength={8}
              {...bind("password")}
              required
            />
          </FormField>

          <Button type="submit" variant="brand" disabled={busy} className="w-full">
            {busy ? "Creating workspace…" : "Create workspace"}
          </Button>

          <div className="text-center text-sm text-ink-muted pt-1">
            Already have one?{" "}
            <a href="/login" className="text-brand-600 hover:text-brand-700 font-medium">
              Sign in
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}
