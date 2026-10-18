"use client";

import { useEffect, useState } from "react";
import { useRealtime } from "./realtime";

/**
 * One-liner realtime subscription for a list page. Reads the current
 * user's bearer token out of localStorage and subscribes to the given
 * channel on the auth-service SSE stream. Every message triggers the
 * passed `refresh` callback (typically the page's `load()` fn).
 *
 *   useRealtimeList("pick-list", load);
 *
 * No-ops gracefully when there's no session (anonymous public pages).
 */
export function useRealtimeList(channel: string, refresh: () => void | Promise<void>): void {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("lumaara.session");
    if (!raw) return;
    try {
      const token = (JSON.parse(raw) as { token?: string }).token;
      if (!token) return;
      const base = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";
      setUrl(
        `${base}/stream?channel=${encodeURIComponent(channel)}&token=${encodeURIComponent(token)}`,
      );
    } catch { /* no session */ }
  }, [channel]);

  useRealtime({
    url: url ?? "",
    enabled: !!url,
    events: [channel],
    onMessage: () => void refresh(),
  });
}
