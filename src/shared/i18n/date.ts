import type { UiLocale } from "./locale";
/** Build each locale's formatter once for a fixed set of display options. */
export function localizedDate(options: Intl.DateTimeFormatOptions) {
  const formatters = {
    it: new Intl.DateTimeFormat("it", options),
    en: new Intl.DateTimeFormat("en", options),
  };
  return (locale: UiLocale) => formatters[locale];
}
