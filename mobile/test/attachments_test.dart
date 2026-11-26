import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/attachments.dart';
import '../lib/chat_journal.dart';
import '../lib/attachment_preview.dart';
import '../lib/personal_attachment.dart';

class _Vault implements DraftVault {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> replace(String key, String? value) async {
    if (value == null)
      values.remove(key);
    else
      values[key] = value;
  }
}

class _Server extends RimiamApi {
  _Server() : super(Uri.parse('http://localhost')) {
    actorId = 'ric';
  }
  final posts = <Map<String, dynamic>>[];
  Map<String, dynamic>? message;
  Map<String, dynamic>? preview;
  final audio = Completer<Uint8List>();
  final readPaths = <String>[];
  bool dropBefore = false, dropAfter = false, previewDenied = false;
  int receipts = 0, previews = 0, originals = 0;
  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    posts.add(body);
    if (dropBefore) {
      dropBefore = false;
      throw const SocketException('Offline');
    }
    message = body;
    if (dropAfter) {
      dropAfter = false;
      throw const SocketException('Conferma persa');
    }
    return body['type'] == 'send'
        ? {'messageId': body['id']}
        : {'commandId': body['commandId'], 'status': 'committed'};
  }

  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (path.contains('/personal-chats?thread=')) {
      if (previewDenied) throw const ApiError(403, 'PERSONAL_CHAT_REQUIRED');
      return {
        'archive': 'archive',
        'selection': {'id': 'shared-group', 'version': 2},
      };
    }
    if (path.endsWith('/personal/workspace')) {
      return {
        'workspace': {'id': 'personal', 'personal': true},
        'members': [
          {'user_id': 'ric', 'active': true, 'contributes': true},
        ],
      };
    }
    if (path.contains('view=preview')) {
      previews++;
      if (previewDenied) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
      return preview ??
          {
            'filename': 'prova.txt',
            'mediaType': 'text/plain',
            'bytes': 4,
            'preview': {
              'kind': 'text',
              'text': 'Contenuto dal servizio',
              'truncated': false,
            },
          };
    }
    receipts++;
    final m = message;
    if (path.contains('/receipts/')) {
      if (m == null) throw const ApiError(404, 'RECEIPT_NOT_FOUND');
      return {'commandId': m['commandId'], 'status': 'committed'};
    }
    return {
      'id': 'space',
      'me': actorId,
      'messages': [
        if (m != null)
          {
            'id': m['id'],
            'authorId': actorId,
            'text': m['text'],
            'quoteId': m['quoteId'],
            'files': [
              for (final (i, f) in (m['attachments'] as List).indexed)
                {'id': 'file$i', 'filename': f['filename']},
            ],
          },
      ],
    };
  }

  @override
  Future<Uint8List> getBytes(String path) async {
    originals++;
    readPaths.add(path);
    if (path.contains('view=audio')) return audio.future;
    if (path.endsWith('tiny.png'))
      return base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqE0AAAAASUVORK5CYII=',
      );
    final i = int.parse(path.split('file').last);
    return base64Decode(message!['attachments'][i]['bytesBase64']);
  }
}

