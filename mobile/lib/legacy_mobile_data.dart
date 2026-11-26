import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter/services.dart';

import 'api.dart';
import 'attachment_staging.dart';
import 'chat_journal.dart' show ChatJournal, DraftVault;
import 'direct_view.dart';

final _id = RegExp(
  r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
typedef LegacyJson = Map<String, dynamic>;

enum LegacyKind { workspace, direct, personal, creation }

class LegacyScope {
  const LegacyScope.workspace(this.id) : kind = LegacyKind.workspace;
  const LegacyScope.direct(this.id) : kind = LegacyKind.direct;
  const LegacyScope.personal(this.id) : kind = LegacyKind.personal;
  const LegacyScope.creation() : kind = LegacyKind.creation, id = '';
  final String id;
  final LegacyKind kind;
  String digest(String origin, String actor, {bool leaving = false}) => sha256
      .convert(
        utf8.encode(
          jsonEncode([
            origin,
            actor,
            switch (kind) {
              LegacyKind.direct => 'direct:$id',
              LegacyKind.creation => 'create',
              _ => id,
            },
            if (leaving) 'call-exit',
          ]),
        ),
      )
      .toString();
}

/// This adapter intentionally cannot read an old session credential. A record is
/// addressed by the same origin/actor/scope digest used in the old Expo journal.
class ExpoDraftStorage {
  const ExpoDraftStorage();
  static const _channel = MethodChannel('rimiam/legacy_drafts');
  Future<bool> has(String key) async {
    try {
      return await _channel.invokeMethod<bool>('has', key) == true;
    } on MissingPluginException {
      return false;
    }
  }

  Future<String?> read(String key) =>
      _channel.invokeMethod<String>('read', key);
  Future<Map<String, String>> roots() async =>
      await _channel.invokeMapMethod<String, String>('roots') ?? {};
  Future<LegacyJson?> record(String key) async {
    final raw = await read(key);
    if (raw == null) return null;
    final index = jsonDecode(raw);
    if (index is! Map ||
        index['id'] is! String ||
        !_id.hasMatch(index['id']) ||
        index['count'] is! int ||
        index['count'] < 1 ||
        index['count'] > 220)
      throw const FormatException('Indice della bozza precedente non valido.');
    final id = index['id'] as String, parts = StringBuffer();
    for (var i = 0; i < index['count']; i++) {
      final part = await read('$key.$id.$i');
      if (part == null || part.runes.length > 350)
        throw const FormatException(
          'Una parte della bozza precedente è illeggibile.',
        );
      parts.write(part);
    }
    final intent = jsonDecode(parts.toString());
    if (intent is! LegacyJson || await read(key) != raw)
      throw const FormatException('La bozza precedente è cambiata. Riprova.');
    return {'id': id, 'intent': intent};
  }

  // Android user 0 can name the same private directory in either form.
  // The verified platform root fixes both package and directory boundaries.
  static String? androidRelativePath(String path, String root) {
    String normalize(String value) => value.startsWith('/data/data/')
        ? value.replaceFirst('/data/data/', '/data/user/0/')
        : value;
    final current = normalize(root);
    final previous = normalize(path);
    if (!current.startsWith('/data/user/0/') ||
        !previous.startsWith('$current/'))
      return null;
    return previous.substring(current.length + 1);
  }

  Future<Uint8List> file(LegacyJson meta) async {
    final raw = meta['uri'],
        size = meta['size'],
        digest = meta['hash'],
        name = meta['filename'];
    if (raw is! String ||
        name is! String ||
        !AttachmentStaging.validName(name) ||
        size is! int ||
        size <= 0 ||
        size > 8 * 1024 * 1024 ||
        digest is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(digest))
      throw const FormatException('Riferimento al file non valido.');
    final uri = Uri.tryParse(raw);
    if (uri == null ||
        uri.scheme != 'file' ||
        uri.host.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        !uri.path.startsWith('/'))
      throw const FormatException('Percorso file non valido.');
    // Validate before Uri normalization. No network paths, encoded separators,
    // dot components or symlinks may escape the current app's own directories.
    final afterScheme = raw.substring('file:'.length);
    final path = Uri.decodeComponent(
      afterScheme.startsWith('//') ? afterScheme.substring(2) : afterScheme,
    );
    if (!path.startsWith('/') || path.startsWith('//'))
      throw const FormatException('Percorso file non valido.');
    if (RegExp(r'%(?:2f|5c|00)', caseSensitive: false).hasMatch(raw) ||
        path.contains('\\') ||
        path.contains('\u0000') ||
        path.split('/').any((s) => s == '.' || s == '..'))
      throw const FormatException('Percorso del file non consentito.');
    final available = await roots();
    for (final entry in available.entries) {
      final root = entry.value.replaceFirst(RegExp(r'/$'), '');
      String? relative;
      if (path.startsWith('$root/')) {
        relative = path.substring(root.length + 1);
      } else if (available.containsKey('temporary')) {
        final suffix = switch (entry.key) {
          'documents' => 'Documents',
          'cache' => 'Library/Caches',
          'temporary' => 'tmp',
          _ => null,
        };
        if (suffix != null) {
          final match = RegExp(
            '/(?:Data|Containers/Data)/Application/[0-9a-fA-F-]{36}/' +
                suffix +
                '/([^\n]+)\$',
          ).firstMatch(path);
          relative = match?.group(1);
        }
      } else {
        relative = androidRelativePath(path, root);
      }
      if (relative == null || relative.isEmpty) continue;
      final canonical = await Directory(root).resolveSymbolicLinks();
      final candidate = File('$canonical/$relative');
      if (!await candidate.exists()) continue;
      final resolved = await candidate.resolveSymbolicLinks();
      if (resolved != '$canonical/$relative' ||
          !resolved.startsWith('$canonical/'))
        throw const FormatException('Collegamento a un file non consentito.');
      final handle = await File(resolved).open();
      try {
        if (await handle.length() != size)
          throw const FormatException('Dimensione del file cambiata.');
        final bytes = await handle.read(size);
        if (bytes.length != size ||
            sha256.convert(utf8.encode(base64Encode(bytes))).toString() !=
                digest)
          throw const FormatException('Il file originale è cambiato.');
        return bytes;
      } finally {
        await handle.close();
      }
    }
    throw const FormatException(
      'Il file originale non è più disponibile sul telefono.',
    );
  }
}

class LegacyMobileData {
  LegacyMobileData(
    this.api,
    this.scope,
    this.vault, {
    this.store = const ExpoDraftStorage(),
    AttachmentStaging? staging,
  }) : actor = api.actorId,
       staging =
           staging ??
           AttachmentStaging(
             scope: jsonEncode([
               'legacy-recovery',
               api.origin.origin,
               api.actorId,
               scope.kind.name,
               scope.id,
             ]),
           );
  final RimiamApi api;
  final String actor;
  final LegacyScope scope;
  final DraftVault vault;
  final ExpoDraftStorage store;
  final AttachmentStaging staging;
  String get _hash => scope.digest(api.origin.origin, actor);
  String get _key => 'rimiam.import.v1.$_hash';
  List<(String, String)> get _indices => [
    ('draft', 'rimiam.draft.$_hash'),
    ('pending', 'rimiam.pending.$_hash'),
    if (scope.kind == LegacyKind.workspace)
      (
        'callExit',
        'rimiam.pending.${scope.digest(api.origin.origin, actor, leaving: true)}',
      ),
  ];
  void _same() {
    if (actor.isEmpty || api.actorId != actor)
      throw const ApiError(403, 'SESSION_CHANGED');
  }

  Future<bool> available() async {
    _same();
    for (final (_, key) in _indices) {
      if (await store.has(key)) return true;
    }
    return await vault.read(_key) != null;
  }

  Future<LegacyJson> authorize({bool forWriting = false}) async {
    _same();
    final session = await api.get('/api/v1/native/session');
    _same();
    if (session['user']?['id'] != actor)
      throw const ApiError(403, 'SESSION_CHANGED');
    if (scope.kind != LegacyKind.creation && !_id.hasMatch(scope.id))
      throw const FormatException('Spazio non valido.');
    switch (scope.kind) {
      case LegacyKind.direct:
        return readDirect(api, scope.id, actor);
      case LegacyKind.creation:
        break;
      case LegacyKind.personal:
      case LegacyKind.workspace:
        final w = await api.get('/api/v1/workspaces/${scope.id}/workspace');
        if (w['workspace']?['id'] != scope.id ||
            !(w['members'] as List).any(
              (m) =>
                  m['user_id'] == actor &&
                  m['active'] == true &&
                  (!forWriting || m['contributes'] == true),
            ))
          throw const ApiError(403, 'ACCESS_CHANGED');
        if (scope.kind == LegacyKind.personal) {
          if (w['workspace']?['personal'] != true)
            throw const ApiError(403, 'PERSONAL_CHAT_REQUIRED');
          await api.get('/api/v1/personal-chats?thread=${scope.id}');
        }
        _same();
        return w;
    }
    _same();
    return {};
  }

  Future<LegacyJson> recover() async {
    await authorize();
    final previous = await vault.read(_key);
    final result = previous == null
        ? <String, dynamic>{}
        : jsonDecode(previous) as LegacyJson;
    final records = <String, dynamic>{};
    for (final (kind, key) in _indices) {
      final r = await store.record(key);
      if (r != null) records[kind] = r;
    }
    _same();
    if (records.isEmpty) return result;
    final prior = Map<String, dynamic>.from(result['files'] as Map? ?? {});
    final fileMap = <String, dynamic>{...prior}, failures = <String, dynamic>{};
    final created = <StagedAttachment>[];
    try {
      for (final r in records.values) {
        for (final meta in attachmentRefs(r['intent'])) {
          final key = fileKey(meta);
          if (fileMap.containsKey(key)) continue;
          try {
            final bytes = await store.file(meta);
            final files = await staging.stage([
              XFile.fromData(bytes, path: meta['filename']),
            ], existing: []);
            fileMap[key] = files.single.toJson();
            created.add(files.single);
          } on FormatException catch (e) {
            failures[key] = e.message;
          } on FileSystemException {
            failures[key] = 'Il file originale non è leggibile.';
          } on AttachmentProblem catch (e) {
            failures[key] = e.message;
          }
        }
      }
      final updated = {
        ...result,
        ...records,
        'files': fileMap,
        'missing': failures,
      };
      await authorize();
      await vault.replace(_key, jsonEncode(updated));
      return updated;
    } catch (_) {
      await staging.discard(created);
      rethrow;
    }
  }

  static String fileKey(LegacyJson m) =>
      jsonEncode([m['uri'], m['filename'], m['size'], m['hash']]);
  static List<LegacyJson> attachmentRefs(LegacyJson intent) {
    final files = [
      ...?intent['files'] as List?,
      if (intent['file'] is Map) intent['file'],
    ];
    if (files.length > 10)
      throw const FormatException('Troppi allegati nel registro.');
    return files.cast<LegacyJson>();
  }

  Future<List<XFile>> draftFiles(
    LegacyJson data, {
    bool skipMissing = false,
  }) async {
    final draft = data['draft']['intent'] as LegacyJson,
        stored = data['files'] as Map;
    final descriptors = <StagedAttachment>[];
    for (final meta in attachmentRefs(draft)) {
      final saved = stored[fileKey(meta)];
      if (saved is! LegacyJson) {
        if (skipMissing) continue;
        throw const FormatException('La bozza ha un allegato non disponibile.');
      }
      descriptors.add(StagedAttachment.fromJson(saved));
    }
    final files = await staging.payloads(descriptors);
    return files
        .map(
          (m) => XFile.fromData(
            base64Decode(m['bytesBase64']),
            path: m['filename'],
          ),
        )
        .toList();
  }

  static bool tiedToSend(LegacyJson data) {
    final draft = data['draft']?['intent'];
    if (draft is! Map || draft['token'] is! String) return true;
    final pending = data['pending']?['intent'];
    return pending is Map &&
        (pending['draftToken'] == draft['token'] ||
            (pending['draftToken'] == null &&
                (pending['kind'] == 'direct' ||
                    pending['kind'] == 'personalAsk' ||
                    pending['command']?['type'] == 'message.send')));
  }

  Future<void> restoreChat(
    LegacyJson data,
    ChatJournal journal, {
    required bool Function() allowed,
    required bool stripContext,
    bool skipMissing = false,
  }) async {
    if (tiedToSend(data) ||
        journal.actor != actor ||
        journal.workspace != scope.id ||
        journal.direct != (scope.kind == LegacyKind.direct) ||
        !(scope.kind == LegacyKind.direct ||
            scope.kind == LegacyKind.workspace))
      throw const FormatException('Questa bozza è collegata a un invio.');
    final snapshot = await authorize(forWriting: true);
    final draft = data['draft']['intent'] as LegacyJson;
    final id = data['draft']['id'] as String;
    if (!allowed() ||
        !journal.acceptsLegacyDraft ||
        journal.importedLegacyId == id)
      throw const FormatException(
        'Il campo contiene già una bozza o il recupero è già avvenuto.',
      );
    final direct = scope.kind == LegacyKind.direct;
    final messages = (snapshot['messages'] as List? ?? const []);
    String? quote;
    bool humanQuote = false;
    ({String sourceId, String filename})? source;
    final people = <String, String>{};
    if (!stripContext) {
      if (draft['topic'] != null)
        throw const FormatException(
          'Controlla i riferimenti prima di riprendere la bozza.',
        );
      quote = draft['quoteId'] as String?;
      if (quote != null) {
        final message = messages.where((m) => m['id'] == quote).firstOrNull;
        if (message == null)
          throw const FormatException('Il messaggio citato non è disponibile.');
        humanQuote = message['actor_kind'] == 'human';
      }
      final reference = draft['fileReference'];
      if (reference != null) {
        if (direct ||
            !(snapshot['sources'] as List? ?? const []).any(
              (s) => s['id'] == reference['id'] && s['withdrawn'] != true,
            ))
          throw const FormatException('Il file citato non è disponibile.');
        source = (
          sourceId: reference['id'] as String,
          filename: reference['name'] as String,
        );
      }
      for (final id in (draft['mentionIds'] as List? ?? const [])) {
        final member = (snapshot['members'] as List? ?? const [])
            .where((m) => m['user_id'] == id && m['active'] == true)
            .firstOrNull;
        if (direct || member == null || member['name'] is! String)
          throw const FormatException(
            'Controlla le menzioni prima di riprendere la bozza.',
          );
        people[id as String] = member['name'] as String;
      }
    }
    final restored = await draftFiles(data, skipMissing: skipMissing);
    if (restored.isEmpty && (draft['text'] as String).trim().isEmpty)
      throw const FormatException(
        'La bozza contiene solo file non disponibili.',
      );
    final staged = await journal.staging.stage(restored, existing: []);
    try {
      await authorize(forWriting: true);
    } catch (_) {
      await journal.staging.discard(staged);
      rethrow;
    }
    await journal.importLegacyDraft(
      id: id,
      content: draft['text'] as String,
      attachments: staged,
      stillAllowed: () => api.actorId == actor && allowed(),
      quote: quote,
      humanQuote: humanQuote,
      ask: !stripContext && (draft['ask'] == true || source != null),
      source: source,
      people: people,
    );
  }

  Future<bool> committed(LegacyJson record) async {
    await authorize();
    final id = record['id'] as String, intent = record['intent'] as LegacyJson;
    if (!_id.hasMatch(id))
      throw const FormatException('Identificativo di invio non valido.');
    if (scope.kind == LegacyKind.direct) {
      final view = await readDirect(api, scope.id, actor);
      return (view['messages'] as List).any(
        (m) => m['id'] == id && m['authorId'] == actor,
      );
    }
    if (scope.kind == LegacyKind.personal && intent['kind'] == 'personalAsk') {
      final view = await api.get('/api/v1/personal-chats?thread=${scope.id}');
      _same();
      return (view['turns'] as List).any(
        (m) => m['id'] == id && m['status'] == 'ready',
      );
    }
    try {
      final receipt = await api.get(
        '/api/v1/workspaces/${scope.kind == LegacyKind.creation ? id : scope.id}/receipts/$id',
      );
      _same();
      return receipt['commandId'] == id && receipt['status'] == 'committed';
    } on ApiError catch (e) {
      if (e.code == 'RECEIPT_NOT_FOUND' ||
          (scope.kind == LegacyKind.creation && e.status == 403))
        return false;
      rethrow;
    }
  }
}
