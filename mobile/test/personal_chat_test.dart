import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/personal_chat.dart';

typedef _Map = Map<String, dynamic>;

class _Vault implements DraftVault {
  final values = <String, String>{};
  int reads = 0;
  @override
  Future<String?> read(String key) async {
    reads++;
    return values[key];
  }

  @override
  Future<void> replace(String k, String? v) async {
    if (v == null) {
      values.remove(k);
    } else {
      values[k] = v;
    }
  }
}

class _Server {
  final active = <String, String>{}, owners = <String, String>{};
  final messages = <String, List<_Map>>{},
      turns = <String, List<_Map>>{},
      readings = <String, List<_Map>>{};
  final selected = <String, _Map>{}, receipts = <String, _Map>{};
  int snapshotReads = 0, lightweightChecks = 0;
  final inspected = <String>[];
  final files = <String, List<_Map>>{}, documentOrigins = <String>[];
  int ids = 0, sends = 0, asks = 0, receiptReads = 0, newCalls = 0, retries = 0;
  bool loseSend = false, loseNew = false, loseAsk = false, denied = false;
}

class _Api extends RimiamApi {
  _Api(this.db, String who) : super(Uri.parse('http://localhost')) {
    actorId = who;
  }
  final _Server db;
  @override
  String newId() => 'id-${++db.ids}';
  String get initial => 'initial-$actorId';
  void check(String thread) {
    if (db.owners[thread] != actorId || db.denied)
      throw const ApiError(404, 'PERSONAL_CHAT_UNAVAILABLE');
  }

  @override
  Future<_Map> get(String path) async {
    final uri = Uri.parse(path);
    if (uri.path.endsWith('/personal-chats')) {
      final thread = uri.queryParameters['thread'];
      if (thread == null) {
        return {
          'threads': [
            for (final e in db.owners.entries)
              if (e.value == actorId)
                {
                  'id': e.key,
                  'label': 'Conversazione ${e.key}',
                  'at': '2026-11-26T10:00:00Z',
                },
          ],
          'more': false,
        };
      }
      check(thread);
      return {
        'archive': initial,
        'selection':
            db.selected[thread] ?? {'id': null, 'label': null, 'version': 0},
        'targets': [
          {'id': 'area', 'name': 'Spazio di prova', 'contributes': true},
        ],
        'turns': db.turns[thread] ?? <_Map>[],
        'research': [],
      };
    }
    final thread = uri.pathSegments[3];
    if (thread == 'area') {
      if (uri.path.endsWith('/reference')) {
        db.inspected.add(uri.query);
        expect(uri.queryParameters, {
          'kind': 'source',
          'id': 'original',
          'version': '1',
        });
        return {
          'reference': {'kind': 'source', 'id': 'original', 'version': 1},
          'title': 'Fonte verificata',
          'content': 'Prima consegna venerdì',
          'provenance': {'sourceKind': 'message'},
        };
      }
      if (uri.path.endsWith('/workspace'))
        return {
          'workspace': {'id': thread, 'name': 'Spazio di prova', 'revision': 1},
          'members': [
            {'user_id': actorId, 'active': true, 'contributes': false},
          ],
          'messages': [
            {
              'id': 'original',
              'author_name': 'Giulia',
              'actor_kind': 'human',
              'sequence': 1,
              'created_at': '2026-11-26T12:00:00Z',
              'content': 'Prima consegna venerdì',
            },
          ],
        };
      throw StateError(path);
    }
    check(thread);
    if (uri.path.endsWith('/source-file')) {
      final f = db.files[thread]!.singleWhere(
        (f) => f['id'] == uri.queryParameters['id'],
      );
      return {
        'filename': f['filename'],
        'mediaType': 'text/plain',
        'bytes': 3,
        'preview': {'kind': 'text', 'text': 'Solo qui'},
      };
    }
    final revision =
        (db.messages[thread]?.length ?? 0) +
        (db.selected[thread]?['version'] as int? ?? 0);
    if (path.contains('/changes?')) {
      db.lightweightChecks++;
      return {'headRevision': revision};
    }
    if (path.endsWith('/workspace')) {
      db.snapshotReads++;
      return {
        'workspace': {'id': thread, 'personal': true, 'revision': revision},
        'messages': db.messages[thread] ?? <_Map>[],
        'members': [
          {'user_id': actorId, 'active': true, 'contributes': true},
        ],
        'interpretations': db.readings[thread] ?? <_Map>[],
        'sources': db.files[thread] ?? <_Map>[],
      };
    }
    if (path.contains('/receipts/')) {
      db.receiptReads++;
      return db.receipts['$thread/${uri.pathSegments.last}'] ??
          (throw const ApiError(404, 'RECEIPT_NOT_FOUND'));
    }
    throw StateError(path);
  }

