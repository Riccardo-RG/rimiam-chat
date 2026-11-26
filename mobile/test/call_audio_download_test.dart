import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';

void main() {
  test('scarica registrazioni superiori a 8 MiB in file temporaneo solo dall’installazione e ferma il trasferimento al cambio di sessione', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final api = RimiamApi(Uri.parse('http://127.0.0.1:${server.port}'))
      ..actorId = 'test-user';
    final dir = await Directory.systemTemp.createTemp('call-stream-test-');
    addTearDown(() async {
      api.close();
      await server.close(force: true);
      await dir.delete(recursive: true);
    });
    final data = Uint8List(64 * 1024);
    final total = data.length * 144;
    final route = <String>[];
    server.listen((request) async {
      final out = request.response;
      try {
        route.add(request.uri.toString());
        out.headers.set('x-miriam-api-version', '1');
        if (request.uri.queryParameters['id'] == 'too-large') {
          out.contentLength = 513 * 1024 * 1024;
          out.add(data);
          await out.flush();
        } else {
          out.contentLength = total;
          for (var n = 0; n < 144; n++) {
            out.add(data);
            if (n % 16 == 0) await out.flush();
          }
        }
        await out.close();
      } on IOException {
        /* The cancellation scenarios close the connection. */
      }
    });
    final local = File('${dir.path}/audio.mp3');
    await api.downloadCallAudio('room', 'allowed', local, allowed: () => true);
    expect(await local.length(), total);
    expect(route.first, '/api/v1/workspaces/room/call-audio?id=allowed');
    await expectLater(
      api.downloadCallAudio('room', 'too-large', local, allowed: () => true),
      throwsFormatException,
    );
    var checks = 0;
    await expectLater(
      api.downloadCallAudio(
        'room',
        'cancel',
        local,
        allowed: () => ++checks < 5,
      ),
      throwsA(isA<ApiError>()),
    );
    expect(await local.length(), lessThan(total));
  });
}
