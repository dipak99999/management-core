"use client";

// Same-origin proxy — see projects-web/lib/api.ts header for rationale.
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

// On 401, kill the stale localStorage session + redirect to /login. Runs
// on every route so the user isn't stuck on a page they can't unstick
// without DevTools. Common trigger: server-side DB reset wipes UserSession
// rows while browser holds a JWT with a jti that no longer exists.
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

// PDF download helper. Fetches the service endpoint with auth, then triggers
// a browser download (blob URL). Can't use a plain <a href> because the token
// lives in localStorage, not a cookie, so we can't ride along on a link click.
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
