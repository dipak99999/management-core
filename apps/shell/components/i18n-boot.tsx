"use client";
import { useEffect, useState } from "react";
import { LocaleProvider } from "@lumaara/web-i18n";
import { loadSession } from "../lib/auth";

// Resolve the locale once per session + hand it to the provider. Order:
//   1. localStorage.lumaara.locale — set by login handler when it reads
//      the tenant.locale off the login response.
//   2. session.tenant.locale (stale but safe fallback for existing sessions
//      that pre-date the locale field).
//   3. "en".
//
// Deliberately client-only. SSR would need middleware + cookie; this is
// the minimum viable adoption for Phase 1 i18n (see docs/I18N.md).

export function I18nBoot({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<string | undefined>(undefined);
  useEffect(() => {
    const stored = typeof window !== "undefined"
      ? localStorage.getItem("lumaara.locale")
      : null;
    const sessionLocale = loadSession()?.tenant?.locale;
    setLocale(stored ?? sessionLocale ?? "en");
  }, []);
  return <LocaleProvider value={locale ?? "en"}>{children}</LocaleProvider>;
}
