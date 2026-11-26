import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_governance.dart';
import '../lib/workspace_work.dart';

class Memory implements DraftVault {
  final data = <String, String>{};
  @override
  Future<String?> read(String k) async => data[k];
  @override
  Future<void> replace(String k, String? v) async {
    if (v == null) {
      data.remove(k);
    } else {
      data[k] = v;
    }
  }
}

class MockApi extends RimiamApi {
  MockApi() : super(Uri.parse('http://127.0.0.1:3102')) {
    actorId = 'p';
  }
  bool private = false,
      write = true,
      lost = false,
      allowed = true,
      loseReadReceipt = false;
  final calls = <GroupRecord>[], seen = <String>[];
  final work = <GroupRecord>[],
      results = <GroupRecord>[],
      receipts = <String, GroupRecord>{};
  @override
  Future<GroupRecord> get(String p) async {
    seen.add(p);
    if (!allowed) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (p.endsWith('/workspace'))
      return {
        'workspace': {'id': 'w', 'personal': private},
        'members': [
          {'user_id': 'p', 'active': true, 'contributes': write},
        ],
        'research': results,
      };
    if (p.endsWith('/active-work'))
      return {
        'canControl': write,
        'works': work,
        'events': [],
        'suggestions': [],
      };
    if (p.contains('/personal-chats?thread=w'))
      return {
        'selection': {'id': 'origin', 'label': 'Lancio', 'version': 2},
        'research': results,
        'targets': [
          {'id': 'origin', 'name': 'Lancio', 'contributes': true},
        ],
      };
    if (p.contains('/receipts/')) return receipts[p.split('/').last]!;
    throw UnsupportedError(p);
  }

  @override
  Future<GroupRecord> post(String p, GroupRecord b) async {
    calls.add(b);
    if (p.endsWith('/personal-chats')) {
      if (loseReadReceipt) {
        loseReadReceipt = false;
        throw const SocketException('Missing reading receipt');
      }
      return {};
    }
    if (!p.endsWith('/commands')) throw UnsupportedError(p);
    final r = {
      'status': 'committed',
      'result': <String, dynamic>{},
      'commandId': b['commandId'],
    };
    receipts[b['commandId']] = r;
    if (lost) {
      lost = false;
      throw const SocketException('Synthetic dropped ack');
    }
    return r;
  }
}

Future<void> mount(WidgetTester t, Widget widget) async {
  await t.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => t.binding.setSurfaceSize(null));
  await t.pumpWidget(MaterialApp(home: widget));
  await t.pumpAndSettle();
}

Future<void> tap(WidgetTester t, String text) async {
  final f = find.text(text).last;
  await t.ensureVisible(f);
  await t.pumpAndSettle();
  await t.tap(f);
  await t.pumpAndSettle();
}

