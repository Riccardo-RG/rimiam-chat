import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/attachments.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_creation.dart';

typedef Json = Map<String, dynamic>;

class MemoryVault implements DraftVault {
  final data = <String, String>{};
  bool reject = false;
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> replace(String key, String? value) async {
    if (reject) throw const FileSystemException();
    if (value == null) {
      data.remove(key);
    } else {
      data[key] = value;
    }
  }
}

class _Api extends RimiamApi {
  _Api({String actor = 'creator', int port = 4100})
    : super(Uri.parse('http://127.0.0.1:$port')) {
    actorId = actor;
  }
  final posts = <Json>[], committed = <String>{};
  bool loseBefore = false, loseAfter = false, rejectRevision = false;
  static final rev = 'a' * 64, other = 'b' * 64;
  @override
  Future<Json> get(String path) async {
    if (path == '/api/v1/assistant-settings') {
      return {
        'connections': [
          {
            'id': 'default',
            'label': 'Emme predefinita',
            'configured': false,
            'revision': rev,
          },
          {
            'id': 'team',
            'label': 'Modello locale',
            'configured': true,
            'destination': 'server locale',
            'revision': other,
          },
        ],
      };
    }
    if (path.startsWith('/api/v1/contacts?'))
      return {
        'contacts': [
          {'id': 'ada', 'name': 'Ada Costa', 'nameAmbiguous': false},
          {'id': 'duplicato', 'name': 'Anna', 'nameAmbiguous': true},
        ],
        'nextOffset': null,
      };
    final id = path.split('/').last;
    expect(path, '/api/v1/workspaces/$id/receipts/$id');
    if (!committed.contains(id))
      throw const ApiError(403, 'MEMBERSHIP_REQUIRED');
    return {
      'commandId': id,
      'status': 'committed',
      'result': {'id': id},
    };
  }

  @override
  Future<Json> post(String path, Json body) async {
    expect(path, '/api/v1/workspaces');
    posts.add(body);
    if (rejectRevision) {
      rejectRevision = false;
      throw const ApiError(409, 'ASSISTANT_CONNECTION_CHANGED');
    }
    if (loseBefore) {
      loseBefore = false;
      throw const SocketException('prima');
    }
    final id = body['commandId'] as String;
    committed.add(id);
    if (loseAfter) {
      loseAfter = false;
      throw const SocketException('dopo');
    }
    return {'id': id};
  }
}

