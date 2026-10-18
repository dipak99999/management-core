import { describe, expect, it } from "vitest";
import {
  direction,
  isRTL,
  normalizeLocale,
  translate,
} from "./locale";

describe("normalizeLocale", () => {
  it("returns the short code for a known locale", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("hi")).toBe("hi");
    expect(normalizeLocale("es")).toBe("es");
    expect(normalizeLocale("de")).toBe("de");
  });

  it("strips region suffixes (en-US, hi_IN, de-AT)", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("hi_IN")).toBe("hi");
    expect(normalizeLocale("de-AT")).toBe("de");
  });

  it("case-insensitive", () => {
    expect(normalizeLocale("EN")).toBe("en");
    expect(normalizeLocale("HI")).toBe("hi");
  });

  it("falls back to en on unknown input", () => {
    expect(normalizeLocale("fr")).toBe("en");
    expect(normalizeLocale("")).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
  });
});

describe("translate", () => {
  it("returns Hindi string for a known key when locale=hi", () => {
    expect(translate("Save", "hi")).toBe("सहेजें");
    expect(translate("Settings", "hi")).toBe("सेटिंग्स");
  });

  it("falls through to the source string when the key isn't translated", () => {
    expect(translate("Not In Any Bag", "hi")).toBe("Not In Any Bag");
    expect(translate("Not In Any Bag", "de")).toBe("Not In Any Bag");
  });

  it("returns the source string for en (no bag entries)", () => {
    expect(translate("Save", "en")).toBe("Save");
    expect(translate("Anything", "en")).toBe("Anything");
  });

  it("Spanish + German round-trip the common actions", () => {
    expect(translate("Cancel", "es")).toBe("Cancelar");
    expect(translate("Cancel", "de")).toBe("Abbrechen");
  });

  it("Arabic + Hebrew bags provide translations too", () => {
    expect(translate("Save", "ar")).toBe("حفظ");
    expect(translate("Save", "he")).toBe("שמור");
    expect(translate("Settings", "ar")).toBe("الإعدادات");
  });
});

describe("RTL helpers", () => {
  it("isRTL returns true only for Arabic + Hebrew", () => {
    expect(isRTL("ar")).toBe(true);
    expect(isRTL("he")).toBe(true);
    expect(isRTL("en")).toBe(false);
    expect(isRTL("hi")).toBe(false);
    expect(isRTL("es")).toBe(false);
    expect(isRTL("de")).toBe(false);
  });

  it("direction returns 'rtl' for RTL locales, 'ltr' otherwise", () => {
    expect(direction("ar")).toBe("rtl");
    expect(direction("he")).toBe("rtl");
    expect(direction("en")).toBe("ltr");
    expect(direction("hi")).toBe("ltr");
  });

  it("normalizeLocale accepts ar + he region variants", () => {
    expect(normalizeLocale("ar-EG")).toBe("ar");
    expect(normalizeLocale("ar_SA")).toBe("ar");
    expect(normalizeLocale("he-IL")).toBe("he");
  });
});
