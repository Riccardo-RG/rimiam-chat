import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/integration_model.dart';
import '../lib/workspace_governance.dart';
import '../lib/workspace_integrations.dart';

class _Vault implements DraftVault {
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

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('http://127.0.0.1:3102')) {
    actorId = 'p';
  }
  bool allowed = true, writer = true, lose = false, linked = false;
  int admission = 1;
  final posts = <GroupRecord>[],
      gets = <String>[],
      receipts = <String, GroupRecord>{};
  final envelope = {
    'sender': 'p@example.test',
    'to': ['team@example.test'],
    'cc': <String>[],
    'bcc': ['privato@example.test'],
    'subject': 'Consegna stampa',
    'body': 'Testo della bozza privata',
    'kind': 'new',
    'target': null,
    'attachments': <GroupRecord>[],
  };
  final actions = <GroupRecord>[],
      drafts = <GroupRecord>[],
      observations = <GroupRecord>[];
  @override
  Future<GroupRecord> get(String path) async {
    gets.add(path);
    if (path.endsWith('/status'))
      return {
        'configured': true,
        'capabilities': ['email', 'calendar'],
      };
    if (!allowed) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (path.endsWith('/workspace'))
      return {
        'workspace': {'id': 'w'},
        'reading': {'admission': admission},
        'members': [
          {'user_id': 'p', 'active': true, 'contributes': writer},
        ],
      };
    if (path.endsWith('/session'))
      return {
        'user': {'id': actorId, 'email': 'p@example.test'},
      };
    if (path.endsWith('/email') || path.contains('/calendar?'))
      return {
        'workspaceId': 'w',
        'contextRevision': 4,
        'accessRevision': 2,
        'reads': [],
        'actions': actions,
        'drafts': drafts,
        'observations': observations,
        'connections': [
          if (linked)
            {
              'id': 'conn',
              'sender': 'p@example.test',
              'active': true,
              'canSend': true,
              'canRead': true,
              'provider': path.contains('calendar')
                  ? 'google-calendar'
                  : 'google-gmail',
              'label': 'Personale',
              'resources': [
                {
                  'id': 'r',
                  'label': 'Turni',
                  'canRead': true,
                  'canWriteSelf': true,
                },
              ],
            },
        ],
        'window': {
          'start': '2026-11-01T00:00:00Z',
          'end': '2026-12-01T00:00:00Z',
        },
      };
    if (path.contains('/receipts/')) {
      return receipts[path.split('/').last]!;
    }
    throw UnsupportedError(path);
  }

  @override
  Future<GroupRecord> post(String path, GroupRecord body) async {
    posts.add(body);
    if (path.contains('-connect'))
      return {
        'authorizationUrl': 'http://127.0.0.1:3102/api/v1/integrations/google/launch?ticket=test',
      };
    if (!path.endsWith('/commands')) throw UnsupportedError(path);
    final cmd = body['command'] as GroupRecord;
    if (cmd['type'] == 'email.draft.create')
      drafts.add({
        'id': 'd',
        'version': 1,
        'connectionId': cmd['connectionId'],
        'envelope': cmd['envelope'],
      });
    final r = {
      'status': 'committed',
      'commandId': body['commandId'],
      'result': <String, dynamic>{},
    };
    receipts[body['commandId']] = r;
    if (lose) {
      lose = false;
      throw const SocketException('synthetic response lost');
    }
    return r;
  }
}

Future<void> _open(WidgetTester t, Widget w) async {
  await t.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => t.binding.setSurfaceSize(null));
  await t.pumpWidget(MaterialApp(home: w));
  await t.pumpAndSettle();
}

Future<void> _tap(WidgetTester t, String label) async {
  final f = find.text(label).last;
  if (f.evaluate().isEmpty)
    await t.scrollUntilVisible(
      f,
      170,
      scrollable: find.byType(Scrollable).first,
    );
  await t.ensureVisible(f);
  await t.pumpAndSettle();
  await t.tap(f);
  await t.pumpAndSettle();
}

