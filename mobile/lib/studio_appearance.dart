import 'ui_language.dart';

import 'dart:convert';

import 'package:material_ui/material_ui.dart';

import 'local_secure_storage.dart';
import 'studio_theme.dart';

typedef AppearanceBuilder = Widget Function(
  ThemeMode mode,
  StudioAccent accent,
);

class StudioAppearance extends StatefulWidget {
  const StudioAppearance({super.key, required this.builder});
  final AppearanceBuilder builder;
  @override
  State<StudioAppearance> createState() => _AppearanceState();
}

class _AppearanceState extends State<StudioAppearance> {
  static const key = 'rimiam.appearance.v1';
  ThemeMode mode = ThemeMode.system;
  StudioAccent accent = StudioAccent.neutral;
  bool busy = false, changed = false;
  String? notice;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final raw = await deviceSecureStorage.read(key: key);
      if (!mounted || changed || raw == null) return;
      final data = jsonDecode(raw);
      if (data is! Map) return;
      final restoredMode = ThemeMode.values
          .where((x) => x.name == data['mode'])
          .firstOrNull;
      final restoredAccent = StudioAccent.values
          .where((x) => x.name == data['accent'])
          .firstOrNull;
      setState(() {
        mode = restoredMode ?? ThemeMode.system;
        accent = restoredAccent ?? StudioAccent.neutral;
      });
    } catch (_) {
      if (mounted && !changed)
        setState(
          () => notice = 'Impossibile leggere le preferenze del dispositivo.',
        );
    }
  }

  Future<void> save(ThemeMode nextMode, StudioAccent nextAccent) async {
    if (busy) return;
    setState(() {
      busy = true;
      changed = true;
      notice = null;
    });
    try {
      await deviceSecureStorage.write(
        key: key,
        value: jsonEncode({'mode': nextMode.name, 'accent': nextAccent.name}),
      );
      if (mounted)
        setState(() {
          mode = nextMode;
          accent = nextAccent;
        });
    } catch (_) {
      if (mounted)
        setState(() => notice = 'Impossibile salvare la preferenza. Riprova.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext c) => _AppearanceScope(
    mode: mode,
    accent: accent,
    busy: busy,
    notice: notice,
    save: save,
    child: widget.builder(mode, accent),
  );
}

class _AppearanceScope extends InheritedWidget {
  const _AppearanceScope({
    required this.mode,
    required this.accent,
    required this.busy,
    required this.notice,
    required this.save,
    required super.child,
  });
  final ThemeMode mode;
  final StudioAccent accent;
  final bool busy;
  final String? notice;
  final Future<void> Function(ThemeMode, StudioAccent) save;
  @override
  bool updateShouldNotify(_AppearanceScope old) =>
      old.mode != mode ||
      old.accent != accent ||
      old.busy != busy ||
      old.notice != notice;
}

Color? workspaceTitleAccent(BuildContext c) {
  final pref = c.dependOnInheritedWidgetOfExactType<_AppearanceScope>();
  if (pref == null || pref.accent == StudioAccent.neutral) return null;
  return pref.accent.color(Theme.of(c).brightness);
}

class AppearanceControls extends StatelessWidget {
  const AppearanceControls({super.key});
  @override
  Widget build(BuildContext c) {
    final state = c.dependOnInheritedWidgetOfExactType<_AppearanceScope>();
    if (state == null) return const SizedBox.shrink();
    const names = {
      ThemeMode.system: 'Sistema',
      ThemeMode.light: 'Chiaro',
      ThemeMode.dark: 'Scuro',
    };
    return ExpansionTile(
      title: Text(uiText(c, 'Aspetto')),
      subtitle: Text(
        '${uiText(c, names[state.mode]!)} · ${uiText(c, state.accent.label)}',
      ),
      childrenPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      children: [
        const LanguagePicker(),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(uiText(c, 'Tema'), style: Theme.of(c).textTheme.titleSmall),
            Wrap(
              spacing: 8,
              children: [
                for (final m in names.entries)
                  ChoiceChip(
                    label: Text(uiText(c, m.value)),
                    selected: state.mode == m.key,
                    onSelected: state.busy
                        ? null
                        : (_) => state.save(m.key, state.accent),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              uiText(c, 'Colore di accento'),
              style: Theme.of(c).textTheme.titleSmall,
            ),
            Wrap(
              spacing: 8,
              children: [
                for (final a in StudioAccent.values)
                  ChoiceChip(
                    label: Text(uiText(c, a.label)),
                    selected: state.accent == a,
                    avatar: CircleAvatar(
                      backgroundColor: a.color(Theme.of(c).brightness),
                      radius: 8,
                    ),
                    onSelected: state.busy
                        ? null
                        : (_) => state.save(state.mode, a),
                  ),
              ],
            ),
            if (state.notice != null)
              Semantics(
                liveRegion: true,
                child: Text(uiText(c, state.notice!)),
              ),
          ],
        ),
      ],
    );
  }
}
