"use client";

import { useEffect, useState } from "react";
import { authApi, loadSession } from "../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../components/ui";

export default function PortalSettingsPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [partyType, setPartyType] = useState<string>("");

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      window.location.href = "/login";
      return;
    }
    setEmail(s.user.email);
    setDisplayName(s.user.displayName ?? "");
    setPartyType(s.user.partyType);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await authApi.post("/portal-auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      setMsg("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Settings" }]}
        title="Account settings"
        subtitle="Update your password and review your account details."
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => history.back()}
          >
            ← Back
          </Button>
        }
      />

      <Card className="p-5">
        <SectionHeader title="Signed in as" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted">
              Email
            </div>
            <div className="mt-0.5 text-ink">{email || "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted">
              Display name
            </div>
            <div className="mt-0.5 text-ink">{displayName || "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted">
              Account type
            </div>
            <div className="mt-0.5 text-ink">{partyType || "—"}</div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader title="Change password" />
        {error && (
          <div className="mb-3">
            <Toast
              kind="error"
              message={error}
              onDismiss={() => setError(null)}
            />
          </div>
        )}
        {msg && (
          <div className="mb-3">
            <Toast
              kind="success"
              message={msg}
              onDismiss={() => setMsg(null)}
            />
          </div>
        )}
        <form onSubmit={submit} className="space-y-3 max-w-md">
          <FormField label="Current password" required>
            <input
              type="password"
              className="input"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
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
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </FormField>
          <FormField label="Confirm new password" required>
            <input
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </FormField>
          <div className="pt-2 flex justify-end">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
