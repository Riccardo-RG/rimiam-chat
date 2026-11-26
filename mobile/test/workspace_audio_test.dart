import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/attachment_staging.dart';
import '../lib/call_device.dart';
import '../lib/call_session.dart';
import '../lib/chat_journal.dart';
import '../lib/voice_device.dart';
import '../lib/workspace_call.dart';
import '../lib/workspace_voice.dart';

class _Memory implements DraftVault {
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

class _Media implements HumanAudio {
  @override
  Future<void> speaker(bool enabled) async {}
  bool hot = false, disposed = false;
  final mic = <bool>[];
  void Function()? lost;
  @override
  Future<void> connect(String url, String token, void Function() lost) async {
    this.lost = lost;
  }

  @override
  void microphone(bool enabled) {
    hot = enabled;
    mic.add(enabled);
  }

  @override
  Future<void> close() async {
    hot = false;
    disposed = true;
  }
}

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('https://synthetic.test')) {
    actorId = 'anna';
  }
  bool configured = true,
      waiting = false,
      participant = false,
      consented = false,
      asked = false;
  bool lose = false, wrongGrant = false, denyView = false;
  int grants = 0;
  Completer<void>? secondGrant;
  final commands = <Map<String, dynamic>>[],
      receipts = <String, Map<String, dynamic>>{};
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (denyView) throw const ApiError(403, 'MEMBERSHIP_REQUIRED');
    if (path.endsWith('/calls'))
      return {
        'configured': configured,
        'recordingConfigured': true,
        'consentText': consentWordings.first,
        'calls': [
          if (participant)
            {
              'id': 'call',
              'state': 'open',
              'epoch': 3,
              'recordingRequested': asked,
              'errorCode': null,
              'participants': [
                {
                  'id': 'part',
                  'name': 'Anna',
                  'userId': 'anna',
                  'state': waiting ? 'waiting' : 'admitted',
                  'consented': consented,
                },
              ],
              'recordings': [],
              'events': [],
            },
        ],
      };
    if (path.endsWith('/voice'))
      return {'transcriptionConfigured': false, 'messages': []};
    final r = receipts[path.split('/').last];
    if (r == null) throw const ApiError(404, 'RECEIPT_NOT_FOUND');
    return r;
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    if (path.endsWith('/call-connect')) {
      grants++;
      if (grants == 2) await secondGrant?.future;
      return {
        'callId': 'call',
        'participantId': wrongGrant ? 'other' : 'part',
        'url': 'wss://audio.example.test',
        'token': 'synthetic',
      };
    }
    final c = body['command'] as Map<String, dynamic>;
    commands.add(c);
    switch (c['type']) {
      case 'call.join':
        participant = true;
      case 'call.leave' || 'call.recording.withdraw':
        participant = false;
        consented = false;
      case 'call.recording.request':
        asked = true;
      case 'call.recording.consent':
        consented = true;
    }
    final r = receipts[body['commandId']] = {
      'commandId': body['commandId'],
      'status': 'committed',
      'result': c['type'] == 'call.join'
          ? {'callId': 'call', 'participantId': 'part'}
          : <String, dynamic>{},
    };
    if (lose &&
        c['type'] != 'call.leave' &&
        c['type'] != 'call.recording.withdraw') {
      lose = false;
      throw const SocketException('Conferma persa');
    }
    return r;
  }
}

class _Capture implements VoiceCapture {
  int starts = 0;
  bool recording = false;
  final XFile file;
  _Capture(this.file);
  @override
  Future<bool> permission() async => true;
  @override
  Future<void> start() async {
    starts++;
    recording = true;
  }

  @override
  Future<XFile?> stop() async {
    recording = false;
    return file;
  }

  @override
  Future<void> clear() async {
    recording = false;
  }

