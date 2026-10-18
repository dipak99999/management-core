"use client";

// Client-side i18n hook. Wraps the pure `t` helper from @lumaara/db
// with a React state that stores the user's locale in localStorage.
//
// Usage:
//   const t = useT();
//   <button>{t("common.save")}</button>
//   <p>{t("pluralize.invoices", { count: 3 })}</p>
//
// Locale switching:
//   const { locale, setLocale } = useLocale();
//   setLocale("hi"); // persists to localStorage.lumaara.locale + re-renders
//
// The initial locale is read from localStorage on first mount; SSR
// renders always use English (safe fallback — hydrates to the persisted
// locale on client mount).

import { useCallback, useEffect, useState } from "react";
import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  makeTranslator,
  type Locale,
  type TranslateParams,
} from "@lumaara/db/i18n";

const LS_KEY = "lumaara.locale";

// Read persisted locale from localStorage. Falls back to "en" on SSR
// or if the stored value is unrecognized.
function readPersisted(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return isSupportedLocale(raw) ? raw : "en";
  } catch {
    return "en";
  }
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    setLocaleState(readPersisted());
    // Cross-tab sync: another tab flipping the locale re-renders here.
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY && isSupportedLocale(e.newValue)) {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const setLocale = useCallback((l: Locale) => {
    try {
      window.localStorage.setItem(LS_KEY, l);
    } catch {
      /* quota / privacy mode — ignore */
    }
    setLocaleState(l);
  }, []);
  return { locale, setLocale };
}

// Convenience — one hook that returns a bound `t()`.
export function useT() {
  const { locale } = useLocale();
  return useCallback((key: string, params?: TranslateParams) => makeTranslator(locale)(key, params), [locale]);
}

export { SUPPORTED_LOCALES };
