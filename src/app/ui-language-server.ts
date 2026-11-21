import { cookies, headers } from "next/headers";
import {
  languagePreference,
  resolveUiLocale,
  translateUi,
} from "../shared/i18n";
export async function pageLanguage() {
  const [jar, request] = await Promise.all([cookies(), headers()]);
  const initial = languagePreference(jar.get("rimiam-ui-language")?.value);
  const accepted = (request.get("accept-language") ?? "")
    .split(",")
    .map((item) => {
      const [tag, q] = item.trim().split(/\s*;\s*q=/i);
      return { tag, weight: q === undefined ? 1 : Number(q) };
    })
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const initialLocale = resolveUiLocale(
    initial,
    accepted.map((item) => item.tag),
  );
  return {
    initial,
    initialLocale,
    t: (source: string, ...args: (string | number)[]) =>
      translateUi(initialLocale, source, ...args),
  };
}
