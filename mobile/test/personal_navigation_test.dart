import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/personal_navigation.dart';

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('http://127.0.0.1:3102')) {
    actorId = 'owner';
  }
  Completer<Map<String, dynamic>>? deferred;
  int reads = 0;
  @override
  Future<Map<String, dynamic>> get(String path) async {
    expect(path, '/api/v1/workspaces');
    reads++;
    return deferred?.future ??
        Future.value({
          'workspaces': [
            {
              'id': 'w',
              'name': 'Spazio riservato',
              'lastActivityAt': '2026-11-26T09:00:00Z',
            },
          ],
        });
  }
}

class _Routes extends NavigatorObserver {
  final pages = <Route<dynamic>>[];
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pages.add(route);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pages.remove(route);
  }
}

Widget entry(_Api api, _Routes routes, {bool edit = false}) {
  Widget section(PersonalSection s) => PopScope(
    canPop: !(edit && s == PersonalSection.today),
    child: Scaffold(
      appBar: AppBar(title: PersonalNavTitle(s.label)),
      body: Text('Contenuto · ${s.label}'),
    ),
  );
  return MaterialApp(
    navigatorObservers: [routes],
    home: PersonalNavigation(
      api: api,
      initial: PersonalSection.home,
      child: section(PersonalSection.home),
      buildSection: section,
      sessionIsCurrent: () => api.actorId == 'owner',
      openSpace: (_, _) async {},
    ),
  );
}

Future<void> menu(WidgetTester t, String label) async {
  await t.tap(find.byTooltip('Apri navigazione'));
  await t.pumpAndSettle();
  final item = find.descendant(
    of: find.byType(Drawer),
    matching: find.text(label),
  );
  await t.ensureVisible(item);
  await t.tap(item);
  await t.pumpAndSettle();
}

void main() {
  void screen(WidgetTester t, Size size) {
    t.view.devicePixelRatio = 1;
    t.view.physicalSize = size;
    addTearDown(t.view.resetDevicePixelRatio);
    addTearDown(t.view.resetPhysicalSize);
  }

  testWidgets(
    'phone menu keeps one personal route and returns to Home after switching between chat and today',
    (t) async {
      screen(t, const Size(390, 844));
      final api = _Api(), routes = _Routes();
      addTearDown(api.close);
      await t.pumpWidget(entry(api, routes));
      await t.pumpAndSettle();
      await menu(t, 'Tu ed Emme');
      expect(find.text('Contenuto · Tu ed Emme'), findsOneWidget);
      expect(routes.pages.length, 2);
      await menu(t, 'Oggi');
      expect(find.text('Contenuto · Oggi'), findsOneWidget);
      expect(routes.pages.length, 2);
      await menu(t, 'I tuoi spazi');
      expect(find.text('Contenuto · I tuoi spazi'), findsOneWidget);
      expect(routes.pages.length, 1);
      await menu(t, 'Tu ed Emme');
      await t.pageBack();
      await t.pumpAndSettle();
      expect(find.text('Contenuto · I tuoi spazi'), findsOneWidget);
      expect(routes.pages.length, 1);
    },
  );

  testWidgets(
    'tablet displays the persistent sidebar, respects edit guards and masks the previous actor’s delayed listing',
    (t) async {
      screen(t, const Size(1024, 768));
      final api = _Api(), routes = _Routes();
      addTearDown(api.close);
      await t.pumpWidget(entry(api, routes, edit: true));
      await t.pumpAndSettle();
      expect(find.byTooltip('Apri navigazione'), findsNothing);
      expect(find.text('Spazio riservato'), findsOneWidget);
      api.deferred = Completer();
      await t.tap(find.text('Oggi'));
      await t.pumpAndSettle();
      await t.tap(find.text('Tu ed Emme'));
      await t.pumpAndSettle();
      expect(find.text('Contenuto · Oggi'), findsOneWidget);
      expect(
        find.text('Chiudi la modifica in corso prima di cambiare sezione.'),
        findsOneWidget,
      );
      api.actorId = 'other';
      api.deferred!.complete({
        'workspaces': [
          {'id': 'x', 'name': 'Risultato precedente'},
        ],
      });
      await t.pumpAndSettle();
      expect(find.text('Risultato precedente'), findsNothing);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await t.pumpAndSettle();
      expect(find.text('Contenuto · Oggi'), findsNothing);
      expect(find.text('Spazio riservato'), findsNothing);
    },
  );
}
