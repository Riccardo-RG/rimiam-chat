import 'ui_language.dart';

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'local_secure_storage.dart';

part 'native_push_settings.dart';

const _path = '/api/v1/native/push';
final _uuid = RegExp(
  r'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$',
  caseSensitive: false,
);
String _hash(String value) => sha256.convert(utf8.encode(value)).toString();

typedef PushAddress = ({String id, String deviceId});
typedef PushDestination = ({String workspaceId, String? messageId});

PushAddress? notificationAddress(Object? value) {
  if (value is! Map) return null;
  final data = value['body'] is Map ? value['body'] as Map : value;
  final id = data['id'], device = data['deviceId'];
  return id is String &&
          _uuid.hasMatch(id) &&
          device is String &&
          _uuid.hasMatch(device)
      ? (id: id, deviceId: device)
      : null;
}

class NativePushDevice {
  NativePushDevice(this.channel) {
    channel.setMethodCallHandler((call) async {
      if (call.method == 'notice' || call.method == 'tokenChanged')
        _events.add(call.method);
    });
  }
  static final instance = NativePushDevice(
    const MethodChannel('rimiam/native_push'),
  );
  final MethodChannel channel;
  final _events = StreamController<String>.broadcast();
  Stream<String> get events => _events.stream;
  Future<Map<String, dynamic>> status() async =>
      await channel.invokeMapMethod<String, dynamic>('status') ?? {};
  Future<bool> requestPermission() async =>
      await channel.invokeMethod<bool>('request') == true;
  Future<void> settings() => channel.invokeMethod<void>('settings');
  Future<String> token() async {
    final token = await channel
        .invokeMethod<String>('token')
        .timeout(const Duration(seconds: 15));
    if (token == null || token.isEmpty)
      throw const FormatException('Token dispositivo assente');
    return token;
  }

  Future<PushAddress?> pending() async =>
      notificationAddress(await channel.invokeMethod('pending'));
  Future<void> acknowledge(PushAddress address) => channel.invokeMethod<void>(
    'ack',
    {'id': address.id, 'deviceId': address.deviceId},
  );
}

class PushRegistration {
  PushRegistration(this.api, this.device, this.provider);
  factory PushRegistration.forApi(RimiamApi api) => PushRegistration(
    api,
    NativePushDevice.instance,
    Platform.isIOS ? 'apns' : 'fcm',
  );
  final RimiamApi api;
  final NativePushDevice device;
  final String provider;
  String get _scope =>
      'rimiam.push.v1.${_hash('$provider:${api.origin.origin}')}';
  String get _binding => '$_scope.account.${_hash(api.actorId)}';
  static final _creating = <String, Future<String>>{};
  Future<String> _installation() {
    final key = '$_scope.installation';
    return _creating.putIfAbsent(key, () async {
      try {
        final previous = await deviceSecureStorage.read(key: key);
        if (previous != null && _uuid.hasMatch(previous)) return previous;
        final id = api.newId();
        await deviceSecureStorage.write(key: key, value: id);
        return id;
      } finally {
        _creating.remove(key);
      }
    });
  }

  Future<Map<String, dynamic>> binding() async {
    final old = await deviceSecureStorage.read(key: _binding);
    if (old == null) return {};
    final entry = jsonDecode(old);
    if (entry is! Map<String, dynamic> ||
        entry['deviceId'] is! String ||
        !_uuid.hasMatch(entry['deviceId']) ||
        entry['tokenHash'] is! String)
      return {};
    return entry;
  }

