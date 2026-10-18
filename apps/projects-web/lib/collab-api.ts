"use client";

// Collab primitives (attachments, comments, notifications, todos) all live on
// the auth-service, not the accounting-service, so they need a separate base URL.
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const collabApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// File download for attachments — same rationale as downloadPdf in api.ts:
// token is in localStorage, not a cookie, so we can't just use an <a href>.
export async function downloadAttachment(
  id: string,
  filename: string,
): Promise<void> {
  const res = await fetch(`${BASE}/attachments/${id}/download?download=1`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
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

// Returns the current user's id (from the localStorage session) or "" if
// nothing is stored. Cheap read — every collab component needs it.
export function currentUserId(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    const s = JSON.parse(raw);
    return typeof s?.user?.id === "string" ? s.user.id : "";
  } catch {
    return "";
  }
}

// Reads a File as a base64 string (no data URL prefix) for upload.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
