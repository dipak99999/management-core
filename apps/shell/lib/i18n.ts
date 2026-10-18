"use client";

// Minimal, dep-free i18n for client components.
//
// Why not next-intl / react-i18next? Both are great but add 20-50KB to
// the bundle + require a provider in the layout. For a product that's
// currently 95% English with a handful of candidate target markets
// (India/Hindi, Latin America/Spanish), a 100-line helper with an
// extendable catalog is enough. Swap in a full lib the day you need
// pluralization, ICU messages, or RTL mirroring.
//
// Catalog shape: { en: { "greeting.hello": "Hello" }, hi: { ... } }
// Lookup falls back to `en` → `key` so a missing translation never
// crashes, it just shows the English (or the key).
//
// Persistence: lumaara.locale in localStorage. Changing emits a
// CustomEvent so useLocale() in every component re-renders.

import { useEffect, useState } from "react";

export type Locale = "en" | "hi" | "es";

export const LOCALES: Array<{ code: Locale; label: string; flag: string }> = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

const KEY = "lumaara.locale";
const EVT = "lumaara:locale-change";

// Starter catalogs. Add keys as you internationalize screens — missing
// keys fall back to English, which falls back to the key itself.
const CATALOG: Record<Locale, Record<string, string>> = {
  en: {
    "nav.dashboard": "Dashboard",
    "nav.customers": "Customers",
    "nav.invoices": "Invoices",
    "nav.settings": "Settings",
    "nav.help": "Help",
    "nav.billing": "Billing",
    "nav.logout": "Log out",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.search": "Search",
    "common.loading": "Loading…",
    "common.error": "Something went wrong",
    "common.yes": "Yes",
    "common.no": "No",
    "brew.placeholder": "Ask me anything",
    "brew.send": "Send",
    "billing.subscribe": "Subscribe",
    "billing.current_plan": "Current plan",
    "billing.renews_on": "Renews on",
    "billing.no_subscription": "No active subscription",
    "billing.payment_history": "Payment history",
  },
  hi: {
    "nav.dashboard": "डैशबोर्ड",
    "nav.customers": "ग्राहक",
    "nav.invoices": "चालान",
    "nav.settings": "सेटिंग्स",
    "nav.help": "मदद",
    "nav.billing": "बिलिंग",
    "nav.logout": "लॉग आउट",
    "common.save": "सहेजें",
    "common.cancel": "रद्द करें",
    "common.delete": "हटाएं",
    "common.edit": "संपादित करें",
    "common.search": "खोजें",
    "common.loading": "लोड हो रहा है…",
    "common.error": "कुछ गलत हुआ",
    "common.yes": "हाँ",
    "common.no": "नहीं",
    "brew.placeholder": "कुछ भी पूछें",
    "brew.send": "भेजें",
    "billing.subscribe": "सदस्यता लें",
    "billing.current_plan": "वर्तमान योजना",
    "billing.renews_on": "नवीनीकरण तिथि",
    "billing.no_subscription": "कोई सक्रिय सदस्यता नहीं",
    "billing.payment_history": "भुगतान इतिहास",
  },
  es: {
    "nav.dashboard": "Panel",
    "nav.customers": "Clientes",
    "nav.invoices": "Facturas",
    "nav.settings": "Ajustes",
    "nav.help": "Ayuda",
    "nav.billing": "Facturación",
    "nav.logout": "Cerrar sesión",
    "common.save": "Guardar",
    "common.cancel": "Cancelar",
    "common.delete": "Eliminar",
    "common.edit": "Editar",
    "common.search": "Buscar",
    "common.loading": "Cargando…",
    "common.error": "Algo salió mal",
    "common.yes": "Sí",
    "common.no": "No",
    "brew.placeholder": "Pregunta cualquier cosa",
    "brew.send": "Enviar",
    "billing.subscribe": "Suscribirse",
    "billing.current_plan": "Plan actual",
    "billing.renews_on": "Se renueva el",
    "billing.no_subscription": "Sin suscripción activa",
    "billing.payment_history": "Historial de pagos",
  },
};

export function loadLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(KEY) as Locale | null;
  if (stored && CATALOG[stored]) return stored;
  // Guess from browser if no stored pref. Fall back to en.
  const nav = navigator.language.split("-")[0] as Locale;
  return CATALOG[nav] ? nav : "en";
}

export function setLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, locale);
  // Also set <html lang> so screen readers + browser spellcheck notice.
  document.documentElement.lang = locale;
  window.dispatchEvent(new CustomEvent(EVT, { detail: locale }));
}

/**
 * Translate a key. Missing keys fall through English → the raw key so a
 * forgotten translation never crashes, just degrades gracefully.
 *
 * Pass `vars` for simple {name}-style interpolation:
 *   t("greeting", { name: "Alice" })  // "Hello, Alice"
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = CATALOG[locale]?.[key] ?? CATALOG.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/**
 * React hook — subscribes to locale changes so components re-render
 * when the user picks a new language. Returns [locale, t, setLocale].
 */
export function useI18n(): {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (l: Locale) => void;
} {
  const [locale, set] = useState<Locale>("en");
  useEffect(() => {
    set(loadLocale());
    const onChange = (e: Event) => set((e as CustomEvent<Locale>).detail);
    const onCross = (e: StorageEvent) => {
      if (e.key === KEY) set(loadLocale());
    };
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onCross);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onCross);
    };
  }, []);
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    setLocale,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Number + currency formatting — the OTHER half of i18n.
// Uses Intl.NumberFormat with the user's locale + a configurable
// currency. Default currency stays INR because the product targets
// India first; override via second arg or via localStorage for the
// tenant's primary currency.
// ─────────────────────────────────────────────────────────────────────

export function formatCurrency(
  amount: number,
  currency: string = "INR",
  locale: Locale = "en",
): string {
  const bcp = locale === "hi" ? "hi-IN" : locale === "es" ? "es-ES" : "en-IN";
  return new Intl.NumberFormat(bcp, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(
  dateIsoOrDate: string | Date,
  locale: Locale = "en",
): string {
  const d = typeof dateIsoOrDate === "string" ? new Date(dateIsoOrDate) : dateIsoOrDate;
  const bcp = locale === "hi" ? "hi-IN" : locale === "es" ? "es-ES" : "en-IN";
  return new Intl.DateTimeFormat(bcp, { dateStyle: "medium" }).format(d);
}