  @override
  Future<void> dispose() async {
    recording = false;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _Api api;
  late _Memory vault;
  late _Media media;
  late HumanCallSession session;
  setUp(() {
    api = _Api();
    vault = _Memory();
    media = _Media();
    session = HumanCallSession(
      api,
      'w',
      vault,
      permission: () async => true,
      makeAudio: () => media,
    );
  });
  tearDown(() {
    session.dispose();
    api.close();
  });
  test('attende ammissione e seconda autorizzazione, poi silenzia subito al ritiro anche con richiesta precedente incerta', () async {
    api.waiting = true;
    await session.initialize();
    await session.join();
    expect(api.grants, 0);
    expect(media.hot, isFalse);
    api.waiting = false;
    api.secondGrant = Completer();
    final refresh = session.refresh();
    while (api.grants < 2) {
      await Future<void>.delayed(Duration.zero);
    }
    expect(media.hot, isFalse);
    api.secondGrant!.complete();
    await refresh;
    expect(media.hot, isTrue);
    expect(api.commands.map((c) => c['type']), ['call.join']);
    api.lose = true;
    await session.command({'type': 'call.recording.request', 'callId': 'call'});
    expect(session.actions.pending, isNotNull);
    final exiting = session.leave(withdraw: true);
    expect(media.hot, isFalse);
    await exiting;
    expect(api.commands.last['type'], 'call.recording.withdraw');
    expect(media.disposed, isTrue);
    await session.recover(false);
    expect(
      api.commands.where((c) => c['type'] == 'call.recording.request'),
      hasLength(1),
    );
    expect(session.actions.pending, isNull);
  });
  test(
    'destinatario del grant errato o view revocata esclude il microfono',
    () async {
      api.wrongGrant = true;
      await session.initialize();
      await session.join();
      expect(media.hot, isFalse);
      expect(api.commands.last['type'], 'call.leave');
      api.wrongGrant = false;
      await Future<void>.delayed(Duration.zero);
      await session.refresh();
      await session.join();
      expect(media.hot, isTrue);
      api.denyView = true;
      await session.refresh();
      expect(media.hot, isFalse);
      expect(session.connected, isFalse);
    },
  );
  test('interruzione o background durante il grant impedisce la riapertura tardiva', () async {
    api.secondGrant = Completer();
    await session.initialize();
    final joining = session.join();
    while (api.grants < 2) {
      await Future<void>.delayed(Duration.zero);
    }
    session.background();
    expect(media.hot, isFalse);
    api.secondGrant!.complete();
    await joining;
    expect(media.hot, isFalse);
    expect(session.wanted, isFalse);
  });
  test(
    'alla riconnessione il microfono si scollega senza rientro implicito',
    () async {
      await session.initialize();
      await session.join();
      expect(media.hot, isTrue);
      media.lost!();
      expect(media.hot, isFalse);
      await Future<void>.delayed(Duration.zero);
      await session.refresh();
      expect(api.commands.where((c) => c['type'] == 'call.join'), hasLength(1));
    },
  );
  testWidgets(
    'installazione priva di chiamate spiega il motivo senza chiedere il microfono',
    (t) async {
      api.configured = false;
      var prompts = 0;
      await t.pumpWidget(
        MaterialApp(
          home: WorkspaceCallPage(
            api: api,
            workspace: 'w',
            vault: vault,
            permission: () async {
              prompts++;
              return true;
            },
          ),
        ),
      );
      await t.pumpAndSettle();
      await t.tap(find.text('Entra in chiamata'));
      await t.pumpAndSettle();
      expect(find.text('Chiamata non disponibile'), findsOneWidget);
      expect(prompts, 0);
      expect(api.commands, isEmpty);
    },
  );
  testWidgets(
    'chiedere la registrazione non acconsente: conferma personale revocabile e vincolata all’epoca visualizzata',
    (t) async {
      await t.pumpWidget(
        MaterialApp(
          home: WorkspaceCallPage(
            api: api,
            workspace: 'w',
            vault: vault,
            permission: () async => true,
            audio: () => media,
          ),
        ),
      );
      await t.pumpAndSettle();
      await t.tap(find.text('Entra in chiamata'));
      await t.pumpAndSettle();
      await t.tap(find.text('Chiedi di registrare'));
      await t.pumpAndSettle();
      expect(api.consented, false);
      await t.ensureVisible(find.text('Consenso alla registrazione'));
      expect(
        t
            .widget<TextButton>(
              find.widgetWithText(TextButton, 'Consenso alla registrazione'),
            )
            .onPressed,
        isNotNull,
      );
      await t.tap(find.text('Consenso alla registrazione'));
      await t.pumpAndSettle();
      expect(
        find.text(consentWordings.first),
        findsOneWidget,
        reason: t
            .widgetList<Text>(find.byType(Text))
            .map((w) => w.data)
            .toList()
            .toString(),
      );
      await t.tap(find.text('Annulla'));
      await t.pumpAndSettle();
      expect(api.consented, false);
      await t.ensureVisible(find.text('Consenso alla registrazione'));
      expect(
        t
            .widget<TextButton>(
              find.widgetWithText(TextButton, 'Consenso alla registrazione'),
            )
            .onPressed,
        isNotNull,
      );
      await t.tap(find.text('Consenso alla registrazione'));
      await t.pumpAndSettle();
      await t.tap(find.text('Acconsento'));
      await t.pumpAndSettle();
      expect(api.commands.last, {
        'type': 'call.recording.consent',
        'callId': 'call',
        'epoch': 3,
        'consentText': consentWordings.first,
      });
      expect(api.commands.any((c) => c['type'] == 'call.analyze'), false);
      await t.tap(find.text('Ritira consenso e scollega audio'));
      await t.pumpAndSettle();
      expect(media.hot, false);
    },
  );
  testWidgets(
    'vocale esplicito, bozza cifrata riapribile e risposta persa recuperata senza un secondo invio',
    (t) async {
      final dir = Directory.systemTemp.createTempSync('rimiam-voice-test-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final bytes = Uint8List.fromList([
        0,
        0,
        0,
        24,
        102,
        116,
        121,
        112,
        ...List.generate(64, (i) => i),
      ]);
      final capture = _Capture(
        XFile.fromData(bytes, name: 'Vocale.m4a', path: 'Vocale.m4a'),
      );
      final stage = AttachmentStaging(scope: 'a/w', root: () async => dir);
      Widget page() => MaterialApp(
        home: WorkspaceVoicePage(
          api: api,
          workspace: 'w',
          vault: vault,
          staging: stage,
          capture: capture,
        ),
      );
      await t.pumpWidget(page());
      await t.pumpAndSettle();
      FilledButton button(String text) =>
          t.widget<FilledButton>(find.widgetWithText(FilledButton, text));
      Future<void> pressAndWait(String label, String expected) async {
        var finished = false;
        await t.runAsync(() async {
          unawaited(
            (button(label).onPressed! as Future<void> Function())()
                .whenComplete(() => finished = true),
          );
        });
        for (var attempt = 0; attempt < 100; attempt++) {
          await t.pump(const Duration(milliseconds: 10));
          if (finished && find.text(expected).evaluate().isNotEmpty) return;
          await t.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 12)),
          );
        }
        fail(
          'Dopo $label attendevo $expected. ${t.widgetList<Text>(find.byType(Text)).map((w) => w.data).toList()}',
        );
      }

      expect(button('Registra').onPressed, isNull);
      await t.tap(find.byType(Switch));
      await t.pumpAndSettle();
      await t.tap(find.text('Registra'));
      await t.pumpAndSettle();
      expect(capture.starts, 1);
      await pressAndWait('Termina registrazione', 'Invia vocale');
      await t.pumpAndSettle();
      expect(find.text('Invia vocale'), findsOneWidget);
      expect(api.commands, isEmpty);
      expect(vault.values.values.single, isNot(contains(base64Encode(bytes))));
      await t.pumpWidget(const SizedBox());
      await t.pumpWidget(page());
      await t.pumpAndSettle();
      expect(button('Invia vocale').onPressed, isNull);
      await t.tap(find.byType(Switch));
      await t.pumpAndSettle();
      api.lose = true;
      await pressAndWait('Invia vocale', 'Verifica invio');
      await t.pumpAndSettle();
      expect(find.text('Verifica invio'), findsOneWidget);
      await pressAndWait('Verifica invio', 'Vocale inviato');
      await t.pumpAndSettle();
      expect(api.commands, hasLength(1));
      expect(api.commands.single, {
        'type': 'voice.send',
        'mode': 'message',
        'allowModelProcessing': true,
        'filename': 'Vocale.m4a',
        'bytesBase64': base64Encode(bytes),
      });
      expect(find.text('Vocale inviato'), findsOneWidget);
      expect(vault.values, isEmpty);
    },
  );
}
