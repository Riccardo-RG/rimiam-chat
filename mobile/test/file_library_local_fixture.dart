// Run flutter test test/file_library_local_fixture.dart with tests/run-native-server.ts on 3102.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/attachment_staging.dart';
import '../lib/chat_journal.dart';
import '../lib/library_collection.dart';
import '../lib/library_documents.dart';
import '../lib/workspace_creation.dart';

void main() {
  test('local two-member workspace: note, original, private star, explicit copy, media, hide, withdrawal and restoration', () async {
    FlutterSecureStorage.setMockInitialValues({});
    const generatedFixture = bool.fromEnvironment('RIMIAM_DOCUMENT_FIXTURE');
    final uri = Uri.parse('http://127.0.0.1:${generatedFixture ? 3197 : 3102}'),
        owner = RimiamApi(uri),
        peer = RimiamApi(uri);
    addTearDown(() {
      owner.close();
      peer.close();
    });
    await owner.login('native-ios@example.test', 'Native-test-only-2026!');
    await peer.login('native-android@example.test', 'Native-test-only-2026!');
    addTearDown(() async {
      await peer.logout();
      await owner.logout();
    });
    final root = await Directory.systemTemp.createTemp(
      'rimiam-library-fixture-',
    );
    addTearDown(() => root.delete(recursive: true));
    final stamp = owner.newId();
    final creation = WorkspaceCreationDraft(owner, const DeviceDraftVault());
    await creation.open(
      initialContact: (id: peer.actorId, name: 'Native android tester'),
    );
    creation.name = 'Raccolta $stamp';
    creation.history = true;
    final settings = await owner.get('/api/v1/assistant-settings');
    final choice = (settings['connections'] as List).singleWhere(
      (c) => c['id'] == 'default',
    );
    final space = (await creation.submit(
      selectedRevision: choice['revision'] as String,
    ))!;
    final incoming =
        (await peer.get('/api/v1/invitations'))['invitations'] as List;
    final invite = incoming.singleWhere(
      (i) => i['workspaceName'] == space.name,
    );
    await peer.post('/api/v1/invitations/${invite['id']}/accept', {
      'fullHistoryAccepted': true,
    });
    LibraryCollection open(RimiamApi api, {String? workspace}) =>
        LibraryCollection(
          api,
          const DeviceDraftVault(),
          workspace: workspace,
          staging: (s) => AttachmentStaging(scope: s, root: () async => root),
        );
    final group = open(owner, workspace: space.id),
        other = open(peer, workspace: space.id),
        personal = open(owner);
    await group.load();
    await other.load();
    await personal.load();
    final privateNote = await personal.note(
      'Nota privata $stamp\nContenuto privato.',
      () => true,
    );
    expect(privateNote.destination, 'Documenti personali');
    await personal.load();
    expect(other.index!.filter(search: 'Nota privata'), isEmpty);
    final source = personal.index!
        .filter(search: privateNote.filename)
        .single
        .file!;
    await personal.copyTo(source, space.id, () => true);
    await other.load();
    final shared = other.index!.filter(search: privateNote.filename).single;
    expect(shared.messageId, isNotNull);
    expect(shared.file!['id'], isNot(source['id']));
    await group.load();
    final copy = group.index!.filter(search: privateNote.filename).single.file!;
    expect(copy['can_manage_visibility'], isTrue);
    expect(shared.file!['can_manage_visibility'], isFalse);
    await expectLater(
      peer.post('${other.path}/commands', {
        'expectedActorId': peer.actorId,
        'commandId': peer.newId(),
        'command': {
          'type': 'document.withdraw',
          'sourceId': copy['id'],
          'documentVersion': copy['document_version'],
          'expectedVisibilityVersion': copy['visibility_version'],
        },
      }),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
    await group.visibility(copy, () => true);
    await other.load();
    expect(other.index!.filter(search: privateNote.filename), isEmpty);
    expect(await owner.getBytes(personal.filePath(source)), isNotEmpty);
    await group.load();
    await group.visibility(
      group.index!.filter(withdrawn: true).single.file!,
      () => true,
    );
    await other.load();
    expect(
      other.index!.filter(search: privateNote.filename).single.file!['id'],
      copy['id'],
    );
    final structured = await composeDocument(group, 'Verbale ' + stamp, '', [
      documentBlock('heading', 'Ordine del giorno'),
      documentBlock('table', 'Voce|Stato\nCalendario|Aperto'),
      documentBlock('checklist', '[x] Rivedere la bozza\n[ ] Condividere'),
    ], () => true);
    await other.load();
    final savedVersion = currentLibraryDocuments(other.snapshot).singleWhere(
      (v) =>
          v['artifact_id'] == structured.id &&
          v['version'] == structured.version,
    );
    expect(versionStatus(savedVersion, other.snapshot), 'Bozza');
    expect(documentMarkdown(savedVersion), contains('| Calendario | Aperto |'));
    expect(documentMarkdown(savedVersion), contains('[x] Rivedere la bozza'));
    await personal.load();
    expect(
      currentLibraryDocuments(personal.snapshot)
          .where((v) => v['artifact_id'] == structured.id),
      isEmpty,
    );
    if (generatedFixture) {
      final request = PrivateDocumentRequest(group);
      await request.load();
      final result = await request.generate(
        'Prepara un piano di lancio per due tester.',
        () => true,
      );
      expect(result['answer'], contains('Invitiamo due tester'));
      await personal.load();
      final generated = personal.index!.files.singleWhere(
        (f) => f['id'] == result['documentSourceId'],
      );
      expect(personal.id, result['documentWorkspaceId']);
      await expectLater(
        peer.getBytes(personal.filePath(generated)),
        throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
      );
      await other.load();
      expect(
        other.index!
            .filter(search: generated['filename'])
            .where((f) => f.file?['origin_source_id'] == generated['id']),
        isEmpty,
      );
      await personal.copyTo(generated, space.id, () => true);
      await other.load();
      final sharedDoc = other.index!
          .filter(search: generated['filename'])
          .single;
      expect(sharedDoc.messageId, isNotNull);
      expect(
        await peer.getBytes(other.filePath(sharedDoc.file!)),
        utf8.encode(result['answer'] as String),
      );
    }
    final note = await group.note(
      'Resoconto $stamp\nDocumento per il gruppo.',
      () => true,
    );
    expect(note.destinationId, space.id);
    expect(note.destination, space.name);
    await other.load();
    final received = other.index!.filter(search: note.filename).single;
    final preview = await peer.get(
      '${other.filePath(received.file!)}&view=preview',
    );
    expect(
      preview['preview']['text'],
      'Resoconto $stamp\nDocumento per il gruppo.',
    );
    expect(
      other.index!.messages[received.messageId]!['author_id'],
      owner.actorId,
    );
    await other.changeFavorite(received.file!, () => true);
    await other.load();
    await group.load();
    expect(other.index!.filter(tab: 'Preferiti').single.title, note.filename);
    expect(group.index!.filter(tab: 'Preferiti'), isEmpty);
    await other.hide(received.key, true);
    final restored = open(peer, workspace: space.id);
    await restored.load();
    expect(
      restored.index!
          .filter(hidden: restored.hidden, onlyHidden: true)
          .single
          .title,
      note.filename,
    );
    expect(group.index!.filter(search: note.filename), isNotEmpty);
    await restored.hide(received.key, false);
    final owned = group.index!.filter(search: note.filename).single.file!;
    expect(received.file!['can_manage_visibility'], isFalse);
    await group.visibility(owned, () => true);
    await other.load();
    expect(other.index!.filter(search: note.filename), isEmpty);
    await expectLater(
      peer.getBytes(other.filePath(received.file!)),
      throwsA(isA<ApiError>()),
    );
    await group.load();
    await group.visibility(
      group.index!.filter(withdrawn: true).single.file!,
      () => true,
    );
    await other.load();
    expect(other.index!.filter(tab: 'Preferiti').single.title, note.filename);
    final png = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );
    final photo = await group.transfers.staging.stage([
      XFile.fromData(Uint8List.fromList(png), path: 'schermata.png'),
    ], existing: []);
    await group.transfers.replaceFiles(photo);
    await group.sendFiles(() => true);
    await group.savePage('https://example.org/riunione/raccolta', () => true);
    await other.load();
    final media = other.index!.filter(tab: 'Media').single;
    expect(media.title, 'schermata.png');
    expect(await peer.getBytes(other.filePath(media.file!)), png);
    final page = other.index!.filter(tab: 'Collegamenti').single;
    expect(page.title, 'example.org/…/raccolta');
    expect(
      other.index!.messages[page.messageId]!['content'],
      'Pagina condivisa: https://example.org/riunione/raccolta',
    );
  });
}
