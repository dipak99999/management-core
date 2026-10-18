export {
  SUPPORTED_LOCALES,
  LOCALES,
  RTL_LOCALES,
  normalizeLocale,
  translate,
  isRTL,
  direction,
} from "./locale";
export type { SupportedLocale, Bag } from "./locale";
export { LocaleProvider, useLocale, useT, useIsRTL } from "./react";
