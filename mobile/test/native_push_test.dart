import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:rimiam_mobile/api.dart';
import 'package:rimiam_mobile/native_push.dart';

const workspace = 'b05da1aa-fd1d-491b-a51d-ec8cd00409b6',
    deviceId = '60d1c461-0225-442e-b60a-dc902617370b',
    delivery = '5c3c7df8-d2d5-4f67-8943-146454d48c12',
    message = 'd10b4f39-60da-4611-a62c-390aa27ccd33';
const address = (id: delivery, deviceId: deviceId);
const channel = MethodChannel('rimiam/native_push');

class TestApi extends RimiamApi {
  TestApi([String host = 'https://example.test']) : super(Uri.parse(host)) {
    actorId = 'recipient';
  }
  bool optedIn = false, configured = true;
  final paths = <String>[], writes = <Map<String, dynamic>>[];
  int? reject;
  @override
  Future<Map<String, dynamic>> get(String path) async {
    paths.add(path);
    if (reject != null) throw ApiError(reject!, 'PUSH_DELIVERY_UNAVAILABLE');
    if (path.contains('/target?'))
      return {'workspaceId': workspace, 'messageId': message};
    return {
      'configured': configured,
      'optedIn': optedIn,
      'enabled': optedIn,
      'deviceId': optedIn ? deviceId : null,
    };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    writes.add(body);
    optedIn = body['operation'] == 'enable';
    return {'enabled': optedIn, 'deviceId': deviceId};
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late TestApi api;
  late bool allowed, osConfigured;
  late String token;
  Object? pending;
  late List<String> native;
  bool failReading = false;
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    api = TestApi();
    native = [];
    allowed = true;
    osConfigured = true;
    token = 'a' * 64;
    pending = null;
    failReading = false;
    messenger.setMockMethodCallHandler(channel, (call) async {
      native.add(call.method);
      return switch (call.method) {
        'status' => {'configured': osConfigured, 'allowed': allowed},
        'request' => allowed,
        'token' =>
          failReading ? throw PlatformException(code: 'unavailable') : token,
        'pending' => pending,
        'ack' => pending = null,
        _ => null,
      };
    });
  });
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));
  test('individua soltanto l’indirizzo opaco delle notifiche APNs attuali, precedenti e FCM', () {
    expect(
      notificationAddress({
        'body': {'id': delivery, 'deviceId': deviceId},
      }),
      address,
    );
    expect(
      notificationAddress({
        'id': delivery,
        'deviceId': deviceId,
        'workspaceId': 'forged',
      }),
      address,
    );
    expect(
      notificationAddress({
        'deviceId': deviceId,
        'url': 'https://example.test',
      }),
      null,
    );
    expect(notificationAddress({'id': '?a=b', 'deviceId': deviceId}), null);
  });
  test('il consenso usa una installazione stabile per origine e un vincolo distinto per account', () async {
    final reg = PushRegistration(api, NativePushDevice.instance, 'apns');
    allowed = false;
    expect(await reg.enable(workspace), isFalse);
    expect(api.writes, isEmpty);
    expect(native, isNot(contains('token')));
    allowed = true;
    await reg.enable(workspace);
    final first = api.writes.single;
    expect(first, containsPair('consent', true));
    expect(first['subscription'], {'provider': 'apns', 'token': token});
    expect(first['localizedAlerts'], true);
    await reg.enable(workspace);
    expect(api.writes.last['installation'], first['installation']);
    expect(await reg.resolve(address), (
      workspaceId: workspace,
      messageId: message,
    ));
    expect(api.paths.last, contains('anchor=message'));
    api.actorId = 'other';
    expect(await reg.resolve(address), null);
    expect((await reg.binding()), isEmpty);
    final another = PushRegistration(
      TestApi('https://other.test'),
      NativePushDevice.instance,
      'apns',
    );
    expect(await another.resolve(address), null);
    await reg.enable(workspace);
    expect(api.writes.last['installation'], first['installation']);
  });
  testWidgets(
    'assenza della configurazione, token cambiato e provider irraggiungibile conservano la possibilità di revocare',
    (t) async {
      Future<void> render() async {
        await t.pumpWidget(
          MaterialApp(
            home: NativePushSettings(
              key: UniqueKey(),
              api: api,
              workspaceId: workspace,
            ),
          ),
        );
        await t.pumpAndSettle();
      }

      api.configured = false;
      await render();
      expect(find.textContaining('Il gestore deve'), findsOneWidget);
      expect(find.text('Attiva per questo spazio'), findsNothing);
      expect(native, isNot(contains('request')));
      api.configured = true;
      osConfigured = true;
      await render();
      await t.tap(find.text('Attiva per questo spazio'));
      await t.pumpAndSettle();
      expect(find.text('Avvisi attivi per questo spazio.'), findsOneWidget);
      token = 'b' * 64;
      await render();
      expect(find.text('Attiva per questo spazio'), findsOneWidget);
      expect(api.writes.length, 1);
      failReading = true;
      await render();
      expect(find.text('Riprova verifica'), findsOneWidget);
      await t.tap(find.text('Disattiva per questo spazio'));
      await t.pumpAndSettle();
      expect(api.writes.last, {
        'operation': 'disable',
        'deviceId': deviceId,
        'workspaceId': workspace,
        'provider': 'fcm',
      });
      expect(api.optedIn, isFalse);
    },
  );
  testWidgets(
    'il tocco risolve il messaggio, riprova dopo un errore temporaneo, scarta una revoca e ignora avvisi di un altro account',
    (t) async {
      final reg = PushRegistration.forApi(api);
      await reg.enable(workspace);
      final opened = <PushDestination>[];
      Future<void> visit() async {
        pending = {
          'body': {'id': delivery, 'deviceId': deviceId},
        };
        await t.pumpWidget(
          MaterialApp(
            home: NativePushNavigation(
              key: UniqueKey(),
              api: api,
              onOpen: (id, m) => opened.add((workspaceId: id, messageId: m)),
              child: const SizedBox(),
            ),
          ),
        );
        await t.pumpAndSettle();
      }

      api.reject = 503;
      await visit();
      expect(opened, isEmpty);
      expect(pending, isNotNull);
      api.reject = null;
      await visit();
      expect(opened, [(workspaceId: workspace, messageId: message)]);
      expect(pending, null);
      api.reject = 404;
      await visit();
      expect(opened.length, 1);
      expect(pending, null);
      api.actorId = 'other';
      api.reject = null;
      final requests = api.paths.length;
      await visit();
      expect(api.paths.length, requests);
      expect(opened.length, 1);
      expect(pending, null);
    },
  );
}
