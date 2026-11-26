import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_tasks.dart';

class _Vault implements DraftVault {
  final data = <String, String>{};
  @override
  Future<String?> read(String k) async => data[k];
  @override
  Future<void> replace(String k, String? s) async {
    if (s == null) {
      data.remove(k);
    } else {
      data[k] = s;
    }
  }
}

Map<String, dynamic> task(
  String id,
  String title, {
  String? person,
  String? responsible,
  String status = 'open',
}) => {
  'id': id,
  'title': title,
  'description': 'Dettagli $title',
  'actor': 'a',
  'version': 2,
  'responsible': responsible,
  'responsibleAvailable': responsible != null,
  'declinedBy': null,
  'suggestedPerson': person,
  'status': status,
  'dueAt': null,
  'createdAt': '2026-11-24T10:00:00Z',
  'timeZone': 'UTC',
  'references': [],
};

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('http://localhost')) {
    actorId = 'a';
  }
  final rows = <Map<String, dynamic>>[
    task('x', 'Coordinate', person: 'a'),
    task('y', 'Fornitore', responsible: 'b'),
  ];
  final sent = <Map<String, dynamic>>[];
  final proposals = <Map<String, dynamic>>[];
  bool denied = false, loseComment = false;
  final receipts = <String, Map<String, dynamic>>{};
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (denied) throw const ApiError(403, 'MEMBERSHIP_REQUIRED');
    final u = Uri.parse(path);
    if (u.path.contains('/receipts/')) return receipts[u.pathSegments.last]!;
    if (u.path.endsWith('/tasks'))
      return {
        'tasks': rows
            .where(
              (r) =>
                  u.queryParameters['focus'] == null ||
                  u.queryParameters['focus'] == r['id'],
            )
            .toList(),
        'proposals': proposals,
        'suggestions': [],
        'members': [
          {'id': 'a', 'name': 'Alice'},
          {'id': 'b', 'name': 'Matteo'},
        ],
        'next': null,
      };
    if (u.path.endsWith('/schedule')) return {'entries': [], 'more': false};
    if (u.path.endsWith('/task-comments') &&
        {'x', 'y'}.contains(u.queryParameters['id']))
      return {
        'comments': [
          {'authorName': 'Matteo', 'body': 'Ultimo commento', 'id': 'c'},
        ],
        'next': null,
      };
    throw StateError(path);
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final c = body['command'] as Map<String, dynamic>;
    final t = rows.where((r) => r['id'] == c['taskId']).firstOrNull;
    sent.add(c);
    if (c['type'] == 'task.accept') {
      t!['responsible'] = actorId;
      t['responsibleAvailable'] = true;
      t['version'] = 3;
    }
    if (c['type'] == 'task.status') {
      t!['status'] = c['status'];
      t['version']++;
    }
    if (c['type'] == 'task.create')
      rows.add({...task('new', c['content']['title']), ...c['content'] as Map});
    final id = body['commandId'] as String;
    final receipt = receipts[id] = {'status': 'committed', 'commandId': id};
    if (c['type'] == 'task.comment' && loseComment) {
      loseComment = false;
      throw const SocketException('Risposta persa');
    }
    return receipt;
  }
}

