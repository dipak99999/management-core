"use client";

// Minimal cookie-consent banner. Shows once per browser; "Got it" writes
// localStorage.lumaara.cookieConsent=1 and dismisses forever (user can
// manually clear browser storage to see it again).
//
// Why so minimal? We don't use third-party trackers by default — all our
// storage is strictly-necessary (session JWT, UI prefs). So EU "cookie
// law" (ePrivacy) technically doesn't require a banner for us. BUT:
//   1. Users expect to see one — its absence looks suspicious.
//   2. If you later add Google Analytics / Hotjar / etc, you MUST
//      upgrade this to a real consent dialog with a non-essential
//      toggle. The current component is a legal placeholder.
//
// Install in the root layout once:
//   <CookieBanner />
// It renders nothing after dismiss, so there's no cost on repeat
// visits.

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "lumaara.cookieConsent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== "1") setVisible(true);
    } catch {
      // Private mode / storage disabled → don't show the banner (we
      // can't persist the dismiss anyway, so it would appear every page).
    }
  }, []);

  if (!visible) return null;

  function dismiss(): void {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie notice"
      // Desktop: anchor bottom-right (clear of sidebar + sidebar-footer
      // collapse button) and lifted above the floating "+" agent FAB so a
      // first-time user can still reach every topbar + sidebar control.
      className="fixed bottom-4 start-4 end-4 md:start-auto md:end-6 md:bottom-20 md:max-w-sm z-30 card p-4 shadow-raised"
    >
      <p className="text-sm text-ink mb-3">
        We use strictly-necessary storage (session, preferences) to run the app.
        No third-party trackers.{" "}
        <Link href="/legal/cookies" className="underline">Learn more</Link>.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={dismiss}
          className="btn-primary btn-sm"
          autoFocus
        >
          Got it
        </button>
      </div>
    </div>
  );
}
