import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show SynchronousFuture;
import 'package:flutter/services.dart' show rootBundle;
import 'package:material_ui/material_ui.dart';

import 'local_secure_storage.dart';

const interfaceLanguages = [Locale('it'), Locale('en')];

Locale resolveInterfaceLanguage(String preference, List<Locale> devices) {
  if (preference == 'it' || preference == 'en') return Locale(preference);
  for (final device in devices) {
    if (device.languageCode == 'it' || device.languageCode == 'en')
      return Locale(device.languageCode);
  }
  return const Locale('en');
}

class UiMessages {
  const UiMessages(this.locale, this.catalog);
  final Locale locale;
  final Map<String, String> catalog;
  String text(String source, List<Object?> values) {
    final template = locale.languageCode == 'en'
        ? (catalog[source] ?? source)
        : source;
    if (values.isEmpty) return template;
    return template.replaceAllMapped(RegExp(r'\{(\d+)\}'), (match) {
      final index = int.parse(match[1]!);
      return index < values.length
          ? (values[index]?.toString() ?? '')
          : match[0]!;
    });
  }

  static const delegate = _UiDelegate();
}

class _UiDelegate extends LocalizationsDelegate<UiMessages> {
  const _UiDelegate();
  static Map<String, String>? _english;
  static Future<Map<String, String>>? _reading;
  @override
  bool isSupported(Locale locale) =>
      interfaceLanguages.contains(Locale(locale.languageCode));
  @override
  Future<UiMessages> load(Locale locale) {
    if (locale.languageCode != 'en') {
      return SynchronousFuture(UiMessages(locale, const {}));
    }
    final cached = _english;
    if (cached != null) return SynchronousFuture(UiMessages(locale, cached));
    final firstLoad = _reading ??= rootBundle
        .loadString('assets/ui.en.json')
        .then((raw) => _english = Map<String, String>.from(jsonDecode(raw)))
        .whenComplete(() {
          _reading = null;
        });
    return firstLoad.then((catalog) => UiMessages(locale, catalog));
  }

  @override
  bool shouldReload(_UiDelegate old) => false;
}

/// Only pass authored interface copy. Arguments are data, and are never translated.
String uiText(
  BuildContext context,
  String source, [
  List<Object?> values = const [],
]) =>
    (Localizations.of<UiMessages>(context, UiMessages) ??
            const UiMessages(Locale('it'), {}))
        .text(source, values);

class InterfaceLanguage extends StatefulWidget {
  const InterfaceLanguage({super.key, required this.builder});
  final Widget Function(Locale locale) builder;
  @override
  State<InterfaceLanguage> createState() => _LanguageState();
}

class _LanguageState extends State<InterfaceLanguage>
    with WidgetsBindingObserver {
  static const key = 'rimiam.ui-language.v1';
  String preference = 'system';
  bool ready = false, busy = false, storageError = false;
  List<Locale> devices = WidgetsBinding.instance.platformDispatcher.locales;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(read());
  }

  Future<void> read() async {
    try {
      final data = await deviceSecureStorage.read(key: key);
      if (mounted) {
        preference = {'en', 'it'}.contains(data) ? data! : 'system';
      }
    } catch (_) {
      storageError = true;
    } finally {
      if (mounted) setState(() => ready = true);
    }
  }

  Future<void> choose(String value) async {
    if (!{'en', 'it', 'system'}.contains(value) || busy || !ready) return;
    setState(() {
      busy = true;
      storageError = false;
    });
    try {
      await deviceSecureStorage.write(key: key, value: value);
      if (mounted) setState(() => preference = value);
    } catch (_) {
      if (mounted) setState(() => storageError = true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void didChangeLocales(List<Locale>? locales) {
    if (mounted)
      setState(
        () => devices =
            locales ?? WidgetsBinding.instance.platformDispatcher.locales,
      );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) didChangeLocales(null);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Resolve the saved preference before mounting Localizations. A slower
    // system-language catalog must not replace the saved locale on a cold start.
    if (!ready) {
      final dark =
          WidgetsBinding.instance.platformDispatcher.platformBrightness ==
          Brightness.dark;
      return Directionality(
        textDirection: TextDirection.ltr,
        child: ColoredBox(
          color: dark ? const Color(0xff222321) : const Color(0xfffdfdfc),
          child: Center(
            child: Semantics(
              label: 'RIMIAM',
              image: true,
              child: Image.asset(
                'assets/brand.png',
                width: 48,
                height: 48,
                excludeFromSemantics: true,
              ),
            ),
          ),
        ),
      );
    }
    return LanguageChoice(
      preference: preference,
      select: busy ? null : choose,
      storageError: storageError,
      child: widget.builder(resolveInterfaceLanguage(preference, devices)),
    );
  }
}

class LanguageChoice extends InheritedWidget {
  const LanguageChoice({
    super.key,
    required this.preference,
    required this.select,
    required this.storageError,
    required super.child,
  });
  final String preference;
  final bool storageError;
  final Future<void> Function(String)? select;
  @override
  bool updateShouldNotify(LanguageChoice old) =>
      preference != old.preference ||
      select != old.select ||
      storageError != old.storageError;
}

class LanguagePicker extends StatelessWidget {
  const LanguagePicker({super.key});
  @override
  Widget build(BuildContext context) {
    final state = context.dependOnInheritedWidgetOfExactType<LanguageChoice>();
    if (state == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String>(
          key: ValueKey(state.preference),
          initialValue: state.preference,
          decoration: InputDecoration(labelText: uiText(context, 'Lingua')),
          items: [
            DropdownMenuItem(
              value: 'system',
              child: Text(uiText(context, 'Lingua del dispositivo')),
            ),
            const DropdownMenuItem(value: 'it', child: Text('Italiano')),
            const DropdownMenuItem(value: 'en', child: Text('English')),
          ],
          onChanged: state.select == null
              ? null
              : (s) {
                  if (s != null) unawaited(state.select!(s));
                },
        ),
        if (state.storageError)
          Semantics(
            liveRegion: true,
            child: Text(
              uiText(
                context,
                'Impossibile leggere o salvare la lingua su questo dispositivo.',
              ),
            ),
          ),
      ],
    );
  }
}
