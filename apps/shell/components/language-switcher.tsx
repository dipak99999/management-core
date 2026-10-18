"use client";

// Language dropdown — drop anywhere in the shell. Reads/writes to the
// same localStorage key as useI18n() so every component that opts-in to
// the hook re-renders when the user picks a new language.

import { LOCALES, useI18n, type Locale } from "../lib/i18n";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Language"
      className={`input text-xs py-1 pe-6 ${className}`.trim()}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.label}
        </option>
      ))}
    </select>
  );
}
