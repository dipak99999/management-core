"use client";

// Per-microfrontend toast host. The shell has its own ToastHost on
// shell-owned routes, but when the user is on an accounting-web route
// (/accounting/*), the shell's AppShell is NOT mounted — so dispatches
// from lib/toast.ts would land on `window` with no listener. This
// component is mounted once inside the accounting-web AppShell so any
// showToast() call from an accounting page lands here.

import { useEffect, useState } from "react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const EVT = "lumaara:toast";

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    let nextId = 1;
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<{ message: string; kind: ToastKind }>).detail;
      if (!detail?.message) return;
      const id = nextId++;
      setItems((prev) => [...prev, { id, message: detail.message, kind: detail.kind }]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    }
    window.addEventListener(EVT, onEvent);
    return () => window.removeEventListener(EVT, onEvent);
  }, []);

  if (items.length === 0) return null;
  return (
    <div
      className="fixed bottom-24 end-6 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={
            "pointer-events-auto rounded-xl shadow-raised px-4 py-3 text-sm max-w-sm border animate-fade-in " +
            (t.kind === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : t.kind === "error"
              ? "bg-red-50 border-red-200 text-red-900"
              : "bg-white border-ink/10 text-ink")
          }
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5" aria-hidden>
              {t.kind === "success" ? "✓" : t.kind === "error" ? "⚠" : "ⓘ"}
            </span>
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="opacity-50 hover:opacity-100 text-base leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
