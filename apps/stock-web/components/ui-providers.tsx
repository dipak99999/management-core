"use client";
import {
  CommandPaletteProvider,
  CommandPalette,
  KeyboardProvider,
  KeyboardCheatsheet,
  UndoToastProvider,
  DocPreviewProvider,
  UIBackendsProvider,
  makeUIBackends,
  type DocPreviewData,
  type HttpClient,
} from "@lumaara/web-ui";
import { useMemo, type ReactNode } from "react";

const AUTH_PREVIEW = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

function readToken(): string {
  if (typeof window === "undefined") return "";
  const raw = window.localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return (JSON.parse(raw) as { token?: string }).token ?? "";
  } catch {
    return "";
  }
}

async function authFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AUTH_PREVIEW}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(readToken() ? { authorization: `Bearer ${readToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

const httpClient: HttpClient = {
  get: (p) => authFetch("GET", p),
  post: (p, b) => authFetch("POST", p, b),
  put: (p, b) => authFetch("PUT", p, b),
  delete: (p) => authFetch("DELETE", p),
};

async function previewFetcher(doctype: string, id: string): Promise<DocPreviewData | null> {
  try {
    return await httpClient.get<DocPreviewData>(
      `/preview/${encodeURIComponent(doctype)}/${encodeURIComponent(id)}`,
    );
  } catch {
    return null;
  }
}

export function UIProviders({ children }: { children: ReactNode }) {
  const backends = useMemo(() => makeUIBackends(httpClient), []);
  const paletteSearch = async (q: string) =>
    httpClient.get<Array<{ doctype: string; id: string; title: string; subtitle?: string; href: string }>>(
      `/search?q=${encodeURIComponent(q)}`,
    );
  return (
    <KeyboardProvider>
      <CommandPaletteProvider search={paletteSearch}>
        <UndoToastProvider>
          <DocPreviewProvider fetcher={previewFetcher}>
            <UIBackendsProvider value={backends}>
              {children}
              <CommandPalette />
              <KeyboardCheatsheet />
            </UIBackendsProvider>
          </DocPreviewProvider>
        </UndoToastProvider>
      </CommandPaletteProvider>
    </KeyboardProvider>
  );
}
