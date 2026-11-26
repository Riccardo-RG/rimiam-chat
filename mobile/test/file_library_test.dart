import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/attachment_staging.dart';
import '../lib/chat_journal.dart';
import '../lib/file_library.dart';
import '../lib/library_collection.dart';
import '../lib/library_entries.dart';
import '../lib/library_documents.dart';
import '../lib/library_document_view.dart';
import '../lib/studio_theme.dart';

class _Vault implements DraftVault {
  final entries = <String, String>{};
  @override
  Future<String?> read(String key) async => entries[key];
  @override
  Future<void> replace(String key, String? value) async {
    if (value == null) {
      entries.remove(key);
    } else {
      entries[key] = value;
    }
  }
}

const _today = '2026-11-26T13:00:00Z', _older = '2026-11-12T10:12:00Z';
LibraryJson _file(
  String id,
  String name, {
  String? doc,
  String? message,
  String at = _today,
  int version = 1,
  bool withdrawn = false,
  bool manage = true,
  bool favorite = false,
}) => {
  'id': id,
  'kind': 'document',
  'filename': name,
  'document_id': doc ?? id,
  'document_version': version,
  'visibility_version': 1,
  'shared_message_id': message,
  'withdrawn': withdrawn,
  'can_manage_visibility': manage,
  'favorite': favorite,
  'created_at': at,
  'media_type': name.endsWith('.png') ? 'image/png' : 'text/plain',
};
LibraryJson _message(
  String id,
  String text,
  int sequence, [
  String at = _today,
]) => {
  'id': id,
  'content': text,
  'actor_kind': 'human',
  'author_id': 'owner',
  'author_name': 'Ada',
  'purpose': 'conversation',
  'created_at': at,
  'sequence': sequence,
};

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('http://127.0.0.1:3102')) {
    actorId = 'owner';
  }
  final messages = [
    _message('m1', 'La bozza della schermata', 1),
    _message('m2', 'Vedi https://example.org/a/b', 2),
  ];
  final files = [
    _file('s1', 'schermata.png', message: 'm1'),
    _file('s2', 'verbale.txt', message: 'm1'),
  ];
  final posts = <LibraryJson>[], receipts = <String, LibraryJson>{};
  bool lose = false, revoked = false, rejectOnce = false, contributor = true;
  final consultations = <LibraryJson>[], artifactVersions = <LibraryJson>[];
  Completer<void>? pause;
  @override
  Future<LibraryJson> get(String path) async {
    if (path.contains('/source-file?') && path.contains('view=preview')) {
      final f = files.firstWhere(
        (s) => s['id'] == Uri.parse(path).queryParameters['id'],
      );
      return {
        'filename': f['filename'],
        'preview': {'kind': 'text', 'text': 'Anteprima del collaudo'},
      };
    }
    if (path.contains('/receipts/'))
      return receipts[path.split('/').last] ??
          (throw const ApiError(404, 'RECEIPT_NOT_FOUND'));
    if (pause != null) await pause!.future;
    final personal = path == '/api/v1/workspaces/archive/workspace';
    if (revoked) throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
    return {
      'workspace': {
        'id': personal ? 'archive' : 'group',
        'personal': personal,
        'name': 'Lancio RIMIAM',
        'personal_archive_id': null,
      },
      'members': [
        {'user_id': actorId, 'active': true, 'contributes': contributor},
      ],
      'artifacts': [
        if (artifactVersions.isNotEmpty)
          {
            'id': 'doc',
            'current_draft_version': artifactVersions.last['version'],
          },
      ],
      'artifactVersions': artifactVersions,
      'messages': messages,
      'sources': files,
      if (personal)
        'libraryDestinations': [
          {'id': 'group', 'name': 'Lancio RIMIAM'},
        ],
    };
  }

  @override
  Future<Uint8List> getBytes(String path) async => base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  );
  @override
  Future<LibraryJson> post(String path, LibraryJson body) async {
    if (path == '/api/v1/personal-space') {
      expect(body['expectedActorId'], actorId);
      return {'id': 'archive'};
    }
    if (path.endsWith('/consultation')) {
      consultations.add({...body});
      if (lose) {
        lose = false;
        throw const SocketException('Risposta persa');
      }
      return {
        'id': body['id'],
        'kind': 'document',
        'answer': '# Documento',
        'documentWorkspaceId': 'archive',
        'documentSourceId': 'saved-md',
      };
    }
    if (rejectOnce) {
      rejectOnce = false;
      throw const ApiError(400, 'INVALID_REQUEST');
    }
    posts.add(body);
    final id = body['commandId'] as String;
    if (!receipts.containsKey(id)) {
      final c = body['command'] as LibraryJson;
      if (c['type'] == 'library.favorite') {
        files.firstWhere((f) => f['id'] == c['sourceId'])['favorite'] =
            c['starred'];
      }
      if (c['type'] == 'artifact.compose') {
        artifactVersions.addAll([
          {
            'artifact_id': 'doc',
            'version': 1,
            'title': c['title'],
            'blocks': c['blocks'],
          },
          {
            'artifact_id': 'doc',
            'version': 2,
            'title': 'Aggiornato',
            'blocks': [documentBlock('paragraph', 'Versione successiva')],
          },
        ]);
      }
      receipts[id] = {
        'commandId': id,
        'status': 'committed',
        'result': c['type'] == 'artifact.compose'
            ? {'artifactId': 'doc', 'version': 1}
            : {'messageId': 'm1'},
      };
    }
    if (lose) {
      lose = false;
      throw const SocketException('Risposta persa');
    }
    return receipts[id]!;
  }
}

