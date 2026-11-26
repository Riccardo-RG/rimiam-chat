import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/workspace_presence.dart';

typedef Json = Map<String, dynamic>;

class _PresenceApi extends RimiamApi {
  _PresenceApi() : super(Uri.parse('http://localhost')) {
    actorId = 'reader';
  }

  final paths = <String>[];
  final pending = <Completer<Json>>[];
  @override
  Future<Json> get(String path) {
    paths.add(path);
    final request = Completer<Json>();
    pending.add(request);
    return request.future;
  }
}

void main() {
  Widget app(
    _PresenceApi api,
    int revision,
    ValueChanged<String?> open, {
    String space = 'design',
  }) => MaterialApp(
    home: Scaffold(
      appBar: AppBar(
        title: const Text(
          'Lancio RIMIAM',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          WorkspacePresence(
            api: api,
            workspace: space,
            revision: revision,
            assistant: 'Mira',
            openWork: open,
          ),
        ],
      ),
    ),
  );
  const empty = {'ongoing': [], 'results': []};
  const busy = {
    'ongoing': [
      {
        'id': 'work-1',
        'objective': 'Ricontrolla le date',
        'phase': 'needs_input',
        'blocked': true,
      },
      {
        'id': 'work-2',
        'objective': 'Preventivo',
        'phase': 'paused',
        'blocked': false,
      },
    ],
    'results': [
      {
        'id': 'work-3',
        'objective': 'Confronto',
        'contributionId': 'result-3',
        'validity': 'potentially_outdated',
      },
    ],
  };

  testWidgets(
    'reading uses the configured name; an unavailable service supersedes a queued reading',
    (t) async {
      final api = _PresenceApi();
      addTearDown(api.close);
      var openedContext = false;
      Widget display(bool offline) => MaterialApp(
        home: Scaffold(
          appBar: AppBar(
            actions: [
              WorkspacePresence(
                api: api,
                workspace: 'w',
                revision: 1,
                assistant: 'Invia',
                unconfigured: offline,
                readingStates: const {'queued', 'running', 'stale'},
                openWork: (_) {},
                openContext: () => openedContext = true,
              ),
            ],
          ),
        ),
      );
      await t.pumpWidget(display(false));
      api.pending.single.complete(empty);
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Attività di Invia · Invia sta leggendo…'));
      await t.pumpAndSettle();
      await t.tap(find.text('Verifica lettura di Invia'));
      await t.pumpAndSettle();
      expect(openedContext, true);
      await t.pumpWidget(display(true));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Attività di Invia · Invia non disponibile.'));
      await t.pumpAndSettle();
      expect(
        find.text(
          'Il servizio AI non è configurato. Puoi continuare a scrivere al gruppo.',
        ),
        findsOneWidget,
      );
      expect(find.text('Invia sta leggendo…'), findsNothing);
      expect(api.paths.length, 1);
    },
  );

  testWidgets(
    '320 px, a compact mark opens the exact shared work or the whole list',
    (t) async {
      final api = _PresenceApi(), opened = <String?>[];
      addTearDown(api.close);
      t.view.devicePixelRatio = 1;
      t.view.physicalSize = const Size(320, 568);
      addTearDown(t.view.resetDevicePixelRatio);
      addTearDown(t.view.resetPhysicalSize);
      await t.pumpWidget(app(api, 1, opened.add));
      api.pending.single.complete(busy);
      await t.pumpAndSettle();
      const status = 'Attività di Mira · Lavoro da verificare';
      expect(find.text('Ricontrolla le date'), findsNothing);
      expect(t.getSize(find.byTooltip(status)).width, lessThanOrEqualTo(48));
      await t.tap(find.byTooltip(status));
      await t.pumpAndSettle();
      expect(find.text('In pausa'), findsOneWidget);
      expect(find.text('Risultato da ricontrollare'), findsOneWidget);
      expect(t.takeException(), isNull);
      await t.tap(find.text('Confronto'));
      await t.pumpAndSettle();
      expect(opened, ['work-3']);
      await t.tap(find.byTooltip(status));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Chiudi attività'));
      await t.pumpAndSettle();
      expect(find.text('Confronto'), findsNothing);
      await t.tap(find.byTooltip(status));
      await t.pumpAndSettle();
      await t.tap(find.text('Tutti i lavori'));
      await t.pumpAndSettle();
      expect(opened, ['work-3', null]);
      expect(api.paths, ['/api/v1/workspaces/design/active-work-presence']);
    },
  );

  testWidgets(
    'revision refresh, revocation, explicit retry and out-of-order results',
    (t) async {
      final api = _PresenceApi();
      addTearDown(api.close);
      void open(String? _) => fail('No navigation expected');
      await t.pumpWidget(app(api, 1, open));
      api.pending[0].complete(busy);
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Attività di Mira · Lavoro da verificare'));
      await t.pumpAndSettle();
      await t.pumpWidget(app(api, 2, open));
      await t.pumpWidget(app(api, 3, open));
      api.pending[2].completeError(
        const ApiError(403, 'WORKSPACE_ACCESS_DENIED'),
      );
      await t.pumpAndSettle();
      api.pending[1].complete(busy);
      await t.pumpAndSettle();
      expect(find.text('Confronto'), findsNothing);
      expect(find.text('Attività non disponibile.'), findsOneWidget);
      await t.tap(find.text('Riprova'));
      await t.pumpAndSettle();
      api.pending[3].complete(empty);
      await t.pumpAndSettle();
      expect(find.text('Nessun lavoro in corso.'), findsOneWidget);
      expect(find.byTooltip('Attività di Mira'), findsOneWidget);
      await t.pumpWidget(app(api, 3, open));
      expect(api.paths.length, 4);
    },
  );

  testWidgets('a late reply cannot disclose a previous space or actor', (
    t,
  ) async {
    final api = _PresenceApi();
    addTearDown(api.close);
    void open(String? _) => fail('No navigation expected');
    await t.pumpWidget(app(api, 1, open, space: 'old'));
    api.actorId = 'new-member';
    await t.pumpWidget(app(api, 1, open, space: 'new'));
    api.pending[1].complete(empty);
    api.pending[0].complete(busy);
    await t.pumpAndSettle();
    await t.tap(find.byTooltip('Attività di Mira'));
    await t.pumpAndSettle();
    expect(find.text('Nessun lavoro in corso.'), findsOneWidget);
    expect(find.text('Ricontrolla le date'), findsNothing);
    await t.pumpWidget(const MaterialApp(home: SizedBox()));
    await t.pumpAndSettle();
    expect(find.text('Attività di Mira'), findsNothing);
  });
}