  @override
  Future<_Map> post(String path, _Map input) async {
    expect(input['expectedActorId'], actorId);
    if (path.endsWith('/personal-chats')) {
      final action = input['action'];
      final thread =
          (input['thread'] ?? db.active[actorId] ?? initial) as String;
      if (action == 'open' || action == 'new') {
        if (db.owners[thread] == null &&
            (action == 'new' || thread == initial)) {
          db.owners[thread] = actorId;
        }
        check(thread);
        db.active[actorId] = thread;
        if (action == 'new') {
          db.newCalls++;
          if (db.loseNew) {
            db.loseNew = false;
            throw const SocketException('risposta interrotta');
          }
        }
        return {'id': thread};
      }
      check(thread);
      if (action == 'select') {
        db.selected[thread] = {
          'id': input['target'],
          'label': input['target'] == null ? null : 'Spazio di prova',
          'version': (input['expectedVersion'] as int) + 1,
        };
        return {};
      }
      expect(action, 'ask');
      expect(input['expectedVersion'], db.selected[thread]!['version']);
      expect(input['target'], db.selected[thread]!['id']);
      db.asks++;
      final existing = db.turns[thread]
          ?.where((t) => t['id'] == input['id'])
          .firstOrNull;
      if (existing != null) {
        expect(input['question'], existing['question']);
        existing['status'] = 'pending';
        return {};
      }
      final m = _add(thread, input['question'] as String);
      (db.turns[thread] ??= []).add({
        'id': input['id'],
        'target': input['target'],
        'selectionVersion': input['expectedVersion'],
        'question': input['question'],
        'messageId': m['id'],
        'status': 'pending',
        'answer': null,
        'references': <_Map>[],
      });
      if (db.loseAsk) {
        db.loseAsk = false;
        throw const SocketException('risposta interrotta');
      }
      return {};
    }
    final thread = Uri.parse(path).pathSegments[3];
    if (path.endsWith('/consultation')) {
      if (thread != 'area') check(thread);
      db.documentOrigins.add(thread);
      return {
        'id': input['id'],
        'kind': 'document',
        'documentWorkspaceId': initial,
        'documentSourceId': 'source-personale',
        'documentFilename': 'Verbale.md',
        'answer': 'Verbale privato',
      };
    }
    check(thread);
    final id = input['commandId'];
    final command = input['command'] as _Map;
    if (command['type'] == 'interpretation.retry') {
      db.retries++;
      db.readings[thread]!.single['status'] = 'queued';
    } else {
      expect(command['type'], 'message.send');
      db.sends++;
      if (!db.receipts.containsKey('$thread/$id')) {
        final m = _add(thread, command['content'] as String);
        (db.readings[thread] ??= []).add({
          'id': 'work-$id',
          'source_id': m['id'],
          'status': 'queued',
          'explicitRequest': null,
        });
      }
    }
    final receipt = db.receipts['$thread/$id'] = {
      'commandId': id,
      'status': 'committed',
    };
    if (db.loseSend) {
      db.loseSend = false;
      throw const SocketException('risposta interrotta');
    }
    return receipt;
  }

  _Map _add(String thread, String text) {
    final rows = db.messages[thread] ??= [];
    final m = {
      'id': 'message-${rows.length}',
      'sequence': rows.length + 1,
      'purpose': 'conversation',
      'actor_kind': 'human',
      'content': text,
      'author_name': 'Utente sintetico',
    };
    rows.add(m);
    return m;
  }
}

