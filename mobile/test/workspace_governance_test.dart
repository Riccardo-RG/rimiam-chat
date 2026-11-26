import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_consultation.dart';
import '../lib/workspace_context.dart';
import '../lib/workspace_direction.dart';
import '../lib/workspace_governance.dart';

class Vault implements DraftVault {
  final entries = <String, String>{};
  @override
  Future<String?> read(String key) async => entries[key];
  @override
  Future<void> replace(String key, String? val) async {
    if (val == null) {
      entries.remove(key);
    } else {
      entries[key] = val;
    }
  }
}

class Api extends RimiamApi {
  Api() : super(Uri.parse('http://127.0.0.1')) {
    actorId = 'alpha';
  }
  bool allowed = true,
      contributor = true,
      unavailable = false,
      loseResponse = false;
  final posts = <GroupRecord>[],
      gets = <String>[],
      candidates = <GroupRecord>[],
      acts = <GroupRecord>[],
      privateTurns = <String, GroupRecord>{};
  Completer<void>? responseGate;
  int version = 2;
  String goal = 'Concordare il calendario';
  final privateRef = {
    'kind': 'information',
    'id': 'ref',
    'version': 1,
    'label': 'Data concordata',
  };
  @override
  Future<GroupRecord?> getOptional(String path) async {
    gets.add(path);
    if (unavailable) throw const SocketException('fixture offline');
    final last = privateTurns.values.lastOrNull;
    return last == null
        ? null
        : {'id': last['id'], 'createdAt': last['createdAt']};
  }

  @override
  Future<GroupRecord> get(String path) async {
    gets.add(path);
    if (!allowed) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (path.endsWith('/workspace'))
      return {
        'workspace': {'id': 'space', 'context_revision': 1},
        'members': [
          {
            'user_id': actorId,
            'active': true,
            'contributes': contributor,
            'name': 'Ada',
          },
        ],
        'information': [
          {
            'id': 'ref',
            'subject': 'Data concordata',
            'content': 'Giovedì',
            'current_version': 1,
            'accepted_by': actorId,
          },
        ],
        'candidates': candidates,
        'questions': [],
        'sources': [],
      };
    if (path.endsWith('/project'))
      return {
        'accessRevision': 3,
        'goals': [
          {
            'id': 'goal',
            'version': version,
            'currentPrimary': true,
            'status': 'active',
            'content': goal,
            'versions': [],
            'adherences': [],
          },
        ],
        'members': [
          {'id': actorId, 'name': 'Ada', 'active': true, 'eligible': true},
        ],
        'acts': acts,
        'mandates': [],
        'goalProposals': [],
      };
    final uri = Uri.parse(path), kind = uri.queryParameters['kind'];
    if (uri.path.endsWith('/reference'))
      return {
        'reference': {
          'kind': kind,
          'id': uri.queryParameters['id'],
          'version': int.parse(uri.queryParameters['version']!),
        },
        'title': kind == 'source' ? 'Messaggio condiviso' : 'Data concordata',
        'content': kind == 'source' ? 'Ho condiviso il calendario.' : 'Giovedì',
        'current': true,
        'sourceIds': ['original'],
        'provenance': {if (kind == 'source') 'sourceKind': 'message'},
      };
    throw UnsupportedError(path);
  }

  @override
  Future<GroupRecord> post(String path, GroupRecord body) async {
    posts.add(body);
    if (responseGate != null) await responseGate!.future;
    if (path.endsWith('/commands')) {
      final c = body['command'];
      if (c['type'] == 'goal.editShared') {
        if (c['expectedVersion'] != version)
          throw const ApiError(409, 'GOAL_VERSION_STALE');
        version++;
        goal = c['content'];
      }
      return {'status': 'committed', 'commandId': body['commandId']};
    }
    final id = body['id'] as String;
    if (body['action'] == 'ask') {
      privateTurns.putIfAbsent(
        id,
        () => {
          'id': id,
          'kind': 'context',
          'question': body['question'],
          'createdAt': '2026-11-26T16:00:00Z',
          'answer': 'Una lettura privata.',
          'references': [privateRef],
          'sharedMessageId': null,
        },
      );
      if (loseResponse) {
        loseResponse = false;
        throw const SocketException('lost response');
      }
    }
    if (body['action'] == 'share')
      privateTurns[id]!['sharedMessageId'] = 'published';
    return {
      ...privateTurns[id]!,
      if (body['action'] == 'resume')
        'history': privateTurns.values.where((r) => r['id'] != id).toList(),
    };
  }
}

Future<void> visit(WidgetTester t, Widget screen) async {
  await t.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => t.binding.setSurfaceSize(null));
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}

