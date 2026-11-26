import 'dart:convert';
import 'dart:io';

part 'push_android_host.dart';
part 'push_apple_host.dart';

/// Only called on the disposable host created by prepare_host.dart.
Future<void> configurePushHost(
  Directory host, {
  Map<String, String>? environment,
}) async {
  final env = environment ?? Platform.environment;
  Future<void> change(String path, String needle, String replacement) async {
    final file = File('${host.path}/$path');
    final original = await file.readAsString();
    if (needle.allMatches(original).length != 1)
      throw StateError('Template notifiche inatteso in $path');
    await file.writeAsString(original.replaceFirst(needle, replacement));
  }

  final apple = env['RIMIAM_IOS_APNS_ENVIRONMENT'];
  if (apple != null && !['development', 'production'].contains(apple))
    throw ArgumentError(
      'RIMIAM_IOS_APNS_ENVIRONMENT richiede development o production.',
    );
  await configureApplePush(host, change, apple);
  await configureAndroidPush(
    host,
    change,
    env['RIMIAM_ANDROID_GOOGLE_SERVICES_FILE'],
  );
}

typedef HostChange = Future<void> Function(
  String path,
  String needle,
  String replacement,
);
