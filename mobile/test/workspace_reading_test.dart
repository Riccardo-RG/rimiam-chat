import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/journey.dart';
import '../lib/workspace_tool_host.dart';

class _Server extends RimiamApi {
  _Server() : super(Uri.parse('http://localhost')) {
    actorId = 'ada';
  }
  final unread = {for (int i = 0; i < 90; i++) 'm$i'},
      mentions = <String>{},
      requests = <String>{};
  final writes = <Map<String, dynamic>>[];
  int admission = 1, version = 4, revision = 1, length = 90;
  String? saved = 'm20';
  Completer<void>? hold;
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (path.contains('/changes?')) return {'headRevision': revision};
    expect(path, '/api/v1/workspaces/work/workspace');
    return {
      'workspace': {'id': 'work', 'name': 'Prova', 'revision': revision},
      'members': [
        {'user_id': 'ada', 'active': true, 'contributes': false},
      ],
      'messages': [
        for (int i = 0; i < length; i++)
          {
            'id': 'm$i',
            'author_name': 'Giulia',
            'actor_kind': 'human',
            'content': 'Conversazione $i',
            'sequence': i + 1,
            'created_at': '2026-11-26T12:00:00Z',
          },
      ],
      'reading': {
        'admission': admission,
        'anchorId': saved,
        'anchorOffset': 0,
        'anchorAtBottom': false,
        'cursorVersion': version,
        'unreadIds': [...unread],
        'mentionIds': [...mentions],
        'requestIds': [...requests],
      },
    };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    expect(path, '/api/v1/workspaces/work/reading');
    expect(body['expectedActorId'], 'ada');
    writes.add(body);
    await hold?.future;
    if (body['admission'] != admission)
      throw const ApiError(409, 'READING_ADMISSION_CHANGED');
    unread.removeAll(body['seen'] as List);
    mentions.removeAll(body['seen'] as List);
    final anchor = body['anchor'];
    if (anchor != null && anchor['expectedVersion'] == version) {
      version++;
      saved = anchor['id'] as String;
    }
    return {'cursorVersion': version};
  }
}

void main() {
  Future<void> open(WidgetTester t, _Server server, {String? target}) async {
    await t.pumpWidget(
      MaterialApp(
        home: WorkspaceJourney(
          api: server,
          workspaceId: 'work',
          workspaceName: 'Prova',
          initialMessageId: target,
        ),
      ),
    );
    await t.pumpAndSettle();
  }

  bool onScreen(WidgetTester t, int i) {
    final row = find.text('Conversazione $i');
    return row.evaluate().isNotEmpty &&
        t
            .getRect(row)
            .overlaps(t.getRect(find.byKey(const Key('workspace-timeline'))));
  }

  testWidgets(
    'ordinary group entry opens its newest unread mention even with a saved position; the next mention opens the oldest and skips unviewed rows',
    (t) async {
      final api = _Server()
        ..mentions.addAll(['m10', 'm61'])
        ..requests.add('m35');
      await open(t, api);
      expect(onScreen(t, 61), isTrue);
      expect(api.mentions, {'m10'});
      expect(api.unread, containsAll(['m10', 'm35', 'm89']));
      await t.tap(find.text('Menzione successiva · 1'));
      await t.pumpAndSettle();
      expect(onScreen(t, 10), isTrue);
      expect(api.mentions, isEmpty);
      expect(api.unread, contains('m35'));
      await t.tap(find.text('Da rispondere · 1'));
      await t.pumpAndSettle();
      expect(onScreen(t, 35), isTrue);
      expect(find.text('Risposta richiesta'), findsOneWidget);
      expect(api.requests, {'m35'});
      await t.tap(find.text('Vai in fondo'));
      await t.pumpAndSettle();
      expect(onScreen(t, 89), isTrue);
      expect(api.unread, contains('m25'));
      expect(api.writes.last['anchor'], containsPair('atBottom', true));
      expect(api.writes.last['anchor']['id'], 'm89');
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );

  testWidgets(
    'explicit Home mention and requested answer targets take precedence, including on a reused route',
    (t) async {
      final api = _Server()
        ..mentions.addAll(['m8', 'm71'])
        ..requests.add('m41');
      await open(t, api, target: 'm8');
      expect(onScreen(t, 8), isTrue);
      expect(api.mentions, {'m71'});
      expect(api.unread, containsAll(['m41', 'm70', 'm89']));
      await open(t, api, target: 'm41');
      expect(onScreen(t, 41), isTrue);
      expect(api.requests, {'m41'});
      expect(api.mentions, {'m71'});
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );

  testWidgets(
    'a group without mentions opens its latest exchange and follows new arrivals while at the bottom',
    (t) async {
      final api = _Server();
      await open(t, api);
      expect(onScreen(t, 89), isTrue);
      expect(api.unread, containsAll(['m0', 'm20', 'm52']));
      expect(api.unread, isNot(contains('m89')));
      api.length++;
      api.revision++;
      api.unread.add('m90');
      await t.pump(const Duration(seconds: 6));
      await t.pumpAndSettle();
      expect(onScreen(t, 90), isTrue);
      expect(api.unread, isNot(contains('m90')));
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );

  testWidgets(
    'a tool covering the narrow chat never reads or follows an incoming mention',
    (t) async {
      await t.binding.setSurfaceSize(const Size(375, 667));
      addTearDown(() => t.binding.setSurfaceSize(null));
      final api = _Server();
      addTearDown(api.close);
      await open(t, api);
      final anchor = api.saved;
      final writes = api.writes.length;
      final tool = t
          .state<WorkspaceToolHostState>(find.byType(WorkspaceToolHost))
          .open(const Scaffold(body: Text('Fonte aperta')));
      await t.pumpAndSettle();
      api.length++;
      api.revision++;
      api.unread.add('m90');
      api.mentions.add('m90');
      await t.pump(const Duration(seconds: 6));
      await t.pumpAndSettle();
      expect(api.writes.length, writes);
      expect(api.mentions, contains('m90'));
      expect(api.saved, anchor);
      await t.binding.handlePopRoute();
      await t.pumpAndSettle();
      expect(await tool, isNull);
      expect(onScreen(t, 89), true);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'new group messages do not move a person reading an older source',
    (t) async {
      final api = _Server();
      await open(t, api, target: 'm13');
      final y = t.getTopLeft(find.text('Conversazione 13')).dy;
      api.length++;
      api.revision++;
      api.unread.add('m90');
      await t.pump(const Duration(seconds: 6));
      await t.pumpAndSettle();
      expect(t.getTopLeft(find.text('Conversazione 13')).dy, y);
      expect(api.unread, contains('m90'));
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );

  testWidgets(
    'a reply to a reading request from an old admission cannot clear attention in a new one',
    (t) async {
      final api = _Server()
        ..hold = Completer<void>()
        ..mentions.add('m69');
      await open(t, api);
      expect(api.writes.single['admission'], 1);
      api.admission = 2;
      api.revision++;
      api.mentions.clear();
      api.mentions.add('m4');
      api.hold!.complete();
      api.hold = null;
      await t.pumpAndSettle();
      expect(onScreen(t, 4), isTrue);
      expect(api.mentions, isEmpty);
      expect(api.writes.last['admission'], 2);
      await t.pumpWidget(const SizedBox());
      api.close();
    },
  );
}
