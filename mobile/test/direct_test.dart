import 'dart:io';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/direct_contacts.dart';
import '../lib/direct_conversation.dart';

class _Vault implements DraftVault {
  final records = <String, String>{};
  int reads = 0;
  @override
  Future<String?> read(String key) async {
    reads++;
    return records[key];
  }

  @override
  Future<void> replace(String key, String? value) async {
    if (value == null) {
      records.remove(key);
    } else {
      records[key] = value;
    }
  }
}

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('http://localhost')) {
    actorId = 'ada';
  }
  static const chat = '00000000-0000-4000-a000-000000000001';
  static String messageId(int index) =>
      '00000000-0000-4000-b000-${index.toString().padLeft(12, '0')}';
  final rows = <Map<String, dynamic>>[],
      posts = <Map<String, dynamic>>[],
      recaps = <Map<String, dynamic>>[];
  final unread = <String>{};
  bool ownConsent = false,
      peerConsent = false,
      loseBefore = false,
      loseAfter = false,
      wrongActor = false,
      atBottom = false,
      recapProcessing = false;
  int consentVersion = 0, cursor = 0;
  String? anchor;
  Map<String, dynamic> message(int i) => {
    'id': messageId(i),
    'authorId': 'matteo',
    'name': 'Matteo',
    'text': 'Revisione $i',
    'sentAt': '2026-11-26T12:00:00Z',
    'quoteId': null,
    'files': [],
  };
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (path == '/api/v1/assistant-settings') {
      return {
        'connections': [
          {
            'id': 'default',
            'label': 'Predefinito',
            'revision': 'a' * 64,
            'configured': false,
          },
        ],
      };
    }
    if (path.startsWith('/api/v1/contacts?')) {
      return {
        'contacts': [
          {'id': 'matteo', 'name': 'Matteo', 'nameAmbiguous': false},
          {'id': 'amb', 'name': 'Paolo', 'nameAmbiguous': true},
        ],
        'nextOffset': null,
      };
    }
    expect(path, '/api/v1/direct-chats/$chat');
    return {
      'id': chat,
      'me': wrongActor ? 'another' : actorId,
      'peer': {'id': 'matteo', 'name': 'Matteo', 'photoVersion': null},
      'consent': ownConsent,
      'peerConsent': peerConsent,
      'consentVersion': consentVersion,
      'messages': [...rows],
      'reading': {
        'anchorId': anchor,
        'anchorAtBottom': atBottom,
        'cursorVersion': cursor,
        'unreadIds': [...unread],
      },
      'recaps': [...recaps],
    };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    posts.add(body);
    if (path == '/api/v1/direct-chats') {
      expect(body, {'expectedActorId': 'ada', 'contactId': 'matteo'});
      return {'id': chat};
    }
    expect(path, '/api/v1/direct-chats/$chat');
    expect(body['expectedActorId'], actorId);
    switch (body['type']) {
      case 'read':
        unread.removeAll(body['seen'] as List);
        if (body['anchor'] != null) {
          anchor = body['anchor']['id'];
          atBottom = body['anchor']['atBottom'];
          cursor++;
        }
        return {'cursorVersion': cursor};
      case 'send':
        if (loseBefore) {
          loseBefore = false;
          throw const SocketException('Richiesta persa');
        }
        if (!rows.any((m) => m['id'] == body['id'])) {
          rows.add({
            ...message(1),
            'id': body['id'],
            'authorId': actorId,
            'name': 'Ada',
            'text': body['text'],
            'quoteId': body['quoteId'],
          });
        }
        if (loseAfter) {
          loseAfter = false;
          throw const SocketException('Risposta persa');
        }
        return {'messageId': body['id']};
      case 'consent':
        expect(body['expectedVersion'], consentVersion);
        ownConsent = body['enabled'] as bool;
        return {'consentVersion': ++consentVersion};
      case 'recap':
        expect(ownConsent && peerConsent, isTrue);
        if (recapProcessing)
          throw const ApiError(409, 'DIRECT_RECAP_ATTEMPT_EXISTS');
        recaps.add({
          'id': body['id'],
          'text': 'Risultato privato di test',
          'createdAt': '2026-11-26T12:03:00Z',
          'sourceIds': [rows.first['id']],
        });
        return {'recapId': body['id']};
      default:
        throw StateError('Comando inatteso');
    }
  }
}

