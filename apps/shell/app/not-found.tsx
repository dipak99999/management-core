"use client";

import { useEffect } from "react";
import shortcuts from "../shortcut-redirects.json";

// Client-side safety net for the case where the app-router lands on a route
// that has no page in the shell (e.g. a stale bookmark like /leads, or a
// bfcache navigation whose chunk manifest is out of date). The middleware
// catches full requests; this catches whatever slips through.
//
// If the path is a known shortcut (or starts with one), replace the URL with
// the canonical destination. Otherwise render a plain "not found" so the
// user isn't stuck on a blank error boundary.
const shortcutMap = new Map<string, string>(shortcuts as [string, string][]);
const aliases: Record<string, string> = {
  "/invoices": "/accounting/sales-invoices",
  "/bills": "/buying/purchase-invoices",
  "/orders": "/crm/sales-orders",
};

function resolveShortcut(pathname: string): string | null {
  const exact = shortcutMap.get(pathname) ?? aliases[pathname];
  if (exact) return exact;
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length >= 2) {
    const first = `/${segs[0]}`;
    const mapped = shortcutMap.get(first) ?? aliases[first];
    if (mapped) return `${mapped}/${segs.slice(1).join("/")}`;
  }
  return null;
}

export default function NotFound() {
  useEffect(() => {
    const dest = resolveShortcut(window.location.pathname);
    if (dest) {
      // Full page reload so the browser drops any stale in-memory manifest —
      // simple, reliable, and only triggered on 404s.
      window.location.replace(dest + window.location.search);
    }
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-brand-soft">
      <div className="text-center space-y-3">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient shadow-brand-glow grid place-items-center">
          <span className="text-white text-2xl font-bold">L</span>
        </div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-ink-muted text-sm max-w-sm">
          The URL you followed doesn&apos;t match any Lumaara page.
        </p>
        <a href="/" className="btn-brand inline-flex">
          Back to dashboard
        </a>
      </div>
    </main>
  );
}
