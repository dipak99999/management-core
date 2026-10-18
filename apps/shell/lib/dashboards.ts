"use client";

import { clearSession, loadSession } from "./auth";

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

// Thin client for the accounting-service dashboards/scheduled-reports APIs
// (Phase G) — shell doesn't ship its own service, so we hit accounting for
// dashboards, reports-builder, and scheduled reports.

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const session = loadSession();
  const r = await fetch(`${ACC}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  // Guard against HTML/text responses from upstream — raw JSON.parse
  // throws "Unexpected token 'I'" ("Internal Server Error") and buries
  // the real status + body.
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new Error(`Expected JSON but got: ${text.slice(0, 120).replace(/\s+/g, " ")}`); }
  }
  if (r.status === 401 && session) {
    // Stale/revoked JWT — bounce to /login (see api.ts for full rationale).
    clearSession();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }
  if (!r.ok) {
    throw new Error(
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : null) ?? `${r.status} ${r.statusText}`,
    );
  }
  return data as T;
}

export const dashboardApi = {
  get: <T,>(p: string) => req<T>("GET", p),
  post: <T,>(p: string, body: unknown) => req<T>("POST", p, body),
  put: <T,>(p: string, body: unknown) => req<T>("PUT", p, body),
  delete: <T,>(p: string) => req<T>("DELETE", p),
};
