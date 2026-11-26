import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const deviceSecureStorage = FlutterSecureStorage(
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.unlocked_this_device,
  ),
  aOptions: AndroidOptions(resetOnError: false),
);
