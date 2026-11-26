import 'dart:async';
import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/file_library.dart';
import '../lib/journey.dart';
import '../lib/chat_message_layout.dart';
import '../lib/participant_profile.dart';

class _Vault implements DraftVault {
  final items = <String, String>{};
  int reads = 0;
  bool failWrites = false;
  @override
  Future<String?> read(String key) async {
    reads++;
    return items[key];
  }

  @override
  Future<void> replace(String key, String? value) async {
    if (failWrites) throw StateError('Archivio bloccato');
    if (value == null) {
      items.remove(key);
    } else {
      items[key] = value;
    }
  }
}

class _TestApi extends RimiamApi {
  _TestApi({
    this.writable = true,
    String actor = 'reader',
    String origin = 'http://localhost',
    _Vault? vault,
  }) : store = vault ?? _Vault(),
       super(Uri.parse(origin)) {
    actorId = actor;
  }
  final _Vault store;
  bool writable;
  bool denied = false;
  final submissions = <Map<String, dynamic>>[];
  final receipts = <String, Map<String, dynamic>>{};
  final rows = <Map<String, dynamic>>[];
  final sources = <Map<String, dynamic>>[];
  final milestones = <Map<String, dynamic>>[];
  final handoffHistory = <Map<String, dynamic>>[];
  final recentHandoffs = <Map<String, dynamic>>[];
  final references = <String, Map<String, dynamic>>{};
  final otherMembers = <Map<String, dynamic>>[];
  final requested = <String>{};
  bool includeReading = false;
  final readings = <Map<String, dynamic>>[];
  int ids = 0, checks = 0;
  bool loseResponse = false, loseRequest = false;
  int photoReads = 0;
  Completer<void>? pause;
  @override
  String newId() => 'command-${++ids}';
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (denied) throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
    if (path.startsWith('/api/v1/identity-photos?')) {
      photoReads++;
      return {'actor': actorId, 'members': <String, dynamic>{}};
    }
    if (path.endsWith('/workspace')) {
      return {
        'workspace': {
          'id': path.split('/')[4],
          'name': 'Laboratorio',
          'revision': rows.length + 1,
        },
        'members': [
          {'user_id': actorId, 'active': true, 'contributes': writable},
          ...otherMembers,
        ],
        'messages': rows,
        'handoffs': recentHandoffs,
        'sources': sources,
        'interpretations': readings,
        if (includeReading)
          'reading': {
            'admission': 1,
            'cursorVersion': 0,
            'anchorId': null,
            'anchorOffset': 0,
            'unreadIds': <String>[],
            'mentionIds': <String>[],
            'requestIds': requested.toList(),
          },
      };
    }
    if (path.contains('/changes?')) return {'headRevision': rows.length + 1};
    if (path.contains('/milestones?')) return {'items': milestones};
    if (path.contains('/handoffs?')) {
      final source = Uri.parse(path).queryParameters['sourceId'];
      return {
        'handoffs': handoffHistory
            .where(
              (h) => h['sourceMessageId'] == source || h['sourceId'] == source,
            )
            .toList(),
      };
    }
    if (path.contains('/reference?')) {
      final ref = Uri.parse(path).queryParameters;
      return references["${ref['kind']}/${ref['id']}/${ref['version']}"] ??
          (throw const ApiError(404, 'REFERENCE_NOT_FOUND'));
    }
    if (path.contains('/profiles/')) {
      final id = path.split('/').last;
      return {'id': id, 'email': '$id@example.test'};
    }
    if (path.contains('/receipts/')) {
      checks++;
      return receipts[path.split('/').last] ??
          (throw const ApiError(404, 'RECEIPT_NOT_FOUND'));
    }
    throw StateError('GET inattesa: $path');
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    if (path.endsWith('/reading')) return {'cursorVersion': 1};
    expect(path, '/api/v1/workspaces/work/commands');
    submissions.add(body);
    await pause?.future;
    if (loseRequest) {
      loseRequest = false;
      throw const SocketException('Offline');
    }
    final id = body['commandId'] as String;
    final result = receipts.putIfAbsent(id, () {
      final command = body['command'];
      if (command['type'] == 'conversation.requestAnswer' ||
          command['type'] == 'conversation.answered') {
        if (command['type'] == 'conversation.answered')
          requested.remove(command['messageId']);
        return {
          'commandId': id,
          'status': 'committed',
          'result': <String, dynamic>{},
        };
      }
      if (body['command']['type'] == 'interpretation.retry') {
        readings.singleWhere(
          (r) => r['id'] == body['command']['interpretationId'],
        )['status'] = 'queued';
        return {
          'commandId': id,
          'status': 'committed',
          'result': <String, dynamic>{},
        };
      }
      rows.add({
        'id': 'msg-$id',
        'author_name': 'Ada',
        'actor_kind': 'human',
        'content': body['command']['content'],
        'sequence': rows.length + 1,
        'created_at': '2026-11-26T12:00:00Z',
      });
      return {
        'commandId': id,
        'status': 'committed',
        'result': {'sourceId': 'msg-$id'},
      };
    });
    if (loseResponse) {
      loseResponse = false;
      throw const SocketException('Conferma persa');
    }
    return result;
  }
}

