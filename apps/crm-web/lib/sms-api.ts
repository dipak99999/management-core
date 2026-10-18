"use client";

// SMS lives on the auth-service (mirrors email/broadcast), not the crm-service,
// so it needs its own base URL. Mirrors the pattern in collab-api.ts + auto-
// clears a stale session on 401 (see feedback-stale-jwt-401).
const BASE =
  process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

function token(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

function clearSessionAndRedirect(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("lumaara.session");
  } catch {
    // ignore quota/privacy-mode errors
  }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hadSession = !!token();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && hadSession) {
    clearSessionAndRedirect();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Request failed (${res.status})`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const smsApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
