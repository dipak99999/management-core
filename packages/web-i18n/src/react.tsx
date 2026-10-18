"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  direction,
  isRTL,
  normalizeLocale,
  translate,
  type SupportedLocale,
} from "./locale";

// Thin React layer over `translate(key, locale)`. Pattern:
//
//   // In app/providers.tsx or similar:
//   <LocaleProvider value={tenantLocale}>
//     {children}
//   </LocaleProvider>
//
//   // In any client component:
//   const t = useT();
//   return <button>{t("Save")}</button>;
//
// The provider accepts any string and normalises to a SupportedLocale.
// Reading via useContext without a provider yields "en" — safe default.

interface LocaleContextValue {
  locale: SupportedLocale;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: "en" });

export function LocaleProvider({
  value,
  children,
}: {
  value: string | null | undefined;
  children: ReactNode;
}) {
  const locale = useMemo(() => normalizeLocale(value), [value]);
  const ctx = useMemo(() => ({ locale }), [locale]);
  // Flip <html dir="rtl"> for Arabic/Hebrew so Tailwind's logical
  // properties (ms-*, ps-*, start-*, end-*) resolve correctly. The dir
  // attribute lives on <html>, not on this provider's wrapper, so it
  // applies to the whole document including portals and modals that
  // render outside this subtree.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.documentElement.getAttribute("dir");
    document.documentElement.setAttribute("dir", direction(locale));
    document.documentElement.setAttribute("lang", locale);
    return () => {
      if (prev) document.documentElement.setAttribute("dir", prev);
      else document.documentElement.removeAttribute("dir");
    };
  }, [locale]);
  return <LocaleContext.Provider value={ctx}>{children}</LocaleContext.Provider>;
}

export function useLocale(): SupportedLocale {
  return useContext(LocaleContext).locale;
}

/** True when the current locale renders right-to-left. */
export function useIsRTL(): boolean {
  return isRTL(useLocale());
}

/**
 * Return a `t(source)` function bound to the current locale. Memoised so
 * downstream `useMemo` dependencies that include `t` stay stable across
 * renders while the locale is unchanged.
 */
export function useT(): (source: string) => string {
  const locale = useLocale();
  return useMemo(
    () => (source: string) => translate(source, locale),
    [locale],
  );
}
