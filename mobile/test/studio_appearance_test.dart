import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/studio_appearance.dart';
import '../lib/studio_theme.dart';

Widget demo() => StudioAppearance(
  builder: (mode, accent) => MaterialApp(
    themeMode: mode,
    theme: studioTheme(Brightness.light, accent: accent),
    darkTheme: studioTheme(Brightness.dark, accent: accent),
    home: Scaffold(
      body: ListView(
        children: [
          Builder(
            builder: (c) => Text(
              'Lancio',
              style: TextStyle(color: workspaceTitleAccent(c)),
            ),
          ),
          const AppearanceControls(),
        ],
      ),
    ),
  ),
);
void main() {
  testWidgets(
    'il caricamento mantiene il marchio e rispetta il movimento ridotto',
    (t) async {
      for (final reduced in [false, true]) {
        await t.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(disableAnimations: reduced),
              child: const Scaffold(
                body: StudioLoading(label: 'Caricamento conversazione'),
              ),
            ),
          ),
        );
        expect(
          t.widget<Image>(find.byType(Image)).image,
          const AssetImage('assets/brand.png'),
        );
        expect(
          find.bySemanticsLabel('Caricamento conversazione'),
          findsOneWidget,
        );
        expect(
          find.byType(LinearProgressIndicator),
          reduced ? findsNothing : findsOneWidget,
        );
        expect(
          find.text('Caricamento conversazione'),
          reduced ? findsOneWidget : findsNothing,
        );
      }
    },
  );
  testWidgets(
    'tema e accento seguono il sistema inizialmente, la preferenza sopravvive alla riapertura',
    (t) async {
      FlutterSecureStorage.setMockInitialValues({});
      await t.pumpWidget(demo());
      await t.pumpAndSettle();
      expect(t.widget<Text>(find.text('Lancio')).style?.color, isNull);
      await t.tap(find.text('Aspetto'));
      await t.pumpAndSettle();
      await t.tap(find.text('Scuro'));
      await t.pumpAndSettle();
      await t.tap(find.text('Oceano'));
      await t.pumpAndSettle();
      final ctx = t.element(find.text('Lancio')),
          darkBase = studioTheme(Brightness.dark);
      expect(Theme.of(ctx).brightness, Brightness.dark);
      expect(Theme.of(ctx).colorScheme.surface, darkBase.colorScheme.surface);
      expect(
        Theme.of(ctx).colorScheme.secondary,
        darkBase.colorScheme.secondary,
      );
      expect(
        t.widget<Text>(find.text('Lancio')).style!.color,
        StudioAccent.ocean.dark,
      );
      await t.pumpWidget(const SizedBox());
      await t.pumpAndSettle();
      await t.pumpWidget(demo());
      await t.pumpAndSettle();
      expect(find.text('Scuro · Oceano'), findsOneWidget);
      await t.tap(find.text('Aspetto'));
      await t.pumpAndSettle();
      await t.tap(find.text('Grafite'));
      await t.pumpAndSettle();
      expect(t.widget<Text>(find.text('Lancio')).style!.color, isNull);
    },
  );
  testWidgets('una preferenza non riconosciuta usa il tema predefinito', (
    t,
  ) async {
    FlutterSecureStorage.setMockInitialValues({
      'rimiam.appearance.v1': '{"mode":"auto","accent":"bad"}',
    });
    await t.pumpWidget(demo());
    await t.pumpAndSettle();
    expect(find.text('Sistema · Grafite'), findsOneWidget);
  });
}
