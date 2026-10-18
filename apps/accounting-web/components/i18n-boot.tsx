"use client";
import { useEffect, useState } from "react";
import { LocaleProvider } from "@lumaara/web-i18n";

// Resolve the locale once per session + hand it to the provider. Order:
//   1. localStorage.lumaara.locale (set by the shell on login).
//   2. localStorage.lumaara.session → tenant.locale (fallback for
//      sessions issued before the field existed).
//   3. "en".
//
// Deliberately client-only. SSR would need middleware + cookie; this is
// the minimum viable adoption for Phase 1 i18n (see docs/I18N.md).
export function I18nBoot({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("lumaara.locale");
    let sessionLocale: string | undefined;
    try {
      const raw = localStorage.getItem("lumaara.session");
      if (raw) {
        const parsed = JSON.parse(raw) as { tenant?: { locale?: string } };
        sessionLocale = parsed.tenant?.locale;
      }
    } catch {
      // ignore parse errors — fall through
    }
    setLocale(stored ?? sessionLocale ?? "en");
  }, []);
  return <LocaleProvider value={locale ?? "en"}>{children}</LocaleProvider>;
}
