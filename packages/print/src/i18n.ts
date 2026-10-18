// Print-template localization. Small static registry — one bag per locale.
// Templates call `t("Grand Total", locale)`; unknown keys fall back to the
// English string (which callsites also pass, so English keeps working with
// no lookup cost). Unknown locales fall back to "en".
//
// Adding a locale is 4 lines: define a bag, add it to the LOCALES map. Adding
// a key is one line per supported locale.

export const SUPPORTED_LOCALES = ["en", "hi", "es", "de"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// English is the source of truth. Every other locale is a partial override —
// missing keys fall through to the English string.
type Bag = Record<string, string>;

const EN: Bag = {}; // Empty — English callsites already use English text.

const HI: Bag = {
  "Sales Invoice": "बिक्री चालान",
  "Purchase Invoice": "क्रय चालान",
  "Salary Slip": "वेतन पर्ची",
  "Quotation": "कोटेशन",
  "Sales Order": "बिक्री आदेश",
  "Delivery Note": "डिलीवरी नोट",
  "Purchase Receipt": "क्रय रसीद",
  "Payment Entry": "भुगतान प्रविष्टि",
  "Stock Entry": "स्टॉक प्रविष्टि",
  "Journal Entry": "जर्नल प्रविष्टि",
  "Expense Claim": "व्यय दावा",
  "Loan": "ऋण",
  "Bill to": "बिल किसे",
  "Ship to": "शिपिंग पता",
  "Item": "आइटम",
  "Description": "विवरण",
  "Qty": "मात्रा",
  "Rate": "दर",
  "Amount": "राशि",
  "Subtotal": "उप-योग",
  "Grand Total": "कुल योग",
  "Outstanding": "बकाया",
  "Status": "स्थिति",
  "Remarks": "टिप्पणी",
  "Date": "दिनांक",
  "Due": "देय",
  "due": "देय",
  "Terms & Conditions": "नियम एवं शर्तें",
  "Earnings": "आय",
  "Deductions": "कटौतियाँ",
  "Net Pay": "शुद्ध वेतन",
  "Employee": "कर्मचारी",
  "Period": "अवधि",
  "Gross": "सकल",
  "Total Deductions": "कुल कटौतियाँ",
};

const ES: Bag = {
  "Sales Invoice": "Factura de Venta",
  "Purchase Invoice": "Factura de Compra",
  "Salary Slip": "Recibo de Salario",
  "Quotation": "Cotización",
  "Sales Order": "Orden de Venta",
  "Delivery Note": "Nota de Entrega",
  "Purchase Receipt": "Recibo de Compra",
  "Payment Entry": "Registro de Pago",
  "Bill to": "Facturar a",
  "Ship to": "Enviar a",
  "Item": "Artículo",
  "Description": "Descripción",
  "Qty": "Cant.",
  "Rate": "Precio",
  "Amount": "Importe",
  "Subtotal": "Subtotal",
  "Grand Total": "Total",
  "Outstanding": "Pendiente",
  "Status": "Estado",
  "Remarks": "Comentarios",
  "Date": "Fecha",
  "Due": "Vence",
  "due": "vence",
  "Terms & Conditions": "Términos y Condiciones",
  "Earnings": "Ingresos",
  "Deductions": "Deducciones",
  "Net Pay": "Neto a Pagar",
  "Employee": "Empleado",
  "Period": "Periodo",
  "Gross": "Bruto",
  "Total Deductions": "Total Deducciones",
};

const DE: Bag = {
  "Sales Invoice": "Rechnung",
  "Purchase Invoice": "Eingangsrechnung",
  "Salary Slip": "Gehaltsabrechnung",
  "Quotation": "Angebot",
  "Sales Order": "Auftrag",
  "Delivery Note": "Lieferschein",
  "Purchase Receipt": "Wareneingang",
  "Payment Entry": "Zahlung",
  "Bill to": "Rechnungsadresse",
  "Ship to": "Lieferadresse",
  "Item": "Artikel",
  "Description": "Beschreibung",
  "Qty": "Menge",
  "Rate": "Preis",
  "Amount": "Betrag",
  "Subtotal": "Zwischensumme",
  "Grand Total": "Gesamtsumme",
  "Outstanding": "Offen",
  "Status": "Status",
  "Remarks": "Anmerkungen",
  "Date": "Datum",
  "Due": "Fällig",
  "due": "fällig",
  "Terms & Conditions": "AGB",
  "Earnings": "Vergütung",
  "Deductions": "Abzüge",
  "Net Pay": "Netto",
  "Employee": "Mitarbeiter",
  "Period": "Zeitraum",
  "Gross": "Brutto",
  "Total Deductions": "Summe Abzüge",
};

const LOCALES: Record<SupportedLocale, Bag> = {
  en: EN,
  hi: HI,
  es: ES,
  de: DE,
};

export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  if (!input) return "en";
  const short = input.slice(0, 2).toLowerCase() as SupportedLocale;
  return (SUPPORTED_LOCALES as readonly string[]).includes(short) ? short : "en";
}

// Look up an English source string in the requested locale's bag. Falls
// through to the source string when the locale has no override — so
// templates can safely default to English and localize incrementally.
export function t(source: string, locale?: string | null): string {
  const l = normalizeLocale(locale);
  return LOCALES[l][source] ?? source;
}

// Factory that closes over a locale, so a template doesn't need to pass
// `locale` on every call. Usage: `const tt = tf(locale); tt("Item")`.
export function tf(locale?: string | null): (s: string) => string {
  const l = normalizeLocale(locale);
  const bag = LOCALES[l];
  return (s: string) => bag[s] ?? s;
}
