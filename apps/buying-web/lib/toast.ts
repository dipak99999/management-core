"use client";

// Dispatch a toast event to the shell's ToastHost. Works from any
// microfrontend because the shell's rewrite proxy keeps everything on
// the same browser origin, and the ToastHost listens on `window`.
//
// Usage:
//   import { showToast } from "../lib/toast";
//   showToast("Saved", "success");

type ToastKind = "success" | "error" | "info";

export function showToast(message: string, kind: ToastKind = "info"): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("lumaara:toast", { detail: { message, kind } }),
    );
  } catch {
    // Fallback — if CustomEvent isn't supported, fall back to alert.
    // Should never trigger on a modern browser.
     
    alert(message);
  }
}
