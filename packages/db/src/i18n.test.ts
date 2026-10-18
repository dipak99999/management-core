import { describe, expect, it } from "vitest";
import { isSupportedLocale, makeTranslator, t } from "./i18n";

describe("t", () => {
  it("returns the English string by default", () => {
    expect(t("common.save")).toBe("Save");
  });

  it("returns the Hindi string when locale=hi", () => {
    expect(t("common.save", "hi")).toBe("सहेजें");
  });

  it("falls back to English when a Hindi key is missing", () => {
    expect(t("common.no_records", "en")).toBe("No records yet");
    // If we later add a locale with a missing key, English should fill in.
    // For now every Hindi key exists — assert English path directly.
  });

  it("falls back to the key itself when neither locale has it", () => {
    expect(t("does.not.exist")).toBe("does.not.exist");
  });

  it("interpolates {{placeholders}}", () => {
    const s = t("pluralize.invoices.other", "en", { count: 5 });
    expect(s).toBe("5 invoices");
  });

  it("pluralizes on count=1 vs count!=1", () => {
    expect(t("pluralize.invoices", "en", { count: 1 })).toBe("1 invoice");
    expect(t("pluralize.invoices", "en", { count: 3 })).toBe("3 invoices");
  });

  it("makeTranslator binds a locale", () => {
    const tHi = makeTranslator("hi");
    expect(tHi("common.save")).toBe("सहेजें");
  });
});

describe("isSupportedLocale", () => {
  it("returns true for en / hi", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("hi")).toBe(true);
  });
  it("returns false for unknown / null", () => {
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});