void main() {
  late _Server db;
  late _Vault vault;
  late _Api api;
  setUp(() {
    db = _Server();
    vault = _Vault();
    api = _Api(db, 'alice');
  });
  Future<void> show(WidgetTester t, [_Api? a]) async {
    await t.pumpWidget(
      MaterialApp(
        home: PersonalChatPage(api: a ?? api, vault: vault),
      ),
    );
    await t.pumpAndSettle();
  }

  Future<void> close(WidgetTester t) async {
    await t.pumpWidget(const SizedBox());
    await t.pump();
  }

  Future<void> send(WidgetTester t, String text) async {
    await t.enterText(find.byType(TextField), text);
    await t.pump();
    await t.tap(find.byTooltip('Invia'));
    await t.pumpAndSettle();
  }

  testWidgets(
    'allegato personale visibile una sola volta, anteprima e azioni tornano alla stessa chat e conservano la bozza',
    (t) async {
      final m = api._add(api.initial, 'verbale.txt');
      m['reference'] = {'kind': 'source', 'id': 'file-originale', 'version': 1};
      db.files[api.initial] = [
        {
          'id': 'file-originale',
          'filename': 'verbale.txt',
          'media_type': 'text/plain',
          'shared_message_id': m['id'],
        },
      ];
      await show(t);
      await t.enterText(find.byType(TextField), 'Da finire');
      await t.pump();
      expect(find.text('verbale.txt'), findsOneWidget);
      await t.tap(find.text('verbale.txt'));
      await t.pumpAndSettle();
      expect(find.text('Solo qui'), findsOneWidget);
      await t.tap(find.text('Vai al messaggio'));
      await t.pumpAndSettle();
      expect(find.text('Da finire'), findsOneWidget);
      await t.tap(find.byTooltip('Allega file'));
      await t.pumpAndSettle();
      expect(
        find.text('Il file sarà visibile solo a te nella chat personale.'),
        findsOneWidget,
      );
      await t.pageBack();
      await t.pumpAndSettle();
      expect(find.text('Da finire'), findsOneWidget);
      expect(db.sends, 0);
      await close(t);
    },
  );
  for (final selected in [false, true]) {
    testWidgets(
      'documento personale usa la conversazione esplicita e l’archivio privato; selezione=$selected',
      (t) async {
        if (selected)
          db.selected[api.initial] = {
            'id': 'area',
            'label': 'Spazio di prova',
            'version': 1,
          };
        await show(t);
        await t.tap(find.byTooltip('Prepara documento'));
        await t.pumpAndSettle();
        await t.enterText(find.byType(TextField), 'Prepara il verbale');
        await t.pump();
        await t.tap(find.text('Prepara anteprima'));
        await t.pumpAndSettle();
        expect(db.documentOrigins, [selected ? 'area' : api.initial]);
        expect(
          find.text('Salvato in Documenti personali · Solo tu'),
          findsOneWidget,
        );
        expect(find.text('Apri Documenti personali'), findsOneWidget);
        await t.pageBack();
        await t.pumpAndSettle();
        expect(db.sends, 0);
        await close(t);
      },
    );
  }
  testWidgets(
    'riprende ultima, nuova ripetibile, elenco e bozza dopo riapertura',
    (t) async {
      await show(t);
      await t.enterText(find.byType(TextField), 'Bozza di Alice');
      await t.pump();
      db.loseNew = true;
      await t.tap(find.byTooltip('Nuova conversazione'));
      await t.pumpAndSettle();
      await t.tap(find.text('Riprova'));
      await t.pumpAndSettle();
      expect(db.newCalls, 2);
      expect(db.owners.length, 2);
      expect(find.text('Bozza di Alice'), findsNothing);
      await t.tap(find.byTooltip('Conversazioni precedenti'));
      await t.pumpAndSettle();
      await t.tap(find.text('Conversazione initial-alice'));
      await t.pumpAndSettle();
      expect(find.text('Bozza di Alice'), findsOneWidget);
      await close(t);
      await show(t, _Api(db, 'alice'));
      expect(find.text('Bozza di Alice'), findsOneWidget);
      expect(db.sends, 0);
      await close(t);
    },
  );
  testWidgets(
    'la chat inattiva controlla la revisione prima di scaricare lo storico',
    (t) async {
      await show(t);
      final reads = db.snapshotReads;
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      expect(db.lightweightChecks, 1);
      expect(db.snapshotReads, reads);
      await send(t, 'Un nuovo messaggio');
      expect(db.snapshotReads, reads + 1);
      await close(t);
    },
  );
  testWidgets(
    'smarrimento della ricevuta, riavvio e verifica mantengono una sola domanda',
    (t) async {
      await show(t);
      db.loseSend = true;
      await send(t, 'Prima domanda');
      expect(db.sends, 1);
      expect(find.text('Verifica invio'), findsOneWidget);
      await close(t);
      await show(t, _Api(db, 'alice'));
      await t.tap(find.text('Verifica invio'));
      await t.pumpAndSettle();
      expect(db.receiptReads, 1);
      expect(db.sends, 1);
      expect(
        db.messages['initial-alice']!.single['content'],
        '@Emme Prima domanda',
      );
      expect(find.text('In attesa della risposta'), findsOneWidget);
      await close(t);
    },
  );
  testWidgets('revoca e cambio account nascondono messaggi e bozze', (t) async {
    await show(t);
    await send(t, 'materiale personale');
    await t.enterText(find.byType(TextField), 'solo Alice');
    await t.pump();
    db.denied = true;
    await t.pump(const Duration(seconds: 7));
    await t.pumpAndSettle();
    expect(find.text('solo Alice'), findsNothing);
    expect(find.text('@Emme materiale personale'), findsNothing);
    final before = vault.reads;
    await close(t);
    await show(t, _Api(db, 'alice'));
    expect(vault.reads, before);
    db.denied = false;
    await close(t);
    await show(t, _Api(db, 'bob'));
    expect(find.text('solo Alice'), findsNothing);
    await t.tap(find.byTooltip('Conversazioni precedenti'));
    await t.pumpAndSettle();
    expect(find.text('Conversazione initial-alice'), findsNothing);
    await close(t);
  });
  testWidgets(
    'stati dal server, errore, retry manuale e risposta realmente pubblicata',
    (t) async {
      await show(t);
      await send(t, '@Emme domanda');
      final r = db.readings['initial-alice']!.single;
      Future<void> refresh() async {
        await t.pump(const Duration(seconds: 7));
        await t.pumpAndSettle();
      }

      r['status'] = 'running';
      await refresh();
      expect(find.text('Emme sta rispondendo…'), findsOneWidget);
      r['status'] = 'failed';
      r['error_code'] = 'AI_USAGE_LIMIT_REACHED';
      await refresh();
      expect(find.textContaining('Limite di utilizzo'), findsOneWidget);
      await t.tap(find.text('Riprova questa richiesta'));
      await t.pumpAndSettle();
      expect(db.retries, 1);
      expect(db.sends, 1);
      db.messages['initial-alice']!.add({
        'id': 'reply',
        'sequence': 2,
        'purpose': 'conversation',
        'actor_kind': 'miriam',
        'author_name': 'Emme',
        'content': 'Una risposta privata',
        'reply_to_source_id': 'message-0',
      });
      await refresh();
      expect(find.text('Una risposta privata'), findsOneWidget);
      expect(find.text('In attesa della risposta'), findsNothing);
      await close(t);
    },
  );
  testWidgets(
    'consultazione privata vincolata allo spazio con verifica del turno dopo riavvio',
    (t) async {
      await show(t);
      await t.tap(find.text('Consulta uno spazio'));
      await t.pumpAndSettle();
      await t.tap(find.text('Spazio di prova'));
      await t.pumpAndSettle();
      expect(find.text('Spazio di prova · Termina'), findsOneWidget);
      db.loseAsk = true;
      await send(t, 'Qual è il contesto?');
      await close(t);
      await show(t, _Api(db, 'alice'));
      await t.tap(find.text('Verifica invio'));
      await t.pumpAndSettle();
      expect(db.asks, 1);
      expect(db.sends, 0);
      expect(find.text('Consultazione in corso…'), findsOneWidget);
      final turn = db.turns['initial-alice']!.single;
      turn['status'] = 'ready';
      turn['answer'] = 'Contesto personale verificato';
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      expect(find.text('Contesto personale verificato'), findsOneWidget);
      await t.tap(find.text('Spazio di prova · Termina'));
      await t.pumpAndSettle();
      expect(find.text('Consulta uno spazio'), findsOneWidget);
      await close(t);
    },
  );
  Future<_Map> consultation(WidgetTester t) async {
    await show(t);
    await t.tap(find.text('Consulta uno spazio'));
    await t.pumpAndSettle();
    await t.tap(find.text('Spazio di prova'));
    await t.pumpAndSettle();
    await send(t, 'Quale consegna?');
    final turn = db.turns['initial-alice']!.single;
    turn['answer'] = 'Venerdì, secondo Giulia.';
    turn['status'] = 'ready';
    turn['references'] = [
      {
        'kind': 'source',
        'id': 'original',
        'version': 1,
        'label': 'Messaggio di Giulia',
      },
    ];
    await t.pump(const Duration(seconds: 7));
    await t.pumpAndSettle();
    return turn;
  }

  testWidgets(
    'fonte della consultazione conclusa, originale e ritorno alla risposta privata',
    (t) async {
      await consultation(t);
      await t.tap(find.text('Spazio di prova · Termina'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), 'La mia bozza');
      await t.pump();
      await t.tap(find.text('Messaggio di Giulia'));
      await t.pumpAndSettle();
      expect(find.text('Fonte verificata'), findsOneWidget);
      expect(db.inspected, hasLength(1));
      await t.tap(find.text('Vai al messaggio'));
      await t.pumpAndSettle();
      expect(find.text('Prima consegna venerdì'), findsOneWidget);
      expect(find.text('Venerdì, secondo Giulia.'), findsNothing);
      await t.pageBack();
      await t.pumpAndSettle();
      expect(find.text('Venerdì, secondo Giulia.'), findsOneWidget);
      expect(find.text('La mia bozza'), findsOneWidget);
      expect(db.asks, 1);
      expect(db.sends, 0);
      await close(t);
    },
  );
  testWidgets(
    'revoca del turno oscura anche la fonte aperta; un collegamento scaduto non legge il gruppo',
    (t) async {
      final turn = await consultation(t);
      final refs = turn['references'];
      await t.tap(find.text('Messaggio di Giulia'));
      await t.pumpAndSettle();
      expect(find.text('Fonte verificata'), findsOneWidget);
      turn['status'] = 'unavailable';
      turn['references'] = [];
      turn['answer'] = null;
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      expect(find.text('Fonte verificata'), findsNothing);
      expect(
        find.text('La conversazione di origine non è accessibile.'),
        findsOneWidget,
      );
      expect(find.text('Venerdì, secondo Giulia.'), findsNothing);
      expect(db.inspected, hasLength(1));
      turn['status'] = 'ready';
      turn['answer'] = 'Venerdì, secondo Giulia.';
      turn['references'] = refs;
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      turn['status'] = 'unavailable';
      turn['references'] = [];
      await t.tap(find.text('Messaggio di Giulia'));
      await t.pumpAndSettle();
      expect(find.text('Fonte verificata'), findsNothing);
      expect(db.inspected, hasLength(1));
      await close(t);
    },
  );
  testWidgets(
    'riprova la stessa consultazione solo quando la selezione coincide',
    (t) async {
      final turn = await consultation(t);
      turn['status'] = 'failed';
      turn['answer'] = null;
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      await t.tap(find.text('Riprova consultazione'));
      await t.pumpAndSettle();
      expect(db.asks, 2);
      expect(db.turns['initial-alice'], hasLength(1));
      expect(db.messages['initial-alice'], hasLength(1));
      await t.tap(find.text('Spazio di prova · Termina'));
      await t.pumpAndSettle();
      expect(find.text('Riprova consultazione'), findsNothing);
      expect(db.sends, 0);
      await close(t);
    },
  );
  testWidgets(
    'più fonti si espandono nella risposta privata e spariscono con la revoca',
    (t) async {
      final turn = await consultation(t);
      (turn['references'] as List).add({
        'kind': 'source',
        'id': 'second',
        'version': 1,
        'label': 'Nota di Matteo',
      });
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      expect(find.text('Messaggio di Giulia'), findsNothing);
      await t.tap(find.text('2 fonti'));
      await t.pumpAndSettle();
      expect(find.text('Nota di Matteo'), findsOneWidget);
      expect(find.text('Messaggio di Giulia'), findsOneWidget);
      turn['status'] = 'unavailable';
      turn['references'] = [];
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      expect(find.text('Nota di Matteo'), findsNothing);
      expect(find.text('2 fonti'), findsNothing);
      expect(db.inspected, isEmpty);
      await close(t);
    },
  );
}
