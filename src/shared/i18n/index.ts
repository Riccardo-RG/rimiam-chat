import english from "./en.json";
import type { UiLocale } from "./locale";
export * from "./locale";
import tools from "./tools.en.json";
import account from "./account.en.json";
import chat from "./chat.en.json";
const catalog: Readonly<Record<string, string>> = {
  ...english,
  ...tools,
  ...account,
  ...chat,
};
// Pass only authored UI copy. Interpolated values are opaque and are never translated.
export function translateUi(
  locale: UiLocale,
  source: string,
  ...args: (string | number)[]
) {
  const template =
    locale === "en" && Object.hasOwn(catalog, source)
      ? catalog[source]
      : source;
  return args.length
    ? template.replace(/\{(\d+)\}/g, (token, index: string) =>
        String(args[Number(index)] ?? token),
      )
    : template;
}
