"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LS_KEY = (key: string) => `lumaara.defaults.${key}`;
const MAX_HISTORY = 10;

export interface SmartDefaultsBackend {
  get(formKey: string): Promise<unknown | null>;
  set(formKey: string, value: unknown): Promise<void>;
  clear(formKey: string): Promise<void>;
}

/**
 * Record of recent values the user has entered on a form.
 *
 *   const { last, remember, history } = useSmartDefaults<FormShape>("invoice-form", backend);
 *   <input defaultValue={last?.customerId ?? ""} />
 *   onSubmit → remember(formValues)
 *
 * With `backend` the latest value is persisted server-side (survives
 * device switch, cleared on signout). Without `backend` falls back to
 * localStorage with a bounded history for the recall UI. The backend
 * only stores the *latest* value; local history remains client-side.
 */
export function useSmartDefaults<T>(key: string, backend?: SmartDefaultsBackend) {
  const [history, setHistory] = useState<T[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(LS_KEY(key));
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  });
  const latest = useRef(history);
  latest.current = history;

  // Hydrate the server-persisted "last" value into history[0] on first mount.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    (async () => {
      try {
        const serverLast = (await backend.get(key)) as T | null;
        if (cancelled || !serverLast) return;
        setHistory((cur) => {
          // Server value may be identical to the local head — avoid duping.
          if (cur[0] && JSON.stringify(cur[0]) === JSON.stringify(serverLast)) return cur;
          return [serverLast, ...cur].slice(0, MAX_HISTORY);
        });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [backend, key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_KEY(key), JSON.stringify(history.slice(0, MAX_HISTORY)));
  }, [key, history]);

  const remember = useCallback(
    (value: T) => {
      setHistory((cur) => [value, ...cur].slice(0, MAX_HISTORY));
      if (backend) void backend.set(key, value).catch(() => {});
    },
    [backend, key],
  );

  const clear = useCallback(() => {
    setHistory([]);
    if (backend) void backend.clear(key).catch(() => {});
  }, [backend, key]);

  return {
    last: history[0] ?? null,
    history,
    remember,
    clear,
  };
}