void main() {
  test('collection projection keeps exact latest file version, chronological media, original links and privacy rules', () {
    final index = LibraryIndex({
      'sources': [
        _file('old', 'prima.txt', doc: 'same', at: _older),
        _file('new', 'nuova.txt', doc: 'same', version: 2, favorite: true),
        _file('foto', 'riunione.png', message: 'a'),
        _file('gone', 'ritirato.txt', withdrawn: true),
        _file('other', 'altrui.txt', withdrawn: true, manage: false),
      ],
      'messages': [
        _message(
          'a',
          'Pagina condivisa: https://example.org/archivio/piano',
          1,
          _older,
        ),
        _message(
          'b',
          'Pagina condivisa: https://example.org/archivio/piano',
          2,
        ),
        _message(
          'c',
          'Due pagine https://example.org/app https://docs.example.org/test',
          3,
        ),
        _message(
          'd',
          'https://private.example.org/reset?token=segreto https://riunioni.local/pagina',
          4,
        ),
      ],
    });
    expect(
      index.filter(tab: 'File').map((e) => e.title),
      unorderedEquals(['nuova.txt', 'riunione.png']),
    );
    expect(index.filter(tab: 'Preferiti').single.file!['id'], 'new');
    expect(index.filter(tab: 'Media').single.messageId, 'a');
    expect(
      index.filter(tab: 'Collegamenti').map((e) => e.title),
      unorderedEquals([
        'example.org/…/piano',
        'example.org',
        'docs.example.org',
      ]),
    );
    final past = index
        .filter(tab: 'Collegamenti', until: DateTime(2026, 11, 13))
        .single;
    expect(past.messageId, 'a');
    expect(past.address.toString(), 'https://example.org/archivio/piano');
    expect(
      index.filter(type: 'Testo', search: 'NUOVA').single.key,
      'file:same',
    );
    expect(index.filter(withdrawn: true).single.file!['id'], 'gone');
    final replaced = LibraryIndex({
      'sources': [
        _file('old', 'old.txt', doc: 'versioned', withdrawn: true),
        _file('new', 'new.txt', doc: 'versioned', version: 2),
      ],
    });
    expect(replaced.filter(withdrawn: true).single.file!['id'], 'old');
    for (final url in [
      'https://user@example.org/a',
      'http://127.0.0.1/x',
      'https://example.org/%72eset?t=1',
      'https://join.slack.com/x',
      'javascript:alert(1)',
    ]) {
      expect(publicLibraryPage(url), isNull, reason: url);
    }
    final long = 'https://example.org/archive/${'abcdef' * 50}?x=${'d' * 300}';
    expect(shortLibraryPage(publicLibraryPage(long)!).length, lessThan(60));
    expect(shortLibraryPage(publicLibraryPage(long)!), isNot(contains('?')));
  });
  test('hidden preferences survive reopening, stay local to actor and workspace; stale reads cannot restore a closed view', () async {
    final api = _Api(),
        vault = _Vault(),
        a = LibraryCollection(api, vault, workspace: 'group');
    await a.load();
    final id = a.index!.files.first['id'] as String;
    await a.hide('file:$id', true);
    final b = LibraryCollection(api, vault, workspace: 'group');
    await b.load();
    expect(b.hidden, contains('file:$id'));
    final personal = LibraryCollection(api, vault);
    await personal.load();
    expect(personal.hidden, isEmpty);
    api.actorId = 'peer';
    final other = LibraryCollection(api, vault, workspace: 'group');
    await other.load();
    expect(other.hidden, isEmpty);
    await expectLater(a.hide('file:other', true), throwsA(isA<ApiError>()));
    final pause = api.pause = Completer<void>();
    final pending = other.load();
    other.clear();
    pause.complete();
    await pending;
    expect(other.ready, isFalse);
  });
  test('a TXT note names the destination; confirmation lost after commit reuses the receipt and preserves original bytes', () async {
    final dir = await Directory.systemTemp.createTemp('rimiam-library-test-');
    addTearDown(() => dir.delete(recursive: true));
    final api = _Api(), vault = _Vault();
    LibraryCollection open(RimiamApi session) => LibraryCollection(
      session,
      vault,
      staging: (s) => AttachmentStaging(scope: s, root: () async => dir),
    );
    final model = open(api);
    await model.load();
    api.lose = true;
    const text = '  Studio / grafico\n\nUna seconda riga.';
    await expectLater(
      model.note(text, () => true),
      throwsA(isA<SocketException>()),
    );
    expect(api.posts.single['command']['attachments'], [
      {
        'filename': 'Studio grafico.txt',
        'bytesBase64': base64Encode(utf8.encode(text)),
      },
    ]);
    expect(
      vault.entries.values.join(),
      isNot(contains(base64Encode(utf8.encode(text)))),
    );
    final reopenedApi = _Api()..receipts.addAll(api.receipts);
    final next = open(reopenedApi);
    await next.load();
    expect(next.transfers.pending, isNotNull);
    await next.sendFiles(() => true);
    expect(api.posts, hasLength(1));
    expect(reopenedApi.posts, isEmpty);
    final result = await next.note('Nota personale', () => true);
    expect(result, (
      destinationId: 'archive',
      destination: 'Documenti personali',
      filename: 'Nota personale.txt',
    ));
  });
  test('personal copy must select an eligible destination, star retries read receipt and visibility names the expected version', () async {
    final api = _Api(), vault = _Vault(), model = LibraryCollection(api, vault);
    await model.load();
    final f = api.files.first;
    expect(
      () => model.copyTo(f, 'foreign', () => true),
      throwsA(isA<ApiError>()),
    );
    await model.copyTo(f, 'group', () => true);
    expect(api.posts.last['command'], {
      'type': 'library.copy',
      'sourceId': 's1',
      'destinationId': 'group',
    });
    api.lose = true;
    await expectLater(
      model.changeFavorite(f, () => true),
      throwsA(isA<SocketException>()),
    );
    final next = LibraryCollection(api, vault);
    await next.load();
    await next.send(next.commands.pending!['command'], () => true);
    expect(api.posts, hasLength(2));
    await next.visibility(f, () => true);
    expect(api.posts.last['command'], {
      'type': 'document.withdraw',
      'sourceId': 's1',
      'documentVersion': 1,
      'expectedVisibilityVersion': 1,
    });
  });
  test('protected document generation resumes the same request after a lost response without sharing it', () async {
    final api = _Api(),
        vault = _Vault(),
        lib = LibraryCollection(api, vault, workspace: 'group');
    await lib.load();
    final first = PrivateDocumentRequest(lib);
    await first.load();
    api.lose = true;
    await expectLater(
      first.generate('Riordina la scaletta', () => true),
      throwsA(isA<SocketException>()),
    );
    final restored = PrivateDocumentRequest(lib);
    await restored.load();
    expect(restored.pending?['question'], 'Riordina la scaletta');
    await expectLater(
      restored.generate('Altra richiesta', () => true),
      throwsStateError,
    );
    expect(
      (await restored.generate(
        'Riordina la scaletta',
        () => true,
      ))['documentWorkspaceId'],
      'archive',
    );
    expect(api.consultations[0], equals(api.consultations[1]));
    expect(api.posts, isEmpty);
    expect(await vault.read(restored.key), isNull);
  });
  test('document preview keeps original version, adoption and table cells distinct', () {
    final t = documentBlock('table', 'Chi|Quando\nAda|Domani');
    expect(
      documentBlockText(t),
      '| Chi | Quando |\n| --- | --- |\n| Ada | Domani |',
    );
    expect(
      () => documentBlock('table', 'Chi|Quando\nAda'),
      throwsFormatException,
    );
    final old = {
          'artifact_id': 'a',
          'title': 'Prima',
          'version': 1,
          'blocks': [t],
        },
        current = {
          'artifact_id': 'a',
          'version': 2,
          'title': 'Seconda',
          'blocks': [documentBlock('paragraph', 'Altro')],
        };
    final data = {
      'artifacts': [
        {'id': 'a', 'current_draft_version': 2, 'current_adoption_id': 'ad'},
      ],
      'artifactVersions': [old, current],
      'artifactAdoptions': [
        {'id': 'ad', 'review_id': 'r'},
      ],
      'artifactReviews': [
        {'id': 'r', 'artifact_id': 'a', 'artifact_version': 1},
      ],
    };
    expect(currentLibraryDocuments(data), [current]);
    expect(versionStatus(old, data), 'Adottato');
    expect(versionStatus(current, data), 'Bozza');
    expect(documentMarkdown(old), contains('Ada | Domani'));
    expect(documentMarkdown(current), '# Seconda\n\nAltro\n');
  });
  testWidgets(
    'saved document opens the exact receipt version even if a newer one already exists',
    (t) async {
      final api = _Api(),
          model = LibraryCollection(api, _Vault(), workspace: 'group');
      await t.pumpWidget(
        MaterialApp(
          // WidgetTester cannot compile the Android sparkle shader on the host.
          theme: studioTheme(Brightness.light)
              .copyWith(splashFactory: InkRipple.splashFactory),
          home: LibraryDocumentsView(library: model),
        ),
      );
      await t.pumpAndSettle();
      await t.tap(find.text('Nuovo documento'));
      await t.pumpAndSettle();
      final fields = find.byType(TextField);
      await t.enterText(fields.at(0), 'Verbale v1');
      await t.enterText(fields.at(2), 'Prima stesura');
      await t.pumpAndSettle();
      final save = find.text('Salva in Lancio RIMIAM');
      await t.ensureVisible(save);
      await t.tap(save);
      await t.pumpAndSettle();
      expect(api.posts.single['command']['title'], 'Verbale v1');
      expect(
        find.text('Anteprima'),
        findsOneWidget,
        reason: t
            .widgetList<Text>(find.byType(Text))
            .map((w) => w.data)
            .join(' | '),
      );
      expect(find.text('Verbale v1'), findsOneWidget);
      expect(find.text('Prima stesura'), findsOneWidget);
      expect(find.text('Versione successiva'), findsNothing);
      await t.tap(find.text('Versioni'));
      await t.pumpAndSettle();
      final newer = find.text('v2 · Aggiornato');
      await t.ensureVisible(newer);
      await t.tap(newer);
      await t.pumpAndSettle();
      expect(find.text('Versione successiva'), findsOneWidget);
      expect(t.takeException(), isNull);
    },
  );
  testWidgets(
    'reading a retained photo requires a separate, exact consent; a changed permission invalidates it',
    (t) async {
      final api = _Api();
      addTearDown(api.close);
      final photo = api.files.first;
      photo['processing_status'] = 'needs_input';
      photo['processing_error'] = 'MEDIA_DISCLOSURE_REQUIRED';
      await t.pumpWidget(
        MaterialApp(
          home: FileLibrary(
            api: api,
            vault: _Vault(),
            workspaceId: 'group',
            workspaceName: 'Lancio RIMIAM',
          ),
        ),
      );
      await t.pumpAndSettle();
      Future<void> open() async {
        final row = find.bySemanticsLabel(RegExp('Apri schermata.png'));
        await t.ensureVisible(row);
        await t.tap(row);
        await t.pumpAndSettle();
        expect(find.text('Lettura con AI non autorizzata.'), findsOneWidget);
      }

      Future<void> choose(String choice) async {
        await t.tap(find.text('Consenti lettura con AI…'));
        await t.pumpAndSettle();
        await t.tap(find.text(choice));
        await t.pumpAndSettle();
      }

      await t.tap(find.widgetWithText(ChoiceChip, 'Media'));
      await t.pumpAndSettle();
      await open();
      await choose('Annulla');
      expect(api.posts, isEmpty);
      expect(find.text('Anteprima del collaudo'), findsOneWidget);
      await choose('Consenti lettura');
      expect(api.posts.single['command'], {
        'type': 'document.retry',
        'sourceId': 's1',
        'allowModelProcessing': true,
      });
      await open();
      api.contributor = false;
      await choose('Consenti lettura');
      expect(api.posts.length, 1);
      await open();
      expect(find.text('Consenti lettura con AI…'), findsNothing);
    },
  );

  testWidgets('rejected link stays in editor and retry names its destination', (
    t,
  ) async {
    final api = _Api();
    await t.pumpWidget(
      MaterialApp(
        home: FileLibrary(api: api, vault: _Vault(), workspaceId: 'group'),
      ),
    );
    await t.pumpAndSettle();
    await t.tap(find.text('Aggiungi link'));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), 'https://example.org/piano');
    await t.pump();
    api.rejectOnce = true;
    await t.tap(find.text('Condividi in Lancio RIMIAM'));
    await t.pumpAndSettle();
    expect(
      find.text('Il salvataggio non è riuscito. Il testo è ancora qui.'),
      findsOneWidget,
    );
    expect(
      t.widget<TextField>(find.byType(TextField)).controller!.text,
      'https://example.org/piano',
    );
    await t.tap(find.text('Condividi in Lancio RIMIAM'));
    await t.pumpAndSettle();
    expect(find.text('Collegamento salvato in Lancio RIMIAM.'), findsOneWidget);
  });
  for (final personal in [false, true]) {
    testWidgets(
      'asking from preview returns the exact source only for a shared file: personal=$personal',
      (t) async {
        final api = _Api(), vault = _Vault();
        Object? result;
        await t.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (ctx) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    result = await Navigator.push<Object?>(
                      ctx,
                      MaterialPageRoute(
                        builder: (_) => FileLibrary(
                          api: api,
                          vault: vault,
                          workspaceId: personal ? null : 'group',
                        ),
                      ),
                    );
                  },
                  child: const Text('Apri'),
                ),
              ),
            ),
          ),
        );
        await t.tap(find.text('Apri'));
        await t.pumpAndSettle();
        await t.ensureVisible(find.text('verbale.txt'));
        await t.tap(find.text('verbale.txt'));
        await t.pumpAndSettle();
        final ask = find.text('Chiedi a Emme su questo file');
        if (personal) {
          expect(ask, findsNothing);
        } else {
          await t.tap(ask);
          await t.pumpAndSettle();
          expect(result, (sourceId: 's2', filename: 'verbale.txt'));
        }
        expect(api.posts, isEmpty);
      },
    );
  }
  for (final allowed in [false, true]) {
    testWidgets(
      'upload shortcut opens only after membership confirms contribution: $allowed',
      (t) async {
        final api = _Api()..contributor = allowed;
        await t.pumpWidget(
          MaterialApp(
            home: FileLibrary(
              api: api,
              vault: _Vault(),
              workspaceId: 'group',
              openUpload: true,
            ),
          ),
        );
        await t.pumpAndSettle();
        expect(
          find.text('Scegli file'),
          allowed ? findsOneWidget : findsNothing,
        );
        if (allowed) {
          await t.tap(find.text('Chiudi'));
          await t.pumpAndSettle();
          expect(find.text('Scegli file'), findsNothing);
        }
        expect(api.posts, isEmpty);
      },
    );
  }
  for (final width in [320.0, 390.0, 768.0]) {
    testWidgets(
      'preview, close and return to original preserve Media at width $width',
      (t) async {
        t.view.reset();
        t.view.devicePixelRatio = 1;
        t.view.physicalSize = Size(width, 730);
        addTearDown(t.view.reset);
        final api = _Api(), vault = _Vault();
        String? selected;
        await t.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    selected = await Navigator.push<String>(
                      context,
                      MaterialPageRoute(
                        builder: (_) => FileLibrary(
                          api: api,
                          vault: vault,
                          workspaceId: 'group',
                          workspaceName: 'Lancio RIMIAM',
                        ),
                      ),
                    );
                  },
                  child: const Text('Apri raccolta'),
                ),
              ),
            ),
          ),
        );
        await t.tap(find.text('Apri raccolta'));
        await t.pumpAndSettle();
        await t.tap(find.widgetWithText(ChoiceChip, 'Media'));
        await t.pumpAndSettle();
        expect(find.text('verbale.txt'), findsNothing);
        expect(find.text('schermata.png'), findsOneWidget);
        await t.ensureVisible(find.text('schermata.png'));
        await t.tap(find.bySemanticsLabel(RegExp('Apri schermata.png')));
        await t.pumpAndSettle();
        expect(find.text('Anteprima del collaudo'), findsOneWidget);
        await t.pageBack();
        await t.pumpAndSettle();
        expect(
          t
              .widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Media'))
              .selected,
          isTrue,
        );
        await t.tap(find.bySemanticsLabel(RegExp('Apri schermata.png')));
        await t.pumpAndSettle();
        await t.tap(find.text('Vai al messaggio'));
        await t.pumpAndSettle();
        expect(selected, 'm1');
        expect(t.takeException(), isNull);
      },
    );
  }
}
