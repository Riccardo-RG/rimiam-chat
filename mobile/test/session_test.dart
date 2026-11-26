import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/local_secure_storage.dart';

void main() {
  late HttpServer server;
  late Uri origin;
  final clients = <RimiamApi>[];
  int lookups = 0, revocations = 0, lookupStatus = 200;
  bool active = true, interruptLogout = false;
  RimiamApi open([Uri? target]) {
    final api = RimiamApi(target ?? origin);
    clients.add(api);
    return api;
  }

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    lookups = revocations = 0;
    lookupStatus = 200;
    active = true;
    interruptLogout = false;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    origin = Uri.parse('http://127.0.0.1:${server.port}');
    server.listen((request) async {
      final response = request.response;
      response.headers.contentType = ContentType.json;
      response.headers.set('x-miriam-api-version', '1');
      final token = request.headers.value('Authorization');
      Object result = {};
      if (request.method == 'POST' && token == null) {
        result = {
          'token': 'test-credential',
          'user': {'id': 'alice'},
        };
      } else if (!active || token != 'Bearer test-credential') {
        response.statusCode = 401;
        result = {
          'error': {'code': 'AUTHENTICATION_REQUIRED'},
        };
      } else if (request.uri.path.startsWith('/api/v1/files/')) {
        if (request.uri.path.endsWith('redirect')) {
          response.statusCode = 302;
          response.headers.set('location', '/api/v1/files/ok');
        } else {
          response.headers.contentType = ContentType.binary;
          if (request.uri.path.endsWith('large')) {
            // Chunked response, as some reverse proxies omit Content-Length.
            final block = List<int>.filled(1024 * 1024, 0);
            for (var n = 0; n < 9; n++) {
              response.add(block);
            }
          } else {
            response.add([255, 0, 193]);
          }
        }
        await response.close();
        return;
      } else if (request.method == 'GET') {
        lookups++;
        response.statusCode = lookupStatus;
        result = lookupStatus == 200
            ? {
                'user': {'id': 'alice'},
              }
            : {
                'error': {'code': 'TEMPORARILY_UNAVAILABLE'},
              };
      } else if (request.method == 'DELETE') {
        revocations++;
        active = false;
        if (interruptLogout) response.statusCode = 503;
      }
      response.write(jsonEncode(result));
      await response.close();
    });
  });

  tearDown(() async {
    for (final client in clients) {
      client.close();
    }
    clients.clear();
    await server.close(force: true);
  });

  test('binary source reads retain auth, refuse redirects and bound a chunked body', () async {
    final api = open();
    await expectLater(
      api.getBytes('/api/v1/files/ok'),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 401)),
    );
    await api.login('tester@example.test', 'synthetic-password');
    expect(await api.getBytes('/api/v1/files/ok'), [255, 0, 193]);
    await expectLater(
      api.getBytes('/api/v1/files/redirect'),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 302)),
    );
    await expectLater(
      api.getBytes('/api/v1/files/large'),
      throwsFormatException,
    );
    await expectLater(
      api.getBytes('https://other.example/api/v1/files/ok'),
      throwsArgumentError,
    );
  });

  test(
    'a new process verifies the identity with the same installation',
    () async {
      await open().login('tester@example.test', 'synthetic-password');
      final restored = open();
      expect(await restored.restoreSession(), isTrue);
      expect(restored.actorId, 'alice');
      expect(lookups, 1);
      final storage = await deviceSecureStorage.readAll();
      expect(storage.values.single, isNot(contains('synthetic-password')));
      expect(
        await open(origin.replace(host: 'localhost')).restoreSession(),
        isFalse,
      );
      expect(lookups, 1);
    },
  );

  test(
    'a temporary lookup failure keeps the credential; revocation clears it',
    () async {
      await open().login('tester@example.test', 'synthetic-password');
      lookupStatus = 503;
      final restored = open();
      await expectLater(restored.restoreSession(), throwsA(isA<ApiError>()));
      expect(restored.actorId, isEmpty);
      lookupStatus = 200;
      expect(await restored.restoreSession(), isTrue);
      active = false;
      expect(await restored.restoreSession(), isFalse);
      expect(restored.actorId, isEmpty);
      expect(await deviceSecureStorage.readAll(), isEmpty);
    },
  );

  test(
    'an interrupted sign-out never restores the previous workspace',
    () async {
      final signedIn = open();
      await signedIn.login('tester@example.test', 'synthetic-password');
      interruptLogout = true;
      await expectLater(signedIn.logout(), throwsA(isA<ApiError>()));
      expect(signedIn.actorId, isEmpty);
      expect(
        jsonDecode(
          (await deviceSecureStorage.readAll()).values.single,
        )['closing'],
        true,
      );
      expect(await open().restoreSession(), isFalse);
      expect(revocations, 1);
      expect(lookups, 0);
      expect(await deviceSecureStorage.readAll(), isEmpty);
    },
  );
}
