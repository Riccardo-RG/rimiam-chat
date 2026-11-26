// Run `flutter test test/workspace_creation_local_fixture.dart` against
// tests/run-native-server.ts. The origin and accounts are
// fixed fictional fixtures, with local mail delivery and no external AI provider.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/attachments.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_creation.dart';

final _origin = Uri.parse('http://127.0.0.1:3102');

class _LostResponse extends RimiamApi {
  _LostResponse() : super(_origin);
  int creates = 0;
  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await super.post(path, body);
    if (path == '/api/v1/workspaces' && ++creates == 1)
      throw const SocketException(
        'Simulate a lost response after the real transaction commits.',
      );
    return response;
  }
}

void main() {
  test('two fixture accounts create and enter a real space with retained introduction and attached document after interrupted delivery', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final creator = _LostResponse(), peer = RimiamApi(_origin);
    addTearDown(() {
      creator.close();
      peer.close();
    });
    await creator.login('native-ios@example.test', 'Native-test-only-2026!');
    await peer.login('native-android@example.test', 'Native-test-only-2026!');
    addTearDown(() async {
      await peer.logout();
      await creator.logout();
    });
    final root = await Directory.systemTemp.createTemp('rimiam-create-native-');
    addTearDown(() => root.delete(recursive: true));
    final contact =
        ((await creator.get('/api/v1/contacts?q=android&offset=0'))['contacts']
                as List)
            .singleWhere((c) => c['id'] == peer.actorId);
    final catalog =
        (await creator.get('/api/v1/assistant-settings'))['connections']
            as List;
    final selected = catalog.singleWhere((c) => c['id'] == 'default');
    WorkspaceCreationDraft reopen() => WorkspaceCreationDraft(
      creator,
      const DeviceDraftVault(),
      staging: (s) => AttachmentStaging(scope: s, root: () async => root),
    );
    final draft = reopen();
    await draft.open(
      initialContact: (id: peer.actorId, name: contact['name'] as String),
    );
    final stamp = creator.newId();
    draft.name = 'Verifica creazione $stamp';
    draft.description = 'Introduzione del collaudo $stamp';
    // Selecting the same account from the address book and by email must result
    // in one account-bound invitation. Only local mail is enabled in this fixture.
    draft.email = 'native-android@example.test';
    draft.history = true;
    final bytes = utf8.encode('Documento del collaudo $stamp');
    draft.files = await draft.staging.stage([
      XFile.fromData(Uint8List.fromList(bytes), path: 'piano.txt'),
    ], existing: []);
    await expectLater(
      draft.submit(selectedRevision: selected['revision'] as String),
      throwsA(isA<SocketException>()),
    );
    final restored = reopen();
    await restored.open();
    expect(restored.commandId, draft.commandId);
    final created = (await restored.submit(verifyOnly: true))!;
    expect(creator.creates, 1);
    final info = await creator.get(
      '/api/v1/assistant-settings?workspaceId=${created.id}',
    );
    expect(info['connectionId'], selected['id']);
    expect(info['canManage'], isTrue);
    final path = '/api/v1/workspaces/${created.id}';
    await expectLater(
      peer.get('$path/workspace'),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
    final invites =
        (await peer.get('/api/v1/invitations'))['invitations'] as List;
    final invitation = invites.singleWhere(
      (i) => i['workspaceName'] == created.name,
    );
    final accepted = await peer.post(
      '/api/v1/invitations/${invitation['id']}/accept',
      {'fullHistoryAccepted': true},
    );
    expect(accepted['workspaceId'], created.id);
    final snapshot = await peer.get('$path/workspace');
    expect(
      (snapshot['members'] as List).where((m) => m['active'] == true),
      hasLength(2),
    );
    final intro = (snapshot['messages'] as List).singleWhere(
      (m) => m['purpose'] == 'workspace_introduction',
    );
    expect(intro['author_id'], creator.actorId);
    expect(intro['content'], draft.description);
    final file = (snapshot['sources'] as List).singleWhere(
      (f) => f['filename'] == 'piano.txt',
    );
    expect(file['shared_message_id'], isNotNull);
    expect(await peer.getBytes('$path/source-file?id=${file['id']}'), bytes);
    expect(
      (await peer.get(
        '/api/v1/assistant-settings?workspaceId=${created.id}',
      ))['canManage'],
      isFalse,
    );
  });
}
