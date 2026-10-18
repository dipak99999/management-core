"use client";

import { showToast } from "../../../lib/toast";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { loadSession } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface Status {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
}
interface EnrollRes {
  secret: string;
  otpauthUrl: string;
}
interface VerifyRes {
  enabled: boolean;
  backupCodes: string[];
  warning: string;
}

export default function TwoFactorPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<EnrollRes | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setStatus(await api.get<Status>("/2fa/status"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    if (!loadSession()) {
      location.href = "/login";
      return;
    }
    load();
  }, []);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    try {
      setEnroll(await api.post<EnrollRes>("/2fa/enroll", {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<VerifyRes>("/2fa/verify", { token: code });
      setBackupCodes(r.backupCodes);
      setEnroll(null);
      setCode("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/2fa/disable", { password });
      setPassword("");
      setBackupCodes(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateBackup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ backupCodes: string[] }>("/2fa/backup-codes", {
        password,
      });
      setBackupCodes(r.backupCodes);
      setPassword("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Settings" }, { label: "Two-factor auth" }]}
        title="Two-factor authentication"
        subtitle="Add an extra layer of security. After enabling, sign-in requires both your password and a 6-digit code."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-2xl space-y-6">

      {backupCodes && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 space-y-2">
          <div className="font-semibold text-amber-800">
            Save these backup codes now
          </div>
          <div className="text-xs text-amber-800">
            Each code works exactly once. Store them somewhere safe.
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            {backupCodes.map((c) => (
              <code key={c} className="bg-white border rounded px-3 py-1">
                {c}
              </code>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(backupCodes.join("\n"));
              showToast("Copied to clipboard", "success");
            }}
            className="text-xs text-brand-600 hover:underline"
          >
            Copy all
          </button>
        </div>
      )}

      {status?.enabled ? (
        <div className="bg-white rounded shadow p-4 space-y-4">
          <div>
            <div className="text-sm text-green-700 font-semibold">✓ 2FA enabled</div>
            <div className="text-xs text-gray-500">
              Since {status.enabledAt && new Date(status.enabledAt).toLocaleString()} ·{" "}
              {status.backupCodesRemaining} backup codes remaining
            </div>
          </div>

          <form onSubmit={regenerateBackup} className="space-y-2 border-t pt-3">
            <div className="text-xs uppercase text-gray-500">
              Regenerate backup codes
            </div>
            <input
              type="password"
              placeholder="Confirm password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              required
            />
            <button
              disabled={busy}
              className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded"
            >
              Regenerate
            </button>
          </form>

          <form onSubmit={disable} className="space-y-2 border-t pt-3">
            <div className="text-xs uppercase text-gray-500">Disable 2FA</div>
            <input
              type="password"
              placeholder="Confirm password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              required
            />
            <button
              disabled={busy}
              className="text-sm border border-red-600 text-red-600 px-3 py-1.5 rounded"
            >
              Disable
            </button>
          </form>
        </div>
      ) : enroll ? (
        <div className="bg-white rounded shadow p-4 space-y-3">
          <div className="text-sm">
            Scan this QR code with your authenticator app (Google Authenticator, 1Password,
            Authy, etc.), then enter the 6-digit code it shows.
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR URL
              carries the TOTP secret; using next/image would route through
              the Next image optimiser and leak the secret through its URL. */}
          <img
            alt="QR"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(enroll.otpauthUrl)}`}
            className="border rounded"
          />
          <div className="text-xs text-gray-600">
            Or enter secret manually:{" "}
            <code className="font-mono">{enroll.secret}</code>
          </div>
          <form onSubmit={verify} className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              className="flex-1 border rounded px-3 py-2 text-sm font-mono"
              required
            />
            <button
              disabled={busy || code.length < 6}
              className="bg-brand-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
            >
              Verify
            </button>
          </form>
          <button
            type="button"
            onClick={() => setEnroll(null)}
            className="text-xs text-gray-600 hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="bg-white rounded shadow p-4 space-y-3">
          <div className="text-sm text-gray-600">
            Add an extra layer of security. After enabling, sign-ins will require both your
            password and a 6-digit code from an authenticator app.
          </div>
          <button
            onClick={startEnroll}
            disabled={busy}
            className="bg-brand-600 text-white px-4 py-2 rounded text-sm"
          >
            {busy ? "..." : "Enable 2FA"}
          </button>
        </div>
      )}
      </div>
    </AppShell>
  );
}