void main() {
  Future<void> open(
    WidgetTester t,
    _Api api,
    _Vault vault, {
    bool contacts = false,
  }) async {
    await t.pumpWidget(
      MaterialApp(
        home: contacts
            ? DirectContacts(api: api, vault: vault)
            : DirectConversation(
                api: api,
                id: _Api.chat,
                name: 'Matteo',
                vault: vault,
              ),
      ),
    );
    await t.pumpAndSettle();
  }

  testWidgets(
    'a space started from a direct chat selects the actual peer and keeps direct history separate',
    (t) async {
      final api = _Api()..rows.add(_Api().message(1)), vault = _Vault();
      await open(t, api, vault, contacts: true);
      await t.tap(find.text('Matteo'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Altre azioni'));
      await t.pumpAndSettle();
      await t.tap(find.text('Crea uno spazio con Matteo'));
      await t.pumpAndSettle();
      expect(find.byTooltip('Rimuovi Matteo'), findsOneWidget);
      expect(find.text('Revisione 1'), findsNothing);
      final saved = jsonDecode(
        vault.records.entries
            .singleWhere((e) => e.key.startsWith('rimiam.create.'))
            .value,
      );
      expect(saved['recipients'], [
        {'contactId': 'matteo', 'label': 'Matteo'},
      ]);
      expect(saved['description'], '');
      expect(saved['files'], isEmpty);
      await t.pageBack();
      await t.pumpAndSettle();
      expect(find.text('Revisione 1'), findsOneWidget);
      expect(api.posts.where((b) => b.containsKey('invitations')), isEmpty);
    },
  );

  testWidgets(
    'contact to direct chat, quote, slash text and @Emme remain private human messages',
    (t) async {
      final api = _Api();
      api.rows.add(api.message(1));
      final vault = _Vault();
      await open(t, api, vault, contacts: true);
      expect(
        t.widget<ListTile>(find.widgetWithText(ListTile, 'Paolo')).onTap,
        isNull,
      );
      await t.tap(find.text('Matteo'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Rispondi a Matteo'));
      await t.pumpAndSettle();
      final input = find.byKey(const Key('direct-composer'));
      await t.enterText(input, '/task @Emme');
      await t.pump();
      expect(
        find.textContaining('Il messaggio arriva a Matteo.'),
        findsOneWidget,
      );
      await t.tap(find.byTooltip('Invia a Matteo'));
      await t.pumpAndSettle();
      final msg = api.posts.singleWhere((r) => r['type'] == 'send');
      expect(msg['quoteId'], api.rows.first['id']);
      expect(msg['text'], '/task @Emme');
      expect(api.posts.any((m) => m['type'] == 'recap'), isFalse);
      expect(t.widget<TextField>(input).controller!.text, isEmpty);
      await t.tap(find.widgetWithText(TextButton, 'Matteo · Revisione 1'));
      await t.pumpAndSettle();
      expect(find.text('Revisione 1'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );
  testWidgets(
    'only on-screen unread messages are marked and resume opens the stored anchor',
    (t) async {
      final api = _Api();
      for (var i = 0; i < 90; i++) {
        api.rows.add(api.message(i));
        api.unread.add(_Api.messageId(i));
      }
      api.anchor = _Api.messageId(40);
      await open(t, api, _Vault());
      expect(find.text('Revisione 40'), findsOneWidget);
      expect(api.unread, isNot(contains(_Api.messageId(40))));
      expect(api.unread, contains(_Api.messageId(0)));
      expect(api.unread, contains(_Api.messageId(89)));
      await t.drag(find.byType(CustomScrollView), const Offset(0, -350));
      await t.pumpAndSettle();
      expect(
        api.posts.any((m) => m['type'] == 'read' && m['anchor'] != null),
        isTrue,
      );
      await t.tap(find.text('Vai in fondo'));
      await t.pumpAndSettle();
      expect(find.text('Revisione 89'), findsOneWidget);
      expect(api.unread, contains(_Api.messageId(20)));
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );
  testWidgets(
    'returning to a direct chat restores the old last exchange even after new messages arrive',
    (t) async {
      final api = _Api();
      for (int i = 0; i < 90; i++) {
        api.rows.add(api.message(i));
        api.unread.add(_Api.messageId(i));
      }
      api.anchor = _Api.messageId(40);
      api.atBottom = true;
      await open(t, api, _Vault());
      final timeline = t.getRect(find.byType(CustomScrollView));
      expect(t.getRect(find.text('Revisione 40')).overlaps(timeline), isTrue);
      expect(api.unread, containsAll([_Api.messageId(70), _Api.messageId(89)]));
      await t.tap(find.text('Vai in fondo'));
      await t.pumpAndSettle();
      expect(api.anchor, _Api.messageId(89));
      expect(api.atBottom, isTrue);
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );
  testWidgets(
    'the full conversation recap needs both consents and stays in its private view',
    (t) async {
      final api = _Api();
      api.rows.add(api.message(1));
      await open(t, api, _Vault());
      await t.tap(find.byTooltip('Riepilogo personale'));
      await t.pumpAndSettle();
      final run = find.widgetWithText(FilledButton, 'Riassumi per me');
      expect(t.widget<FilledButton>(run).onPressed, isNull);
      await t.tap(find.byType(Switch));
      await t.pumpAndSettle();
      expect(api.ownConsent, isTrue);
      expect(t.widget<FilledButton>(run).onPressed, isNull);
      api.peerConsent = true;
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      await t.tap(run);
      await t.pumpAndSettle();
      expect(find.text('Risultato privato di test'), findsOneWidget);
      expect(api.rows, hasLength(1));
      await t.tap(find.byType(Switch));
      await t.pumpAndSettle();
      expect(api.ownConsent, isFalse);
      expect(t.widget<FilledButton>(run).onPressed, isNull);
      await t.tap(find.text('Messaggi originali'));
      await t.pumpAndSettle();
      await t.tap(find.text('Revisione 1'));
      await t.pumpAndSettle();
      expect(find.text('Risultato privato di test'), findsNothing);
      expect(find.byKey(const Key('direct-composer')), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );
  testWidgets(
    'an unresolved private recap keeps its id after restart and never starts a second calculation while checking',
    (t) async {
      final api = _Api()
        ..ownConsent = true
        ..peerConsent = true
        ..recapProcessing = true;
      api.rows.add(api.message(1));
      final vault = _Vault();
      await open(t, api, vault);
      await t.tap(find.byTooltip('Riepilogo personale'));
      await t.pumpAndSettle();
      await t.tap(find.text('Riassumi per me'));
      await t.pumpAndSettle();
      List<Map<String, dynamic>> attempts() =>
          api.posts.where((op) => op['type'] == 'recap').toList();
      final id = attempts().single['id'];
      expect(find.text('Verifica richiesta'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      await open(t, api, vault);
      await t.tap(find.byTooltip('Riepilogo personale'));
      await t.pumpAndSettle();
      expect(attempts(), hasLength(1));
      await t.tap(find.text('Verifica richiesta'));
      await t.pumpAndSettle();
      expect(attempts().map((a) => a['id']).toList(), [id, id]);
      await t.tap(find.text('Chiudi tentativo'));
      await t.pumpAndSettle();
      await t.tap(find.text('Continua ad attendere'));
      await t.pumpAndSettle();
      api.recaps.add({
        'id': id,
        'text': 'Risultato recuperato',
        'sourceIds': [api.rows.first['id']],
      });
      await t.pump(const Duration(seconds: 7));
      await t.pumpAndSettle();
      expect(find.text('Risultato recuperato'), findsOneWidget);
      expect(find.text('Verifica richiesta'), findsNothing);
      expect(attempts(), hasLength(2));
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );
  for (final committed in [true, false]) {
    testWidgets(
      'direct drafts and quoted retry survive a cold start; committed=$committed',
      (t) async {
        final api = _Api();
        api.rows.add(api.message(7));
        final vault = _Vault();
        await open(t, api, vault);
        await t.tap(find.byTooltip('Rispondi a Matteo'));
        final input = find.byKey(const Key('direct-composer'));
        await t.enterText(input, 'Testo iniziale');
        await t.pump();
        api.loseAfter = committed;
        api.loseBefore = !committed;
        await t.tap(find.byTooltip('Invia a Matteo'));
        await t.pumpAndSettle();
        final original = api.posts.singleWhere((p) => p['type'] == 'send');
        await t.enterText(input, 'Bozza successiva');
        await t.pumpAndSettle();
        await t.pumpWidget(const SizedBox());
        final next = _Api()..rows.addAll(api.rows);
        final disk = _Vault()..records.addAll(vault.records);
        await open(t, next, disk);
        expect(t.widget<TextField>(input).controller!.text, 'Bozza successiva');
        expect(next.posts.where((c) => c['type'] == 'send'), isEmpty);
        expect(disk.records.keys.single, startsWith('rimiam.direct.v1.'));
        await t.tap(find.text('Verifica e riprova'));
        await t.pumpAndSettle();
        final sent = next.posts.where((c) => c['type'] == 'send');
        expect(sent, committed ? isEmpty : equals([original]));
        expect(
          next.rows.where((r) => r['text'] == 'Testo iniziale'),
          hasLength(1),
        );
        expect(t.widget<TextField>(input).controller!.text, 'Bozza successiva');
        await t.pumpWidget(const SizedBox());
        api.close();
        next.close();
      },
    );
  }
  testWidgets('a mismatched participant cannot open stored drafts or send', (
    t,
  ) async {
    final api = _Api()..wrongActor = true;
    final vault = _Vault();
    await open(t, api, vault);
    expect(vault.reads, 0);
    expect(find.byKey(const Key('direct-composer')), findsNothing);
    expect(api.posts, isEmpty);
    await t.pumpWidget(const SizedBox());
    api.close();
  });
  testWidgets(
    'a quoted direct message stays above the keyboard in portrait and landscape',
    (tester) async {
      final api = _Api();
      api.rows.add(api.message(1));
      final store = _Vault();
      final device = tester.view;
      addTearDown(device.reset);
      device.devicePixelRatio = 1;
      for (final size in [const Size(390, 844), const Size(640, 320)]) {
        device.physicalSize = size;
        final keyboard = size.height > 400 ? 310.0 : 130.0;
        device.viewInsets = FakeViewPadding(bottom: keyboard);
        await open(tester, api, store);
        final input = find.byKey(const Key('direct-composer'));
        if (find.byTooltip('Rimuovi citazione').evaluate().isEmpty) {
          await tester.tap(find.byTooltip('Rispondi a Matteo'));
        }
        await tester.enterText(input, '/test prima riga\nseconda riga');
        await tester.pumpAndSettle();
        expect(
          tester.getRect(input).bottom,
          lessThanOrEqualTo(size.height - keyboard),
        );
        expect(tester.getRect(input).width, greaterThan(size.width * .72));
        expect(tester.takeException(), isNull);
      }
      await tester.pumpWidget(const SizedBox());
      api.close();
    },
  );
  test('the old workspace journal payload is recovered only for that workspace', () async {
    final vault = _Vault(), api = _Api();
    final group = ChatJournal(
      vault: vault,
      origin: api.origin,
      actor: api.actorId,
      workspace: _Api.chat,
    );
    final direct = ChatJournal(
      vault: vault,
      origin: api.origin,
      actor: api.actorId,
      workspace: _Api.chat,
      direct: true,
    );
    const previousKey =
        'rimiam.chat.v1.b29f813875cab2483d72f684acc9a5880d6e629de8430b980c0950b87df82f1d';
    vault.records[previousKey] = jsonEncode({
      'v': 1,
      'revision': 2,
      'text': 'Bozza del gruppo',
      'pending': {
        'id': _Api.messageId(3),
        'content': 'Bozza del gruppo',
        'draftRevision': 2,
      },
    });
    await group.open();
    await direct.open();
    expect(group.key, previousKey);
    expect(group.text, 'Bozza del gruppo');
    expect(group.pending!.id, _Api.messageId(3));
    expect(group.pending!.quoteId, isNull);
    expect(direct.text, isEmpty);
    expect(direct.pending, isNull);
    api.close();
  });
}