void main() {
  late _Api api;
  late _Vault vault;
  setUp(() {
    api = _Api();
    vault = _Vault();
  });
  Future<void> page(
    WidgetTester t, {
    bool write = true,
    bool create = false,
  }) async {
    await t.pumpWidget(
      MaterialApp(
        home: WorkspaceTasksPage(
          api: api,
          workspace: 's',
          canWrite: write,
          createOnOpen: create,
          vault: vault,
          timeZone: () async => 'Europe/Rome',
        ),
      ),
    );
    await t.pumpAndSettle();
  }

  Future<void> tap(WidgetTester t, String label) async {
    await t.pump();
    final f = find.text(label);
    await t.ensureVisible(f);
    await t.tap(f);
    await t.pumpAndSettle();
  }

  testWidgets(
    'dalla riga di chat il dettaglio si apre sul compito indicato e Indietro torna alla chat',
    (t) async {
      final id = api.rows.last['id'] as String;
      final title = api.rows.last['title'] as String;
      await t.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (ctx) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.push<void>(
                  ctx,
                  MaterialPageRoute(
                    builder: (_) => WorkspaceTasksPage(
                      api: api,
                      workspace: 's',
                      canWrite: true,
                      vault: vault,
                      initialTaskId: id,
                    ),
                  ),
                ),
                child: const Text('Apri incarico in chat'),
              ),
            ),
          ),
        ),
      );
      await t.tap(find.text('Apri incarico in chat'));
      await t.pumpAndSettle();
      expect(find.text('Attività'), findsOneWidget);
      expect(find.text(title), findsWidgets);
      await t.tap(find.byTooltip('Aggiorna attività'));
      await t.pumpAndSettle();
      expect(find.text(title), findsWidgets);
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
      expect(find.text('Apri incarico in chat'), findsOneWidget);
    },
  );
  testWidgets(
    'la proposta collegata apre solo la revisione indicata, poi segnala quando non è più aperta',
    (t) async {
      for (final id in ['A', 'B']) {
        api.proposals.add({
          'id': id,
          'taskId': 'x',
          'baseVersion': 2,
          'actor': 'a',
          'reason': 'Revisione $id',
          'content': {'title': 'Versione $id', 'description': ''},
        });
      }
      await t.pumpWidget(
        MaterialApp(
          home: WorkspaceTasksPage(
            api: api,
            workspace: 's',
            vault: vault,
            canWrite: false,
            initialTaskId: 'x',
            proposalId: 'A',
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Versione A'), findsOneWidget);
      expect(find.text('Versione B'), findsNothing);
      api.proposals.removeAt(0);
      await t.tap(find.byTooltip('Aggiorna attività'));
      await t.pumpAndSettle();
      expect(find.text('Questa proposta non è più aperta.'), findsOneWidget);
      expect(api.sent, isEmpty);
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'il comando nuova attività apre subito la bozza se il membro può contribuire',
    (t) async {
      await page(t, create: true);
      expect(find.text('Titolo attività'), findsOneWidget);
      expect(api.sent, isEmpty);
    },
  );
  testWidgets(
    'il comando nuova attività lascia il membro in sola lettura sulla lista',
    (t) async {
      await page(t, create: true, write: false);
      expect(find.text('Titolo attività'), findsNothing);
      expect(
        find.text('Puoi consultare le attività di questo spazio.'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'accetta l’offerta personale, mette in pausa, completa e riapre',
    (t) async {
      await page(t);
      await tap(t, 'Coordinate');
      await tap(t, 'Accetta incarico');
      expect(api.sent.single, containsPair('expectedVersion', 2));
      expect(api.sent.single['representSelf'], true);
      await tap(t, 'Metti in pausa');
      await tap(t, 'Completa');
      await tap(t, 'Riapri attività');
      expect(api.sent.skip(1).map((c) => c['status']), [
        'standby',
        'completed',
        'open',
      ]);
      expect(api.sent.last['noNormativeEffect'], true);
    },
  );
  testWidgets(
    'responsabile diverso: commento consentito, stato protetto e revisione solo proposta',
    (t) async {
      await page(t);
      await tap(t, 'Fornitore');
      expect(find.text('Completa'), findsNothing);
      await tap(t, 'Commenti');
      expect(find.text('Ultimo commento'), findsOneWidget);
      await t.enterText(find.byType(TextField), 'Aggiungo la data');
      await tap(t, 'Invia commento');
      expect(api.sent.single, {
        'type': 'task.comment',
        'taskId': 'y',
        'expectedVersion': 2,
        'body': 'Aggiungo la data',
      });
      await tap(t, 'Proponi una modifica');
      final fields = find.byType(TextField);
      await t.enterText(fields.at(0), 'Titolo modificato');
      await t.enterText(fields.at(2), 'Aggiungo una data');
      await tap(t, 'Invia proposta');
      expect(api.sent.last['type'], 'task.propose_revision');
      expect(api.sent.last['content']['references'], isEmpty);
    },
  );
  testWidgets(
    'verifica manuale della ricevuta svuota il commento già pubblicato',
    (t) async {
      await page(t);
      await tap(t, 'Fornitore');
      await tap(t, 'Commenti');
      await t.enterText(find.byType(TextField), 'Conferma una volta');
      api.loseComment = true;
      await tap(t, 'Invia commento');
      expect(find.text('Salvataggio da verificare'), findsOneWidget);
      await tap(t, 'Verifica e riprova');
      expect(find.text('Salvataggio da verificare'), findsNothing);
      await tap(t, 'Commenti');
      expect(
        t.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      expect(api.sent, hasLength(1));
    },
  );
  testWidgets(
    'crea un’attività senza assegnare implicitamente la responsabilità a Matteo',
    (t) async {
      await page(t);
      await tap(t, 'Nuova attività');
      await t.enterText(find.byType(TextField).first, 'Controllo preventivo');
      await tap(t, 'Nessuno');
      await tap(t, 'Matteo');
      await tap(t, 'Crea attività');
      expect(api.sent.single['type'], 'task.create');
      expect(api.sent.single['content']['suggestedPerson'], 'b');
      expect(api.sent.single['content']['timeZone'], 'Europe/Rome');
      expect(find.text('Controllo preventivo'), findsOneWidget);
    },
  );
  testWidgets('accesso di lettura, poi revoca del gruppo', (t) async {
    await page(t, write: false);
    expect(find.text('Nuova attività'), findsNothing);
    await tap(t, 'Coordinate');
    expect(find.text('Accetta incarico'), findsNothing);
    await tap(t, 'Commenti');
    expect(find.text('Ultimo commento'), findsOneWidget);
    expect(find.text('Invia commento'), findsNothing);
    api.denied = true;
    await t.tap(find.byTooltip('Aggiorna attività'));
    await t.pumpAndSettle();
    expect(find.text('Coordinate'), findsNothing);
    expect(find.text('Ultimo commento'), findsNothing);
    expect(api.sent, isEmpty);
  });
}
