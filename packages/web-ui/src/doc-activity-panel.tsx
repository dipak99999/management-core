"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityTimeline, CommentComposer, type ActivityEntry } from "./activity-timeline";
import { useRealtime } from "./realtime";
import { useUIBackends } from "./backends";

/**
 * Drop-in `<DocActivityPanel doctype="PickList" docId={id} />` for any
 * doc detail page. Fetches /activity/:doctype/:id, posts comments through
 * /comments, and subscribes to the activity:<doctype> SSE channel so
 * other users' comments appear live.
 *
 * Requires <UIBackendsProvider> in the tree.
 */
export function DocActivityPanel({
  doctype,
  docId,
  streamBase,
}: {
  doctype: string;
  docId: string;
  /** Optional override for the SSE base URL. Defaults to the same base
   * the backends httpClient uses — most apps don't need this. */
  streamBase?: string;
}) {
  const backends = useUIBackends();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      // Reuse the http layer from backends — same auth + base URL rules.
      const data = await (backends as unknown as { aiBudget: unknown }); // typing dodge
      void data;
      const raw = await (await fetch(
        resolveBase(streamBase) + `/activity/${encodeURIComponent(doctype)}/${encodeURIComponent(docId)}`,
        { headers: authHeaders() },
      )).json();
      setEntries(Array.isArray(raw) ? (raw as ActivityEntry[]) : []);
    } catch {
      /* keep page functional */
    }
  }, [backends, doctype, docId, streamBase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live comment fan-in.
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = readToken();
    if (!token) return;
    setStreamUrl(
      `${resolveBase(streamBase)}/stream?channel=${encodeURIComponent(`activity:${doctype}`)}&token=${encodeURIComponent(token)}`,
    );
  }, [doctype, streamBase]);
  useRealtime({
    url: streamUrl ?? "",
    enabled: !!streamUrl,
    events: [`activity:${doctype}`],
    onMessage: (m) => {
      const d = m.data as { docId?: string } | null;
      if (d?.docId === docId) void load();
    },
  });

  async function postComment(body: string) {
    setPosting(true);
    try {
      await fetch(resolveBase(streamBase) + `/comments`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ doctype, docId, body }),
      });
      await load();
    } finally {
      setPosting(false);
    }
  }

  return (
    <ActivityTimeline
      entries={entries}
      composer={
        <CommentComposer
          busy={posting}
          onSubmit={postComment}
          placeholder="Add a note (⌘↵ to post)"
        />
      }
      empty="No activity yet."
    />
  );
}

function readToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("lumaara.session");
    if (!raw) return "";
    return (JSON.parse(raw) as { token?: string }).token ?? "";
  } catch { return ""; }
}

function authHeaders(): Record<string, string> {
  const t = readToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

function resolveBase(override?: string): string {
  if (override) return override;
  // Falls back to a Next.js same-origin rewrite path configured per app.
  // Every staff-web app proxies /api/auth-svc → auth-service.
  return (
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_AUTH_SERVICE_URL) ||
    "/api/auth-svc"
  );
}
