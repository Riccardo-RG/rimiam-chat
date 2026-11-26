import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/workspace_handoff_review.dart';
import 'workspace_recap_test.dart' show Vault;

typedef Row = Map<String, dynamic>;

class HandoffApi extends RimiamApi {
  HandoffApi([String kind = 'project.propose'])
    : super(Uri.parse('http://127.0.0.1:3102')) {
    actorId = 'anna';
    h['kind'] = kind;
    if (kind.startsWith('email.') || kind.startsWith('calendar.'))
      h['status'] = 'navigation';
  }
  final Row h = {
    'id': 'proposal',
    'sourceId': 'citation',
    'sourceMessageId': 'original',
    'summary': 'Verifica il calendario',
    'suggestedText': 'Usiamo venerdì.',
    'sourceIds': ['citation'],
    'target': null,
    'candidateId': null,
    'status': 'ready',
    'application': null,
  };
  bool member = true, writable = true, lose = false;
  final commands = <Row>[], receipts = <String, Row>{}, reads = <String>[];
  final extraSnapshot = <String, dynamic>{};
  final taskPages = <String, Row>{};
  late Row project = {
    'goals': [],
    'members': [
      {'id': 'anna', 'active': true, 'eligible': true, 'name': 'Anna'},
    ],
    'acts': [],
  };
  @override
  Future<Row> get(String p) async {
    reads.add(p);
    if (p.endsWith('/workspace'))
      return {
        'workspace': {'id': 'room', 'name': 'Studio', 'context_revision': 2},
        'members': [
          {
            'user_id': 'anna',
            'active': member,
            'contributes': writable,
            'name': 'Anna',
          },
        ],
        'candidates': [],
        ...extraSnapshot,
      };
    if (taskPages.containsKey(p)) return taskPages[p]!;
    if (!member && p.contains('/handoffs'))
      throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (p.endsWith('/project')) return project;
    if (p.endsWith('/handoffs?sourceId=citation'))
      return {
        'handoffs': [
          {...h},
        ],
      };
    if (p.contains('/receipts/'))
      return receipts[p.split('/').last] ??
          (throw const ApiError(404, 'RECEIPT_NOT_FOUND'));
    throw StateError('Unexpected read $p');
  }

  @override
  Future<Row> post(String p, Row body) async {
    expect(p, '/api/v1/workspaces/room/commands');
    expect(body['command']['conversationOrigin'], {'handoffId': 'proposal'});
    commands.add(body);
    h.addAll({
      'status': 'applied',
      'application': {
        'actor': actorId,
        'commandId': body['commandId'],
        'commandType': body['command']['type'],
        'prepared': {'kind': 'project_proposal', 'id': 'decision'},
        'resultReference': {
          'kind': 'commitment',
          'id': 'decision',
          'version': 1,
        },
      },
    });
    final receipt = <String, dynamic>{
      'commandId': body['commandId'],
      'status': 'committed',
      'result': body['command']['type'] == 'artifact.compose'
          ? {'artifactId': 'artifact', 'version': 1}
          : {'proposalId': 'decision'},
    };
    receipts[body['commandId']] = receipt;
    if (lose) {
      lose = false;
      throw const SocketException('response lost');
    }
    return receipt;
  }
}

