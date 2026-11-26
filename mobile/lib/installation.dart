import 'dart:io';

import 'package:flutter/foundation.dart';

Uri installationOrigin(String value, {bool allowEmulator = kDebugMode}) {
  const problem = FormatException(
    'Indica l’indirizzo HTTPS di RIMIAM, senza percorso.',
  );
  final input = value.trim();
  final uri = Uri.tryParse(input);
  if (uri == null ||
      uri.host.isEmpty ||
      input.contains('@') ||
      RegExp(r'[\s\\]').hasMatch(input) ||
      uri.hasQuery ||
      uri.hasFragment ||
      (uri.path.isNotEmpty && uri.path != '/')) {
    throw problem;
  }
  final local = {
    '127.0.0.1',
    'localhost',
    '::1',
    '10.0.2.2',
  }.contains(uri.host);
  if (uri.scheme != 'https' &&
      !(allowEmulator && local && uri.scheme == 'http')) {
    throw problem;
  }
  if (uri.hasPort && (uri.port <= 0 || uri.port > 65535)) throw problem;
  return Uri.parse(uri.origin);
}

String defaultInstallation() {
  const configured = String.fromEnvironment('RIMIAM_ORIGIN');
  if (configured.isNotEmpty) return configured;
  if (!kDebugMode) return '';
  const port = int.fromEnvironment('RIMIAM_TEST_PORT', defaultValue: 4633);
  return Uri(
    scheme: 'http',
    host: Platform.isAndroid ? '10.0.2.2' : '127.0.0.1',
    port: port,
  ).origin;
}
