import { describe, expect, it } from "vitest";
import {
  preferredVoiceLanguage,
  languagePreference,
  resolveUiLocale,
  translateUi,
} from "../src/shared/i18n";
import general from "../src/shared/i18n/en.json";
import chat from "../src/shared/i18n/chat.en.json";
import account from "../src/shared/i18n/account.en.json";
import tools from "../src/shared/i18n/tools.en.json";
describe("UI languages", () => {
  it("retains every substituted value in English, including when the word order changes", () => {
    const slots = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();
    const problems = Object.entries({
      ...general,
      ...tools,
      ...account,
      ...chat,
    })
      .filter(
        ([source, translation]) =>
          !translation.trim() ||
          slots(source).join() !== slots(translation).join(),
      )
      .map(([source]) => source);
    expect(problems).toEqual([]);
  });

  it("resolves device languages in priority order with a stable fallback", () => {
    expect(resolveUiLocale("system", ["fr", "it-CH", "en-US"])).toBe("it");
    expect(resolveUiLocale("system", ["de"])).toBe("en");
    expect(resolveUiLocale("it", ["en"])).toBe("it");
    expect(languagePreference("xx")).toBe("system");
  });
  it("honors the selected voice language independently of the device locale", () => {
    expect(preferredVoiceLanguage("en", "it-IT")).toBe("en");
    expect(preferredVoiceLanguage("en", "en_GB")).toBe("en-GB");
    expect(preferredVoiceLanguage("it", "it-CH")).toBe("it-CH");
  });
  it("keeps interpolated source text opaque, including placeholders", () => {
    expect(translateUi("it", "Opzione {0}", "{1}")).toBe("Opzione {1}");
    expect(translateUi("en", "A value {0}", "{0}")).toBe("A value {0}");
  });
});
