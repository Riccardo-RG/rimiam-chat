export type UiLocale = "en" | "it";
export type LanguagePreference = UiLocale | "system";
export function languagePreference(value: unknown): LanguagePreference {
  return value === "it" || value === "en" ? value : "system";
}
export function resolveUiLocale(
  preference: LanguagePreference,
  languages: readonly string[],
): UiLocale {
  if (preference !== "system") return preference;
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === "en" || base === "it") return base;
  }
  return "en";
}

/** Keep a regional voice when it matches the selected interface language. */
export function preferredVoiceLanguage(
  locale: UiLocale,
  deviceTag: string,
): string {
  return deviceTag.toLowerCase().split(/[-_]/)[0] === locale
    ? deviceTag.replaceAll("_", "-")
    : locale;
}
