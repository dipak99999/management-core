"use client";

// Two UI surfaces:
//   - "ai"     — full-screen chat/prompt (default, matches reference)
//   - "manual" — classic sidebar + module pages
//
// Persisted per-user in localStorage so the choice sticks across sessions.
// Emitted as a CustomEvent so both the sidebar wrapper and the mode toggle
// stay in sync inside one tab without React context prop-drilling.
import { useEffect, useState } from "react";

export type UiMode = "ai" | "manual";
const KEY = "lumaara.uiMode";
const EVT = "lumaara:mode-change";

export function loadMode(): UiMode {
  if (typeof window === "undefined") return "ai";
  const stored = localStorage.getItem(KEY);
  return stored === "manual" ? "manual" : "ai";
}

export function setMode(mode: UiMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, mode);
  window.dispatchEvent(new CustomEvent(EVT, { detail: mode }));
}

// React hook: reads from localStorage + subscribes to same-tab + cross-tab
// changes so any component that renders differently by mode re-renders.
export function useMode(): [UiMode, (m: UiMode) => void] {
  const [mode, set] = useState<UiMode>("ai");
  useEffect(() => {
    set(loadMode());
    const onSame = (e: Event) => set((e as CustomEvent<UiMode>).detail);
    const onCross = (e: StorageEvent) => {
      if (e.key === KEY) set(loadMode());
    };
    window.addEventListener(EVT, onSame);
    window.addEventListener("storage", onCross);
    return () => {
      window.removeEventListener(EVT, onSame);
      window.removeEventListener("storage", onCross);
    };
  }, []);
  return [mode, setMode];
}