  Future<Map<String, dynamic>> preference(
    String workspaceId,
    Map<String, dynamic> saved,
  ) => api.get(
    Uri(
      path: _path,
      queryParameters: {
        'workspace': workspaceId,
        'provider': provider,
        if (saved['deviceId'] is String) 'device': saved['deviceId'] as String,
      },
    ).toString(),
  );
  Future<bool> enable(String workspaceId) async {
    final actor = api.actorId, key = _binding;
    if (!await device.requestPermission()) return false;
    final token = await device.token(), installation = await _installation();
    if (actor.isEmpty || actor != api.actorId)
      throw StateError('Sessione cambiata');
    final result = await api.post(_path, {
      'operation': 'enable',
      'workspaceId': workspaceId,
      'consent': true,
      'installation': installation,
      'localizedAlerts': true,
      'subscription': {'provider': provider, 'token': token},
    });
    final id = result['deviceId'];
    if (id is! String || !_uuid.hasMatch(id) || result['enabled'] != true)
      throw const FormatException('Conferma dispositivo assente');
    await deviceSecureStorage.write(
      key: key,
      value: jsonEncode({'deviceId': id, 'tokenHash': _hash(token)}),
    );
    return true;
  }

  Future<void> disable(String workspaceId, String id) => api.post(_path, {
    'operation': 'disable',
    'workspaceId': workspaceId,
    'deviceId': id,
    'provider': provider,
  });
  Future<PushDestination?> resolve(PushAddress address) async {
    final actor = api.actorId;
    if (actor.isEmpty ||
        (await binding())['deviceId'] != address.deviceId ||
        api.actorId != actor)
      return null;
    final result = await api.get(
      Uri(
        path: '$_path/target',
        queryParameters: {
          'id': address.id,
          'device': address.deviceId,
          'anchor': 'message',
        },
      ).toString(),
    );
    final workspace = result['workspaceId'], message = result['messageId'];
    if (actor != api.actorId ||
        workspace is! String ||
        !_uuid.hasMatch(workspace) ||
        (message != null && (message is! String || !_uuid.hasMatch(message))))
      return null;
    return (workspaceId: workspace, messageId: message as String?);
  }
}

class NativePushNavigation extends StatefulWidget {
  const NativePushNavigation({
    super.key,
    required this.api,
    required this.onOpen,
    required this.child,
  });
  final RimiamApi api;
  final FutureOr<void> Function(String workspaceId, String? messageId) onOpen;
  final Widget child;
  @override
  State<NativePushNavigation> createState() => _NativePushNavigationState();
}

class _NativePushNavigationState extends State<NativePushNavigation>
    with WidgetsBindingObserver {
  late final StreamSubscription<String> _listener;
  bool _checking = false, _queued = false;
  PushAddress? _handled;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _listener = NativePushDevice.instance.events
        .where((event) => event == 'notice')
        .listen((_) {
          unawaited(_open());
        });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_open());
    });
  }

  @override
  void didUpdateWidget(NativePushNavigation old) {
    super.didUpdateWidget(old);
    if (old.api != widget.api) {
      _handled = null;
      unawaited(_open());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_open());
  }

  Future<void> _open() async {
    if (_checking) {
      _queued = true;
      return;
    }
    _checking = true;
    final device = NativePushDevice.instance,
        api = widget.api,
        actor = api.actorId;
    PushAddress? address;
    try {
      address = await device.pending();
      if (address == null ||
          !mounted ||
          widget.api != api ||
          api.actorId != actor ||
          actor.isEmpty)
        return;
      if (_handled != address) {
        final target = await PushRegistration.forApi(api).resolve(address);
        if (!mounted || widget.api != api || api.actorId != actor) return;
        if (target != null) {
          await widget.onOpen(target.workspaceId, target.messageId);
          _handled = address;
        }
      }
      await device.acknowledge(address);
    } on ApiError catch (error) {
      // A transient outage keeps the tapped address for the next foreground visit.
      // A rejected address belongs to an expired session, opt-in or membership.
      if (address != null &&
          [401, 403, 404].contains(error.status) &&
          mounted &&
          widget.api == api &&
          api.actorId == actor) {
        try {
          await device.acknowledge(address);
        } on PlatformException {
          /* Retried on resume. */
        }
      }
    } on Object {
      /* Widget tests, other platforms, locked storage and offline startup can omit push. */
    } finally {
      _checking = false;
      if (_queued && mounted) {
        _queued = false;
        unawaited(_open());
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _listener.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
