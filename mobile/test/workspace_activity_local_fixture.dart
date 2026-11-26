import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/workspace_governance.dart';

void main() {
  test('a second member can inspect the original, archive, restore and see only one topic notice per version', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final origin = Uri.parse('http://127.0.0.1:3102'),
        first = RimiamApi(origin),
        peer = RimiamApi(origin);
    addTearDown(() {
      first.close();
      peer.close();
    });
    await first.login('native-ios@example.test', 'Native-test-only-2026!');
    await peer.login('native-android@example.test', 'Native-test-only-2026!');
    addTearDown(() async {
      await first.logout();
      await peer.logout();
    });
    final room =
        groupRows((await first.get('/api/v1/workspaces'))['workspaces'])
                .singleWhere(
                  (s) => s['name'] == 'Native shared verification',
                )['id']
            as String;
    final a = GroupGovernance(
          first,
          room,
          direction: false,
          journalName: 'activity',
        ),
        b = GroupGovernance(
          peer,
          room,
          direction: false,
          journalName: 'activity',
        );
    await a.load();
    await b.load();
    final suffix = first.newId(),
        title = 'Revisione ${suffix.substring(0, 8)}',
        text = 'Indice per $title';
    await a.send({'type': 'message.send', 'content': text});
    await b.load();
    final source = groupRows(b.snapshot['messages'])
        .singleWhere((m) => m['content'] == text)['id'];
    await b.send({
      'type': 'question.open',
      'sourceId': source,
      'content': 'Cosa manca per $title?',
    });
    await a.load();
    expect(
      groupRows(a.snapshot['questions'])
          .singleWhere((q) => q['source_id'] == source)['recorded_by'],
      peer.actorId,
    );
    await a.send({
      'type': 'workstream.save',
      'title': title,
      'description': 'Documenti da rivedere',
    });
    Future<GroupRecord> topic() async => groupRows(
      (await peer.get('${b.path}/attention?limit=30'))['workstreams'],
    ).singleWhere((t) => t['title'] == title);
    final id = (await topic())['id'];
    await b.send({
      'type': 'workstream.link',
      'workstreamId': id,
      'sourceId': source,
      'expectedVersion': 0,
      'included': true,
    });
    await b.send({
      'type': 'workstream.transition',
      'workstreamId': id,
      'expectedVersion': 1,
      'action': 'archive',
    });
    expect((await topic())['state'], 'archived');
    await expectLater(
      a.send({
        'type': 'workstream.transition',
        'workstreamId': id,
        'expectedVersion': 1,
        'action': 'archive',
      }),
      throwsA(isA<ApiError>().having((e) => e.code, 'code', 'STATE_STALE')),
    );
    await a.send({
      'type': 'workstream.transition',
      'workstreamId': id,
      'expectedVersion': 2,
      'action': 'restore',
    });
    final restored = await topic();
    expect(restored['state'], 'active');
    final focused = 'Controllato per $title';
    await a.send({
      'type': 'message.send',
      'content': focused,
      'workstreamFocus': {'workstreamId': id, 'version': restored['version']},
    });
    await b.load();
    final original = groupRows(b.snapshot['messages'])
        .singleWhere((m) => m['content'] == focused);
    final thread = await peer.get(
      '${b.path}/history?through=${original['sequence']}&workstreamId=$id&limit=30',
    );
    final same = groupRows(thread['messages'])
        .singleWhere((m) => m['content'] == focused);
    expect(same['id'], original['id']);
    expect(same['workstreamFocus']['version'], restored['version']);
    expect(
      groupRows(restored['sources'])
          .singleWhere((s) => s['id'] == source)['included'],
      true,
    );
    final ref = await peer.get(
      '${b.path}/reference?kind=source&id=$source&version=1',
    );
    expect(ref['content'], text);
    await b.load();
    for (final verb in ['creato', 'archiviato', 'ripristinato']) {
      expect(
        groupRows(b.snapshot['messages']).where(
          (m) => (m['content'] as String).contains(
            'ha $verb l’argomento «$title»',
          ),
        ),
        hasLength(1),
      );
    }
  });
}