void main() {
  testWidgets(
    'private research freezes exact words, origin and per-request notifications only after explicit consent',
    (t) async {
      final a = MockApi()
        ..private = true
        ..lost = true;
      addTearDown(a.close);
      final v = Memory();
      Widget widget() => ResearchScreen(
        api: a,
        workspaceId: 'w',
        workspaceName: 'Tu ed Emme',
        personal: true,
        vault: v,
      );
      await mount(t, widget());
      await tap(t, 'Nuova ricerca privata');
      final field = find.byType(TextField).last;
      await t.enterText(field, 'Prima versione');
      await t.pump();
      final submit = find.widgetWithText(FilledButton, 'Avvia ricerca');
      expect(t.widget<FilledButton>(submit).onPressed, isNull);
      final consent = find.byType(Checkbox).last;
      await t.tap(consent);
      await t.pump();
      await t.enterText(field, 'Termini esatti');
      await t.pump();
      expect(t.widget<FilledButton>(submit).onPressed, isNull);
      await t.tap(consent);
      await t.pump();
      await tap(t, 'Avvia ricerca');
      expect(a.calls.single['command'], {
        'type': 'research.private_request',
        'query': 'Termini esatti',
        'discloseQuery': true,
        'analyzeExcerpts': true,
        'notify': false,
        'originId': 'origin',
      });
      await t.pumpWidget(const SizedBox());
      await t.pumpAndSettle();
      await t.pumpWidget(MaterialApp(home: widget()));
      await t.pumpAndSettle();
      await tap(t, 'Verifica operazione');
      expect(a.calls.length, 1);
      expect(a.seen.any((s) => s.contains('/receipts/')), isTrue);
    },
  );
  testWidgets(
    'a private result is shared only after choosing the destination and confirming that exact generation',
    (t) async {
      final a = MockApi()..private = true;
      addTearDown(a.close);
      a.results.add({
        'id': 'r',
        'generation': 3,
        'status': 'ready',
        'query': 'Preventivo',
        'read': false,
        'summary': 'Confronto riservato',
        'citations': [],
        'shared': [],
      });
      await mount(
        t,
        ResearchScreen(
          api: a,
          workspaceId: 'w',
          workspaceName: 'Tu ed Emme',
          personal: true,
          vault: Memory(),
        ),
      );
      expect(a.calls, isEmpty);
      await tap(t, 'Preventivo');
      expect(a.calls.single['action'], 'research_read');
      await tap(t, 'Condividi nello spazio…');
      await tap(t, 'Lancio');
      await tap(t, 'Annulla');
      expect(a.calls.length, 1);
      await tap(t, 'Condividi nello spazio…');
      await tap(t, 'Lancio');
      await tap(t, 'Condividi in Lancio');
      expect(a.calls.last['command'], {
        'type': 'research.private_publish',
        'workId': 'r',
        'generation': 3,
        'destinationId': 'origin',
      });
      expect(a.calls.length, 2);
    },
  );
  testWidgets(
    'the private notification opens the exact result before acknowledging it and only retries a lost read receipt on request',
    (t) async {
      final a = MockApi()
        ..private = true
        ..loseReadReceipt = true;
      addTearDown(a.close);
      for (var i = 0; i < 24; i++) {
        a.results.add({
          'id': 'research-$i',
          'generation': 1,
          'status': 'ready',
          'query': 'Ricerca $i',
          'read': false,
          'summary': 'Risultato $i',
        });
      }
      Widget page(String id) => ResearchScreen(
        key: ValueKey(id),
        api: a,
        workspaceId: 'w',
        workspaceName: 'Tu ed Emme',
        personal: true,
        initialWorkId: id,
        vault: Memory(),
      );
      await mount(t, page('not-found'));
      expect(a.calls, isEmpty);
      await t.pumpWidget(MaterialApp(home: page('research-23')));
      await t.pumpAndSettle();
      expect(find.text('Risultato 23').hitTestable(), findsOneWidget);
      expect(a.calls.single['workId'], 'research-23');
      await tap(t, 'Ricerca 23');
      await tap(t, 'Ricerca 23');
      expect(a.calls.length, 1);
      await tap(t, 'Riprova conferma di lettura');
      expect(a.calls.map((call) => call['action']), [
        'research_read',
        'research_read',
      ]);
      expect(a.calls.every((call) => call['workId'] == 'research-23'), isTrue);
      await tap(t, 'Ricerca 23');
      await tap(t, 'Ricerca 23');
      expect(a.calls.length, 2);
    },
  );
  testWidgets(
    'starting an analysis requires showing the model disclosure; shared results are saved separately',
    (t) async {
      final a = MockApi();
      addTearDown(a.close);
      a.work.add({
        'id': 'work',
        'revision': 4,
        'phase': 'completed',
        'validity': 'current',
        'contract': {
          'objective': 'Budget laboratori',
          'version': 2,
          'scope': 'Solo lo spazio',
          'expectedOutput': 'Tabella',
          'anchors': [],
        },
        'issues': [],
        'contribution': {
          'id': 'contribution',
          'body': 'Stima: tre giorni.',
          'objective': 'a${'😀' * 90}',
          'qualification': 'Stima da verificare.',
          'sources': [],
        },
      });
      await mount(
        t,
        WorkspaceWorkScreen(
          api: a,
          workspaceId: 'w',
          workspaceName: 'Lancio',
          vault: Memory(),
        ),
      );
      await tap(t, 'Avvia analisi');
      await t.enterText(find.byType(TextField), 'Costi di lancio');
      await tap(t, 'Continua');
      expect(
        find.textContaining('modello configurato').evaluate().isNotEmpty,
        isTrue,
      );
      await tap(t, 'Annulla');
      expect(a.calls, isEmpty);
      await tap(t, 'Budget laboratori');
      await tap(t, 'Salva in Condivisi');
      await tap(t, 'Salva');
      expect(a.calls.single['command']['type'], 'artifact.from_contribution');
      expect(a.calls.single['command']['nonOperative'], true);
      expect(a.calls.single['command']['title'], 'a${'😀' * 79}');
      expect(a.calls.single['command']['contributionId'], 'contribution');
    },
  );
  testWidgets(
    'a reader can inspect group research without permission to start it or enter a private thread',
    (t) async {
      final a = MockApi()..write = false;
      addTearDown(a.close);
      await mount(
        t,
        ResearchScreen(
          api: a,
          workspaceId: 'w',
          workspaceName: 'Ricerca',
          vault: Memory(),
        ),
      );
      expect(find.text('Nuova ricerca'), findsNothing);
      await t.pumpWidget(const SizedBox());
      await t.pumpAndSettle();
      await t.pumpWidget(
        MaterialApp(
          home: ResearchScreen(
            api: a,
            workspaceId: 'w',
            workspaceName: 'Area',
            personal: true,
            vault: Memory(),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(a.seen.where((s) => s.contains('/personal-chats')), isEmpty);
      expect(find.text('Nuova ricerca privata'), findsNothing);
    },
  );
}
