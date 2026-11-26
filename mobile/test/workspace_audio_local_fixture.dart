// Only run against the synthetic, provider-disabled two-member fixture on 3102.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/call_session.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_command_journal.dart';

Uint8List _quietWav() {
  final b = Uint8List(1644), v = ByteData.sublistView(b);
  void text(int start, String value) => b.setAll(start, ascii.encode(value));
  text(0, 'RIFF');
  v.setUint32(4, b.length - 8, Endian.little);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, Endian.little);
  v.setUint16(20, 1, Endian.little);
  v.setUint16(22, 1, Endian.little);
  v.setUint32(24, 8000, Endian.little);
  v.setUint32(28, 16000, Endian.little);
  v.setUint16(32, 2, Endian.little);
  v.setUint16(34, 16, Endian.little);
  text(36, 'data');
  v.setUint32(40, b.length - 44, Endian.little);
  return b;
}

void main() {
  test('due utenti, vocale sintetico scaricabile e chiamate chiaramente disattivate nella fixture', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final origin = Uri.parse('http://127.0.0.1:3102'),
        a = RimiamApi(origin),
        b = RimiamApi(origin);
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
    final rooms = (await a.get('/api/v1/workspaces'))['workspaces'] as List;
    final w =
            rooms.singleWhere(
                  (r) => r['name'] == 'Native shared verification',
                )['id']
                as String,
        base = '/api/v1/workspaces/$w';
    final calls = await b.get('$base/calls');
    expect(calls['configured'], false);
    expect(consentWordings, contains(calls['currentConsentText']));
    final before = await a.get('$base/voice');
    expect(
      before['transcriptionConfigured'],
      false,
      reason: 'Eseguire soltanto con provider disattivati',
    );
    final bytes = _quietWav();
    final journal = WorkspaceCommandJournal(
      a,
      const DeviceDraftVault(),
      namespace: 'test-voice',
      collection: w,
    );
    final result = await journal.send(w, {
      'type': 'voice.send',
      'filename': 'Collaudo.wav',
      'bytesBase64': base64Encode(bytes),
      'mode': 'message',
      'allowModelProcessing': true,
    }, allowed: () => true);
    final after = (await b.get('$base/voice'))['messages'] as List;
    expect(
      after.where(
        (r) =>
            r['messageId'] == result['messageId'] &&
            r['sourceId'] == result['sourceId'] &&
            r['mode'] == 'message',
      ),
      hasLength(1),
    );
    expect(
      await b.getBytes('$base/source-file?id=${result['sourceId']}'),
      orderedEquals(bytes),
    );
  });
}
