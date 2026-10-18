"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Fetcher = (doctype: string, id: string) => Promise<DocPreviewData | null>;

export interface DocPreviewData {
  title: string;
  subtitle?: string;
  rows?: Array<{ label: string; value: ReactNode }>;
  href?: string;
}

interface Ctx {
  fetcher: Fetcher;
  cache: Map<string, DocPreviewData | null>;
  prefetch: (doctype: string, id: string) => Promise<void>;
}

const Ctx = createContext<Ctx | null>(null);

export function DocPreviewProvider({
  children,
  fetcher,
}: {
  children: ReactNode;
  fetcher: Fetcher;
}) {
  const cache = useRef(new Map<string, DocPreviewData | null>()).current;
  const inflight = useRef(new Map<string, Promise<void>>()).current;
  const prefetch = useCallback(
    async (doctype: string, id: string) => {
      const key = `${doctype}::${id}`;
      if (cache.has(key)) return;
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        try {
          const data = await fetcher(doctype, id);
          cache.set(key, data);
        } catch {
          cache.set(key, null);
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
    [cache, inflight, fetcher],
  );
  const value = useMemo<Ctx>(() => ({ fetcher, cache, prefetch }), [fetcher, cache, prefetch]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDocPreview() {
  return useContext(Ctx);
}

export function DocPreview({
  doctype,
  id,
  children,
}: {
  doctype: string;
  id: string;
  children: ReactNode;
}) {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `${doctype}::${id}`;
  const data = ctx?.cache.get(key);

  const show = useCallback(() => {
    if (!ctx) return;
    timer.current = setTimeout(async () => {
      await ctx.prefetch(doctype, id);
      setTick((t) => t + 1);
      setOpen(true);
    }, 350);
  }, [ctx, doctype, id]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute z-40 top-full mt-1 start-0 min-w-[260px] max-w-[360px] rounded-lg bg-canvas border border-ink/10 shadow-xl p-3 text-xs"
        >
          {data === undefined && (
            <span className="text-ink-muted">Loading…</span>
          )}
          {data === null && (
            <span className="text-ink-muted">
              {doctype} {id} — no preview
            </span>
          )}
          {data && (
            <span className="block">
              <span className="block font-semibold text-ink text-sm">{data.title}</span>
              {data.subtitle && (
                <span className="block text-ink-muted mb-1">{data.subtitle}</span>
              )}
              {data.rows && (
                <span className="block mt-1 space-y-0.5">
                  {data.rows.map((r) => (
                    <span key={r.label} className="flex items-baseline justify-between gap-3">
                      <span className="text-ink-muted">{r.label}</span>
                      <span className="text-ink">{r.value}</span>
                    </span>
                  ))}
                </span>
              )}
              {data.href && (
                <a
                  href={data.href}
                  className="block mt-2 text-brew hover:underline text-[11px]"
                >
                  Open →
                </a>
              )}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
