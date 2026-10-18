"use client";

import { clearSession, loadSession } from "./auth";

// Same-origin proxy; see shell/next.config.js `rewrites()`.
const AUTH = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

// Lightweight client for shell → auth-service calls. Auto-attaches the JWT.
// On 401 (invalid/revoked token), clears the stale session + bounces to
// /login so the user isn't stuck on a page they can't fix without DevTools.
// Common trigger: server-side DB reset wipes UserSession rows while the
// browser still holds a JWT with a jti that no longer exists.
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const session = loadSession();
  // No session + an authed route → bounce to /login instead of firing a
  // guaranteed 401. Browsers log 401 responses as "Failed to load resource"
  // in DevTools, which looks like an app bug when it's just the user not
  // being signed in. Login/signup/forgot-password POST through separate
  // paths and don't flow through this helper.
  if (!session && !path.startsWith("/public/")) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new Error("not-authenticated");
  }
  const res = await fetch(`${AUTH}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // Backends can return HTML on hard failures (reverse-proxy 502,
  // Express default 500 handler, etc). Blind JSON.parse crashes with
  // "Unexpected token 'I'" and buries the real cause. Try/catch so the
  // error message carries the status + a snippet of the body instead.
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch {
      if (!res.ok) {
        throw new Error(
          `${res.status} ${res.statusText}: ${text.slice(0, 120).replace(/\s+/g, " ")}`,
        );
      }
      throw new Error(`Expected JSON but got: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
    }
  }
  if (res.status === 401 && session) {
    // Stale/revoked JWT. Kill the localStorage entry + redirect. Guard on
    // `session` so a login-attempt 401 (wrong password) doesn't get eaten
    // before the login page can display the error.
    clearSession();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }
  if (!res.ok) {
    throw new Error(
      (data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : null) ??
        `${res.status} ${res.statusText}`,
    );
  }
  return data as T;
}

export const api = {
  get: <T,>(p: string) => req<T>("GET", p),
  post: <T,>(p: string, body: unknown) => req<T>("POST", p, body),
  put: <T,>(p: string, body: unknown) => req<T>("PUT", p, body),
  patch: <T,>(p: string, body: unknown) => req<T>("PATCH", p, body),
  delete: <T,>(p: string) => req<T>("DELETE", p),
};
