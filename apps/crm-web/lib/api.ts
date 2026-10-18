"use client";

// Same-origin proxy — see projects-web/lib/api.ts header for rationale.
const BASE = process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";
// Cross-service base for accounting-owned resources (currencies, tax templates,
// etc.). Kept in one place so a base-URL move doesn't have to grep the app.
const ACCOUNTING_BASE =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

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

// See accounting-web/lib/api.ts for the full rationale on why we clear the
// stale session + hard-navigate to /login on a 401 with a session present.
function clearSessionAndRedirect(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("lumaara.session");
  } catch {
    // ignore quota / privacy-mode errors
  }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

// Client factory: same auth + 401 + error-body semantics against any base URL.
// Kept as a factory so cross-service calls (e.g. accounting-owned resources
// consumed by crm-web) share the exact same policy — no drift between the
// primary client and one-off `fetch(...)` calls scattered across pages.
export function makeClient(baseUrl: string) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const hadSession = !!token();
    const res = await fetch(`${baseUrl}${path}`, {
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
        typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
      );
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }
  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}

// Primary client — same-tenant CRM service.
export const api = makeClient(BASE);

// Cross-service client for accounting-owned resources (currencies,
// tax templates, etc.). Same auth + 401 semantics as `api`.
export const accountingApi = makeClient(ACCOUNTING_BASE);

export async function downloadPdf(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}?download=1`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string" ? body.error : `PDF fetch failed (${res.status})`,
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
