"use client";

// Same-origin proxy — see projects-web/lib/api.ts header for rationale.
// Buying hits accounting-service, hence `/api/accounting`.
const BASE =
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
      typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Fetches a PDF endpoint with auth then triggers a browser download. Uses
// a blob URL because the JWT lives in localStorage, so a plain <a href>
// can't ride along on the link click.
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