// Same scoped routes as the server. The archive only becomes visible in the
// next workspace snapshot, after the exact source has been inspected.
class _LinkApi extends _TestApi {
  final topics = <Map<String, dynamic>>[];
  Map<String, dynamic>? older;
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (denied) throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
    if (path.contains('/attention?')) return {'workstreams': topics};
    if (path.contains('/activity?')) return {'events': [], 'next': null};
    final result = await super.get(path);
    if (path.contains('/reference?') &&
        older != null &&
        result['reference']?['id'] == older?['id']) {
      rows.insert(0, older!);
      older = null;
    }
    return result;
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    if (body['command']?['type'] == 'question.open') {
      submissions.add(body);
      return {
        'commandId': body['commandId'],
        'status': 'committed',
        'result': {'questionId': 'saved'},
      };
    }
    return super.post(path, body);
  }
}

Map<String, dynamic> _historyRow(
  int i,
  String author,
  String text, {
  String kind = 'human',
}) => {
  'id': 'old$i',
  'author_id': 'person$i',
  'author_name': author,
  'sequence': i,
  'content': text,
  'actor_kind': kind,
  'created_at': '2026-11-26T12:00:00Z',
};

void main() {
  test('a question about a specific file version and its timezone are frozen for explicit retry', () async {
    final api = _TestApi()..loseRequest = true;
    addTearDown(api.close);
    ChatJournal journal() => ChatJournal(
      vault: api.store,
      origin: api.origin,
      actor: api.actorId,
      workspace: 'work',
    );
    final first = journal();
    await first.open();
    first.askAboutFile((sourceId: 'preventivo-v2', filename: 'Preventivo.pdf'));
    first.edit('Qual è il totale?');
    await first.saveAgain();
    final reopened = journal();
    await reopened.open();
    expect(reopened.fileReference?.filename, 'Preventivo.pdf');
    expect(reopened.askAssistant, isTrue);
    expect(api.submissions, isEmpty);
    await expectLater(
      reopened.submit(api, mayPost: () => true, timeZone: 'Europe/Rome'),
      throwsA(isA<SocketException>()),
    );
    final restarted = journal();
    await restarted.open();
    await restarted.submit(api, mayPost: () => true, timeZone: 'Asia/Tokyo');
    expect(api.submissions.last, api.submissions.first);
    expect(api.submissions.last['command'], {
      'type': 'message.send',
      'content': '@Emme Qual è il totale?',
      'clientTimeZone': 'Europe/Rome',
      'reference': {'kind': 'source', 'id': 'preventivo-v2', 'version': 1},
    });
    expect(restarted.fileReference, isNull);
    expect(api.rows, hasLength(1));
  });
  Future<void> open(
    WidgetTester tester,
    _TestApi api, {
    String workspace = 'work',
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: WorkspaceJourney(
          api: api,
          vault: api.store,
          workspaceId: workspace,
          workspaceName: 'Laboratorio',
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'compact chat keeps each action and groups consecutive authors between reading intervals',
    (t) async {
      final api = _TestApi();
      addTearDown(api.close);
      await t.binding.setSurfaceSize(const Size(390, 850));
      addTearDown(() => t.binding.setSurfaceSize(null));
      for (final (i, time, author) in [
        (1, '09:00', 'Lina'),
        (2, '09:04', 'Lina'),
        (3, '11:04', 'Lina'),
        (4, '11:06', 'Emme'),
      ]) {
        api.rows.add({
          ..._historyRow(
            i,
            author,
            'Testo $i',
            kind: author == 'Emme' ? 'miriam' : 'human',
          ),
          'author_id': author == 'Lina' ? 'lina' : null,
          'created_at': '2026-11-24T${time}:00Z',
        });
      }
      await open(t, api);
      expect(find.byType(ChatAuthor), findsNWidgets(3));
      expect(find.byTooltip('Azioni sul messaggio di Lina'), findsNWidgets(3));
      expect(find.byType(IdentityAvatar), findsNothing);
      expect(api.photoReads, 0);
      final clock =
          MaterialLocalizations.of(t.element(find.byType(ChatAuthor).first))
              .formatTimeOfDay(
                TimeOfDay.fromDateTime(
                  DateTime.parse('2026-11-24T11:04:00Z').toLocal(),
                ),
              );
      expect(find.text(clock), findsOneWidget);
      await t.binding.setSurfaceSize(const Size(1024, 850));
      await t.pumpAndSettle();
      expect(api.photoReads, 1);
      expect(find.byType(IdentityAvatar), findsNWidgets(2));
      expect(find.byTooltip('Azioni sul messaggio di Lina'), findsNWidgets(3));
      await t.pumpWidget(const SizedBox());
    },
  );

  for (final size in [const Size(390, 844), const Size(1024, 800)]) {
    testWidgets(
      'opening a question from a message keeps the exact source, allows changing it and never submits automatically at ${size.width}',
      (t) async {
        await t.binding.setSurfaceSize(size);
        addTearDown(() => t.binding.setSurfaceSize(null));
        final api = _LinkApi()
          ..rows.addAll([
            _historyRow(1, 'Ada', 'Il primo input'),
            _historyRow(2, 'Matteo', 'Il secondo input'),
          ]);
        addTearDown(api.close);
        await open(t, api);
        await t.tap(find.byTooltip('Azioni sul messaggio di Ada'));
        await t.pumpAndSettle();
        await t.tap(find.text('Apri una domanda'));
        await t.pumpAndSettle();
        final dialog = find.byType(AlertDialog);
        Finder inside(Finder matching) =>
            find.descendant(of: dialog, matching: matching);
        expect(inside(find.text('Ada · Il primo input')), findsOneWidget);
        final questionField = inside(
          find.widgetWithText(TextField, 'Cosa resta da chiarire?'),
        );
        await t.enterText(questionField, 'Quando partiamo?');
        await t.pump();
        expect(api.submissions, isEmpty);
        await t.tap(find.text('Cambia fonte'));
        await t.pumpAndSettle();
        await t.tap(find.text('Matteo · Il secondo input'));
        await t.pumpAndSettle();
        expect(inside(find.text('Matteo · Il secondo input')), findsOneWidget);
        expect(inside(find.text('Ada · Il primo input')), findsNothing);
        expect(api.submissions, isEmpty);
        await t.tap(inside(find.text('Registra domanda')));
        await t.pumpAndSettle();
        expect(api.submissions.single['command'], {
          'type': 'question.open',
          'sourceId': 'old2',
          'content': 'Quando partiamo?',
        });
      },
    );
  }
  testWidgets(
    'a generic versioned reference and the topic created by a chat operation open the precise records',
    (t) async {
      final api = _LinkApi();
      addTearDown(api.close);
      api.rows.add({
        ..._historyRow(1, 'Emme', 'Argomento pronto', kind: 'miriam'),
        'operationResult': {
          'outcome': 'created',
          'workstreamId': 'topic',
          'workstreamVersion': 1,
          'title': 'Materiali',
        },
        'reference': {'kind': 'goal', 'id': 'goal', 'version': 2},
      });
      api.topics.addAll([
        {
          'id': 'other',
          'state': 'active',
          'title': 'Altro',
          'description': '',
          'version': 1,
          'sources': [],
          'history': [],
        },
        {
          'id': 'topic',
          'state': 'archived',
          'title': 'Materiali',
          'description': 'La scheda giusta',
          'version': 2,
          'sources': [],
          'history': [],
        },
      ]);
      api.references['goal/goal/2'] = {
        'reference': {'kind': 'goal', 'id': 'goal', 'version': 2},
        'title': 'Obiettivo storico',
        'content': 'Versione richiesta',
        'current': false,
        'sourceIds': [],
      };
      await open(t, api);
      await t.tap(find.text('Vedi riferimento'));
      await t.pumpAndSettle();
      expect(find.text('Versione richiesta'), findsOneWidget);
      await t.pageBack();
      await t.pumpAndSettle();
      await t.tap(find.text('Apri argomento · Materiali'));
      await t.pumpAndSettle();
      expect(find.text('La scheda giusta'), findsOneWidget);
      expect(find.text('Altro'), findsNothing);
      expect(api.submissions, isEmpty);
    },
  );
  testWidgets(
    'a citation absent from the local index opens its authorized reference and jumps to an offscreen original in a long timeline',
    (t) async {
      final api = _LinkApi()..writable = false;
      addTearDown(api.close);
      api.older = _historyRow(1, 'Ada', 'Il messaggio di partenza');
      for (var i = 2; i <= 80; i++)
        api.rows.add(_historyRow(i, 'Matteo', 'Aggiornamento $i'));
      api.rows.add({
        ..._historyRow(81, 'Emme', 'Trovata la fonte', kind: 'miriam'),
        'citation_source_ids': ['old1'],
      });
      api.references['source/old1/1'] = {
        'reference': {'kind': 'source', 'id': 'old1', 'version': 1},
        'title': 'Messaggio condiviso',
        'content': 'Il messaggio di partenza',
        'provenance': {'sourceKind': 'message'},
        'sourceIds': ['old1'],
      };
      await open(t, api);
      expect(find.text('Il messaggio di partenza'), findsNothing);
      await t.tap(find.text('Fonte citata'));
      await t.pumpAndSettle();
      expect(find.text('Vai al messaggio'), findsOneWidget);
      await t.tap(find.text('Vai al messaggio'));
      await t.pumpAndSettle();
      expect(
        find.text('Il messaggio di partenza').hitTestable(),
        findsOneWidget,
      );
      expect(find.text('Trovata la fonte').hitTestable(), findsNothing);
      expect(api.submissions, isEmpty);
    },
  );

  testWidgets(
    'a contributor chooses exactly who should reply; a lost acknowledgment reuses its receipt',
    (t) async {
      final api = _TestApi()
        ..otherMembers.addAll([
          {'user_id': 'matteo', 'name': 'Matteo', 'active': true},
          {'user_id': 'giulia', 'name': 'Giulia', 'active': true},
        ])
        ..rows.add({
          'id': 'm1',
          'author_name': 'Ada',
          'actor_kind': 'human',
          'sequence': 1,
          'content': 'Approvate la data?',
          'created_at': '2026-11-26T12:00:00Z',
        });
      addTearDown(api.close);
      await open(t, api);
      await t.tap(find.byTooltip('Azioni sul messaggio di Ada'));
      await t.pumpAndSettle();
      await t.tap(find.text('Richiedi una risposta'));
      await t.pumpAndSettle();
      expect(api.submissions, isEmpty);
      await t.tap(find.text('Giulia'));
      await t.pump();
      api.loseResponse = true;
      await t.tap(find.text('Richiedi risposta'));
      await t.pumpAndSettle();
      expect(api.submissions.single['command'], {
        'type': 'conversation.requestAnswer',
        'messageId': 'm1',
        'recipients': ['giulia'],
      });
      await t.tap(find.text('Verifica richiesta'));
      await t.pumpAndSettle();
      expect(api.submissions, hasLength(1));
      expect(api.checks, 1);
      expect(find.text('Verifica richiesta'), findsNothing);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'group citations stay compact and an adopted decision opens its source at the original message',
    (t) async {
      final api = _TestApi(writable: false);
      addTearDown(api.close);
      Map<String, dynamic> row(
        String id,
        String author,
        String kind,
        int seq,
        String content,
      ) => {
        'id': id,
        'author_name': author,
        'actor_kind': kind,
        'sequence': seq,
        'content': content,
        'created_at': '2026-11-26T12:00:00Z',
      };
      api.rows.addAll([
        row('m1', 'Matteo', 'human', 1, 'La scadenza è venerdì'),
        {
          ...row('m2', 'Emme', 'miriam', 2, 'Ho verificato la data'),
          'citation_source_ids': ['m1', 'file1'],
        },
      ]);
      api.sources.add({
        'id': 'file1',
        'kind': 'document',
        'filename': 'Piano.pdf',
        'document_version': 2,
      });
      api.milestones.add({
        'id': 'adoption1',
        'anchor': 'm2',
        'kind': 'decision',
        'objectId': 'decision1',
        'label': 'Confermare il calendario',
      });
      api.references['commitment/decision1/1'] = {
        'reference': {'kind': 'commitment', 'id': 'decision1', 'version': 1},
        'title': 'Decisione del gruppo',
        'content': 'Confermare il calendario',
        'sourceIds': ['m1'],
      };
      api.references['source/m1/1'] = {
        'reference': {'kind': 'source', 'id': 'm1', 'version': 1},
        'title': 'Messaggio condiviso',
        'content': 'La scadenza è venerdì',
        'sourceIds': ['m1'],
        'provenance': {'sourceKind': 'message'},
      };
      await open(t, api);
      expect(find.text('Piano.pdf · v2'), findsNothing);
      await t.tap(find.text('2 fonti'));
      await t.pumpAndSettle();
      expect(find.text('Piano.pdf · v2'), findsOneWidget);
      await t.tap(find.widgetWithText(ListTile, 'Matteo'));
      await t.pumpAndSettle();
      await t.tap(find.text('Decisione adottata · Confermare il calendario'));
      await t.pumpAndSettle();
      expect(find.text('Decisione del gruppo'), findsOneWidget);
      await t.tap(find.text('Fonte 1'));
      await t.pumpAndSettle();
      await t.tap(find.text('Vai al messaggio'));
      await t.pumpAndSettle();
      expect(find.text('Laboratorio'), findsOneWidget);
      expect(find.text('La scadenza è venerdì'), findsOneWidget);
      expect(api.submissions, isEmpty);
    },
  );

  testWidgets('a read-only recipient can dismiss their own pending reply', (
    t,
  ) async {
    final api = _TestApi(writable: false)
      ..includeReading = true
      ..requested.add('m1')
      ..rows.add({
        'id': 'm1',
        'author_name': 'Ada',
        'actor_kind': 'human',
        'sequence': 1,
        'content': 'Ti va bene?',
        'created_at': '2026-11-26T12:00:00Z',
      });
    addTearDown(api.close);
    await open(t, api);
    await t.tap(find.byTooltip('Azioni sul messaggio di Ada'));
    await t.pumpAndSettle();
    expect(find.text('Richiedi una risposta'), findsNothing);
    await t.tap(find.text('Già risposto'));
    await t.pumpAndSettle();
    expect(api.submissions.single['command'], {
      'type': 'conversation.answered',
      'messageId': 'm1',
    });
    expect(find.text('Risposta richiesta'), findsNothing);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets(
    'a shared file has one name and suggestions stay grouped while reading',
    (t) async {
      final api = _TestApi(writable: false);
      addTearDown(api.close);
      api.rows.addAll([
        _historyRow(1, 'Matteo', 'Piano.pdf'),
        _historyRow(2, 'Lina', 'La mia nota'),
      ]);
      for (final (index, filename) in [(1, 'Piano.pdf'), (2, 'Nota.pdf')]) {
        api.sources.add({
          'id': 'file$index',
          'kind': 'document',
          'filename': filename,
          'shared_message_id': 'old$index',
          'media_type': 'application/pdf',
          'attachment_position': 0,
        });
        api.recentHandoffs.add({
          'id': 'step$index',
          'sourceMessageId': 'old1',
          'summary': 'Proposta $index',
          'kind': 'calendar.prepare',
          'status': 'navigation',
        });
      }
      await open(t, api);
      expect(find.text('Piano.pdf'), findsOneWidget);
      expect(find.text('La mia nota'), findsOneWidget);
      expect(find.text('Nota.pdf'), findsOneWidget);
      expect(find.text('Proposta 1'), findsNothing);
      await t.tap(find.text('Passi proposti · 2'));
      await t.pumpAndSettle();
      expect(find.text('Proposta 1'), findsOneWidget);
      expect(find.text('Proposta 2'), findsOneWidget);
      await t.tap(find.text('Passi proposti · 2'));
      await t.pumpAndSettle();
      expect(find.text('Proposta 2'), findsNothing);
      expect(api.submissions, isEmpty);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'a reader can retrieve older suggestions for the selected message',
    (t) async {
      final api = _TestApi(writable: false);
      addTearDown(api.close);
      api.rows.add({
        'id': 'm1',
        'author_name': 'Matteo',
        'actor_kind': 'human',
        'sequence': 1,
        'content': 'Prepariamo il lancio',
        'created_at': '2026-11-26T12:00:00Z',
      });
      for (final (id, summary) in [
        ('p1', 'Apri la bozza'),
        ('p2', 'Prepara il calendario'),
      ]) {
        api.handoffHistory.add({
          'id': id,
          'sourceMessageId': 'm1',
          'sourceId': 'm1',
          'kind': 'calendar.prepare',
          'summary': summary,
          'status': 'navigation',
        });
      }
      await open(t, api);
      expect(find.text('Apri la bozza'), findsNothing);
      await t.tap(find.byTooltip('Azioni sul messaggio di Matteo'));
      await t.pumpAndSettle();
      await t.tap(find.text('Passi proposti'));
      await t.pumpAndSettle();
      expect(find.text('Apri la bozza'), findsOneWidget);
      expect(find.text('Prepara il calendario'), findsOneWidget);
      expect(api.submissions, isEmpty);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'only the explicit failed request displays its reason and one manual retry reconciles a lost acknowledgment',
    (tester) async {
      final api = _TestApi();
      addTearDown(api.close);
      for (final (sequence, text) in [
        '@Emme, controlla',
        'Ciao Emme',
        '@Miriam ciao',
      ].indexed) {
        api.rows.add({
          'id': 'm$sequence',
          'author_name': 'Ada',
          'actor_kind': 'human',
          'purpose': 'conversation',
          'content': text,
          'sequence': sequence + 1,
          'created_at': '2026-11-26T12:00:00Z',
        });
        api.readings.add({
          'id': 'r$sequence',
          'source_id': 'm$sequence',
          'status': 'failed',
          'error_code': 'AI_USAGE_LIMIT_REACHED',
          'requestDisplayName': 'Ria',
          'explicitRequest': sequence != 1,
          'otherMemberTarget': sequence == 2,
        });
      }
      await open(tester, api);
      final retry = find.text('Riprova questa richiesta');
      expect(find.textContaining('Ria ha raggiunto il limite'), findsOneWidget);
      expect(retry, findsOneWidget);
      expect(api.submissions, isEmpty);
      api.loseResponse = true;
      await tester.ensureVisible(retry);
      await tester.tap(retry);
      await tester.pumpAndSettle();
      await tester.tap(retry);
      await tester.pumpAndSettle();
      expect(api.submissions, hasLength(1));
      expect(api.submissions.single['command'], {
        'type': 'interpretation.retry',
        'interpretationId': 'r0',
      });
      expect(api.checks, 1);
      expect(retry, findsNothing);
      expect(api.rows, hasLength(3));
      await tester.pumpWidget(const SizedBox());
    },
  );

  for (final commitFirst in [true, false]) {
    testWidgets(
      commitFirst
          ? 'a lost response is reconciled without posting again'
          : 'a lost request retries the exact envelope after navigating away',
      (tester) async {
        final api = _TestApi()
          ..loseResponse = commitFirst
          ..loseRequest = !commitFirst;
        await open(tester, api);
        final input = find.byKey(const Key('workspace-composer'));
        final send = find.byKey(const Key('workspace-send'));
        await tester.enterText(input, 'Verifica campione');
        await tester.pump();
        api.pause = Completer<void>();
        await tester.tap(send);
        await tester.pump();
        await tester.tap(send);
        await tester.pump();
        expect(api.submissions, hasLength(1));
        api.pause!.complete();
        await tester.pumpAndSettle();
        expect(find.text('Verifica e riprova'), findsOneWidget);
        if (!commitFirst) {
          await tester.pumpWidget(const SizedBox());
          await open(tester, api);
        }
        expect(
          tester.widget<TextField>(input).controller!.text,
          'Verifica campione',
        );
        expect(tester.widget<TextField>(input).readOnly, isFalse);
        await tester.tap(find.text('Verifica e riprova'));
        await tester.pumpAndSettle();
        expect(api.rows, hasLength(1));
        expect(api.ids, 1);
        expect(api.checks, 1);
        expect(api.submissions, hasLength(commitFirst ? 1 : 2));
        expect(api.submissions.last, api.submissions.first);
        expect(tester.widget<TextField>(input).controller!.text, isEmpty);
        expect(
          find.descendant(
            of: find.byKey(const Key('workspace-timeline')),
            matching: find.text('Verifica campione'),
          ),
          findsOneWidget,
        );
        await tester.pumpWidget(const SizedBox());
        api.close();
      },
    );
  }
  testWidgets(
    'slash aliases open one collection and analysis prepares an editable draft without sending',
    (tester) async {
      final api = _TestApi();
      addTearDown(api.close);
      await open(tester, api);
      final input = find.byKey(const Key('workspace-composer'));
      for (final alias in ['/file', '/documenti']) {
        await tester.enterText(input, alias);
        await tester.pumpAndSettle();
        expect(find.text('Apri il raccoglitore'), findsOneWidget);
        await tester.tap(find.text('Apri il raccoglitore'));
        await tester.pumpAndSettle();
        expect(find.byType(FileLibrary), findsOneWidget);
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(tester.widget<TextField>(input).controller!.text, isEmpty);
      }
      await tester.enterText(input, 'Confronta le scadenze');
      await tester.tap(find.byTooltip('Azioni dello spazio'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'analizza');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Prepara un’analisi con Emme'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(input).controller!.text,
        '@Emme analizza: Confronta le scadenze',
      );
      expect(api.submissions, isEmpty);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'the selected homonym survives a restart and an interrupted send, and deleting a mention removes the ID',
    (tester) async {
      final members = [
        for (final id in ['luca-uno', 'luca-due'])
          {
            'user_id': id,
            'name': 'Luca Serra',
            'active': true,
            'contributes': true,
          },
        {'user_id': 'uscito', 'name': 'Luca Rossi', 'active': false},
      ];
      final api = _TestApi()..otherMembers.addAll(members);
      addTearDown(api.close);
      final input = find.byKey(const Key('workspace-composer'));
      await open(tester, api);
      await tester.enterText(input, 'Per @Lu');
      await tester.pumpAndSettle();
      expect(find.text('@Luca Rossi'), findsNothing);
      await tester.tap(find.text('@Luca Serra · luca-due@example.test'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(input).controller!.text,
        'Per @Luca Serra ',
      );
      expect(api.submissions, isEmpty);
      await tester.pumpWidget(const SizedBox());
      final restarted = _TestApi(vault: api.store)
        ..otherMembers.addAll(members)
        ..loseRequest = true;
      addTearDown(restarted.close);
      await open(tester, restarted);
      await tester.tap(find.byKey(const Key('workspace-send')));
      await tester.pumpAndSettle();
      expect(restarted.submissions.single['command']['mentionIds'], [
        'luca-due',
      ]);
      await tester.enterText(input, 'Appunto successivo senza destinatari');
      await tester.tap(find.text('Verifica e riprova'));
      await tester.pumpAndSettle();
      expect(restarted.submissions.last, restarted.submissions.first);
      await tester.tap(find.byKey(const Key('workspace-send')));
      await tester.pumpAndSettle();
      expect(restarted.submissions.last['command'], {
        'type': 'message.send',
        'content': 'Appunto successivo senza destinatari',
      });
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'asking about a group message prepares a quoted draft and reuses its reference after a lost response',
    (tester) async {
      final api = _TestApi()
        ..rows.add({
          'id': 'quoted',
          'author_name': 'Matteo',
          'actor_kind': 'human',
          'content': 'Il costo è 470 euro.',
          'sequence': 1,
          'created_at': '2026-11-26T12:00:00Z',
        });
      addTearDown(api.close);
      await open(tester, api);
      await tester.tap(find.byTooltip('Azioni sul messaggio di Matteo'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chiedi a Emme').last);
      await tester.pumpAndSettle();
      expect(api.submissions, isEmpty);
      await tester.enterText(
        find.byKey(const Key('workspace-composer')),
        'Cosa comprende?',
      );
      await tester.pump();
      await tester.pumpWidget(const SizedBox());
      final restarted = _TestApi(vault: _Vault()..items.addAll(api.store.items))
        ..rows.addAll(api.rows)
        ..loseResponse = true;
      addTearDown(restarted.close);
      await open(tester, restarted);
      expect(find.text('Matteo · Il costo è 470 euro.'), findsOneWidget);
      expect(find.byTooltip('Torna al gruppo'), findsOneWidget);
      await tester.tap(find.byKey(const Key('workspace-send')));
      await tester.pumpAndSettle();
      expect(restarted.submissions.single['command'], {
        'type': 'message.send',
        'content': '@Emme Cosa comprende?',
        'quoteMessageId': 'quoted',
        'reference': {'kind': 'source', 'id': 'quoted', 'version': 1},
      });
      await tester.tap(find.text('Verifica e riprova'));
      await tester.pumpAndSettle();
      expect(restarted.submissions, hasLength(1));
      expect(find.byTooltip('Rimuovi citazione'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('reopening the workspace shares an in-flight submission', (
    tester,
  ) async {
    final api = _TestApi();
    await open(tester, api);
    await tester.enterText(
      find.byKey(const Key('workspace-composer')),
      'Messaggio interrotto',
    );
    await tester.pump();
    api.pause = Completer<void>();
    await tester.tap(find.byKey(const Key('workspace-send')));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(
      MaterialApp(
        home: WorkspaceJourney(
          api: api,
          vault: api.store,
          workspaceId: 'work',
          workspaceName: 'Laboratorio',
        ),
      ),
    );
    await tester.pump();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('workspace-composer')))
          .readOnly,
      isFalse,
    );
    api.pause!.complete();
    await tester.pumpAndSettle();
    expect(api.ids, 1);
    expect(api.submissions, hasLength(1));
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('workspace-composer')))
          .controller!
          .text,
      isEmpty,
    );
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
  testWidgets(
    'the composer leaves text full width above portrait and landscape keyboards',
    (tester) async {
      final api = _TestApi();
      api.rows.add({
        'id': 'm1',
        'author_name': 'Ada',
        'actor_kind': 'human',
        'content': 'Messaggio precedente',
        'sequence': 1,
        'created_at': '2026-11-26T12:00:00Z',
      });
      final view = tester.view;
      addTearDown(view.reset);
      view.devicePixelRatio = 1;
      for (final size in [
        const Size(320, 568),
        const Size(390, 844),
        const Size(640, 320),
      ]) {
        final inset = size.height > 600
            ? 310.0
            : size.height > 400
            ? 240.0
            : 130.0;
        view.physicalSize = size;
        view.viewInsets = FakeViewPadding(bottom: inset);
        await open(tester, api);
        final editor = find.byKey(const Key('workspace-composer'));
        await tester.enterText(
          editor,
          'prima riga\nseconda riga\nterza riga\nquarta riga',
        );
        await tester.pump();
        final rect = tester.getRect(editor);
        expect(rect.width, greaterThan(size.width * .72));
        expect(rect.bottom, lessThanOrEqualTo(size.height - inset));
        expect(
          tester.getRect(find.byKey(const Key('workspace-timeline'))).bottom,
          lessThanOrEqualTo(rect.top),
        );
        expect(tester.takeException(), isNull);
      }
      await tester.pumpWidget(const SizedBox());
      api.close();
    },
  );
  for (final committedBeforeRestart in [true, false]) {
    testWidgets(
      'cold restart restores an uncertain send and keeps a later draft (committed=$committedBeforeRestart)',
      (tester) async {
        final original = _TestApi()
          ..loseResponse = committedBeforeRestart
          ..loseRequest = !committedBeforeRestart;
        final field = find.byKey(const Key('workspace-composer'));
        await open(tester, original);
        await tester.enterText(field, 'Messaggio originale.');
        await tester.pump();
        original.pause = Completer<void>();
        await tester.tap(find.byTooltip('Invia'));
        await tester.pump();
        final first = original.submissions.single;
        await tester.enterText(field, 'Prossimo messaggio, ancora privato.');
        await tester.pump();
        original.pause!.complete();
        await tester.pumpAndSettle();
        await tester.pumpWidget(const SizedBox());
        // Both the API session and local storage handle are new. Only persisted
        // bytes and state committed by the simulated server survive the restart.
        final disk = _Vault()..items.addAll(original.store.items);
        final restarted = _TestApi(vault: disk)
          ..receipts.addAll(original.receipts)
          ..rows.addAll(original.rows);
        await open(tester, restarted);
        expect(
          tester.widget<TextField>(field).controller!.text,
          'Prossimo messaggio, ancora privato.',
        );
        expect(restarted.submissions, isEmpty);
        expect(restarted.checks, 0);
        expect(find.text('Verifica e riprova'), findsOneWidget);
        await tester.tap(find.text('Verifica e riprova'));
        await tester.pumpAndSettle();
        expect(restarted.ids, 0);
        expect(restarted.checks, 1);
        expect(
          restarted.submissions,
          committedBeforeRestart ? isEmpty : equals([first]),
        );
        expect(restarted.rows.single['content'], 'Messaggio originale.');
        expect(
          tester.widget<TextField>(field).controller!.text,
          'Prossimo messaggio, ancora privato.',
        );
        await tester.pumpWidget(const SizedBox());
        final again = _TestApi(vault: _Vault()..items.addAll(disk.items));
        await open(tester, again);
        expect(find.text('Verifica e riprova'), findsNothing);
        expect(
          tester.widget<TextField>(field).controller!.text,
          'Prossimo messaggio, ancora privato.',
        );
        await tester.pumpWidget(const SizedBox());
        original.close();
        restarted.close();
        again.close();
      },
    );
  }

  testWidgets(
    'restoring drafts requires the exact origin, actor, workspace and fresh access',
    (tester) async {
      final field = find.byKey(const Key('workspace-composer'));
      final original = _TestApi();
      await open(tester, original);
      await tester.enterText(field, 'Nota riservata');
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      final disk = _Vault()..items.addAll(original.store.items);
      expect(
        disk.items.keys.single,
        matches(RegExp(r'^rimiam\.chat\.v1\.[a-f0-9]{64}$')),
      );
      for (final context in [
        (_TestApi(vault: disk, actor: 'other'), 'work'),
        (_TestApi(vault: disk, origin: 'http://localhost:1234'), 'work'),
        (_TestApi(vault: disk), 'other'),
      ]) {
        await open(tester, context.$1, workspace: context.$2);
        expect(tester.widget<TextField>(field).controller!.text, isEmpty);
        await tester.pumpWidget(const SizedBox());
        context.$1.close();
      }
      final requests = disk.reads;
      final denied = _TestApi(vault: disk)..denied = true;
      await open(tester, denied);
      expect(field, findsNothing);
      expect(disk.reads, requests);
      await tester.pumpWidget(const SizedBox());
      denied.close();
      final readOnly = _TestApi(vault: disk, writable: false);
      await open(tester, readOnly);
      expect(field, findsNothing);
      expect(disk.reads, requests);
      await tester.pumpWidget(const SizedBox());
      readOnly.close();
      final restored = _TestApi(vault: disk);
      await open(tester, restored);
      expect(
        tester.widget<TextField>(field).controller!.text,
        'Nota riservata',
      );
      restored.denied = true;
      await tester.pump(const Duration(seconds: 6));
      await tester.pump();
      expect(field, findsNothing);
      expect(find.text('Nota riservata'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      restored.close();
      original.close();
    },
  );

  testWidgets(
    'a failed secure write prevents network submission and retains the draft',
    (tester) async {
      final api = _TestApi();
      await open(tester, api);
      api.store.failWrites = true;
      await tester.enterText(
        find.byKey(const Key('workspace-composer')),
        'Da proteggere',
      );
      await tester.pumpAndSettle();
      expect(find.text('Riprova salvataggio'), findsOneWidget);
      await tester.tap(find.byTooltip('Invia'));
      await tester.pumpAndSettle();
      expect(api.submissions, isEmpty);
      api.store.failWrites = false;
      await tester.tap(find.text('Verifica e riprova'));
      await tester.pumpAndSettle();
      expect(api.ids, 1);
      expect(api.submissions, hasLength(1));
      expect(api.store.items, isEmpty);
      await tester.pumpWidget(const SizedBox());
      api.close();
    },
  );

  testWidgets('read-only membership has no composer', (tester) async {
    final api = _TestApi(writable: false);
    await open(tester, api);
    expect(find.text('Puoi leggere questa conversazione.'), findsOneWidget);
    expect(find.byKey(const Key('workspace-composer')), findsNothing);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
}
