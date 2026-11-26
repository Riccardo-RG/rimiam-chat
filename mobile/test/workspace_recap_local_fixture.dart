// Run explicitly against the native fixture and its loopback model double.
// From the repository, start test accounts with tests/run-native-server.ts, then
// node --env-file=.env --import tsx mobile/tool/local_document_provider.ts
// flutter test test/workspace_recap_local_fixture.dart
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_recap.dart';

class LostReply extends RimiamApi {
  LostReply(super.destination);
  String? drop;
  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final result = await super.post(path, body);
    if (path.endsWith('/consultation') && body['action'] == drop) {
      drop = null;
      throw const SocketException('Perdita della risposta di prova');
    }
    return result;
  }
}

void main() {
  test('two native accounts recover an anchored private recap and publish exactly one public message with original citations', () async {
    FlutterSecureStorage.setMockInitialValues({});
    const port = int.fromEnvironment('RIMIAM_TEST_PORT', defaultValue: 3197);
    final origin = Uri.parse('http://127.0.0.1:$port'),
        a = RimiamApi(origin),
        b = LostReply(origin);
    addTearDown(() {
      a.close();
      b.close();
    });
    await a.login('native-ios@example.test', 'Native-test-only-2026!');
    await b.login('native-android@example.test', 'Native-test-only-2026!');
    addTearDown(() async {
      await a.logout();
      await b.logout();
    });
    final id = a.newId(), title = 'Riepilogo locale ${id.substring(0, 8)}';
    await a.post('/api/v1/workspaces', {
      'commandId': id,
      'expectedActorId': a.actorId,
      'name': title,
    });
    final base = '/api/v1/workspaces/$id';
    Future<Map<String, dynamic>> send(Map<String, dynamic> cmd) async {
      final r = await a.post('$base/commands', {
        'commandId': a.newId(),
        'expectedActorId': a.actorId,
        'command': cmd,
      });
      return r['result'];
    }

    await send({
      'type': 'invitation.create',
      'email': 'native-android@example.test',
      'fullHistoryDisclosed': true,
    });
    final invitations =
        (await b.get('/api/v1/invitations'))['invitations'] as List;
    final invite = invitations.singleWhere((i) => i['workspaceName'] == title);
    await b.post('/api/v1/invitations/${invite['id']}/accept', {
      'fullHistoryAccepted': true,
    });
    final prior = (await send({
      'type': 'message.send',
      'content': 'Messaggio precedente alla selezione',
    }))['messageId'];
    final start =
        (await send({
              'type': 'message.send',
              'content': 'Prepariamo la sessione di lancio.',
            }))['messageId']
            as String;
    await send({
      'type': 'conversation.requestAnswer',
      'messageId': start,
      'recipients': [b.actorId],
    });
    Future<List> timeline() async =>
        (await a.get('$base/workspace'))['messages'] as List;
    final before = (await timeline()).length;
    final private = WorkspaceRecap(b, const DeviceDraftVault(), id);
    b.drop = 'summarize';
    await expectLater(private.open(start), throwsA(isA<SocketException>()));
    final restored = WorkspaceRecap(b, const DeviceDraftVault(), id);
    await restored.open(start);
    expect(restored.id, private.id);
    expect(restored.answer!['personalIds'], contains(start));
    final refs = restored.answer!['references'] as List;
    expect(refs.map((r) => r['id']), contains(start));
    expect(refs.map((r) => r['id']), isNot(contains(prior)));
    expect(await restored.original(start), start);
    expect((await timeline()).length, before);
    await expectLater(
      a.post('$base/consultation', {
        'action': 'share',
        'id': restored.id,
        'expectedActorId': a.actorId,
      }),
      throwsA(
        isA<ApiError>().having((e) => e.code, 'code', 'CONSULTATION_NOT_FOUND'),
      ),
    );
    b.drop = 'share';
    await expectLater(restored.share(), throwsA(isA<SocketException>()));
    final refreshed = WorkspaceRecap(b, const DeviceDraftVault(), id);
    await refreshed.open(start);
    expect(refreshed.answer!['sharedMessageId'], isNotNull);
    final messages = await timeline();
    expect(messages.length, before + 1);
    final published = messages.singleWhere(
      (m) => m['id'] == refreshed.answer!['sharedMessageId'],
    );
    expect(published['content'], refreshed.answer!['answer']);
    expect(published.containsKey('personalIds'), false);
    expect(
      (published['consultationReferences'] as List).map((r) => r['id']),
      contains(start),
    );
  }, timeout: const Timeout(Duration(minutes: 2)));
}
