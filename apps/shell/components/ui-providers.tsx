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
import { api } from "../lib/api";
import { NavCommands } from "./nav-commands";

// Doc preview fetcher. Routes each doctype to a cheap summary endpoint
// so hovering a doc number anywhere in the app shows title/key fields
// without a full navigation.
const previewFetcher = async (
  doctype: string,
  id: string,
): Promise<DocPreviewData | null> => {
  try {
    const data = await api.get<DocPreviewData>(
      `/preview/${encodeURIComponent(doctype)}/${encodeURIComponent(id)}`,
    );
    return data;
  } catch {
    return null;
  }
};

// Shell talks to auth-service through `api` (its only backend), so wrap it
// into the shape makeUIBackends expects. `api.post/put` require a body
// — pass `{}` when the backends layer omits one (e.g. ai-rules bump).
const httpClient: HttpClient = {
  get: (p) => api.get(p),
  post: (p, b) => api.post(p, b ?? {}),
  put: (p, b) => api.put(p, b ?? {}),
  delete: (p) => api.delete(p),
};

export function UIProviders({ children }: { children: ReactNode }) {
  const backends = useMemo(() => makeUIBackends(httpClient), []);
  const paletteSearch = async (q: string) =>
    api.get<Array<{ doctype: string; id: string; title: string; subtitle?: string; href: string }>>(
      `/search?q=${encodeURIComponent(q)}`,
    );
  return (
    <KeyboardProvider>
      <CommandPaletteProvider search={paletteSearch}>
        <UndoToastProvider>
          <DocPreviewProvider fetcher={previewFetcher}>
            <UIBackendsProvider value={backends}>
              <NavCommands />
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
