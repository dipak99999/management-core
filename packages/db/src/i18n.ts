// Lightweight in-house i18n — no external dep, keys → per-locale strings.
//
// Design:
//   * One bundle per locale (BUNDLES.en, BUNDLES.hi, …). Bundles are
//     plain `{key: string}` objects loaded once at process start.
//   * `t(key, locale, params?)` looks up the string, falls back to
//     English if the target locale doesn't have it, falls back to the
//     key itself if English is also missing (so a missing translation
//     shows the key — obvious signal in QA).
//   * `{{name}}` placeholders interpolated from params.
//   * Pluralization: pass `{count: N}`; the key can have `.one` / `.other`
//     suffixes and `t()` picks the right one.
//
// Locale resolution:
//   * Server: read `Tenant.locale` (falls back to "en"). Route handlers
//     stash it on req.
//   * Client: read the shell's localStorage `lumaara.locale`, default "en".
//
// Extending: add a bundle to BUNDLES and every caller of `t()` picks it
// up. Keys are intentionally flat + string-typed (not a nested TS type)
// so translators can edit bundles without regenerating types.

export type Locale = "en" | "hi";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "hi"] as const;

type Bundle = Record<string, string>;

// Bundles live inline here for the seed set. Larger apps could load
// them via `import "./bundles/hi.json"` and let bundlers tree-shake.
const EN: Bundle = {
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.submit": "Submit",
  "common.confirm": "Confirm",
  "common.loading": "Loading…",
  "common.no_records": "No records yet",
  "common.search": "Search…",
  "common.download": "Download",
  "common.print": "Print",
  "common.back": "Back",
  "common.next": "Next",
  "common.previous": "Previous",
  "common.actions": "Actions",
  "common.status": "Status",
  "common.total": "Total",
  "common.date": "Date",
  "common.amount": "Amount",
  "common.quantity": "Quantity",
  "common.customer": "Customer",
  "common.supplier": "Supplier",
  "common.item": "Item",
  "nav.dashboard": "Dashboard",
  "nav.leads": "Leads",
  "nav.opportunities": "Opportunities",
  "nav.invoices": "Invoices",
  "nav.payments": "Payments",
  "nav.reports": "Reports",
  "auth.login": "Log in",
  "auth.logout": "Log out",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.forgot_password": "Forgot password?",
  "invoice.new": "New invoice",
  "invoice.draft": "Draft",
  "invoice.submitted": "Submitted",
  "invoice.paid": "Paid",
  "invoice.overdue": "Overdue",
  "pluralize.invoices.one": "{{count}} invoice",
  "pluralize.invoices.other": "{{count}} invoices",
  "pluralize.leads.one": "{{count}} lead",
  "pluralize.leads.other": "{{count}} leads",
};

const HI: Bundle = {
  "common.save": "सहेजें",
  "common.cancel": "रद्द करें",
  "common.delete": "हटाएँ",
  "common.edit": "संपादित करें",
  "common.submit": "प्रस्तुत करें",
  "common.confirm": "पुष्टि करें",
  "common.loading": "लोड हो रहा है…",
  "common.no_records": "कोई रिकॉर्ड नहीं",
  "common.search": "खोजें…",
  "common.download": "डाउनलोड",
  "common.print": "प्रिंट",
  "common.back": "वापस",
  "common.next": "अगला",
  "common.previous": "पिछला",
  "common.actions": "कार्रवाइयाँ",
  "common.status": "स्थिति",
  "common.total": "कुल",
  "common.date": "दिनांक",
  "common.amount": "राशि",
  "common.quantity": "मात्रा",
  "common.customer": "ग्राहक",
  "common.supplier": "आपूर्तिकर्ता",
  "common.item": "वस्तु",
  "nav.dashboard": "डैशबोर्ड",
  "nav.leads": "लीड्स",
  "nav.opportunities": "अवसर",
  "nav.invoices": "चालान",
  "nav.payments": "भुगतान",
  "nav.reports": "रिपोर्ट",
  "auth.login": "लॉग इन",
  "auth.logout": "लॉग आउट",
  "auth.email": "ईमेल",
  "auth.password": "पासवर्ड",
  "auth.forgot_password": "पासवर्ड भूल गए?",
  "invoice.new": "नया चालान",
  "invoice.draft": "मसौदा",
  "invoice.submitted": "प्रस्तुत",
  "invoice.paid": "भुगतान किया गया",
  "invoice.overdue": "अतिदेय",
  "pluralize.invoices.one": "{{count}} चालान",
  "pluralize.invoices.other": "{{count}} चालान",
  "pluralize.leads.one": "{{count}} लीड",
  "pluralize.leads.other": "{{count}} लीड्स",
};

export const BUNDLES: Record<Locale, Bundle> = { en: EN, hi: HI };

// Interpolate {{name}} placeholders with values from `params`.
function interpolate(template: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    const v = params[k];
    return v == null ? "" : String(v);
  });
}

export interface TranslateParams {
  count?: number;
  [key: string]: string | number | undefined;
}

// Look up a key in the given locale, with pluralization + English
// fallback + key fallback.
export function t(
  key: string,
  locale: Locale = "en",
  params?: TranslateParams,
): string {
  const bundle = BUNDLES[locale] ?? EN;
  // Pluralization: caller passes `count`; we probe key.one / key.other.
  if (params && typeof params.count === "number") {
    const plural = params.count === 1 ? "one" : "other";
    const pluralKey = `${key}.${plural}`;
    const found = bundle[pluralKey] ?? EN[pluralKey];
    if (found) return interpolate(found, params);
  }
  const direct = bundle[key] ?? EN[key] ?? key;
  return interpolate(direct, params);
}

// Curry a t() bound to a locale so callers don't repeat the locale arg.
export function makeTranslator(locale: Locale) {
  return (key: string, params?: TranslateParams) => t(key, locale, params);
}

export function isSupportedLocale(x: string | null | undefined): x is Locale {
  return typeof x === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(x);
}
