# Interface languages

RIMIAM supports Italian and English on Web, iOS and Android. Choose a language at sign-in or under **Profile → Appearance**. The default follows the first supported device language, with English as the fallback. A manual choice persists on that browser or installation. Web reads the preference cookie during server rendering and updates open tabs on a change. Native stores the preference locally and checks the system language on return to the foreground.

## What changes language

Controls, navigation, suggested actions, accessible names, system explanations and formatted dates follow the selected language. Names, messages, filenames, drafts and shared source material remain as written. Emme answers in the language of the question or conversation. Changing the interface does not reinterpret history or request a model response. The beta notice includes the original terms alongside the English reading. On Web, read-aloud selects a local voice for the chosen language and keeps its input on device. The operating system and external providers render their own permission, picker and account screens.

The same space command can be found in either language. For example, `/file` and `/files` open the same collection, and `/h` opens **Draw**. User-generated content passed into a translated sentence remains opaque, even when it happens to match an interface label.

## Maintaining the clients

- Use [the shared catalog](../../src/shared/i18n/index.ts) from the [Web provider](../../src/client/ui-language.tsx). Keep the Italian source and its English translation together by feature. Translate complete authored phrases. Use positional arguments for names, counts and source text. Keep protocol values, identity fields, consent versions and stored commands stable.
- The [server resolver](../../src/app/ui-language-server.ts) handles initial HTML, public pages and the Web manifest. Both clients format display dates in the viewer’s language while keeping scheduling time zones explicit.
- [The browser regression](../../tests/e2e/ui-language.spec.ts) covers a language change with a draft, a space named after an interface control, and persistence on reload. [Workspace language tests](../../tests/workspace-tools-language.test.ts) cover library filters, the guide and recording consent. See [mobile push](NATIVE_PUSH.md) for lock-screen behavior and [multi-client verification](MULTICLIENT.md) for the device evidence.

## Flutter

The mobile client reads the saved choice before building its first localized screen. This matters on iOS when the system uses English and the saved choice is Italian. A late English catalog load must not replace that choice. [Language controller](../../mobile/lib/ui_language.dart)

Use `uiText(context, 'Proposta per {0}', [displayName])` for interface copy. Render a message body, contact name or citation title directly. Use Material localizations to display dates and times. A translation of the beta rules applies only when both the published version and the full original wording match. [Beta notice](../../mobile/lib/beta_notice.dart)

After editing a shared catalog or the [additional Flutter copy](../../src/shared/i18n/mobile.en.json), run `node --import tsx mobile/tool/sync_ui_catalog.ts` from the repository root. The same command with `--check` verifies the bundled asset and the published beta text. Use `mobile/tool/sync_composer_actions.ts` for labels and shortcuts from the space command catalog. [Widget regressions](../../mobile/test/ui_language_test.dart)

An iPhone SE (3rd generation) on iOS 18.2 Simulator was tested with English system settings. With the dedicated test installation, the sign-in controls switched to Italian, remained Italian after process termination and returned to English on selection. The Flutter widget suite separately covers screen-reader labels, a space called “Invia”, a message reading “Oggi”, command shortcuts, displayed dates and the verbatim original beta rules.
