import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_chat_action_line.dart';

class _Vault implements DraftVault {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> replace(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('http://localhost')) {
    actorId = 'member';
  }
  final calls = <Map<String, dynamic>>[];
  final receipts = <String, Map<String, dynamic>>{};
  String? lastPath;
  bool lose = false;
  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    lastPath = path;
    calls.add(body);
    final receipt = {
      'commandId': body['commandId'],
      'status': 'committed',
      'result': <String, dynamic>{},
    };
    receipts[body['commandId']] = receipt;
    if (lose) {
      lose = false;
      throw const SocketException('lost response');
    }
    return receipt;
  }

  @override
  Future<Map<String, dynamic>> get(String path) async {
    final receipt = receipts[path.split('/').last];
    if (receipt != null) return receipt;
    throw const ApiError(404, 'RECEIPT_NOT_FOUND');
  }
}

void main() {
  late _Api api;
  late _Vault vault;
  late int refreshes;
  final offer = {
    'taskId': 't',
    'version': 2,
    'title': 'Oggi',
    'description': 'Invia',
    'due': null,
    'person': 'member',
    'personName': 'Matteo',
    'acceptedBy': null,
    'status': 'pending',
  };
  final reminder = {
    'audience': 'personal',
    'content': 'Piano di prova',
    'day': '2026-12-01',
    'zone': 'Europe/Rome',
    'destination': 'private',
    'id': 'f',
    'at': '2026-12-01T14:00:00Z',
    'version': 3,
    'closed': false,
    'recurring': true,
  };
  setUp(() {
    api = _Api();
    vault = _Vault();
    refreshes = 0;
  });
  tearDown(() => api.close());
  Widget row({
    Map<String, dynamic>? t,
    Map<String, dynamic>? r,
    String author = 'member',
    bool write = true,
  }) => MaterialApp(
    home: Scaffold(
      body: ListView(
        children: [
          WorkspaceChatActionLine(
            api: api,
            workspace: 'space',
            messageId: 'm',
            authorId: author,
            canWrite: write,
            taskOffer: t,
            reminder: r,
            refresh: () async {
              refreshes++;
            },
            vault: vault,
            timeZone: () async => 'Europe/Rome',
          ),
        ],
      ),
    ),
  );
  Future<void> open(WidgetTester w, Widget page, String label) async {
    await w.pumpWidget(page);
    await w.tap(find.textContaining(label));
    await w.pumpAndSettle();
  }

  testWidgets(
    'il solo destinatario decide per la versione ricevuta e recupera la risposta persa',
    (w) async {
      await open(w, row(t: offer), 'Oggi ·');
      expect(find.text('Invia'), findsOneWidget);
      api.lose = true;
      await w.tap(find.text('Accetta'));
      await w.pumpAndSettle();
      expect(api.calls.single['expectedActorId'], 'member');
      expect(api.calls.single['command'], {
        'type': 'task.accept',
        'taskId': 't',
        'expectedVersion': 2,
        'reason': 'Accettazione personale dalla conversazione',
        'representSelf': true,
      });
      expect(find.text('Verifica invio'), findsOneWidget);
      await w.pumpWidget(const SizedBox());
      await w.pump();
      await open(
        w,
        row(t: {...offer, 'status': 'accepted', 'acceptedBy': 'Matteo'}),
        'Oggi · Matteo ha accettato',
      );
      await w.tap(find.text('Verifica invio'));
      await w.pumpAndSettle();
      expect(api.calls, hasLength(1));
      expect(refreshes, 1);
      expect(find.text('Accetta'), findsNothing);
    },
  );
  testWidgets(
    'gli altri membri vedono lo stato e non possono rispondere per la persona indicata',
    (w) async {
      await open(w, row(t: {...offer, 'person': 'other'}), 'Oggi ·');
      expect(find.text('Accetta'), findsNothing);
      expect(find.text('Rifiuta'), findsNothing);
      await w.pumpWidget(row(t: offer, write: false));
      await w.pump();
      expect(find.text('Accetta'), findsNothing);
      await w.pumpWidget(row(t: offer));
      await w.pump();
      await w.tap(find.text('Rifiuta'));
      await w.pumpAndSettle();
      expect(api.calls.single['command'], {
        'type': 'task.decline',
        'taskId': 't',
        'expectedVersion': 2,
        'reason': 'Proposta rifiutata dalla conversazione',
      });
    },
  );
  testWidgets(
    'il promemoria privato dell’autore aggiorna una sola scadenza sullo spazio personale',
    (w) async {
      await w.pumpWidget(row(r: reminder, author: 'other'));
      expect(find.textContaining('Promemoria'), findsNothing);
      await open(w, row(r: reminder), 'Promemoria ·');
      await w.tap(find.text('Modifica promemoria'));
      await w.pumpAndSettle();
      expect(
        w.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        false,
      );
      await w.enterText(find.byType(TextField), 'Nuovo testo');
      await w.tap(find.text('Salva'));
      await w.pumpAndSettle();
      expect(api.lastPath, '/api/v1/workspaces/private/commands');
      final c = api.calls.single['command'];
      expect(c['type'], 'followup.occurrence');
      expect(c['action'], 'replace');
      expect(c['expectedVersion'], 3);
      expect(c['scheduledAt'], reminder['at']);
      expect(c['replacement']['content'], 'Nuovo testo');
      expect(c['replacement']['timeZone'], 'Europe/Rome');
    },
  );
  testWidgets('una modifica concorrente richiede di riaprire la conferma', (
    w,
  ) async {
    await open(w, row(r: reminder), 'Promemoria ·');
    await w.tap(find.text('Modifica promemoria'));
    await w.pumpAndSettle();
    await w.pumpWidget(row(r: {...reminder, 'version': 4}));
    await w.pump();
    await w.tap(find.text('Salva'));
    await w.pumpAndSettle();
    expect(api.calls, isEmpty);
    expect(
      find.text('Il promemoria è cambiato. Riapri la conferma.'),
      findsOneWidget,
    );
  });
  testWidgets(
    'la modifica della serie è esplicita e una richiesta incompleta richiede l’orario',
    (w) async {
      await open(
        w,
        row(r: {...reminder, 'audience': 'space', 'destination': 'space'}),
        'Promemoria ·',
      );
      await w.tap(find.text('Modifica promemoria'));
      await w.pumpAndSettle();
      await w.tap(find.byType(SwitchListTile));
      await w.pumpAndSettle();
      await w.tap(find.text('Salva'));
      await w.pumpAndSettle();
      expect(api.calls.single['command']['action'], 'replace_following');
      await w.pumpWidget(const SizedBox());
      await w.pump();
      await open(
        w,
        row(
          r: {
            ...reminder,
            'id': null,
            'version': null,
            'at': null,
            'destination': null,
          },
        ),
        'A che ora?',
      );
      await w.tap(find.text('Imposta orario'));
      await w.pumpAndSettle();
      expect(
        w
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Salva'))
            .onPressed,
        isNull,
      );
      await w.tap(find.byIcon(Icons.schedule));
      await w.pumpAndSettle();
      await w.tap(find.text('OK'));
      await w.pumpAndSettle();
      await w.tap(find.text('Salva'));
      await w.pumpAndSettle();
      expect(api.lastPath, '/api/v1/workspaces/space/commands');
      expect(api.calls.last['command']['type'], 'reminder.set_time');
      expect(api.calls.last['command']['messageId'], 'm');
    },
  );
}
