import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/attachment_staging.dart';
import '../lib/chat_journal.dart';
import '../lib/legacy_mobile_data.dart';

const room = '10000000-0000-4000-a000-000000000001',
    oldDraft = '10000000-0000-4000-a000-000000000002',
    oldSend = '10000000-0000-4000-a000-000000000003',
    oldContainer = '10000000-0000-4000-a000-000000000004';

class Storage extends ExpoDraftStorage {
  Storage(this.dirs);
  final Map<String, String> dirs, entries = {};
  final reads = <String>[];
  @override
  Future<String?> read(String key) async {
    reads.add(key);
    return entries[key];
  }

  @override
  Future<bool> has(String key) async => entries.containsKey(key);
  @override
  Future<Map<String, String>> roots() async => dirs;
  void write(String key, String id, LegacyJson intent) {
    final all = jsonEncode(intent).runes.toList();
    final parts = (all.length + 349) ~/ 350;
    for (int i = 0; i < parts; i++) {
      final chunk = all.skip(i * 350).take(350);
      entries['$key.$id.$i'] = String.fromCharCodes(chunk);
    }
    entries[key] = jsonEncode({'id': id, 'count': parts});
  }
}

class Memory implements DraftVault {
  final data = <String, String>{};
  bool fail = false;
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> replace(String key, String? value) async {
    if (fail) throw const FileSystemException('storage');
    if (value == null) {
      data.remove(key);
    } else {
      data[key] = value;
    }
  }
}

class Server extends RimiamApi {
  Server([String actor = 'ric', int port = 3102])
    : super(Uri.parse('http://localhost:$port')) {
    actorId = actor;
  }
  final reads = <String>[], sent = <String>[];
  bool member = true, canWrite = true, confirmed = false;
  int? revokeAt;
  int snapshots = 0;
  @override
  Future<LegacyJson> get(String path) async {
    reads.add(path);
    if (path == '/api/v1/native/session')
      return {
        'user': {'id': actorId},
      };
    if (path == '/api/v1/workspaces/$room/workspace')
      return {
        'workspace': {'id': room, 'personal': true},
        'members': [
          {
            'user_id': actorId,
            'active': member && ++snapshots != revokeAt,
            'contributes': canWrite,
          },
          {'user_id': 'gio', 'name': 'Gio', 'active': true},
        ],
        'messages': [
          {'id': 'quoted', 'actor_kind': 'human'},
        ],
        'sources': [
          {'id': 'file-source', 'withdrawn': false},
        ],
      };
    if (path == '/api/v1/direct-chats/$room')
      return {
        'id': room,
        'me': actorId,
        'messages': [
          if (confirmed) {'id': oldSend, 'authorId': actorId},
        ],
      };
    if (path == '/api/v1/personal-chats?thread=$room')
      return {
        'turns': [
          if (confirmed) {'id': oldSend, 'status': 'ready'},
        ],
      };
    if (path.endsWith('/receipts/$oldSend')) {
      if (!confirmed) throw const ApiError(404, 'RECEIPT_NOT_FOUND');
      return {'commandId': oldSend, 'status': 'committed'};
    }
    throw StateError(path);
  }

  @override
  Future<LegacyJson> post(String path, LegacyJson body) async {
    sent.add(path);
    throw StateError('unexpected POST');
  }
}

