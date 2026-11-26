// Run explicitly with the loopback-only native fixture from tests/run-native-server.ts.
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/assistant_settings_model.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_governance.dart';
import '../lib/workspace_consultation.dart';

void main() {
  test('two real local sessions exercise goal history, exact provenance and two explicitly named signatories', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final local = Uri.parse('http://127.0.0.1:3102'),
        creator = RimiamApi(local),
        participant = RimiamApi(local);
    addTearDown(() {
      creator.close();
      participant.close();
    });
    await creator.login('native-ios@example.test', 'Native-test-only-2026!');
    await participant.login(
      'native-android@example.test',
      'Native-test-only-2026!',
    );
    addTearDown(() async {
      await creator.logout();
      await participant.logout();
    });
    final wid = creator.newId(),
        title = 'Percorso Direzione ${wid.substring(0, 8)}';
    final defaults = await AssistantSettingsRepository(creator).read(null);
    await creator.post('/api/v1/workspaces', {
      'commandId': wid,
      'expectedActorId': creator.actorId,
      'name': title,
      'assistantConnectionId': 'default',
      'assistantConnectionRevision': defaults.connection('default')!.revision,
      'invitations': {
        'recipients': [
          {'contactId': participant.actorId},
        ],
        'fullHistoryDisclosed': true,
      },
    });
    final ownerGroup = GroupGovernance(creator, wid, direction: true),
        memberGroup = GroupGovernance(participant, wid, direction: true);
    await expectLater(
      memberGroup.load(),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
    final invite = groupRows(
      (await participant.get('/api/v1/invitations'))['invitations'],
    ).singleWhere((i) => i['workspaceName'] == title);
    await participant.post('/api/v1/invitations/${invite['id']}/accept', {
      'fullHistoryAccepted': true,
    });
    await ownerGroup.load();
    await memberGroup.load();
    expect(ownerGroup.goal, isNull);
    expect(memberGroup.canWrite, isTrue);
    const initial = 'Presentare il prototipo al gruppo',
        next = 'Presentare il prototipo e la guida al gruppo';
    await ownerGroup.send({'type': 'goal.establish', 'content': initial});
    await memberGroup.load();
    final id = memberGroup.goal!['id'];
    await memberGroup.send({
      'type': 'goal.editShared',
      'goalId': id,
      'expectedVersion': 1,
      'content': next,
    });
    await ownerGroup.load();
    expect(ownerGroup.goal!['content'], next);
    final versions = groupRows(ownerGroup.goal!['versions']);
    expect(versions.singleWhere((r) => r['version'] == 1)['content'], initial);
    expect(
      versions.singleWhere((r) => r['version'] == 2)['actor'],
      participant.actorId,
    );
    final ref = await creator.get(
      '${ownerGroup.path}/reference?kind=goal&id=$id&version=2',
    );
    final notice = groupIds(ref['sourceIds']).single;
    final source = await participant.get(
      '${memberGroup.path}/reference?kind=source&id=$notice&version=1',
    );
    expect(source['provenance']['sourceKind'], 'message');
    expect(source['content'], contains('ha aggiornato l’obiettivo'));
    expect(
      groupRows(ownerGroup.snapshot['messages'])
          .where((m) => m['id'] == notice)
          .length,
      1,
    );
    await expectLater(
      ownerGroup.send({
        'type': 'goal.editShared',
        'goalId': id,
        'expectedVersion': 1,
        'content': 'Bozza superata',
      }),
      throwsA(
        isA<ApiError>().having((e) => e.code, 'code', 'GOAL_VERSION_STALE'),
      ),
    );
    expect(ownerGroup.journal.pending, isNull);
    await ownerGroup.send({
      'type': 'project.propose',
      'kind': 'decision',
      'content': 'Approvare il collaudo interno',
      'reason': 'Verifica su due dispositivi',
      'operation': 'establish',
      'goal': {'id': id, 'version': 2},
      'people': [creator.actorId, participant.actorId],
    });
    await memberGroup.load();
    final act = groupRows(memberGroup.project['acts']).single;
    expect(act['status'], 'proposed');
    expect(act['approvals'], isEmpty);
    Future<void> approve(GroupGovernance g, String who) => g.send({
      'type': 'project.approve',
      'proposalId': act['proposalId'],
      'representedPersonId': who,
      'expectedAccessRevision': g.project['accessRevision'],
      'confirmExactContent': true,
    });
    await approve(memberGroup, participant.actorId);
    await ownerGroup.load();
    expect(groupRows(ownerGroup.project['acts']).single['status'], 'proposed');
    expect(
      groupRows(groupRows(ownerGroup.project['acts']).single['approvals'])
          .single['personId'],
      participant.actorId,
    );
    await approve(ownerGroup, creator.actorId);
    await memberGroup.load();
    final done = groupRows(memberGroup.project['acts']).single;
    expect(done['status'], 'effective');
    expect(
      groupRows(done['approvals']).map((a) => a['personId']),
      unorderedEquals([creator.actorId, participant.actorId]),
    );
    final chatBefore = groupRows(memberGroup.snapshot['messages']).length;
    final consultation = WorkspaceConsultation(
      memberGroup,
      const DeviceDraftVault(),
    );
    await consultation.load();
    expect(consultation.last, isNull);
    final req = consultation.ask('Quale decisione abbiamo preso?');
    await expectLater(
      consultation.run(req),
      throwsA(
        isA<ApiError>().having(
          (e) => e.code,
          'code',
          'AI_PROVIDER_UNAVAILABLE',
        ),
      ),
    );
    expect(consultation.pending!['id'], req['id']);
    expect(
      await creator.getOptional('${ownerGroup.path}/consultation?kind=context'),
      isNull,
    );
    await ownerGroup.load();
    expect(groupRows(ownerGroup.snapshot['messages']).length, chatBefore);
  });
}
