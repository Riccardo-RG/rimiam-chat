import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveUiLocale,
  languagePreference,
} from "../../src/shared/i18n/locale.ts";

test("first launch and unsupported or legacy device locales", () => {
  assert.equal(languagePreference(null), "system");
  assert.equal(languagePreference("corrupted"), "system");
  assert.equal(resolveUiLocale("system", ["it_CH"]), "it");
  assert.equal(resolveUiLocale("system", ["IT-it"]), "it");
  assert.equal(resolveUiLocale("system", ["en-GB"]), "en");
  assert.equal(resolveUiLocale("system", ["pt-BR"]), "en");
  assert.equal(resolveUiLocale("system", ["de-DE", "it-CH"]), "it");
  assert.equal(resolveUiLocale("system", []), "en");
});

test("an explicit choice survives reading and takes priority over the operating system", () => {
  assert.equal(resolveUiLocale(languagePreference("en"), ["it-IT"]), "en");
  assert.equal(resolveUiLocale(languagePreference("it"), ["en-US"]), "it");
  assert.equal(resolveUiLocale(languagePreference("system"), ["en-US"]), "en");
});

test("built-in connection labels are translated without translating deployed model IDs or custom names", async () => {
  const { connectionName } =
    await import("../../src/shared/connection-name.ts");
  const translate = (source: string, ...args: string[]) =>
    source === "Predefinito" ? "Default" : "Default · " + args[0];
  assert.equal(
    connectionName(
      { id: "default", label: "Predefinito · Ricerca" },
      translate,
    ),
    "Default · Ricerca",
  );
  assert.equal(
    connectionName({ id: "default", label: "Predefinito" }, translate),
    "Default",
  );
  assert.equal(
    connectionName({ id: "custom", label: "Predefinito · Ricerca" }, translate),
    "Predefinito · Ricerca",
  );
});

test("only the exact current beta policy has a reviewed display translation", async () => {
  const { betaRules, currentBetaRule } =
    await import("../../src/shared/beta-rules.ts");
  assert.equal(currentBetaRule(betaRules), true);
  assert.equal(
    currentBetaRule({ ...betaRules, text: "Text chosen by the operator" }),
    false,
  );
  assert.equal(currentBetaRule({ ...betaRules, version: "future" }), false);
});

test("chat timestamps respect the selected UI language and retain the original date", async () => {
  const { chatClock, messageDay, mobileDayLabel } =
    await import("../../src/shared/conversation-presentation.ts");
  const at = "2026-11-20T12:30:00";
  const now = new Date("2026-11-20T14:00:00");
  assert.match(messageDay(at, "it"), /novembre/i);
  assert.match(messageDay(at, "en"), /November/i);
  assert.equal(mobileDayLabel(at, now, "it"), "venerdì");
  assert.equal(mobileDayLabel(at, now, "en"), "Friday");
  assert.match(chatClock(at, "en"), /12:30/);
});