void main() {
  test('an unknown external effect can only be reconciled; a missing local acknowledgement checks its receipt before submitting any command', () async {
    final api = _Api(),
        vault = _Vault(),
        m = WorkspaceIntegration(api, 'w', 'email', vault);
    addTearDown(api.close);
    await m.load(DateTime(2026, 11, 1), null);
    final a = {
      'id': 'action',
      'version': 2,
      'status': 'OUTCOME_UNKNOWN',
      'canRetry': true,
      'canAuthorize': true,
      'canReconcile': true,
    };
    expect(() => integrationEffect(m, a, 'retry'), throwsFormatException);
    expect(() => integrationEffect(m, a, 'authorize'), throwsFormatException);
    final cmd = integrationEffect(m, a, 'reconcile');
    api.lose = true;
    await expectLater(m.send(cmd), throwsA(isA<SocketException>()));
    final reboot = WorkspaceIntegration(api, 'w', 'email', vault);
    await reboot.load(DateTime(2026, 11, 1), null);
    expect(api.posts.length, 1);
    await reboot.send(reboot.journal.pending!['command']);
    expect(api.posts.length, 1);
    expect(api.gets.any((p) => p.contains('/receipts/')), isTrue);
    api.allowed = false;
    await expectLater(
      reboot.load(DateTime(2026, 11, 1), null),
      throwsA(isA<ApiError>()),
    );
    expect(reboot.admitted, isFalse);
    expect(reboot.data, isEmpty);
    expect(reboot.email, isEmpty);
  });
  test('provider authorization can only open the verified launch ticket for the current origin, provider and capability', () async {
    final api = _Api(),
        m = WorkspaceIntegration(api, 'w', 'calendar', _Vault());
    addTearDown(api.close);
    final raw =
        'http://127.0.0.1:3102/api/v1/integrations/google/launch?ticket=t';
    for (final invalid in [
      raw.replaceFirst('3102', '3103'),
      raw.replaceFirst('google', 'microsoft'),
      raw.replaceFirst('127.0.0.1', 'user@127.0.0.1'),
      raw + '#fragment',
      raw + '&ticket=x',
      raw.replaceFirst('ticket=t', 'ticket='),
    ]) {
      expect(
        () => integrationLaunchUri(api.origin, 'google', invalid),
        throwsFormatException,
      );
    }
    await m.load(DateTime(2026, 11, 1), null);
    expect((await m.connect('google')).queryParameters['ticket'], 'test');
    expect(api.posts, [
      {'capability': 'calendar'},
    ]);
    api.actorId = 'peer';
    await expectLater(m.connect('google'), throwsA(isA<ApiError>()));
  });
  testWidgets(
    'a local draft with no mailbox saves privately; no sending or linking action is implicit',
    (t) async {
      final api = _Api();
      addTearDown(api.close);
      await _open(
        t,
        WorkspaceEmailScreen(
          api: api,
          workspaceId: 'w',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      await _tap(t, 'Nuova bozza');
      Finder field(String s) => find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == s,
      );
      await t.enterText(field('A'), 'team@example.test');
      await t.enterText(field('Oggetto'), 'Revisione interna');
      await t.enterText(field('Messaggio'), 'Testo riservato');
      await _tap(t, 'Salva bozza');
      expect(api.posts.single['command']['type'], 'email.draft.create');
      expect(api.posts.single['command']['connectionId'], isNull);
      expect(api.posts.single['command']['envelope']['to'], [
        'team@example.test',
      ]);
      await _tap(t, 'Revisione interna');
      expect(find.textContaining('Testo riservato'), findsOneWidget);
      expect(find.text('Controlla invio'), findsNothing);
    },
  );
  testWidgets(
    'to send a version a user must review the exact Bcc, body and attachments and explicitly authorize',
    (t) async {
      final api = _Api()..linked = true;
      addTearDown(api.close);
      api.actions.add({
        'id': 'action',
        'version': 5,
        'draftId': 'd',
        'status': 'PROPOSED',
        'canAuthorize': true,
        'envelope': {
          ...api.envelope,
          'attachments': [
            {
              'id': 'f',
              'kind': 'workspace_source',
              'version': 3,
              'hash': '0' * 64,
              'filename': 'lista.txt',
            },
          ],
        },
      });
      await _open(
        t,
        WorkspaceEmailScreen(
          api: api,
          workspaceId: 'w',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      await _tap(t, 'Consegna stampa');
      await _tap(t, 'Autorizza invio');
      expect(
        find.textContaining('privato@example.test').evaluate().isNotEmpty,
        isTrue,
      );
      expect(
        find.textContaining('lista.txt · v3').evaluate().isNotEmpty,
        isTrue,
      );
      await _tap(t, 'Annulla');
      expect(api.posts, isEmpty);
      await _tap(t, 'Autorizza invio');
      await _tap(t, 'Autorizza invio');
      expect(api.posts.single['command'], {
        'type': 'email.authorize',
        'actionId': 'action',
        'version': 5,
        'expectedContextRevision': 4,
        'expectedAccessRevision': 2,
        'representSelf': true,
        'discloseToRecipients': true,
      });
    },
  );
  testWidgets(
    'returning to the app preserves an unsaved draft only for the same admission',
    (t) async {
      final api = _Api();
      addTearDown(api.close);
      await _open(
        t,
        WorkspaceEmailScreen(
          api: api,
          workspaceId: 'w',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      await _tap(t, 'Nuova bozza');
      final subject = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Oggetto',
      );
      await t.enterText(subject, 'Formula riservata');
      Future<void> suspendAndReturn() async {
        t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
        t.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await t.pump();
        t.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
        t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await t.pumpAndSettle();
      }

      await suspendAndReturn();
      expect(find.text('Formula riservata'), findsOneWidget);
      api.admission++;
      await suspendAndReturn();
      expect(find.text('Formula riservata'), findsNothing);
      expect(find.text('Nuova bozza'), findsOneWidget);
      expect(api.posts, isEmpty);
    },
  );
  testWidgets(
    'a private observation shares only the confirmed exact excerpt, preserving all other text',
    (t) async {
      final api = _Api()..linked = true;
      addTearDown(api.close);
      api.observations.add({
        'id': 'obs',
        'observedAt': '2026-11-22T18:00:00Z',
        'connectionId': 'conn',
        'request': {'query': 'lancio'},
        'data': {
          'complete': true,
          'messages': [
            {
              'id': 'msg',
              'subject': 'Proposta di consegna',
              'from': 'fornitore@example.test',
              'to': ['p@example.test'],
              'sentAt': '2026-11-22T17:45:00Z',
              'body': 'Data riservata e prezzo interno. Arrivo venerdì.',
            },
          ],
        },
      });
      await _open(
        t,
        WorkspaceEmailScreen(
          api: api,
          workspaceId: 'w',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      await _tap(t, 'lancio');
      await _tap(t, 'Proposta di consegna');
      Future<void> preview(String text) async {
        await _tap(t, 'Condividi un estratto');
        await t.enterText(find.byType(TextField).last, text);
        await _tap(t, 'Anteprima');
      }

      await preview('Testo diverso');
      expect(api.posts, isEmpty);
      await preview('Arrivo venerdì.');
      await _tap(t, 'Annulla');
      expect(api.posts, isEmpty);
      await preview('Arrivo venerdì.');
      await _tap(t, 'Condividi');
      expect(api.posts.single['command'], {
        'type': 'email.disclose',
        'observationId': 'obs',
        'messageId': 'msg',
        'text': 'Arrivo venerdì.',
        'fullHistoryDisclosed': true,
      });
    },
  );
  testWidgets(
    'an uncertain delivery has one receipt check and keeps the affected draft from being revised',
    (t) async {
      final api = _Api()..linked = true;
      addTearDown(api.close);
      api.drafts.add({
        'id': 'draft',
        'version': 1,
        'envelope': api.envelope,
        'connectionId': 'conn',
      });
      api.actions.add({
        'id': 'send',
        'draftId': 'draft',
        'version': 1,
        'status': 'OUTCOME_UNKNOWN',
        'canAuthorize': true,
        'canRetry': true,
        'canReconcile': true,
        'envelope': api.envelope,
      });
      await _open(
        t,
        WorkspaceEmailScreen(
          api: api,
          workspaceId: 'w',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      final draft = find.byKey(const PageStorageKey('draft-draft'));
      await t.tap(
        find.descendant(of: draft, matching: find.text('Consegna stampa')),
      );
      await t.pumpAndSettle();
      expect(find.text('Modifica bozza'), findsNothing);
      final send = find.byKey(const PageStorageKey('send-send'));
      final tile = find.descendant(
        of: send,
        matching: find.text('Consegna stampa'),
      );
      await t.ensureVisible(tile);
      await t.tap(tile);
      await t.pumpAndSettle();
      expect(find.text('Autorizza invio'), findsNothing);
      expect(find.textContaining('Riprova questa versione'), findsNothing);
      await _tap(t, 'Verifica esito');
      await _tap(t, 'Verifica esito');
      expect(api.posts.single['command'], {
        'type': 'email.reconcile',
        'actionId': 'send',
        'version': 1,
      });
    },
  );
  testWidgets(
    'private calendar availability is read on demand for one resource and date range; there is no publication',
    (t) async {
      final api = _Api()..linked = true;
      addTearDown(api.close);
      await _open(
        t,
        WorkspaceCalendarScreen(
          api: api,
          workspaceId: 'w',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      expect(api.posts, isEmpty);
      await _tap(t, 'Turni');
      await _tap(t, 'Leggi disponibilità');
      expect(api.posts.single['command'], {
        'type': 'calendar.read',
        'connectionId': 'conn',
        'resourceId': 'r',
        'mode': 'availability',
        'start': '2026-11-01T00:00:00Z',
        'end': '2026-12-01T00:00:00Z',
      });
    },
  );
}
