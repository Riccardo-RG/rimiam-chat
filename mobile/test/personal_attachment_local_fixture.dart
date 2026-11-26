// Run with the local native fixture on 3102 and its two synthetic accounts.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/attachment_staging.dart';
import '../lib/chat_journal.dart';
import '../lib/personal_attachment.dart';

class _LoseReceipt extends RimiamApi {
  _LoseReceipt(super.origin);
  int uploads = 0;
  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await super.post(path, body);
    if (body['command']?['type'] == 'document.upload' && ++uploads == 1) {
      throw const SocketException('Risposta persa dopo commit');
    }
    return response;
  }
}

void main() {
  test('one private original after lost receipt while consulting a shared workspace, hidden from its other member', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final uri = Uri.parse('http://127.0.0.1:3102');
    final owner = _LoseReceipt(uri), peer = RimiamApi(uri);
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
    final dir = await Directory.systemTemp.createTemp(
      'rimiam-personal-attachment-fixture',
    );
    addTearDown(() => dir.delete(recursive: true));
    final id = owner.newId();
    await owner.post('/api/v1/personal-chats', {
      'action': 'new',
      'thread': id,
      'expectedActorId': owner.actorId,
    });
    final state = await owner.get('/api/v1/personal-chats?thread=$id');
    final group = (state['targets'] as List).firstWhere(
      (t) => t['name'] == 'Native shared verification',
    )['id'];
    await owner.post('/api/v1/personal-chats', {
      'action': 'select',
      'thread': id,
      'target': group,
      'expectedVersion': state['selection']['version'],
      'expectedActorId': owner.actorId,
    });
    final name = 'Riservato-$id.txt';
    const words = 'Bozza personale del verbale, contenuto sintetico.';
    final bytes = Uint8List.fromList(utf8.encode(words));
    final stage = AttachmentStaging(
      scope: 'fixture/$id',
      root: () async => dir,
    );
    PersonalAttachment open() =>
        PersonalAttachment(owner, const DeviceDraftVault(), id, staging: stage);
    final first = open();
    await first.load();
    await first.choose(XFile.fromData(bytes, path: name));
    await expectLater(first.save(), throwsA(isA<SocketException>()));
    final reopened = open();
    await reopened.load();
    expect(reopened.journal.pending, isNotNull);
    await reopened.save();
    expect(owner.uploads, 1);
    final snapshot = await owner.get('/api/v1/workspaces/$id/workspace');
    final source = (snapshot['sources'] as List).singleWhere(
      (r) => r['filename'] == name,
    );
    final message = (snapshot['messages'] as List).singleWhere(
      (m) => m['id'] == source['shared_message_id'],
    );
    expect(message['author_id'], owner.actorId);
    final path = '/api/v1/workspaces/$id/source-file?id=${source['id']}';
    expect(await owner.getBytes(path), bytes);
    await expectLater(
      peer.getBytes(path),
      throwsA(
        isA<ApiError>().having((e) => e.status, 'access', anyOf(403, 404)),
      ),
    );
    final groupSnap = await peer.get('/api/v1/workspaces/$group/workspace');
    expect(
      (groupSnap['sources'] as List).where((s) => s['filename'] == name),
      isEmpty,
    );
    final after = await owner.get('/api/v1/personal-chats?thread=$id');
    expect(after['selection']['id'], group);
    expect(after['turns'], isEmpty);
  });
}
