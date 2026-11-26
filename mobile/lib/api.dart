import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'local_secure_storage.dart';
import 'installation.dart';

class ApiError implements Exception {
  const ApiError(this.status, this.code);
  final int status;
  final String code;
  @override
  String toString() => 'Richiesta non riuscita ($status · $code)';
}

class RimiamApi {
  RimiamApi(Uri destination)
    : origin = installationOrigin(destination.toString());
  final Uri origin;
  final HttpClient _http = HttpClient()
    ..connectionTimeout = const Duration(seconds: 15);
  String actorId = '';
  String? _token;
  String get _sessionKey =>
      'rimiam.session.v1.${base64Url.encode(utf8.encode(origin.origin))}';
  static const _sessionPath = '/api/v1/native/session';
  final _random = Random.secure();
  String newId() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    final h = bytes.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }

  Future<Map<String, dynamic>> get(String path) => _call('GET', path);
  Future<Map<String, dynamic>?> getOptional(String path) => _call('GET', path);
  Future<List<dynamic>> getList(String path) => _call('GET', path);
  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) =>
      _call('POST', path, body);
  Future<Uint8List> getBytes(String path) async {
    final res = await _response(
      'GET',
      path,
      accept: 'application/octet-stream',
    );
    return _boundedBytes(res, 8 * 1024 * 1024);
  }

  /// A call recording can exceed the attachment limit. Stream it to a
  /// caller-owned temporary file, with the same session and version checks.
  Future<void> downloadCallAudio(
    String workspace,
    String recording,
    File temp, {
    required bool Function() allowed,
  }) async {
    final actor = actorId;
    bool valid() => actor.isNotEmpty && actor == actorId && allowed();
    if (!valid()) throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
    final response = await _response(
      'GET',
      '/api/v1/workspaces/${Uri.encodeComponent(workspace)}/call-audio?id=${Uri.encodeQueryComponent(recording)}',
      accept: 'application/octet-stream',
    );
    const limit = 512 * 1024 * 1024;
    if (response.contentLength > limit || !valid()) {
      await response.listen((_) {}).cancel();
      if (!valid()) throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
      throw const FormatException('La registrazione supera 512 MiB.');
    }
    late final RandomAccessFile output;
    try {
      output = await temp.open(mode: FileMode.write);
    } catch (_) {
      await response.listen((_) {}).cancel();
      rethrow;
    }
    var size = 0;
    try {
      await for (final chunk in response.timeout(const Duration(seconds: 30))) {
        if (!valid()) throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
        size += chunk.length;
        if (size > limit)
          throw const FormatException('La registrazione supera 512 MiB.');
        await output.writeFrom(chunk);
      }
      if (size == 0 ||
          (response.contentLength >= 0 && size != response.contentLength))
        throw const FormatException('Scaricamento audio incompleto.');
    } finally {
      await output.close();
    }
  }

  static Future<Uint8List> _boundedBytes(
    HttpClientResponse res,
    int maximum,
  ) async {
    if (res.contentLength > maximum) {
      await res.listen((_) {}).cancel();
      throw const FormatException('Il file supera la dimensione consentita.');
    }
    final data = BytesBuilder(copy: false);
    await for (final chunk in res.timeout(const Duration(seconds: 30))) {
      if (data.length + chunk.length > maximum) {
        throw const FormatException('Il file supera la dimensione consentita.');
      }
      data.add(chunk);
    }
    return data.takeBytes();
  }

  Future<T> _call<T>(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final res = await _response(
      method,
      path,
      body: body,
      accept: 'application/json',
    );
    final text = await res
        .transform(utf8.decoder)
        .join()
        .timeout(const Duration(seconds: 30));
    if (text.isEmpty) return <String, dynamic>{} as T;
    return jsonDecode(text) as T;
  }

  Future<HttpClientResponse> _response(
    String method,
    String path, {
    Map<String, dynamic>? body,
    required String accept,
  }) async {
    final url = origin.resolve(path);
    if (!path.startsWith('/api/v1/') ||
        url.origin != origin.origin ||
        !url.path.startsWith('/api/v1/') ||
        url.hasFragment) {
      throw ArgumentError('Percorso non autorizzato');
    }
    final req = await _http.openUrl(method, url);
    req.followRedirects = false;
    req.headers.set(HttpHeaders.acceptHeader, accept);
    if (_token != null)
      req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $_token');
    if (body != null) {
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(body));
    }
    final res = await req.close().timeout(const Duration(seconds: 30));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      String code = 'REQUEST_FAILED';
      try {
        code =
            jsonDecode(
                  utf8.decode(await _boundedBytes(res, 32 * 1024)),
                )['error']['code']
                as String;
      } on Object {
        /* upstream can return HTML */
      }
      throw ApiError(res.statusCode, code);
    }
    if (res.headers.value('x-miriam-api-version') != '1') {
      await res.listen((_) {}).cancel();
      throw const FormatException('Versione API inattesa');
    }
    return res;
  }

  Future<void> login(String email, String password) async {
    final response = await post(_sessionPath, {
      'email': email,
      'password': password,
    });
    await _acceptIssuedSession(response);
  }

  Future<void> exchangeSocial({
    required String code,
    required String state,
    required String verifier,
  }) async {
    final response = await post('/api/v1/native/social/exchange', {
      'code': code,
      'state': state,
      'verifier': verifier,
    });
    await _acceptIssuedSession(response);
  }

  Future<void> _acceptIssuedSession(Map<String, dynamic> response) async {
    final token = response['token'] as String;
    final actor = response['user']['id'] as String;
    if (token.isEmpty || actor.isEmpty)
      throw const FormatException('Sessione non valida.');
    _token = token;
    try {
      await _storeSession(token, closing: false);
    } catch (_) {
      // The device could not retain this newly issued credential. Revoke the
      // session where reachable; always discard the unsaved token in memory.
      try {
        await _call('DELETE', _sessionPath);
      } on Exception {
        // The server's expiry still applies when revocation cannot be reached.
      } finally {
        _token = null;
      }
      rethrow;
    }
    actorId = actor;
  }

  Future<void> _storeSession(String token, {required bool closing}) =>
      deviceSecureStorage.write(
        key: _sessionKey,
        value: jsonEncode({
          'token': token,
          'closing': closing,
          'origin': origin.origin,
        }),
      );

  // A valid token can outlive access. Re-read the current identity from the
  // server before letting any workspace open a locally stored draft.
  Future<bool> restoreSession() async {
    final stored = await deviceSecureStorage.read(key: _sessionKey);
    _token = null;
    actorId = '';
    if (stored == null) return false;
    final record = jsonDecode(stored);
    if (record is! Map ||
        record['origin'] != origin.origin ||
        record['token'] is! String ||
        (record['token'] as String).isEmpty ||
        record['closing'] is! bool) {
      throw const FormatException('Sessione salvata non leggibile.');
    }
    _token = record['token'] as String;
    if (record['closing'] == true) {
      await _finishLogout();
      return false;
    }
    try {
      final session = await get(_sessionPath);
      actorId = session['user']['id'] as String;
      return true;
    } on ApiError catch (error) {
      if (error.status != 401 && error.code != 'ACCOUNT_INELIGIBLE') rethrow;
      await deviceSecureStorage.delete(key: _sessionKey);
      _token = null;
      return false;
    }
  }

  Future<void> logout() async {
    final token = _token;
    if (token == null) return;
    await _storeSession(token, closing: true);
    await _finishLogout();
  }

  Future<void> _finishLogout() async {
    // Marked closing before the network call. Restart resumes the revocation
    // even when the previous process never received the server response.
    actorId = '';
    try {
      await _call('DELETE', _sessionPath);
    } on ApiError catch (error) {
      if (error.status != 401) rethrow;
    }
    await deviceSecureStorage.delete(key: _sessionKey);
    _token = null;
  }

  void close() => _http.close(force: true);
}