void main() {
  late Directory root;
  late AttachmentStaging staging;
  XFile named(String name, String content) =>
      XFile.fromData(Uint8List.fromList(utf8.encode(content)), path: name);
  setUp(() async {
    root = await Directory.systemTemp.createTemp('rimiam-attachment-test-');
    staging = AttachmentStaging(
      scope: 'private test scope',
      root: () async => root,
    );
  });
  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });
  test('only encrypted bytes reach disk, selection order is preserved, and other scopes and tampered files cannot be opened', () async {
    final source = [
      named('piano.txt', 'un contenuto privato di prova'),
      named('turno.md', 'seconda riga'),
    ];
    final entries = await staging.stage(source, existing: []);
    final refs = entries
        .map((f) => StagedAttachment.fromJson(f.toJson()))
        .toList();
    final onDisk = await root
        .list(recursive: true)
        .where((v) => v is File)
        .cast<File>()
        .toList();
    expect(onDisk, hasLength(2));
    expect(onDisk.map((f) => f.path).join(), isNot(contains('piano')));
    expect(
      latin1.decode(await onDisk.first.readAsBytes()),
      isNot(contains('contenuto privato')),
    );
    expect(
      jsonEncode(refs.map((f) => f.toJson()).toList()),
      isNot(
        contains(base64Encode(utf8.encode('un contenuto privato di prova'))),
      ),
    );
    final payload = await staging.payloads(refs.reversed.toList());
    expect(payload.map((v) => v['filename']), ['turno.md', 'piano.txt']);
    expect(
      utf8.decode(base64Decode(payload.last['bytesBase64'])),
      'un contenuto privato di prova',
    );
    expect(payload.first.keys, unorderedEquals(['filename', 'bytesBase64']));
    final other = AttachmentStaging(
      scope: 'altra identità',
      root: () async => root,
    );
    await expectLater(other.payloads(refs), throwsA(isA<AttachmentProblem>()));
    final file = onDisk.first;
    final data = await file.readAsBytes();
    data[15] ^= 7;
    await file.writeAsBytes(data);
    await expectLater(
      staging.payloads(refs),
      throwsA(isA<AttachmentProblem>()),
    );
    await staging.discard(refs);
    expect(await root.list(recursive: true).where((v) => v is File).length, 0);
  });
  test('rejects unsupported formats, oversize text, nesting, aggregate count and size before committing an invalid batch', () async {
    Future<void> refused(List<XFile> selected) => expectLater(
      staging.stage(selected, existing: []),
      throwsA(isA<AttachmentProblem>()),
    );
    await refused([named('valido.txt', 'ok'), named('x.jpg', 'not an image')]);
    await refused([named('prova.exe', 'test')]);
    expect(AttachmentStaging.validName('../test.txt'), isFalse);
    await refused([named('big.txt', 'x' * 200001)]);
    await refused([for (int i = 0; i < 11; i++) named('f$i.txt', 'ok')]);
    final large = Uint8List(5 * 1024 * 1024)..setAll(0, ascii.encode('%PDF-'));
    await refused([
      XFile.fromData(large, path: 'a.pdf'),
      XFile.fromData(large, path: 'b.pdf'),
    ]);
    expect(await root.list(recursive: true).where((v) => v is File).length, 0);
  });

  for (final direct in [false, true]) {
    for (final committed in [false, true]) {
      test(
        'file-only submission with restart and exact receipt; direct=$direct, committed=$committed',
        () async {
          final api = _Server(), vault = _Vault();
          ChatJournal journal() => ChatJournal(
            vault: vault,
            origin: api.origin,
            actor: api.actorId,
            workspace: 'space',
            staging: staging,
            direct: direct,
          );
          final j = journal();
          await j.open();
          final refs = await staging.stage([
            named('prova.txt', 'test uno'),
            named('secondo.md', 'test due'),
          ], existing: []);
          await j.replaceFiles(refs.reversed.toList());
          api.dropBefore = !committed;
          api.dropAfter = committed;
          await expectLater(
            j.submit(api, mayPost: () => true),
            throwsA(isA<SocketException>()),
          );
          final accepted = api.posts.single;
          final content = direct ? accepted : accepted['command'];
          expect(content[direct ? 'text' : 'content'], '');
          expect((content['attachments'] as List).map((f) => f['filename']), [
            'secondo.md',
            'prova.txt',
          ]);
          expect(vault.values.values.single, isNot(contains('bytesBase64')));
          if (committed)
            await staging.discard(
              refs,
            ); // A receipt is sufficient, including when staged bytes are gone.
          final restored = journal();
          await restored.open();
          expect(api.posts, hasLength(1));
          restored.edit('altra bozza');
          await restored.submit(api, mayPost: () => true);
          expect(restored.pending, isNull);
          expect(restored.text, 'altra bozza');
          expect(restored.files, isEmpty);
          expect(api.receipts, 1);
          expect(api.originals, direct && committed ? 2 : 0);
          expect(api.posts, committed ? [accepted] : [accepted, accepted]);
          expect(
            (await root.list(recursive: true).where((v) => v is File).toList()),
            isEmpty,
          );
          api.close();
        },
      );
    }
  }
  test(
    'a first attempt with unavailable bytes can be corrected without posting',
    () async {
      final api = _Server(),
          j = ChatJournal(
            vault: _Vault(),
            origin: Uri.parse('http://localhost'),
            actor: 'ric',
            workspace: 'space',
            staging: staging,
          );
      await j.open();
      final f = await staging.stage([
        named('report.md', 'Da leggere'),
      ], existing: []);
      await j.replaceFiles(f);
      await staging.discard(f);
      await expectLater(
        j.submit(api, mayPost: () => true),
        throwsA(isA<AttachmentProblem>()),
      );
      expect(api.posts, isEmpty);
      expect(j.pending, isNull);
      expect(j.files, hasLength(1));
      await j.replaceFiles([]);
      expect(j.files, isEmpty);
      api.close();
    },
  );
  testWidgets(
    'inline image uses authenticated original and offers both explicit actions; other types and withdrawn files never fetch a thumbnail',
    (t) async {
      final api = _Server();
      addTearDown(api.close);
      const path = '/protected/tiny.png';
      int asks = 0, jumps = 0;
      Future<void> view(String type, {bool withdrawn = false}) async {
        await t.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ReceivedAttachment(
                api: api,
                path: path,
                filename: 'tiny.png',
                mediaType: type,
                withdrawn: withdrawn,
                onAsk: () => asks++,
                onMessage: () => jumps++,
              ),
            ),
          ),
        );
        await t.pumpAndSettle();
      }

      await view('image/svg+xml');
      expect(api.readPaths, isEmpty);
      await view('image/png', withdrawn: true);
      expect(find.text('Allegato rimosso.'), findsOneWidget);
      expect(api.readPaths, isEmpty);
      await view('image/png');
      expect(api.readPaths, [path]);
      api.preview = {
        'filename': 'tiny.png',
        'mediaType': 'image/png',
        'bytes': 68,
        'preview': {'kind': 'image'},
      };
      for (final label in [
        'Vai al messaggio',
        'Chiedi a Emme su questo file',
      ]) {
        await t.tap(find.text('tiny.png'));
        await t.pumpAndSettle();
        await t.tap(find.text(label));
        await t.pumpAndSettle();
        expect(find.text('tiny.png'), findsOneWidget);
      }
      expect([jumps, asks], [1, 1]);
      expect(api.previews, 2);
      expect(t.takeException(), isNull);
    },
  );
  for (final committed in [false, true]) {
    test(
      'a personal upload resumes only for its owner and same thread; original receipt after restart with committed=$committed',
      () async {
        final api = _Server(), vault = _Vault();
        addTearDown(api.close);
        PersonalAttachment open() =>
            PersonalAttachment(api, vault, 'personal', staging: staging);
        final first = open();
        await first.load();
        await first.choose(
          named('privato.txt', 'Solo per questa conversazione'),
        );
        expect(api.posts, isEmpty);
        expect(
          vault.values.values.single,
          isNot(
            contains(
              base64Encode(utf8.encode('Solo per questa conversazione')),
            ),
          ),
        );
        api.dropAfter = committed;
        api.dropBefore = !committed;
        await expectLater(first.save(), throwsA(isA<SocketException>()));
        final original = api.posts.single;
        expect(original['expectedActorId'], 'ric');
        expect(original['command'], {
          'type': 'document.upload',
          'filename': 'privato.txt',
          'conversationShare': <String, dynamic>{},
          'bytesBase64': base64Encode(
            utf8.encode('Solo per questa conversazione'),
          ),
        });
        final restarted = open();
        api.previewDenied = true;
        await expectLater(restarted.load(), throwsA(isA<ApiError>()));
        expect(restarted.file, isNull);
        await expectLater(restarted.save(), throwsA(isA<ApiError>()));
        api.previewDenied = false;
        await restarted.load();
        expect(restarted.file?.filename, 'privato.txt');
        expect(api.posts, hasLength(1));
        if (committed) await staging.discard([restarted.file!]);
        await restarted.save();
        expect(restarted.file, isNull);
        expect(vault.values, isEmpty);
        expect(api.posts, committed ? [original] : [original, original]);
      },
    );
  }
  test(
    'an unavailable personal original can be removed before any upload starts',
    () async {
      final api = _Server(), vault = _Vault();
      addTearDown(api.close);
      final transfer = PersonalAttachment(
        api,
        vault,
        'personal',
        staging: staging,
      );
      await transfer.load();
      await transfer.choose(named('bozza.txt', 'Da correggere'));
      await staging.discard([transfer.file!]);
      await expectLater(transfer.save(), throwsA(isA<AttachmentProblem>()));
      expect(transfer.journal.pending, isNull);
      expect(api.posts, isEmpty);
      await transfer.remove();
      expect(transfer.file, isNull);
    },
  );
  testWidgets(
    'a busy preview can be retried and attachment audio is downloaded only on tap; stopping fences a late response',
    (t) async {
      final api = _Server();
      addTearDown(api.close);
      const path = '/api/v1/workspaces/work/source-file?id=f';
      api.preview = {
        'filename': 'voce.wav',
        'mediaType': 'audio/wav',
        'bytes': 128,
        'preview': {'kind': 'unavailable', 'reason': 'busy'},
      };
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReceivedAttachment(
              api: api,
              path: path,
              filename: 'voce.wav',
            ),
          ),
        ),
      );
      await t.tap(find.text('voce.wav'));
      await t.pumpAndSettle();
      expect(api.readPaths, isEmpty);
      api.preview!['preview'] = {'kind': 'audio', 'extension': 'wav'};
      await t.tap(find.text('Riprova anteprima'));
      await t.pumpAndSettle();
      expect(api.previews, 2);
      expect(api.readPaths, isEmpty);
      await t.tap(find.text('Ascolta audio'));
      await t.pumpAndSettle();
      expect(api.readPaths, ['$path&view=audio']);
      await t.tap(find.text('Interrompi ascolto'));
      await t.pumpAndSettle();
      api.audio.complete(Uint8List(1));
      await t.pumpAndSettle();
      expect(find.text('Ascolta audio'), findsOneWidget);
      expect(find.text('Impossibile riprodurre l’audio.'), findsNothing);
      expect(t.takeException(), isNull);
    },
  );
  testWidgets(
    'attachments picker lets a person reorder and remove before sending and keeps the composer untouched',
    (t) async {
      // Widget tests execute file IO in real async time.
      final refs = await t.runAsync(
        () => staging.stage([
          named('primo.txt', '1'),
          named('secondo.txt', '2'),
        ], existing: []),
      );
      List<StagedAttachment> latest = refs!;
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AttachmentPicker(
              staging: staging,
              files: latest,
              onChanged: (v) async {
                latest = v;
              },
            ),
          ),
        ),
      );
      await t.tap(find.text('Allegati · 2'));
      await t.pumpAndSettle();
      expect(find.text('Scegli file'), findsOneWidget);
      expect(find.text('Scatta foto'), findsOneWidget);
      await t.tap(find.byTooltip('Sposta prima secondo.txt'));
      await t.pumpAndSettle();
      expect(latest.map((f) => f.filename), ['secondo.txt', 'primo.txt']);
      await t.tap(find.byTooltip('Rimuovi primo.txt'));
      await t.pumpAndSettle();
      expect(latest.map((f) => f.filename), ['secondo.txt']);
      await t.tap(find.text('Chiudi'));
      await t.pumpAndSettle();
      expect(find.text('Scatta foto'), findsNothing);
    },
  );
  testWidgets(
    'a received attachment loads only on request and checks current access each time',
    (t) async {
      final api = _Server();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReceivedAttachment(
              api: api,
              path: '/api/v1/workspaces/work/source-file?id=f',
              filename: 'prova.txt',
            ),
          ),
        ),
      );
      expect(api.previews, 0);
      await t.tap(find.text('prova.txt'));
      await t.pumpAndSettle();
      expect(find.text('Contenuto dal servizio'), findsOneWidget);
      expect(api.previews, 1);
      await t.pageBack();
      await t.pumpAndSettle();
      api.previewDenied = true;
      await t.tap(find.text('prova.txt'));
      await t.pumpAndSettle();
      expect(find.text('Contenuto dal servizio'), findsNothing);
      expect(api.previews, 2);
      expect(
        find.text('Impossibile aprire questo allegato. Riprova'),
        findsOneWidget,
      );
      api.close();
    },
  );
}