void main() {
  test('a response lost after commit restores the sealed command; verify never resends', () async {
    final api = _Api()..loseAfter = true, vault = MemoryVault();
    final draft = WorkspaceCreationDraft(api, vault);
    await draft.open(initialContact: (id: 'matteo', name: 'Matteo'));
    draft.name = ' Progetto ';
    draft.description = ' Introduzione ';
    draft.email = ' PRIMA@EXAMPLE.TEST ';
    draft.history = true;
    final first = draft.submit(selectedRevision: _Api.rev);
    expect(await draft.submit(selectedRevision: _Api.rev), isNull);
    await expectLater(first, throwsA(isA<SocketException>()));
    final id = draft.commandId!, stored = jsonDecode(vault.data[draft.key]!);
    expect(stored['commandId'], id);
    final fresh = WorkspaceCreationDraft(api, vault);
    await fresh.open(initialContact: (id: 'ignored', name: 'Altra persona'));
    expect(await fresh.submit(verifyOnly: true), (id: id, name: 'Progetto'));
    expect(api.posts.single, {
      'commandId': id,
      'expectedActorId': 'creator',
      'name': 'Progetto',
      'description': 'Introduzione',
      'assistantConnectionId': 'default',
      'assistantConnectionRevision': _Api.rev,
      'invitations': {
        'recipients': [
          {'contactId': 'matteo'},
          {'email': 'prima@example.test'},
        ],
        'fullHistoryDisclosed': true,
      },
    });
    expect(vault.data, isEmpty);
    expect(await fresh.submit(selectedRevision: _Api.rev), isNull);
  });
  test('interruption before commit: verification is read-only, retry uses identical bytes, ID and revision', () async {
    final root = await Directory.systemTemp.createTemp('rimiam-create-test-');
    addTearDown(() => root.delete(recursive: true));
    final api = _Api()..loseBefore = true, vault = MemoryVault();
    WorkspaceCreationDraft load() => WorkspaceCreationDraft(
      api,
      vault,
      staging: (s) => AttachmentStaging(scope: s, root: () async => root),
    );
    final first = load();
    await first.open();
    first.name = 'Allegati';
    final bytes = utf8.encode('specifica sintetica');
    first.files = await first.staging.stage([
      XFile.fromData(Uint8List.fromList(bytes), path: 'specifica.txt'),
    ], existing: []);
    await expectLater(
      first.submit(selectedRevision: _Api.rev),
      throwsA(isA<SocketException>()),
    );
    final next = load();
    await next.open();
    expect(await next.submit(verifyOnly: true), isNull);
    expect(api.posts.length, 1);
    expect(vault.data.values.single, isNot(contains(base64Encode(bytes))));
    final result = await next.submit(selectedRevision: _Api.other);
    expect(result!.id, first.commandId);
    expect(api.posts[1], api.posts[0]);
    expect(api.posts.first['attachments'], [
      {'filename': 'specifica.txt', 'bytesBase64': base64Encode(bytes)},
    ]);
    expect(
      await root.list(recursive: true).where((e) => e is File).toList(),
      isEmpty,
    );
  });
  test('failed durable save or missing staged file leaves form editable and sends nothing', () async {
    final root = await Directory.systemTemp.createTemp('rimiam-create-test-');
    addTearDown(() => root.delete(recursive: true));
    final api = _Api(), vault = MemoryVault();
    final draft = WorkspaceCreationDraft(
      api,
      vault,
      staging: (s) => AttachmentStaging(scope: s, root: () async => root),
    );
    await draft.open();
    draft.name = 'Recuperabile';
    vault.reject = true;
    await expectLater(
      draft.submit(selectedRevision: _Api.rev),
      throwsA(
        isA<FormatException>().having(
          (e) => e.message,
          "message",
          contains("non è stato inviato"),
        ),
      ),
    );
    expect(draft.commandId, isNull);
    vault.reject = false;
    draft.files = await draft.staging.stage([
      XFile.fromData(Uint8List.fromList([65]), path: 'a.txt'),
    ], existing: []);
    await draft.staging.discard(draft.files);
    await expectLater(
      draft.submit(selectedRevision: _Api.rev),
      throwsFormatException,
    );
    expect(draft.commandId, isNull);
    expect(api.posts, isEmpty);
  });
  test('history consent, address validity, invite limit, identity and installation boundaries', () async {
    final api = _Api(),
        vault = MemoryVault(),
        draft = WorkspaceCreationDraft(api, vault);
    await draft.open();
    draft.name = 'Inviti';
    draft.email = 'indirizzo';
    await expectLater(
      draft.submit(selectedRevision: _Api.rev),
      throwsFormatException,
    );
    draft.email = 'uno@example.test';
    await expectLater(
      draft.submit(selectedRevision: _Api.rev),
      throwsFormatException,
    );
    draft.recipients = List.generate(
      25,
      (i) => CreationRecipient.email('a$i@example.test'),
    );
    draft.history = true;
    await expectLater(
      draft.submit(selectedRevision: _Api.rev),
      throwsFormatException,
    );
    draft.email = 'A0@EXAMPLE.TEST';
    expect(draft.selection.length, 25);
    await draft.save();
    for (final alternative in [_Api(actor: 'altra'), _Api(port: 4101)]) {
      final other = WorkspaceCreationDraft(alternative, vault);
      await other.open();
      expect(other.name, isEmpty);
      expect(other.recipients, isEmpty);
      expect(other.stagingScope, isNot(draft.stagingScope));
    }
    api.actorId = 'altra';
    expect(await draft.submit(selectedRevision: _Api.rev), isNull);
    expect(api.posts, isEmpty);
    api.actorId = 'creator';
    await draft.submit(selectedRevision: _Api.rev);
    expect(api.posts.single['invitations']['recipients'], hasLength(25));
  });
  test('stale connection must be reviewed before using a different frozen revision', () async {
    final api = _Api()..rejectRevision = true,
        vault = MemoryVault(),
        draft = WorkspaceCreationDraft(api, vault);
    await draft.open();
    draft.name = 'Connessione';
    draft.connectionId = 'team';
    await expectLater(
      draft.submit(selectedRevision: _Api.rev),
      throwsA(isA<ApiError>()),
    );
    expect(draft.commandId, isNull);
    expect(draft.revision, isNull);
    await draft.submit(selectedRevision: _Api.other);
    expect(api.posts.last['assistantConnectionRevision'], _Api.other);
    expect(api.posts.last['commandId'], isNot(api.posts.first['commandId']));
  });
  test('explicitly forgetting an unresolved attempt never cancels or resends a request; a failed vault write keeps it recoverable', () async {
    final api = _Api()..loseAfter = true,
        vault = MemoryVault(),
        draft = WorkspaceCreationDraft(api, vault);
    await draft.open();
    draft.name = 'Conferma assente';
    await expectLater(
      draft.submit(selectedRevision: _Api.rev),
      throwsA(isA<SocketException>()),
    );
    final id = draft.commandId!;
    vault.reject = true;
    await expectLater(
      draft.discardLocalAttempt(),
      throwsA(isA<FileSystemException>()),
    );
    expect(draft.finished, isFalse);
    expect(vault.data, isNotEmpty);
    vault.reject = false;
    await draft.discardLocalAttempt();
    expect(vault.data, isEmpty);
    expect(api.posts, hasLength(1));
    expect(api.committed, {id});
    final fresh = WorkspaceCreationDraft(api, vault);
    await fresh.open();
    expect(fresh.commandId, isNull);
    expect(fresh.files, isEmpty);
    expect(fresh.flow, isNot(draft.flow));
  });

  testWidgets(
    'creator selects contact and connection, acknowledges retained history, then enters the new workspace',
    (t) async {
      final api = _Api(), vault = MemoryVault();
      WorkspaceTarget? entered;
      await t.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (ctx) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  entered = await Navigator.of(ctx).push<WorkspaceTarget>(
                    MaterialPageRoute(
                      builder: (_) => WorkspaceCreation(api: api, vault: vault),
                    ),
                  );
                },
                child: const Text('Apertura'),
              ),
            ),
          ),
        ),
      );
      await t.tap(find.text('Apertura'));
      await t.pumpAndSettle();
      await t.enterText(
        find.widgetWithText(TextField, 'Nome dello spazio'),
        'Lancio',
      );
      await t.tap(find.text('Scegli dalla rubrica'));
      await t.pumpAndSettle();
      expect(
        t.widget<ListTile>(find.widgetWithText(ListTile, 'Anna')).onTap,
        isNull,
      );
      await t.tap(find.text('Ada Costa'));
      await t.pumpAndSettle();
      expect(find.byTooltip('Rimuovi Ada Costa'), findsOneWidget);
      await t.enterText(
        find.widgetWithText(TextField, 'Indirizzo email'),
        'altra@example.test',
      );
      await t.ensureVisible(find.byType(DropdownButton<String>));
      await t.tap(find.byType(DropdownButton<String>));
      await t.pumpAndSettle();
      await t.tap(find.text('Modello locale').last);
      await t.pumpAndSettle();
      expect(find.text('Destinazione: server locale'), findsOneWidget);
      var create = find.widgetWithText(FilledButton, 'Crea spazio e invita');
      await t.ensureVisible(create);
      expect(t.widget<FilledButton>(create).onPressed, isNull);
      await t.ensureVisible(find.byType(CheckboxListTile));
      await t.tap(find.byType(CheckboxListTile));
      await t.pumpAndSettle();
      await t.ensureVisible(create);
      await t.tap(create);
      await t.pumpAndSettle();
      expect(entered?.name, 'Lancio');
      expect(api.posts.single['assistantConnectionId'], 'team');
      expect(api.posts.single['invitations']['recipients'], [
        {'contactId': 'ada'},
        {'email': 'altra@example.test'},
      ]);
    },
  );
}
