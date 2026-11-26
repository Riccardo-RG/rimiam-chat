// Run explicitly against tests/run-native-server.ts: loopback, two synthetic
// accounts, PostgreSQL and disabled model, search and notification providers.
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/assistant_settings_model.dart';
import '../lib/workspace_governance.dart';

void main() {
  test('a peer controls group analysis, a stale revision is refused, private research never enters the group implicitly', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final url = Uri.parse('http://127.0.0.1:3102'),
        owner = RimiamApi(url),
        peer = RimiamApi(url);
    addTearDown(() {
      owner.close();
      peer.close();
    });
    await owner.login('native-ios@example.test', 'Native-test-only-2026!');
    await peer.login('native-android@example.test', 'Native-test-only-2026!');
    addTearDown(() async {
      await owner.logout();
      await peer.logout();
    });
    final w = owner.newId(),
        name = 'Ricerca e analisi ${w.substring(0, 8)}',
        cfg = await AssistantSettingsRepository(owner).read(null);
    await owner.post('/api/v1/workspaces', {
      'commandId': w,
      'expectedActorId': owner.actorId,
      'name': name,
      'assistantConnectionId': 'default',
      'assistantConnectionRevision': cfg.connection('default')!.revision,
      'invitations': {
        'recipients': [
          {'contactId': peer.actorId},
        ],
        'fullHistoryDisclosed': true,
      },
    });
    await expectLater(
      peer.get('/api/v1/workspaces/$w/active-work-presence'),
      throwsA(isA<ApiError>().having((e) => e.status, 'membership required', 403)),
    );
    final invite = groupRows(
      (await peer.get('/api/v1/invitations'))['invitations'],
    ).singleWhere((r) => r['workspaceName'] == name);
    await peer.post('/api/v1/invitations/${invite['id']}/accept', {
      'fullHistoryAccepted': true,
    });
    final ga = GroupGovernance(
          owner,
          w,
          direction: false,
          journalName: 'analysis',
        ),
        gb = GroupGovernance(
          peer,
          w,
          direction: false,
          journalName: 'analysis',
        );
    await ga.load();
    await gb.load();
    await ga.send({
      'type': 'work.converse',
      'text': 'Analizza le date della consegna',
    });
    Future<GroupRecord> settled(String objective) async {
      for (var n = 0; n < 60; n++) {
        final work = groupRows(
          (await peer.get('${gb.path}/active-work'))['works'],
        ).singleWhere((r) => r['contract']['objective'] == objective);
        if (!{'queued', 'working'}.contains(work['phase'])) return work;
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }
      throw StateError('Il worker locale non ha concluso la generazione.');
    }

    final wa = await settled('le date della consegna');
    final version = wa['revision'], id = wa['id'];
    await gb.send({
      'type': 'work.converse',
      'workId': id,
      'expectedRevision': version,
      'text': 'pausa',
    });
    await expectLater(
      ga.send({
        'type': 'work.converse',
        'workId': id,
        'expectedRevision': version,
        'text': 'ferma',
      }),
      throwsA(
        isA<ApiError>().having((e) => e.code, 'stale', 'WORK_STATE_STALE'),
      ),
    );
    final view = await owner.get('${ga.path}/active-work?workId=$id');
    expect(groupRows(view['works']).single['phase'], 'paused');
    final presence = await owner.get('${ga.path}/active-work-presence');
    final signal = groupRows(presence['ongoing']).singleWhere((r) => r['id'] == id);
    expect(signal['phase'], 'paused');
    expect(signal['objective'], 'le date della consegna');
    final history = await owner.get('${ga.path}/active-work-history?id=$id');
    expect(
      groupRows(history['events']).any((e) => e['actor'] == peer.actorId),
      isTrue,
    );
    await ga.send({
      'type': 'research.request',
      'query': 'Termine condiviso di collaudo',
      'discloseQuery': true,
    });
    await gb.load();
    expect(
      groupRows(gb.snapshot['research']).single['query'],
      'Termine condiviso di collaudo',
    );
    final thread = owner.newId();
    await owner.post('/api/v1/personal-chats', {
      'action': 'new',
      'expectedActorId': owner.actorId,
      'thread': thread,
    });
    final pc = GroupGovernance(
      owner,
      thread,
      direction: false,
      journalName: 'research',
    );
    await pc.load();
    final current = await owner.get('/api/v1/personal-chats?thread=$thread');
    await owner.post('/api/v1/personal-chats', {
      'action': 'select',
      'expectedActorId': owner.actorId,
      'thread': thread,
      'target': w,
      'expectedVersion': current['selection']['version'],
    });
    await pc.send({
      'type': 'research.private_request',
      'query': 'Termine riservato del proprietario',
      'notify': false,
      'originId': w,
      'analyzeExcerpts': true,
      'discloseQuery': true,
    });
    final pv = await owner.get('/api/v1/personal-chats?thread=$thread');
    final r = groupRows(pv['research']).single;
    expect(r['origin'], w);
    expect(r['notify'], false);
    expect(r['shared'], isEmpty);
    await expectLater(
      peer.get('/api/v1/personal-chats?thread=$thread'),
      throwsA(
        isA<ApiError>().having(
          (e) => {403, 404}.contains(e.status),
          'unauthorized',
          true,
        ),
      ),
    );
    await gb.load();
    expect(groupRows(gb.snapshot['research']).map((e) => e['query']), [
      'Termine condiviso di collaudo',
    ]);
  });
}
