import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/agenda.dart';
import '../lib/agenda_commands.dart';
import '../lib/api.dart';
import '../lib/chat_journal.dart';

class _Vault implements DraftVault {
  final values = <String, String>{};
  @override
  Future<String?> read(String k) async => values[k];
  @override
  Future<void> replace(String k, String? v) async {
    if (v == null) {
      values.remove(k);
    } else {
      values[k] = v;
    }
  }
}

final now = DateTime(2026, 11, 26, 10),
    start = DateTime(2026, 11, 26, 11),
    end = DateTime(2026, 11, 26, 12);
Future<String> zone() async => 'Europe/Rome';

class _Api extends RimiamApi {
  _Api(String actor) : super(Uri.parse('http://localhost')) {
    actorId = actor;
  }
  final rows = <AgendaJson>[],
      offers = <AgendaJson>[],
      previous = <AgendaJson>[],
      sent = <AgendaJson>[],
      urls = <String>[];
  final receipts = <String, AgendaJson>{};
  int checks = 0, ids = 0;
  bool lost = false, forbidden = false;
  List<AgendaJson> rooms = [
    {'id': 'space', 'name': 'Lancio'},
  ];
  @override
  String newId() => 'cmd-${++ids}';
  @override
  Future<AgendaJson> get(String path) async {
    urls.add(path);
    if (forbidden) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (path.startsWith('/api/v1/agenda?'))
      return {
        'items': rows,
        'previous': previous,
        'offers': offers,
        'before': '2026-11-26T00:00:00Z',
      };
    if (path == '/api/v1/workspaces') return {'workspaces': rooms};
    if (path.contains('/agenda/destination'))
      return {
        'contextRevision': 5,
        'members': [
          {'id': 'alice', 'name': 'Alice'},
          {'id': 'bob', 'name': 'Matteo'},
        ],
      };
    if (path.contains('/receipts/')) {
      checks++;
      return receipts[path.split('/').last] ??
          (throw const ApiError(404, 'RECEIPT_NOT_FOUND'));
    }
    if (path.contains('/calendar?'))
      return {'workspaceId': 'space', 'temporal': []};
    throw StateError(path);
  }

  @override
  Future<AgendaJson> post(String path, AgendaJson input) async {
    expect(input['expectedActorId'], actorId);
    if (path == '/api/v1/personal-space') return {'id': 'private-$actorId'};
    expect(path.endsWith('/commands'), true);
    final id = input['commandId'] as String, c = input['command'] as AgendaJson;
    sent.add({'path': path, ...input});
    final receipt = receipts[id] = {'commandId': id, 'status': 'committed'};
    if (c['type'] == 'followup.create') {
      rows.add(
        item(id, c['content'] as String, private: path.contains('private-')),
      );
    }
    if (lost) {
      lost = false;
      throw const SocketException('Conferma persa');
    }
    return receipt;
  }
}

