import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_recap.dart';

const room = '10000000-0000-4000-a000-000000000001',
    anchor = '10000000-0000-4000-a000-000000000002',
    later = '10000000-0000-4000-a000-000000000003',
    askMe = '10000000-0000-4000-a000-000000000004';

class Vault implements DraftVault {
  final data = <String, String>{};
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> replace(String key, String? value) async {
    if (value == null) {
      data.remove(key);
    } else {
      data[key] = value;
    }
  }
}

class Server extends RimiamApi {
  Server() : super(Uri.parse('http://127.0.0.1:3102')) {
    actorId = 'anna';
  }
  bool canWrite = true, member = true, loseNext = false;
  int generated = 0, shared = 0;
  final requests = <Map<String, dynamic>>[];
  final stored = <String, Map<String, dynamic>>{};
  Completer<void>? delay;
  @override
  Future<Map<String, dynamic>> get(String path) async {
    expect(path, endsWith('/workspace'));
    return {
      'workspace': {'id': room},
      'members': [
        {'user_id': actorId, 'active': member, 'contributes': canWrite},
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    expect(path, '/api/v1/workspaces/$room/consultation');
    requests.add({...body});
    final actor = actorId, key = '$actor/${body['id']}';
    await delay?.future;
    if (!member) throw const ApiError(403, 'DENIED');
    expect(body['expectedActorId'], actor);
    if (body['action'] == 'summarize') {
      expect(body.keys.toSet(), {
        'action',
        'id',
        'expectedActorId',
        'kind',
        'anchorId',
      });
      expect(body['kind'], 'recap');
      if (![anchor, later].contains(body['anchorId']))
        throw const ApiError(404, 'MESSAGE_NOT_FOUND');
      stored.putIfAbsent(key, () {
        generated++;
        return {
          'id': body['id'],
          'kind': 'recap',
          'answer': 'La revisione è pronta.',
          'references': [
            {
              'id': body['anchorId'],
              'kind': 'source',
              'version': 1,
              'label': 'Anna · messaggio originale',
            },
          ],
          'personalIds': [askMe],
          'sharedMessageId': null,
        };
      });
    } else {
      expect(body.keys.toSet(), {'action', 'id', 'expectedActorId'});
      expect(body['action'], 'share');
      if (!canWrite || stored[key] == null) throw const ApiError(403, 'DENIED');
      if (stored[key]!['sharedMessageId'] == null) {
        shared++;
        stored[key]!['sharedMessageId'] = 'shared';
      }
    }
    if (loseNext) {
      loseNext = false;
      throw const SocketException('Risposta persa');
    }
    return {...stored[key]!};
  }
}

void main() {
  test('explicit request survives losing the reply, two anchors and process restarts; a second actor cannot resume or publish it', () async {
    final api = Server(), vault = Vault();
    final first = WorkspaceRecap(api, vault, room);
    expect(api.requests, isEmpty);
    api.loseNext = true;
    await expectLater(first.open(anchor), throwsA(isA<SocketException>()));
    final firstId = api.requests.single['id'];
    final newer = WorkspaceRecap(api, vault, room);
    await newer.open(later);
    final restart = WorkspaceRecap(api, vault, room);
    await restart.open(anchor);
    expect(api.generated, 2);
    expect(api.requests.last['id'], firstId);
    expect(restart.answer!['references'].single['id'], anchor);
    expect(await restart.original(askMe), askMe);
    await expectLater(restart.original('unrelated'), throwsFormatException);
    expect(api.shared, 0);
    expect(jsonEncode(vault.data), isNot(contains('La revisione')));
    expect(jsonEncode(vault.data), isNot(contains(askMe)));
    api.actorId = 'paolo';
    await expectLater(restart.share(), throwsA(isA<ApiError>()));
    final stranger = WorkspaceRecap(api, vault, room);
    await expectLater(stranger.open(null), throwsA(isA<ApiError>()));
    expect(api.shared, 0);
    api.close();
  });
  test('a lost share reply can only be rechecked or retried with the exact result ID; no personal IDs sent', () async {
    final api = Server(), v = Vault(), r = WorkspaceRecap(api, v, room);
    await r.open(anchor);
    final id = r.id;
    api.loseNext = true;
    await expectLater(r.share(), throwsA(isA<SocketException>()));
    expect(api.shared, 1);
    expect(api.requests.last, {
      'action': 'share',
      'id': id,
      'expectedActorId': 'anna',
    });
    final next = WorkspaceRecap(api, v, room);
    await next.open(null);
    expect(next.answer!['sharedMessageId'], 'shared');
    await next.share();
    expect(api.shared, 1);
    expect(api.generated, 1);
    expect(api.requests.map((r) => r['action']), [
      'summarize',
      'share',
      'summarize',
    ]);
    api.close();
  });
  test(
    'read-only, revocation during request and concurrent starts are fenced',
    () async {
      final api = Server(),
          v = Vault(),
          a = WorkspaceRecap(api, v, room),
          b = WorkspaceRecap(api, v, room);
      await Future.wait([a.open(anchor), b.open(anchor)]);
      expect(api.generated, 1);
      expect(a.id, b.id);
      api.canWrite = false;
      await expectLater(a.share(), throwsA(isA<ApiError>()));
      expect(api.shared, 0);
      api.delay = Completer<void>();
      final inFlight = b.open(anchor);
      await Future<void>.delayed(Duration.zero);
      b.hide();
      api.delay!.complete();
      await expectLater(inFlight, throwsA(isA<ApiError>()));
      expect(b.answer, isNull);
      api.member = false;
      await expectLater(b.open(anchor), throwsA(isA<ApiError>()));
      expect(api.shared, 0);
      api.close();
    },
  );
  testWidgets(
    'private summary, personal targeting, original-message navigation and explicit share',
    (tester) async {
      final api = Server(), v = Vault();
      String? chosen;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (c) => Scaffold(
              body: TextButton(
                child: const Text('Riassumi da qui'),
                onPressed: () async {
                  chosen = await Navigator.push<String>(
                    c,
                    MaterialPageRoute(
                      builder: (_) => WorkspaceRecapScreen(
                        api: api,
                        vault: v,
                        workspaceId: room,
                        anchorId: anchor,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      );
      expect(api.requests, isEmpty);
      await tester.tap(find.text('Riassumi da qui'));
      await tester.pumpAndSettle();
      expect(find.text('Solo tu'), findsOneWidget);
      expect(find.text('Ti riguarda'), findsOneWidget);
      expect(api.shared, 0);
      await tester.tap(find.text('Vai al messaggio 1'));
      await tester.pumpAndSettle();
      expect(chosen, askMe);
      await tester.tap(find.text('Riassumi da qui'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Anna · messaggio originale'));
      await tester.pumpAndSettle();
      expect(chosen, anchor);
      await tester.tap(find.text('Riassumi da qui'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Condividi in chat'));
      await tester.pumpAndSettle();
      expect(find.text('Condiviso nella chat dello spazio'), findsOneWidget);
      expect(api.generated, 1);
      expect(api.shared, 1);
      api.close();
    },
  );
}
