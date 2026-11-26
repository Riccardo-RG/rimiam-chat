// Uses only tests/run-native-server.ts and its fictional accounts on loopback.
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_command_journal.dart';

class _Interrupted extends RimiamApi {
  _Interrupted(super.origin);
  bool interrupt = true;
  int sends = 0;
  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final result = await super.post(path, body);
    if (body['command']?['type'] == 'message.send') {
      sends++;
      if (interrupt) {
        interrupt = false;
        throw const SocketException('Conferma persa dopo il commit');
      }
    }
    return result;
  }
}

void main() {
  test('the Flutter sender commits once; the addressed account reads the exact group message', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final origin = Uri.parse('http://127.0.0.1:3102');
    final sender = _Interrupted(origin), reader = RimiamApi(origin);
    addTearDown(() {
      sender.close();
      reader.close();
    });
    await sender.login('native-ios@example.test', 'Native-test-only-2026!');
    await reader.login('native-android@example.test', 'Native-test-only-2026!');
    addTearDown(() async {
      await sender.logout();
      await reader.logout();
    });
    final spaces =
        (await sender.get('/api/v1/workspaces'))['workspaces'] as List;
    final room =
        spaces.singleWhere(
              (s) => s['name'] == 'Native shared verification',
            )['id']
            as String;
    final path = '/api/v1/workspaces/$room';
    final members = (await sender.get('$path/workspace'))['members'] as List;
    final name =
        members.singleWhere((m) => m['user_id'] == reader.actorId)['name']
            as String;
    final text = '@$name controlla la bozza ${sender.newId()}';
    ChatJournal journal() => ChatJournal(
      vault: const DeviceDraftVault(),
      origin: origin,
      actor: sender.actorId,
      workspace: room,
    );
    final first = journal();
    await first.open();
    first.edit(text, selected: {reader.actorId: name});
    await expectLater(
      first.submit(sender, mayPost: () => true),
      throwsA(isA<SocketException>()),
    );
    final restored = journal();
    await restored.open();
    await restored.submit(sender, mayPost: () => true);
    expect(sender.sends, 1);
    final snapshot = await reader.get('$path/workspace');
    final match = (snapshot['messages'] as List).singleWhere(
      (m) => m['content'] == text,
    );
    expect(match['author_id'], sender.actorId);
    expect(snapshot['reading']['mentionIds'], contains(match['id']));
    expect(
      (await sender.get('$path/workspace'))['reading']['mentionIds'],
      isNot(contains(match['id'])),
    );
    final request = WorkspaceCommandJournal(
      sender,
      const DeviceDraftVault(),
      namespace: 'message-answer',
      collection: room,
    );
    final ack = WorkspaceCommandJournal(
      reader,
      const DeviceDraftVault(),
      namespace: 'message-answer',
      collection: room,
    );
    await request.send(room, {
      'type': 'conversation.requestAnswer',
      'messageId': match['id'],
      'recipients': [reader.actorId],
    }, allowed: () => true);
    expect(
      (await reader.get('$path/workspace'))['reading']['requestIds'],
      contains(match['id']),
    );
    expect(
      (await sender.get('$path/workspace'))['reading']['requestIds'],
      isNot(contains(match['id'])),
    );
    await ack.send(room, {
      'type': 'conversation.answered',
      'messageId': match['id'],
    }, allowed: () => true);
    final after = await reader.get('$path/workspace');
    expect(after['reading']['requestIds'], isNot(contains(match['id'])));
    expect(after['reading']['mentionIds'], contains(match['id']));
  });
}
