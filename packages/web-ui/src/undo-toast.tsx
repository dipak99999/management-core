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

interface PendingToast {
  id: string;
  message: string;
  undo: () => void | Promise<void>;
  commit: () => void | Promise<void>;
  timeoutMs: number;
  startedAt: number;
}

interface Ctx {
  show: (opts: {
    message: string;
    undo: () => void | Promise<void>;
    commit: () => void | Promise<void>;
    timeoutMs?: number;
  }) => void;
}

const UndoCtx = createContext<Ctx | null>(null);

export function UndoToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<PendingToast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const commitAndRemove = useCallback(async (id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    const toast = (await new Promise<PendingToast | undefined>((resolve) => {
      setToasts((cur) => {
        const found = cur.find((x) => x.id === id);
        resolve(found);
        return cur.filter((x) => x.id !== id);
      });
    })) as PendingToast | undefined;
    if (toast) await toast.commit();
  }, []);

  const undoAndRemove = useCallback(async (id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    const toast = (await new Promise<PendingToast | undefined>((resolve) => {
      setToasts((cur) => {
        const found = cur.find((x) => x.id === id);
        resolve(found);
        return cur.filter((x) => x.id !== id);
      });
    })) as PendingToast | undefined;
    if (toast) await toast.undo();
  }, []);

  const show = useCallback<Ctx["show"]>(
    ({ message, undo, commit, timeoutMs = 7000 }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: PendingToast = {
        id,
        message,
        undo,
        commit,
        timeoutMs,
        startedAt: Date.now(),
      };
      setToasts((cur) => [...cur, toast]);
      const t = setTimeout(() => void commitAndRemove(id), timeoutMs);
      timers.current.set(id, t);
    },
    [commitAndRemove],
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const value = useMemo<Ctx>(() => ({ show }), [show]);

  return (
    <UndoCtx.Provider value={value}>
      {children}
      <div
        className="fixed bottom-6 start-6 z-40 flex flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg bg-ink text-white px-4 py-2 shadow-xl text-sm"
          >
            <span className="min-w-0">{t.message}</span>
            <button
              className="text-brew-pale font-semibold hover:underline"
              onClick={() => void undoAndRemove(t.id)}
            >
              Undo
            </button>
            <button
              className="text-white/60 hover:text-white"
              onClick={() => void commitAndRemove(t.id)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </UndoCtx.Provider>
  );
}

export function useUndoToast(): Ctx["show"] {
  const ctx = useContext(UndoCtx);
  if (!ctx) throw new Error("useUndoToast: wrap in <UndoToastProvider>");
  return ctx.show;
}

/**
 * Convenience helper that defers the real destructive call until the undo
 * window elapses. Keeps the UI optimistic (row disappears immediately) while
 * the server call only fires when the user doesn't press Undo.
 */
export function undoableAction<T>({
  show,
  message,
  optimistic,
  commit,
  revert,
  timeoutMs,
}: {
  show: Ctx["show"];
  message: string;
  optimistic: () => void;
  commit: () => Promise<T> | T;
  revert: () => void;
  timeoutMs?: number;
}): void {
  optimistic();
  let undone = false;
  show({
    message,
    timeoutMs,
    undo: () => {
      undone = true;
      revert();
    },
    commit: async () => {
      if (undone) return;
      try {
        await commit();
      } catch {
        revert();
      }
    },
  });
}
