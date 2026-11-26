import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'api.dart';
import 'chat_journal.dart';

/// Store a single unresolved command for this account/installation. A manual
/// retry checks the server receipt before submitting the identical operation.
class WorkspaceCommandJournal {
  WorkspaceCommandJournal(
    this.api,
    this.vault, {
    required String namespace,
    String? collection,
  }) : actor = api.actorId,
       scope =
           'rimiam.$namespace.v1.${sha256.convert(utf8.encode(jsonEncode([api.origin.origin, api.actorId, if (collection != null) collection])))}';
  final RimiamApi api;
  final DraftVault vault;
  final String actor, scope;
  Map<String, dynamic>? pending, draft;
  bool busy = false;
  Future<void> _writes = Future.value();
  Future<void> store() {
    final value = (pending == null && draft == null)
        ? null
        : jsonEncode({'v': 1, 'pending': pending, 'draft': draft});
    final write = _writes.then((_) => vault.replace(scope, value));
    _writes = write.then((_) {}, onError: (Object _, StackTrace __) {});
    return write;
  }

  Future<void> load() async {
    await _writes;
    final raw = await vault.read(scope);
    final record = raw == null ? null : jsonDecode(raw) as Map<String, dynamic>;
    if (record != null && record['v'] != 1)
      throw const FormatException('Archivio comandi non riconosciuto');
    pending = record?['pending'] as Map<String, dynamic>?;
    draft = record?['draft'] as Map<String, dynamic>?;
  }

  Future<void> stopVerification() async {
    if (busy) throw StateError('Operazione in corso');
    final request = pending;
    if (request == null) return;
    final original = draft;
    busy = true;
    pending = null;
    if (request['fromEditor'] == true) draft = null;
    try {
      await store();
    } catch (_) {
      pending = request;
      draft = original;
      rethrow;
    } finally {
      busy = false;
    }
  }

  Future<Map<String, dynamic>> send(
    String workspace,
    Map<String, dynamic> command, {
    required bool Function() allowed,
    bool fromEditor = false,
    Future<Map<String, dynamic>> Function()? materialize,
  }) async {
    if (busy) throw StateError('Operazione in corso');
    if (!allowed() || api.actorId != actor)
      throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
    if (pending != null &&
        (pending!['space'] != workspace ||
            jsonEncode(pending!['command']) != jsonEncode(command)))
      throw StateError('Verifica prima il salvataggio precedente.');
    final retry = pending != null;
    final request =
        pending ??
        {
          'id': api.newId(),
          'space': workspace,
          'command': command,
          'fromEditor': fromEditor,
        };
    final id = request['id'] as String;
    final path = '/api/v1/workspaces/${Uri.encodeComponent(workspace)}';
    busy = true;
    try {
      pending = request;
      await store();
      if (!allowed() || api.actorId != actor)
        throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
      Map<String, dynamic>? confirmed;
      if (retry) {
        try {
          final r = await api.get('$path/receipts/$id');
          confirmed = _receipt(r, id);
        } on ApiError catch (e) {
          if (e.status != 404 || e.code != 'RECEIPT_NOT_FOUND') rethrow;
        }
      }
      if (confirmed == null) {
        // Large binary payloads stay in protected staging until the server
        // actually needs them. The durable intent contains their digest.
        final wire = materialize == null ? command : await materialize();
        if (!allowed() || api.actorId != actor)
          throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
        try {
          confirmed = _receipt(
            await api.post('$path/commands', {
              'commandId': id,
              'expectedActorId': actor,
              'command': wire,
            }),
            id,
          );
        } on ApiError catch (e) {
          // A definitive validation or authority rejection performed no command.
          if ({400, 403, 404, 409, 422}.contains(e.status)) {
            pending = null;
            await store();
          }
          rethrow;
        }
      }
      final original = draft;
      pending = null;
      if (request['fromEditor'] == true) draft = null;
      try {
        await store();
      } catch (_) {
        pending = request;
        draft = original;
        rethrow;
      }
      return confirmed;
    } finally {
      busy = false;
    }
  }

  Map<String, dynamic> _receipt(Map<String, dynamic> result, String id) {
    if (result['commandId'] != id || result['status'] != 'committed')
      throw const FormatException('Ricevuta non riconosciuta');
    return (result['result'] as Map<String, dynamic>?) ?? {};
  }
}
