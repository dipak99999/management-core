// Supported locales for the staff + portal web apps. Keep in sync with
// `packages/print/src/i18n.ts` (PDF templates) — the bags live in two
// places by design so each surface can grow strings independently
// (invoices use "Grand Total", a dashboard card uses "Overview") without
// cross-contamination.
//
// Adding a locale: define a bag, add it to `LOCALES`, extend the
// `SUPPORTED_LOCALES` tuple. Four lines + the translations.

export const SUPPORTED_LOCALES = ["en", "hi", "es", "de", "ar", "he"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// Locales that render right-to-left. Consumers use `isRTL(locale)` to
// flip the document's `dir` attribute + swap Tailwind `ml-*` → `ms-*`,
// `pl-*` → `ps-*`, etc. Only these two for now; the catalogue keys stay
// LTR-neutral (words rather than icons) so arrow glyphs don't need
// manual mirroring in every translation.
export const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set(["ar", "he"]);

export function isRTL(locale: SupportedLocale): boolean {
  return RTL_LOCALES.has(locale);
}

export function direction(locale: SupportedLocale): "ltr" | "rtl" {
  return isRTL(locale) ? "rtl" : "ltr";
}

export type Bag = Record<string, string>;

// English is the source. Every other locale is an override; keys the
// locale doesn't define fall through to English (= the source string
// passed to `t()`).
const EN: Bag = {};

const HI: Bag = {
  // Navigation + chrome
  Home: "होम",
  Dashboards: "डैशबोर्ड",
  Notifications: "सूचनाएँ",
  Todos: "कार्य",
  Settings: "सेटिंग्स",
  Logout: "लॉग आउट",
  Search: "खोजें",
  // Primary actions
  Save: "सहेजें",
  Cancel: "रद्द करें",
  Delete: "हटाएँ",
  Edit: "संपादित करें",
  Submit: "सबमिट करें",
  Close: "बंद करें",
  Add: "जोड़ें",
  Create: "बनाएँ",
  // Form labels
  Description: "विवरण",
  "Due date": "देय तिथि",
  Priority: "प्राथमिकता",
  Status: "स्थिति",
  // Priority levels
  Low: "कम",
  Medium: "मध्यम",
  High: "उच्च",
  // Status + state
  Open: "खुला",
  Done: "पूर्ण",
  All: "सभी",
  Loading: "लोड हो रहा है…",
  "No results": "कोई परिणाम नहीं",
  Required: "आवश्यक",
  Back: "वापस",
  Category: "श्रेणी",
};

const ES: Bag = {
  Home: "Inicio",
  Dashboards: "Paneles",
  Notifications: "Notificaciones",
  Todos: "Tareas",
  Settings: "Configuración",
  Logout: "Cerrar sesión",
  Search: "Buscar",
  Save: "Guardar",
  Cancel: "Cancelar",
  Delete: "Eliminar",
  Edit: "Editar",
  Submit: "Enviar",
  Close: "Cerrar",
  Add: "Añadir",
  Create: "Crear",
  Description: "Descripción",
  "Due date": "Fecha de vencimiento",
  Priority: "Prioridad",
  Status: "Estado",
  Low: "Baja",
  Medium: "Media",
  High: "Alta",
  Open: "Abierto",
  Done: "Hecho",
  All: "Todos",
  Loading: "Cargando…",
  "No results": "Sin resultados",
  Required: "Obligatorio",
  Back: "Atrás",
  Category: "Categoría",
};

const DE: Bag = {
  Home: "Start",
  Dashboards: "Dashboards",
  Notifications: "Benachrichtigungen",
  Todos: "Aufgaben",
  Settings: "Einstellungen",
  Logout: "Abmelden",
  Search: "Suchen",
  Save: "Speichern",
  Cancel: "Abbrechen",
  Delete: "Löschen",
  Edit: "Bearbeiten",
  Submit: "Absenden",
  Close: "Schließen",
  Add: "Hinzufügen",
  Create: "Erstellen",
  Description: "Beschreibung",
  "Due date": "Fälligkeitsdatum",
  Priority: "Priorität",
  Status: "Status",
  Low: "Niedrig",
  Medium: "Mittel",
  High: "Hoch",
  Open: "Offen",
  Done: "Erledigt",
  All: "Alle",
  Loading: "Lädt…",
  "No results": "Keine Ergebnisse",
  Required: "Erforderlich",
  Back: "Zurück",
  Category: "Kategorie",
};

// Arabic (RTL). Translations here are the standard-register "fuṣḥā"
// forms; dialects (Egyptian, Levantine, Gulf) are deliberately NOT
// branched — ERP UI terminology is close enough across them that one
// bag works. If a tenant insists on a regional variant, add
// e.g. "ar-EG" as a separate locale.
const AR: Bag = {
  Home: "الرئيسية",
  Dashboards: "اللوحات",
  Notifications: "الإشعارات",
  Todos: "المهام",
  Settings: "الإعدادات",
  Logout: "تسجيل الخروج",
  Search: "بحث",
  Save: "حفظ",
  Cancel: "إلغاء",
  Delete: "حذف",
  Edit: "تعديل",
  Submit: "إرسال",
  Close: "إغلاق",
  Add: "إضافة",
  Create: "إنشاء",
  Description: "الوصف",
  "Due date": "تاريخ الاستحقاق",
  Priority: "الأولوية",
  Status: "الحالة",
  Low: "منخفضة",
  Medium: "متوسطة",
  High: "عالية",
  Open: "مفتوح",
  Done: "مكتمل",
  All: "الكل",
  Loading: "جاري التحميل…",
  "No results": "لا توجد نتائج",
  Required: "مطلوب",
  Back: "رجوع",
  Category: "الفئة",
};

// Hebrew (RTL).
const HE: Bag = {
  Home: "דף הבית",
  Dashboards: "לוחות מחוונים",
  Notifications: "התראות",
  Todos: "משימות",
  Settings: "הגדרות",
  Logout: "התנתקות",
  Search: "חיפוש",
  Save: "שמור",
  Cancel: "ביטול",
  Delete: "מחק",
  Edit: "עריכה",
  Submit: "שלח",
  Close: "סגור",
  Add: "הוסף",
  Create: "צור",
  Description: "תיאור",
  "Due date": "תאריך יעד",
  Priority: "עדיפות",
  Status: "סטטוס",
  Low: "נמוכה",
  Medium: "בינונית",
  High: "גבוהה",
  Open: "פתוח",
  Done: "הושלם",
  All: "הכל",
  Loading: "טוען…",
  "No results": "אין תוצאות",
  Required: "חובה",
  Back: "חזרה",
  Category: "קטגוריה",
};

export const LOCALES: Record<SupportedLocale, Bag> = {
  en: EN,
  hi: HI,
  es: ES,
  de: DE,
  ar: AR,
  he: HE,
};

// Accept Accept-Language-style strings ("hi-IN", "en_US"), bare 2-char
// codes, or unknown input. Fall back to "en".
export function normalizeLocale(
  input: string | null | undefined,
): SupportedLocale {
  if (!input) return "en";
  const short = input.slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(short)
    ? (short as SupportedLocale)
    : "en";
}

// Look up `source` in the resolved locale's bag; fall through to the
// source itself if the locale has no override. Means callers can write
// `t("Save")` and English Just Works even before any translation lands.
export function translate(source: string, locale: SupportedLocale): string {
  return LOCALES[locale][source] ?? source;
}