AgendaJson item(
  String id,
  String title, {
  bool private = true,
  String kind = 'reminder',
  String owner = 'alice',
  String? rsvp,
}) => {
  'id': id,
  'kind': kind,
  'personal': private,
  'workspaceId': private ? 'private-alice' : 'space',
  'workspaceName': private ? 'Area personale' : 'Lancio',
  'version': 1,
  'title': title,
  'at': start.toUtc().toIso8601String(),
  'until': kind == 'event' ? end.toUtc().toIso8601String() : null,
  'owner': owner,
  'recurring': false,
  'rsvp': rsvp,
};
void main() {
  late _Api api;
  late _Vault vault;
  setUp(() {
    api = _Api('alice');
    vault = _Vault();
  });
  test('costruisce i contratti reali per giorni scelti, fine inclusiva e modifica solo occorrenza/successive', () {
    final f = AgendaForm(
      kind: AgendaAction.reminder,
      start: start,
      end: end,
      title: 'Da verificare',
      repeat: 'weekly',
      weekdays: {5, 1},
      until: DateTime(2026, 12, 10),
    );
    AgendaJson command(AgendaForm form) =>
        form.command(zone: 'Europe/Rome', revision: 6, now: now);
    expect(command(f)['recurrence'], {
      'weekdays': [1, 5],
      'until': '2026-12-10',
    });
    expect(command(f)['timeZone'], 'Europe/Rome');
    f.weekdays.clear();
    expect(() => command(f), throwsFormatException);
    f.repeat = 'daily';
    expect(command(f)['recurrence']['weekdays'], [1, 2, 3, 4, 5, 6, 7]);
    final edit = AgendaForm(
      kind: AgendaAction.reminder,
      start: start,
      end: end,
      title: 'Solo questa',
      item: {...item('r', 'Ricorrente'), 'recurring': true},
    );
    expect(command(edit)['action'], 'replace');
    edit.following = true;
    expect(command(edit)['action'], 'replace_following');
    expect(command(edit)['scheduledAt'], start.toUtc().toIso8601String());
  });
  test('evento privato, inviti nominali e revisione che conserva i destinatari originali', () {
    AgendaJson command(AgendaForm form) =>
        form.command(zone: 'Europe/Rome', revision: 8, now: now);
    final f = AgendaForm(
      kind: AgendaAction.appointment,
      start: start,
      end: end,
      title: 'Punto',
    );
    expect(command(f)['audience'], {'kind': 'calendar'});
    f.target = 'space';
    f.audience = 'people';
    expect(() => command(f), throwsFormatException);
    f.people = {'bob'};
    expect(command(f)['audience'], {
      'kind': 'people',
      'people': ['bob'],
    });
    expect(command(f)['expectedContextRevision'], 8);
    final edit = AgendaForm(
      kind: AgendaAction.appointment,
      start: start,
      end: end,
      item: {
        ...item('e', 'Riunione', kind: 'event'),
        'eventZone': 'Asia/Tokyo',
      },
      title: 'Nuovo titolo',
      target: 'space',
      audience: 'people',
      people: {'bob'},
    );
    expect(command(edit).containsKey('audience'), false);
    expect(command(edit)['payload']['timeZone'], 'Asia/Tokyo');
    edit.audienceEdited = true;
    edit.audience = 'all';
    expect(command(edit)['audience'], {'kind': 'all'});
    edit.end = edit.start;
    expect(() => command(edit), throwsFormatException);
  });
  test('ripristina la bozza e la stessa operazione dopo un’interruzione e azzera entrambe con la ricevuta', () async {
    final journal = AgendaCommands(api, vault),
        f = AgendaForm(
          kind: AgendaAction.reminder,
          start: start,
          end: end,
          title: 'Conferma',
        );
    await journal.saveDraft(f);
    final c = f.command(zone: 'UTC', revision: 4, now: now);
    api.lost = true;
    await expectLater(
      journal.send('space', c, fromEditor: true, allowed: () => true),
      throwsA(isA<SocketException>()),
    );
    final recovered = AgendaCommands(api, vault);
    await recovered.load();
    expect(recovered.pending, isNotNull);
    expect(recovered.draft?['title'], 'Conferma');
    final other = AgendaCommands(_Api('bob'), vault);
    await other.load();
    expect(other.draft, isNull);
    expect(other.pending, isNull);
    await recovered.send('space', c, fromEditor: true, allowed: () => true);
    expect(api.sent.length, 1);
    expect(api.checks, 1);
    final fresh = AgendaCommands(api, vault);
    await fresh.load();
    expect(fresh.draft, isNull);
    expect(fresh.pending, isNull);
  });
  test(
    'la rinuncia esplicita a una verifica incerta agisce solo sul dispositivo',
    () async {
      final journal = AgendaCommands(api, vault);
      final f = AgendaForm(
        kind: AgendaAction.reminder,
        title: 'Una volta',
        start: start,
        end: end,
      );
      await journal.saveDraft(f);
      api.lost = true;
      await expectLater(
        journal.send(
          'space',
          f.command(zone: 'UTC', revision: 2, now: now),
          fromEditor: true,
          allowed: () => true,
        ),
        throwsA(isA<SocketException>()),
      );
      await journal.stopVerification();
      await journal.load();
      expect(journal.pending, isNull);
      expect(journal.draft, isNull);
      expect(api.sent, hasLength(1));
      expect(api.checks, 0);
    },
  );
  Future<void> page(WidgetTester t, {AgendaAction? initial}) async {
    await t.pumpWidget(
      MaterialApp(
        home: AgendaPage(
          api: api,
          vault: vault,
          timeZone: zone,
          now: () => now,
          initialAction: initial,
        ),
      ),
    );
    await t.pumpAndSettle();
  }

  Future<void> close(WidgetTester t) async {
    await t.pumpWidget(const SizedBox());
    await t.pump();
  }

  testWidgets(
    'scorciatoia promemoria libera, Solo io predefinito, bozza dopo chiusura e invio unico',
    (t) async {
      await page(t, initial: AgendaAction.reminder);
      expect(find.text('Solo io'), findsOneWidget);
      await t.enterText(find.byType(TextField), 'Controllare il preventivo');
      await t.pump();
      await t.tap(find.text('Chiudi'));
      await t.pumpAndSettle();
      await t.tap(find.text('Riprendi bozza'));
      await t.pumpAndSettle();
      expect(find.text('Controllare il preventivo'), findsOneWidget);
      await t.ensureVisible(find.text('Crea promemoria'));
      await t.tap(find.text('Crea promemoria'));
      await t.pumpAndSettle();
      expect(
        api.sent.single['path'],
        '/api/v1/workspaces/private-alice/commands',
      );
      expect(find.text('Controllare il preventivo'), findsOneWidget);
      await close(t);
    },
  );
  testWidgets(
    'azioni di un invitato e nascondi personale usano id, istante e versione corretti',
    (t) async {
      api.rows.addAll([
        item(
          'event',
          'Riunione',
          private: false,
          kind: 'event',
          owner: 'bob',
          rsvp: 'pending',
        ),
        item('weekly', 'Avviso', private: false, owner: 'bob'),
      ]);
      await page(t);
      await t.tap(find.text('Riunione'));
      await t.pumpAndSettle();
      await t.tap(find.text('Accetta'));
      await t.pumpAndSettle();
      expect(api.sent.single['command'], {
        'type': 'temporal.respond',
        'eventId': 'event',
        'expectedVersion': 1,
        'response': 'accepted',
      });
      await t.tap(find.text('Avviso'));
      await t.pumpAndSettle();
      await t.ensureVisible(find.text('Nascondi per me'));
      expect(find.text('Chiudi per tutti'), findsNothing);
      await t.tap(find.text('Nascondi per me'));
      await t.pumpAndSettle();
      expect(api.sent.last['command'], {
        'type': 'followup.occurrence',
        'followupId': 'weekly',
        'expectedVersion': 1,
        'scheduledAt': start.toUtc().toIso8601String(),
        'action': 'hide',
      });
      await close(t);
    },
  );
  testWidgets(
    'archivia insieme le scadenze precedenti della serie senza toccare quella di oggi',
    (t) async {
      api.previous.add({...item('serie', 'Revisione'), 'count': 4});
      api.rows.add(item('serie', 'Revisione di oggi'));
      await page(t);
      expect(find.text('4 scadenze'), findsNothing);
      await t.tap(find.text('Promemoria precedenti'));
      await t.pumpAndSettle();
      await t.ensureVisible(find.text('Archivia precedenti'));
      await t.tap(find.text('Archivia precedenti'));
      await t.pumpAndSettle();
      expect(api.sent.single['command'], {
        'type': 'followup.previous',
        'followupId': 'serie',
        'before': '2026-11-26T00:00:00Z',
        'timeZone': 'Europe/Rome',
        'action': 'archive',
      });
      expect(find.text('Revisione di oggi'), findsOneWidget);
      await close(t);
    },
  );
  testWidgets(
    'Home nasconde e ricorda Oggi, mostra le origini e instrada ogni scorciatoia',
    (t) async {
      final opens = <AgendaAction?>[];
      api.rows.addAll([
        item('r', 'Foto da scegliere'),
        item(
          'e',
          'Incontro gruppo',
          kind: 'event',
          private: false,
          rsvp: 'pending',
        ),
      ]);
      Future<void> show() async {
        await t.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: HomeAgendaPreview(
                api: api,
                vault: vault,
                timeZone: zone,
                now: () => now,
                open: (a) async {
                  opens.add(a);
                },
              ),
            ),
          ),
        );
        await t.pumpAndSettle();
      }

      await show();
      expect(find.text('Lancio · Da confermare'), findsOneWidget);
      await t.tap(find.byTooltip('Nascondi Oggi'));
      await t.pumpAndSettle();
      expect(find.text('Incontro gruppo'), findsNothing);
      await close(t);
      await show();
      expect(find.text('Incontro gruppo'), findsNothing);
      await t.tap(find.byTooltip('Mostra Oggi'));
      await t.pumpAndSettle();
      for (final name in [
        'Oggi',
        'Calendario',
        'Nuovo promemoria',
        'Nuovo appuntamento',
      ]) {
        await t.tap(find.text(name));
        await t.pumpAndSettle();
      }
      expect(opens, [
        null,
        null,
        AgendaAction.reminder,
        AgendaAction.appointment,
      ]);
      expect(
        api.urls.where((p) => p.contains('zone=Europe%2FRome')),
        isNotEmpty,
      );
      await close(t);
    },
  );
  testWidgets(
    'accesso revocato nasconde i titoli personali e impedisce la mutazione',
    (t) async {
      api.rows.add(item('r', 'Materiale privato'));
      await page(t);
      expect(find.text('Materiale privato'), findsOneWidget);
      api.forbidden = true;
      await t.tap(find.byTooltip('Aggiorna agenda'));
      await t.pumpAndSettle();
      expect(find.text('Materiale privato'), findsNothing);
      expect(find.text('Nuovo promemoria'), findsNothing);
      expect(api.sent, isEmpty);
      await close(t);
    },
  );
}
