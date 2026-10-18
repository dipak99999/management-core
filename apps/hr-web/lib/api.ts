"use client";

// Same-origin proxy — see projects-web/lib/api.ts header for rationale.
const BASE = process.env.NEXT_PUBLIC_HR_SERVICE_URL ?? "/api/hr";

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

// PDF download helper (see accounting-web/lib/api.ts for rationale).
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

// Generic authenticated file download (CSV, TXT, etc.). Reads
// Content-Disposition to pull the filename the server proposes;
// falls back to `defaultFilename`.
export async function downloadFile(path: string, defaultFilename: string): Promise<{ skipped: number }> {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${separator}download=1`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string" ? body.error : `Download failed (${res.status})`,
    );
  }
  const skipped = Number(res.headers.get("X-Skipped-Rows") ?? 0);
  const disp = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disp);
  const filename = match?.[1] ?? defaultFilename;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { skipped };
}