Future<void> tap(WidgetTester t, String label) async {
  final f = find.text(label).last;
  if (f.evaluate().isEmpty)
    await t.scrollUntilVisible(
      f,
      180,
      scrollable: find.byType(Scrollable).first,
    );
  await t.ensureVisible(f);
  await t.pumpAndSettle();
  await t.tap(f);
  await t.pumpAndSettle();
}

void main() {
  testWidgets(
    'opening a registered proposal shows the exact decision without adopting it',
    (t) async {
      final api = Api();
      addTearDown(api.close);
      for (final id in ['A', 'B']) {
        api.acts.add({
          'proposalId': id,
          'kind': 'decision',
          'operation': 'create',
          'content': 'Decisione $id',
          'reason': 'Motivo $id',
          'status': 'proposed',
          'people': [],
          'approvals': [],
        });
      }
      await t.pumpWidget(
        MaterialApp(
          home: WorkspaceDirectionScreen(
            api: api,
            vault: Vault(),
            workspaceId: 'space',
            workspaceName: 'Lancio',
            proposalId: 'B',
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Decisione B'), findsOneWidget);
      expect(find.text('Motivo B'), findsOneWidget);
      expect(find.text('Decisione A'), findsNothing);
      expect(api.posts, isEmpty);
      await t.pumpWidget(const SizedBox());
    },
  );
  test('a response from before suspension cannot repaint a private consultation or clear its receipt', () async {
    final api = Api(), vault = Vault();
    addTearDown(api.close);
    final group = GroupGovernance(api, 'space', direction: false, vault: vault);
    await group.load();
    final reader = WorkspaceConsultation(group, vault);
    final ask = reader.ask('Quali date?');
    final gate = api.responseGate = Completer();
    final request = reader.run(ask);
    await Future<void>.delayed(Duration.zero);
    expect(api.posts.length, 1);
    group.suspend();
    await group.load();
    final result = expectLater(request, throwsStateError);
    gate.complete();
    await result;
    expect(reader.turns, isEmpty);
    expect(reader.pending, ask);
  });
  testWidgets(
    'a suggested commitment requires selected people and explicit submission',
    (t) async {
      final api = Api();
      api.candidates.add({
        'id': 'idea',
        'interpretation_id': 'job',
        'source_id': 'original',
        'source_ids': <String>[],
        'classification': 'normative',
        'origin': 'inferred',
        'subject': 'Collaudo comune',
        'content': 'Verificare insieme il prototipo.',
        'context_revision': 1,
        'uses': {'information': [], 'questions': [], 'proposals': []},
      });
      addTearDown(api.close);
      await visit(
        t,
        WorkspaceContextScreen(
          api: api,
          workspaceId: 'space',
          workspaceName: 'Lancio',
          vault: Vault(),
        ),
      );
      await tap(t, 'Riferimenti e proposte');
      await tap(t, 'Da valutare');
      await tap(t, 'Collaudo comune');
      expect(find.text('Accetta come riferimento'), findsNothing);
      await tap(t, 'Proponi come impegno');
      await tap(t, 'Continua');
      expect(api.posts, isEmpty);
      await tap(t, 'Proponi');
      expect(api.posts.single['command'], {
        'type': 'commitment.propose',
        'candidateId': 'idea',
        'people': ['alpha'],
      });
    },
  );
  test('a lost private consultation restores its exact id without an automatic retry; follow-ups refer only to the selected previous turn', () async {
    final api = Api(), vault = Vault();
    addTearDown(api.close);
    GroupGovernance repo() =>
        GroupGovernance(api, 'space', direction: false, vault: vault);
    final g = repo();
    await g.load();
    final reader = WorkspaceConsultation(g, vault);
    await reader.load();
    final first = reader.ask('Quali date?');
    api.loseResponse = true;
    await expectLater(reader.run(first), throwsA(isA<SocketException>()));
    expect(api.posts.length, 1);
    final reopened = repo();
    await reopened.load();
    final after = WorkspaceConsultation(reopened, vault);
    await after.load();
    expect(after.turns, isEmpty);
    expect(api.posts.length, 1);
    expect(after.pending, first);
    await after.run(after.pending!);
    expect(api.privateTurns.length, 1);
    expect(api.posts.last['id'], first['id']);
    final second = after.ask('Quale giorno?');
    expect(second['parentId'], first['id']);
    await after.run(second);
    final resumed = WorkspaceConsultation(reopened, vault);
    await resumed.load();
    expect(resumed.turns, isEmpty);
    await resumed.run(resumed.action('resume', resumed.last!['id']));
    expect(resumed.turns.map((r) => r['id']), [first['id'], second['id']]);
    api.actorId = 'beta';
    await expectLater(
      after.run(after.action('share', first['id'])),
      throwsA(isA<ApiError>()),
    );
    expect(api.posts.where((b) => b['action'] == 'share'), isEmpty);
  });
  testWidgets(
    'neutral context, explicit sharing or source back to the correct original message',
    (t) async {
      final api = Api(), vault = Vault();
      addTearDown(api.close);
      String? original;
      await visit(
        t,
        Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              child: const Text('Apri'),
              onPressed: () async {
                original = await Navigator.push<String>(
                  context,
                  MaterialPageRoute(
                    builder: (_) => WorkspaceContextScreen(
                      api: api,
                      workspaceId: 'space',
                      workspaceName: 'Lancio',
                      vault: vault,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      );
      await tap(t, 'Apri');
      expect(api.posts, isEmpty);
      expect(find.text('Giovedì'), findsNothing);
      await tap(t, 'Quali riferimenti abbiamo già accettato?');
      expect(find.text('Una lettura privata.'), findsOneWidget);
      await tap(t, 'Condividi in chat');
      await tap(t, 'Annulla');
      expect(api.posts.map((r) => r['action']), ['ask']);
      await tap(t, 'Condividi in chat');
      await tap(t, 'Condividi');
      expect(api.posts.last, {
        'action': 'share',
        'id': api.posts.first['id'],
        'expectedActorId': 'alpha',
      });
      await tap(t, 'Data concordata');
      await tap(t, 'Fonte 1');
      await tap(t, 'Vai al messaggio');
      expect(original, 'original');
      expect(api.gets.where((s) => s.contains('/reference?')).length, 2);
      expect(t.takeException(), isNull);
    },
  );
  testWidgets(
    'shared references remain accessible when private consultations are unavailable',
    (t) async {
      final api = Api()..unavailable = true;
      addTearDown(api.close);
      await visit(
        t,
        WorkspaceContextScreen(
          api: api,
          workspaceId: 'space',
          workspaceName: 'Lancio',
          vault: Vault(),
        ),
      );
      await tap(t, 'Riferimenti e proposte');
      await tap(t, 'Data concordata');
      expect(find.text('Giovedì'), findsOneWidget);
      expect(api.posts, isEmpty);
    },
  );
  testWidgets(
    'goal editor sends the displayed version and exposes a stale response without changing the current goal',
    (t) async {
      final api = Api();
      addTearDown(api.close);
      await visit(
        t,
        WorkspaceDirectionScreen(
          api: api,
          workspaceId: 'space',
          workspaceName: 'Lancio',
          vault: Vault(),
        ),
      );
      await tap(t, 'Modifica obiettivo');
      await t.enterText(find.byType(TextField), 'Presentare la bozza');
      await t.pump();
      api.version = 3;
      api.goal = 'Aggiornamento del gruppo';
      await tap(t, 'Salva obiettivo');
      expect(api.posts.single['command'], {
        'type': 'goal.editShared',
        'goalId': 'goal',
        'expectedVersion': 2,
        'content': 'Presentare la bozza',
      });
      expect(find.textContaining('Qualcuno ha aggiornato'), findsOneWidget);
      expect(api.goal, 'Aggiornamento del gruppo');
      await t.tap(find.byTooltip('Aggiorna'));
      await t.pumpAndSettle();
      expect(find.text(api.goal), findsOneWidget);
      await tap(t, 'Modifica obiettivo');
      await t.enterText(find.byType(TextField), 'Testare il prototipo');
      await t.pump();
      await tap(t, 'Salva obiettivo');
      expect(api.posts.last['command']['expectedVersion'], 3);
      expect(api.version, 4);
      expect(find.text('Testare il prototipo'), findsOneWidget);
    },
  );
  testWidgets(
    'read-only members can inspect the goal but cannot change it, propose acts or share a consultation',
    (t) async {
      final api = Api()..contributor = false;
      addTearDown(api.close);
      await visit(
        t,
        WorkspaceDirectionScreen(
          api: api,
          workspaceId: 'space',
          workspaceName: 'Lancio',
          vault: Vault(),
        ),
      );
      expect(find.text(api.goal), findsOneWidget);
      expect(find.text('Modifica obiettivo'), findsNothing);
      await tap(t, 'Proposte e storia');
      expect(find.text('Nuova proposta'), findsNothing);
      await t.pumpWidget(
        MaterialApp(
          home: WorkspaceContextScreen(
            api: api,
            workspaceId: 'space',
            workspaceName: 'Lancio',
            vault: Vault(),
          ),
        ),
      );
      await t.pumpAndSettle();
      await tap(t, 'Quali questioni sono ancora aperte?');
      expect(find.text('Una lettura privata.'), findsOneWidget);
      expect(find.text('Condividi in chat'), findsNothing);
      api.allowed = false;
      await t.tap(find.byTooltip('Aggiorna'));
      await t.pumpAndSettle();
      expect(find.text('Una lettura privata.'), findsNothing);
    },
  );
}
