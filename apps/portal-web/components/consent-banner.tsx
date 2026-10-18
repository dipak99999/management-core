"use client";

import { useEffect, useState } from "react";
import { accApi, loadSession } from "../lib/api";

interface ConsentRow {
  id: string;
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
  policyVersion: string | null;
  createdAt: string;
}

export function ConsentBanner(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    if (typeof window !== "undefined" && window.location.pathname === "/login") return;
    (async () => {
      try {
        const row = await accApi.get<ConsentRow | null>("/portal/consent");
        if (!row) setVisible(true);
      } catch {
        // silent — don't block UX if the API is down
      }
    })();
  }, []);

  async function decide(analytics: boolean, marketing: boolean): Promise<void> {
    setBusy(true);
    try {
      await accApi.post<ConsentRow>("/portal/consent", { analytics, marketing });
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-6xl mx-auto p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-700 flex-1">
          <span className="font-semibold">Cookies &amp; tracking.</span> We use
          essential cookies to keep you signed in. Optional analytics &amp;
          marketing cookies are off unless you accept.{" "}
          <a
            href="/privacy"
            className="text-blue-600 hover:underline whitespace-nowrap"
          >
            Manage preferences
          </a>
          .
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => decide(false, false)}
            disabled={busy}
            className="text-sm px-3 py-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Essential only
          </button>
          <button
            onClick={() => decide(true, true)}
            disabled={busy}
            className="text-sm px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