void main() {
  late Directory dir, docs;
  late LegacyScope scope;
  late Server api;
  late Storage store;
  late Memory vault;
  late LegacyMobileData legacy;
  String key(String kind) =>
      'rimiam.$kind.${scope.digest(api.origin.origin, api.actorId)}';
  AttachmentStaging attachments(String ns) =>
      AttachmentStaging(scope: ns, root: () async => dir);
  ChatJournal current() => ChatJournal(
    vault: vault,
    origin: api.origin,
    actor: api.actorId,
    workspace: room,
    staging: attachments('chat'),
  );
  late LegacyJson file, draft;
  setUp(() async {
    dir = await Directory.systemTemp.createTemp('rimiam-migration-test-');
    docs = await Directory('${dir.path}/Documents').create();
    scope = const LegacyScope.workspace(room);
    api = Server();
    vault = Memory();
    store = Storage({'documents': docs.path, 'temporary': dir.path});
    legacy = LegacyMobileData(
      api,
      scope,
      vault,
      store: store,
      staging: attachments('archive'),
    );
    final bytes = utf8.encode('testo sintetico');
    await File('${docs.path}/appunto.txt').writeAsBytes(bytes);
    file = {
      'uri':
          'file:///private/var/mobile/Containers/Data/Application/$oldContainer/Documents/appunto.txt',
      'filename': 'appunto.txt',
      'size': bytes.length,
      'hash': sha256.convert(utf8.encode(base64Encode(bytes))).toString(),
    };
    draft = {
      'token': oldDraft,
      'text': '@Gio ' + ('🧭' * 351),
      'ask': true,
      'files': [file],
      'quoteId': 'quoted',
      'mentionIds': ['gio'],
    };
  });
  tearDown(() async {
    api.close();
    await dir.delete(recursive: true);
  });
  test('real Expo chunk/URI formats recover text, verified attachment and context once into the protected current draft', () async {
    store.write(key('draft'), oldDraft, draft);
    expect(await legacy.available(), true);
    final recovered = await legacy.recover(), journal = current();
    await journal.open();
    expect(recovered['missing'], isEmpty);
    await legacy.restoreChat(
      recovered,
      journal,
      allowed: () => true,
      stripContext: false,
    );
    final reloaded = current();
    await reloaded.open();
    expect(reloaded.text, draft['text']);
    expect(reloaded.quoteSource, true);
    expect(reloaded.quoteId, 'quoted');
    expect(reloaded.mentions, {'gio': 'Gio'});
    expect(reloaded.files.single.filename, 'appunto.txt');
    expect(
      utf8.decode(
        base64Decode(
          (await reloaded.staging.payloads(reloaded.files))
              .single['bytesBase64'],
        ),
      ),
      'testo sintetico',
    );
    expect(reloaded.importedLegacyId, oldDraft);
    expect(reloaded.pending, isNull);
    expect(api.sent, isEmpty);
    expect(
      await legacy
          .restoreChat(
            recovered,
            reloaded,
            allowed: () => true,
            stripContext: false,
          )
          .then((_) => false, onError: (_) => true),
      true,
    );
    expect(store.entries.containsKey(key('draft')), true);
  });
  test('an existing draft survives and a pending legacy send can only read its own receipt', () async {
    store.write(key('draft'), oldDraft, draft);
    final journal = current();
    await journal.open();
    journal.edit('già presente');
    var data = await legacy.recover();
    await expectLater(
      legacy.restoreChat(
        data,
        journal,
        allowed: () => true,
        stripContext: false,
      ),
      throwsFormatException,
    );
    expect(journal.text, 'già presente');
    store.write(key('pending'), oldSend, {
      'kind': 'command',
      'draftToken': oldDraft,
      'command': {'type': 'message.send', 'content': draft['text']},
      'files': [file],
    });
    data = await legacy.recover();
    expect(LegacyMobileData.tiedToSend(data), true);
    expect(await legacy.committed(data['pending']), false);
    api.confirmed = true;
    expect(await legacy.committed(data['pending']), true);
    expect(api.sent, isEmpty);
    journal.edit('');
    await expectLater(
      legacy.restoreChat(
        data,
        journal,
        allowed: () => true,
        stripContext: false,
      ),
      throwsFormatException,
    );
    expect(journal.text, isEmpty);
  });
  test(
    'actor, origin, access loss and incomplete chunks fence the imported data',
    () async {
      store.write(key('draft'), oldDraft, draft);
      for (final other in [Server('gio'), Server('ric', 4100)]) {
        final isolated = LegacyMobileData(other, scope, vault, store: store);
        expect(await isolated.available(), false);
        other.close();
      }
      api.member = false;
      await expectLater(legacy.recover(), throwsA(isA<ApiError>()));
      expect(store.reads, isEmpty);
      api.member = true;
      api.revokeAt = 2;
      await expectLater(legacy.recover(), throwsA(isA<ApiError>()));
      expect(vault.data, isEmpty);
      api.revokeAt = null;
      store.entries.remove('${key('draft')}.$oldDraft.1');
      await expectLater(legacy.recover(), throwsFormatException);
      expect(vault.data, isEmpty);
      expect(api.sent, isEmpty);
    },
  );
  test('external URI, altered bytes, relative escape and symlink cannot become attachments', () async {
    final link = Link('${docs.path}/symlink.txt');
    await link.create('${docs.path}/appunto.txt');
    for (final uri in [
      'https://example.test/appunto.txt',
      'file:///tmp/missing.txt',
      '${file['uri']}/../appunto.txt',
      '${file['uri']}%2F..%2Fappunto.txt',
      File(link.path).uri.toString(),
    ]) {
      await expectLater(
        store.file({...file, 'uri': uri}),
        throwsFormatException,
      );
    }
    store.write(key('draft'), oldDraft, {
      ...draft,
      'files': [
        {...file, 'hash': '0' * 64},
      ],
    });
    final recovered = await legacy.recover();
    expect(recovered['missing'], hasLength(1));
    expect(recovered['files'], isEmpty);
    final journal = current();
    await journal.open();
    await expectLater(
      legacy.restoreChat(
        recovered,
        journal,
        allowed: () => true,
        stripContext: false,
      ),
      throwsFormatException,
    );
    expect(journal.text, isEmpty);
    await legacy.restoreChat(
      recovered,
      journal,
      allowed: () => true,
      stripContext: false,
      skipMissing: true,
    );
    expect(journal.text, draft['text']);
    expect(journal.files, isEmpty);
    expect(api.sent, isEmpty);
  });
  test(
    'Android maps only current app files and ignores unrelated roots',
    () async {
      for (final pair in [
        (
          '/data/user/0/com.rimiam.chat/files/test',
          '/data/data/com.rimiam.chat/files',
        ),
        (
          '/data/data/com.rimiam.chat/files/test',
          '/data/user/0/com.rimiam.chat/files',
        ),
      ]) {
        expect(ExpoDraftStorage.androidRelativePath(pair.$1, pair.$2), 'test');
      }
      for (final path in [
        '/data/user/1/com.rimiam.chat/files/test',
        '/data/data/com.other/files/test',
        '/data/data/com.rimiam.chat/files-backup/test',
      ]) {
        expect(
          ExpoDraftStorage.androidRelativePath(
            path,
            '/data/data/com.rimiam.chat/files',
          ),
          isNull,
        );
      }
      final android = Storage({
        'documents': docs.path,
        'cache': '${dir.path}/cache',
      });
      final result = await android.file({
        ...file,
        'uri': File('${docs.path}/appunto.txt').uri.toString(),
      });
      expect(utf8.decode(result), 'testo sintetico');
      final singleSlash = await android.file({
        ...file,
        'uri': 'file:${docs.path}/appunto.txt',
      });
      expect(singleSlash, result);
      await expectLater(android.file(file), throwsFormatException);
    },
  );
  test('old direct, consultation, creation and call-exit records query each original scope read-only', () async {
    for (final pair in [
      (const LegacyScope.direct(room), 'direct'),
      (const LegacyScope.personal(room), 'personalAsk'),
      (const LegacyScope.creation(), 'create'),
    ]) {
      final (s, kind) = pair;
      final d = LegacyMobileData(api, s, vault, store: store);
      final id = s.digest(api.origin.origin, api.actorId);
      store.write('rimiam.pending.$id', oldSend, {
        'kind': kind,
        'label': 'Verifica',
      });
      final record = (await d.recover())['pending'];
      api.confirmed = false;
      expect(await d.committed(record), false);
      api.confirmed = true;
      expect(await d.committed(record), true);
    }
    final lane = scope.digest(api.origin.origin, api.actorId, leaving: true);
    store.write('rimiam.pending.$lane', oldSend, {
      'kind': 'command',
      'command': {'type': 'call.leave'},
      'label': 'Uscita',
    });
    final result = await legacy.recover();
    expect(result['callExit']['id'], oldSend);
    expect(api.sent, isEmpty);
  });
}