HandoffReviewModel read(HandoffApi a, Vault v) => HandoffReviewModel(
  a,
  v,
  'room',
  id: 'proposal',
  source: 'citation',
  kind: a.h['kind'],
);
void main() {
  test('an unknown outcome confirms the original receipt after restart, without reopening or posting a stale command', () async {
    final a = HandoffApi(), v = Vault();
    final first = read(a, v);
    await first.load();
    expect(a.commands, isEmpty);
    a.lose = true;
    await expectLater(
      first.apply({
        'type': 'project.propose',
        'people': ['anna'],
      }),
      throwsA(isA<SocketException>()),
    );
    final second = read(a, v);
    await second.load();
    expect(second.handoff?['status'], 'applied');
    await second.verify();
    expect(a.commands, hasLength(1));
    expect(
      a.reads.where(
        (p) => p.endsWith('/receipts/${a.commands.single['commandId']}'),
      ),
      hasLength(1),
    );
    expect(second.group.journal.pending, isNull);
    expect(a.h['application']['prepared']['kind'], 'project_proposal');
  });
  test('expired versions, lost membership and a read-only member cannot apply or retain revoked content', () async {
    final a = HandoffApi(), v = Vault(), m = read(a, v);
    await m.load();
    a.h['status'] = 'stale';
    await expectLater(
      m.apply({'type': 'project.propose'}),
      throwsA(isA<ApiError>()),
    );
    a.h['status'] = 'ready';
    a.writable = false;
    await expectLater(
      m.apply({'type': 'project.propose'}),
      throwsA(isA<ApiError>()),
    );
    a.member = false;
    await expectLater(m.load(), throwsA(isA<ApiError>()));
    expect(m.handoff, isNull);
    expect(a.commands, isEmpty);
    a.member = true;
    a.actorId = 'other';
    await expectLater(m.load(), throwsA(isA<ApiError>()));
    expect(m.handoff, isNull);
    expect(a.commands, isEmpty);
  });
  Future<void> show(
    WidgetTester t,
    HandoffApi a,
    void Function(Row? r) receive,
  ) async {
    final v = Vault();
    await t.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (ctx) => Scaffold(
            body: TextButton(
              onPressed: () async {
                receive(
                  await Navigator.push<Row>(
                    ctx,
                    MaterialPageRoute(
                      builder: (_) => WorkspaceHandoffReview(
                        api: a,
                        workspaceId: 'room',
                        workspaceName: 'Studio',
                        vault: v,
                        handoff: a.h,
                      ),
                    ),
                  ),
                );
              },
              child: const Text('Apri suggerimento'),
            ),
          ),
        ),
      ),
    );
    await t.tap(find.text('Apri suggerimento'));
    await t.pumpAndSettle();
  }

  testWidgets(
    'review and select the approver before preparing a decision; show the author, original and prepared destination',
    (t) async {
      final a = HandoffApi();
      Row? dest;
      await show(t, a, (r) => dest = r);
      expect(find.text('Usiamo venerdì.'), findsOneWidget);
      expect(a.commands, isEmpty);
      await t.tap(find.text('Esamina proposta'));
      await t.pumpAndSettle();
      expect(
        find
            .widgetWithText(FilledButton, 'Sottoponi proposta')
            .evaluate()
            .single
            .widget,
        isA<FilledButton>().having((b) => b.onPressed, 'onPressed', isNull),
      );
      await t.ensureVisible(find.text('Anna'));
      await t.tap(find.text('Anna'));
      await t.pump();
      await t.ensureVisible(find.text('Sottoponi proposta'));
      await t.tap(find.text('Sottoponi proposta'));
      await t.pumpAndSettle();
      expect(
        a.commands.single['command'],
        containsPair('type', 'project.propose'),
      );
      expect(a.commands.single['command']['people'], ['anna']);
      expect(a.commands.single['command']['content'], 'Usiamo venerdì.');
      expect(find.text('Passaggio registrato'), findsOneWidget);
      expect(find.text('Registrato da Anna'), findsOneWidget);
      await t.ensureVisible(find.text('Esamina la proposta registrata'));
      await t.tap(find.text('Esamina la proposta registrata'));
      await t.pumpAndSettle();
      expect(dest, {'destination': 'direction', 'preparedId': 'decision'});
    },
  );
  for (final (k, d, label) in [
    ('email.prepare', 'email', 'Apri Posta privata'),
    ('calendar.prepare', 'calendar', 'Apri Calendario'),
  ]) {
    testWidgets('$k is navigation only', (t) async {
      final a = HandoffApi(k);
      Row? dest;
      await show(t, a, (r) => dest = r);
      await t.tap(find.text(label));
      await t.pumpAndSettle();
      expect(dest, {'destination': d});
      expect(a.commands, isEmpty);
    });
  }
  testWidgets(
    'a stale handoff links to its exact source and has no preparation action',
    (t) async {
      final a = HandoffApi()..h['status'] = 'stale';
      Row? dest;
      await show(t, a, (r) => dest = r);
      expect(find.text('Suggerimento superato'), findsOneWidget);
      expect(find.text('Esamina proposta'), findsNothing);
      await t.tap(find.text('Fonte 1'));
      await t.pumpAndSettle();
      expect(dest, {'kind': 'source', 'id': 'citation', 'version': 1});
      expect(a.commands, isEmpty);
    },
  );
  testWidgets(
    'membership revoked while editing removes both the form and its source',
    (t) async {
      final a = HandoffApi();
      await show(t, a, (_) {});
      await t.tap(find.text('Esamina proposta'));
      await t.pumpAndSettle();
      expect(find.text('Sottoponi proposta'), findsOneWidget);
      a.member = false;
      await t.pump(const Duration(seconds: 11));
      await t.pumpAndSettle();
      expect(find.text('Sottoponi proposta'), findsNothing);
      expect(find.text('Usiamo venerdì.'), findsNothing);
      expect(a.commands, isEmpty);
    },
  );
  testWidgets(
    'a descriptive correction identifies the exact version before asking for a reason',
    (t) async {
      final a = HandoffApi('information.correct')
        ..h.addAll({
          'target': {'kind': 'information', 'id': 'info', 'version': 4},
          'candidateId': 'candidate',
        });
      a.extraSnapshot.addAll({
        'information': [
          {'id': 'info', 'current_version': 4, 'content': 'Prima versione'},
        ],
        'candidates': [
          {
            'id': 'candidate',
            'classification': 'descriptive',
            'context_revision': 2,
            'source_id': 'citation',
            'content': 'Nuova informazione',
          },
        ],
      });
      await show(t, a, (_) {});
      await t.ensureVisible(find.text('Correggi riferimento'));
      await t.tap(find.text('Correggi riferimento'));
      await t.pumpAndSettle();
      expect(find.textContaining('Prima versione'), findsOneWidget);
      await t.enterText(find.byType(TextField), 'Verificato il nuovo dato.');
      await t.pump();
      await t.tap(find.text('Conferma correzione'));
      await t.pumpAndSettle();
      expect(a.commands.single['command'], {
        'type': 'information.correct',
        'candidateId': 'candidate',
        'descriptiveOnly': true,
        'informationId': 'info',
        'expectedVersion': 4,
        'reason': 'Verificato il nuovo dato.',
        'conversationOrigin': {'handoffId': 'proposal'},
      });
    },
  );
  testWidgets(
    'accepted task responsibility prepares a revision using the historical target retrieved on page two',
    (t) async {
      final a = HandoffApi('task.change')
        ..h['target'] = {'kind': 'task', 'id': 'task', 'version': 3};
      a.taskPages.addAll({
        '/api/v1/workspaces/room/tasks': {
          'tasks': [],
          'next': 'second',
          'members': [],
        },
        '/api/v1/workspaces/room/tasks?before=second': {
          'tasks': [
            {
              'id': 'task',
              'version': 3,
              'responsible': 'anna',
              'title': 'Prima attività',
              'description': 'Prima descrizione',
              'timeZone': 'Europe/Rome',
              'references': [
                {'kind': 'message', 'id': 'old', 'version': 1},
              ],
            },
          ],
          'members': [],
        },
      });
      await show(t, a, (_) {});
      await t.tap(find.text('Modifica attività'));
      await t.pumpAndSettle();
      expect(find.text('Prima attività'), findsOneWidget);
      final submit = find.widgetWithText(FilledButton, 'Invia proposta');
      await t.ensureVisible(submit);
      await t.tap(submit);
      await t.pumpAndSettle();
      expect(
        a.commands.single['command'],
        containsPair('type', 'task.propose_revision'),
      );
      expect(a.commands.single['command']['expectedVersion'], 3);
      expect(a.commands.single['command']['content']['references'], [
        {'kind': 'message', 'id': 'old', 'version': 1},
      ]);
    },
  );
  testWidgets(
    'the prepared task proposal keeps both task and exact proposal IDs',
    (t) async {
      final a = HandoffApi('task.change')
        ..h.addAll({
          'status': 'applied',
          'target': {'kind': 'task', 'id': 'task', 'version': 3},
          'application': {
            'actor': 'anna',
            'prepared': {
              'kind': 'task_revision_proposal',
              'id': 'pending-revision',
            },
          },
        });
      Row? dest;
      await show(t, a, (r) => dest = r);
      await t.tap(find.text('Esamina la proposta registrata'));
      await t.pumpAndSettle();
      expect(dest, {
        'destination': 'tasks',
        'taskId': 'task',
        'preparedId': 'pending-revision',
      });
      expect(a.commands, isEmpty);
    },
  );
  testWidgets(
    'preparing a document retains the suggested source IDs on explicit save in the chosen space',
    (t) async {
      final a = HandoffApi('artifact.prepare');
      await show(t, a, (_) {});
      await t.tap(find.text('Prepara documento'));
      await t.pumpAndSettle();
      expect(find.text('Nuovo documento'), findsOneWidget);
      expect(find.text('Usiamo venerdì.'), findsOneWidget);
      expect(a.commands, isEmpty);
      final save = find.widgetWithText(FilledButton, 'Salva in Studio');
      for (int i = 0; i < 8 && save.evaluate().isEmpty; i++) {
        await t.drag(find.byType(ListView).last, const Offset(0, -250));
        await t.pumpAndSettle();
      }
      await t.ensureVisible(save);
      await t.tap(save);
      await t.pumpAndSettle();
      final cmd = a.commands.single['command'];
      expect(cmd['type'], 'artifact.compose');
      expect(cmd['blocks'].single['text'], 'Usiamo venerdì.');
      expect(cmd['sourceIds'], ['citation']);
      expect(cmd['conversationOrigin'], {'handoffId': 'proposal'});
    },
  );
}
