import type { SupportedLocale } from "@gadgets/workshop-shared/api";

/** Locales available in the phase-one Softmatrix UI. */
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

/** Return whether a persisted or external value is a supported UI locale. */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === "en" || value === "zh-CN";
}

/** Prefer Simplified Chinese for any Chinese browser language; otherwise use English. */
export function detectLocale(
  languages: readonly string[] = navigator.languages,
): SupportedLocale {
  return languages.some((language) => /^zh(?:-|$)/i.test(language)) ? "zh-CN" : "en";
}
