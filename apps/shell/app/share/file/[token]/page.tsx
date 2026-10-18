"use client";

// Public shared file — no auth. Validates the WorkDriveShareLink token,
// optionally prompts for password, then downloads the latest version.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const AUTH =
  process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

interface Meta {
  fileName: string;
  mimeType: string;
  size: number;
  isPasswordProtected: boolean;
  expiresAt: string | null;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PublicFilePage() {
  const params = useParams<{ token: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${AUTH}/public/drive/shares/${params.token}`);
        if (!r.ok) throw new Error((await r.json()).error ?? "Not available");
        setMeta((await r.json()) as Meta);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, [params.token]);

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${AUTH}/public/drive/shares/${params.token}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Download failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta?.fileName ?? "download";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (err)
    return (
      <main className="p-8 max-w-md mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {err}
        </div>
      </main>
    );
  if (!meta)
    return <main className="p-8 max-w-md mx-auto text-sm text-ink-muted">Loading…</main>;

  return (
    <main className="p-8 max-w-md mx-auto">
      <div className="text-xs uppercase tracking-wider text-brand-600">Shared file</div>
      <h1 className="text-xl font-semibold mt-1">{meta.fileName}</h1>
      <p className="text-sm text-gray-600 mt-1">
        {meta.mimeType} · {fmtBytes(meta.size)}
      </p>
      {meta.expiresAt && (
        <p className="text-xs text-gray-500 mt-1">
          Expires {new Date(meta.expiresAt).toLocaleString()}
        </p>
      )}
      {meta.isPasswordProtected && (
        <input
          type="password"
          placeholder="Password"
          className="w-full border rounded px-3 py-2 mt-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      <button
        onClick={download}
        disabled={busy}
        className="w-full mt-3 bg-brand-600 text-white py-2 rounded disabled:opacity-60"
      >
        {busy ? "Downloading…" : "Download"}
      </button>
      <div className="text-xs text-gray-400 text-center pt-6">
        Powered by Lumaara WorkDrive
      </div>
    </main>
  );
}
