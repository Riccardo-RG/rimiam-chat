import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'chat_journal.dart';

class SocialSignIn {
  SocialSignIn(this.api, this.vault, {this.open = _systemBrowser});
  final RimiamApi api;
  final DraftVault vault;
  final Future<bool> Function(Uri) open;
  bool _exchanging = false;
  String get _key =>
      'rimiam.oauth.v1.${sha256.convert(utf8.encode(api.origin.origin))}';
  static Future<bool> _systemBrowser(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);
  static final _random = Random.secure();
  static String _nonce() => List.generate(
    32,
    (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  Future<void> clear() => vault.replace(_key, null);

  Future<void> start(String provider) async {
    if (!const {'google', 'microsoft'}.contains(provider))
      throw ArgumentError.value(provider);
    final state = _nonce(), verifier = _nonce();
    final challenge = base64Url
        .encode(sha256.convert(utf8.encode(verifier)).bytes)
        .replaceAll('=', '');
    await vault.replace(
      _key,
      jsonEncode({
        'origin': api.origin.origin,
        'state': state,
        'verifier': verifier,
        'expires': DateTime.now()
            .add(const Duration(minutes: 15))
            .millisecondsSinceEpoch,
      }),
    );
    final uri = api.origin.replace(
      path: '/account/native',
      queryParameters: {
        'provider': provider,
        'state': state,
        'challenge': challenge,
      },
    );
    try {
      if (await open(uri)) return;
    } on Exception {
      // The platform launcher can throw instead of returning false.
    }
    await clear();
    throw const FormatException('Impossibile aprire il browser di sistema.');
  }

  Future<bool> complete(Uri uri) async {
    if (uri.scheme != 'com.rimiam.chat' ||
        uri.hasAuthority ||
        uri.path != '/oauth/complete' ||
        uri.hasFragment ||
        _exchanging)
      return false;
    _exchanging = true;
    try {
      final raw = await vault.read(_key);
      if (raw == null) return false;
      final attempt = jsonDecode(raw) as Map<String, dynamic>;
      final state = attempt['state'], verifier = attempt['verifier'];
      final hex = RegExp(r'^[a-f0-9]{64}$');
      if (attempt['origin'] != api.origin.origin ||
          state is! String ||
          !hex.hasMatch(state) ||
          verifier is! String ||
          !hex.hasMatch(verifier) ||
          (attempt['expires'] as int) <=
              DateTime.now().millisecondsSinceEpoch) {
        await clear();
        throw const FormatException('Accesso scaduto. Avvialo di nuovo.');
      }
      final params = uri.queryParametersAll;
      if (params['state']?.length != 1 || params['state']!.single != state)
        return false;
      try {
        if (params.containsKey('error'))
          throw const FormatException(
            'Accesso interrotto dal servizio di identità.',
          );
        final codes = params['code'];
        if (codes == null ||
            codes.length != 1 ||
            !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(codes.single))
          throw const FormatException('Il codice di accesso non è valido.');
        await api.exchangeSocial(
          code: codes.single,
          state: state,
          verifier: verifier,
        );
        return true;
      } finally {
        await clear();
      }
    } finally {
      _exchanging = false;
    }
  }
}
