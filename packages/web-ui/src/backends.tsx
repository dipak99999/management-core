"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AiRulesBackend } from "./ai";
import type { SavedViewsBackend, SavedView } from "./saved-views";
import type { SmartDefaultsBackend } from "./smart-defaults";

export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

/**
 * Factory that wires all four @lumaara/web-ui persistence backends to
 * an auth-service http client. One call-site per app:
 *
 *   export const uiBackends = makeUIBackends(authApi);
 *   // then:
 *   const views = useSavedViews("stock-web:pick-lists", uiBackends.views);
 */
export function makeUIBackends(http: HttpClient): {
  views: SavedViewsBackend;
  defaults: SmartDefaultsBackend;
  rules: AiRulesBackend;
  aiBudget: () => Promise<{ used: number; limit: number; currency: string } | null>;
} {
  return {
    views: {
      list: async (listKey: string) =>
        http.get<SavedView<unknown>[]>(`/user-views?listKey=${encodeURIComponent(listKey)}`),
      create: (input) => http.post(`/user-views`, input),
      update: (id, patch) => http.put(`/user-views/${id}`, patch),
      remove: async (id) => {
        await http.delete(`/user-views/${id}`);
      },
    },
    defaults: {
      get: async (formKey) => {
        const row = await http.get<{ value: unknown } | null>(
          `/form-defaults/${encodeURIComponent(formKey)}`,
        );
        return row?.value ?? null;
      },
      set: async (formKey, value) => {
        await http.put(`/form-defaults`, { formKey, value });
      },
      clear: async (formKey) => {
        await http.delete(`/form-defaults/${encodeURIComponent(formKey)}`);
      },
    },
    rules: {
      list: (scope) => http.get(`/ai-rules?scope=${encodeURIComponent(scope)}`),
      create: (input) => http.post(`/ai-rules`, input),
      bump: async (id) => {
        await http.post(`/ai-rules/${id}/bump`);
      },
      remove: async (id) => {
        await http.delete(`/ai-rules/${id}`);
      },
    },
    aiBudget: async () => {
      try {
        return await http.get<{ used: number; limit: number; currency: string }>(`/ai-budget`);
      } catch {
        return null;
      }
    },
  };
}

export type UIBackends = ReturnType<typeof makeUIBackends>;

const BackendsCtx = createContext<UIBackends | null>(null);

export function UIBackendsProvider({
  value,
  children,
}: {
  value: UIBackends;
  children: ReactNode;
}) {
  return <BackendsCtx.Provider value={value}>{children}</BackendsCtx.Provider>;
}

/** Access the shared UI backends. Throws if the provider is missing so bugs
 * surface at mount time rather than silently falling back to localStorage. */
export function useUIBackends(): UIBackends {
  const ctx = useContext(BackendsCtx);
  if (!ctx)
    throw new Error("useUIBackends: wrap in <UIBackendsProvider value={makeUIBackends(authApi)}>");
  return ctx;
}

/** Variant that returns null instead of throwing — use when a provider is
 * optional (e.g. anonymous portal pages). */
export function useOptionalUIBackends(): UIBackends | null {
  return useContext(BackendsCtx);
}
