"use client";

// Global toast host — mount once in the AppShell. Any code anywhere in
// the shell (or in a microfrontend proxied through the shell's origin)
// can call `showToast("Message", "success"|"error"|"info")` and a toast
// slides in bottom-right, auto-dismisses after 4s.
//
// Zero-dep by design: uses a window CustomEvent so a tsx file three
// microfrontends away can trigger a toast without an import graph.

import { useEffect, useState } from "react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const EVT = "lumaara:toast";

// Public API — call from anywhere.
export function showToast(message: string, kind: ToastKind = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT, { detail: { message, kind } }));
}

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
