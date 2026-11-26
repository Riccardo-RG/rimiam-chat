// Run explicitly with tests/run-native-server.ts (loopback API, fictional
// accounts and deterministic native-worker interpretation; no external service).
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_governance.dart';
import '../lib/workspace_handoff_review.dart';

class DropConfirmation extends RimiamApi {
  DropConfirmation(super.destination);
  bool drop = false;
  int prepared = 0;
  @override
  Future<GroupRecord> post(String path, GroupRecord body) async {
    final data = await super.post(path, body);
    if (body['command']?['conversationOrigin'] != null) {
      prepared++;
      if (drop) {
        drop = false;
        throw const SocketException('response lost after commit');
      }
    }
    return data;
  }
}

void main() {
  test('a group member explicitly prepares an exact proposal; both people approve independently before the decision takes effect', () async {
    FlutterSecureStorage.setMockInitialValues({});
    const port = int.fromEnvironment('RIMIAM_TEST_PORT', defaultValue: 3102);
    final origin = Uri.parse('http://127.0.0.1:$port'),
        a = RimiamApi(origin),
        b = DropConfirmation(origin);
    addTearDown(() {
      a.close();
      b.close();
    });
    await a.login('native-ios@example.test', 'Native-test-only-2026!');
    await b.login('native-android@example.test', 'Native-test-only-2026!');
    addTearDown(() async {
      await a.logout();
      await b.logout();
    });
    final w = a.newId(),
        name = 'Revisione ${w.substring(0, 8)}',
        base = '/api/v1/workspaces/$w';
    await a.post('/api/v1/workspaces', {
      'name': name,
      'commandId': w,
      'expectedActorId': a.actorId,
    });
    Future<GroupRecord> send(RimiamApi api, GroupRecord command) async =>
        (await api.post('$base/commands', {
              'commandId': api.newId(),
              'expectedActorId': api.actorId,
              'command': command,
            }))['result']
            as GroupRecord;
    await send(a, {
      'type': 'invitation.create',
      'email': 'native-android@example.test',
      'fullHistoryDisclosed': true,
    });
    final inv = groupRows((await b.get('/api/v1/invitations'))['invitations'])
        .singleWhere((r) => r['workspaceName'] == name);
    await b.post('/api/v1/invitations/${inv['id']}/accept', {
      'fullHistoryAccepted': true,
    });
    final request = await send(a, {
      'type': 'message.send',
      'content': '@Miriam Native handoff decision $w',
    });
    final message = request['messageId'];
    GroupRecord? h;
    for (int attempt = 0; attempt < 50 && h == null; attempt++) {
      h = groupRows(
        (await b.get('$base/handoffs?sourceId=$message'))['handoffs'],
      ).where((h) => h['kind'] == 'project.propose').firstOrNull;
      if (h == null)
        await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    expect(
      h,
      isNotNull,
      reason:
          'Start the current tests/native-worker.ts alongside the test API.',
    );
    final proposal = h!;
    HandoffReviewModel model() => HandoffReviewModel(
      b,
      const DeviceDraftVault(),
      w,
      id: proposal['id'],
      source: proposal['sourceId'],
      kind: proposal['kind'],
    );
    final review = model();
    await review.load();
    expect(groupRows(review.group.project['acts']), isEmpty);
    b.drop = true;
    await expectLater(
      review.apply({
        'type': 'project.propose',
        'kind': 'decision',
        'operation': 'establish',
        'goal': null,
        'content': 'Testiamo il venerdì pomeriggio.',
        'reason': 'Conferma dei partecipanti',
        'people': [a.actorId, b.actorId],
      }),
      throwsA(isA<SocketException>()),
    );
    final resumed = model();
    await resumed.load();
    expect(resumed.handoff!['status'], 'applied');
    expect(resumed.handoff!['application']['actor'], b.actorId);
    await resumed.verify();
    expect(resumed.group.journal.pending, isNull);
    expect(b.prepared, 1);
    final id = resumed.handoff!['application']['prepared']['id'];
    final author = GroupGovernance(a, w, direction: true),
        member = GroupGovernance(b, w, direction: true);
    await author.load();
    GroupRecord item(GroupGovernance g) =>
        groupRows(g.project['acts']).singleWhere((r) => r['proposalId'] == id);
    expect(item(author)['status'], 'proposed');
    expect(item(author)['approvals'], isEmpty);
    Future<void> approve(GroupGovernance group, String represented) =>
        group.send({
          'type': 'project.approve',
          'proposalId': id,
          'representedPersonId': represented,
          'expectedAccessRevision': group.project['accessRevision'],
          'confirmExactContent': true,
        });
    await expectLater(approve(author, b.actorId), throwsA(isA<ApiError>()));
    await approve(author, a.actorId);
    await member.load();
    expect(item(member)['status'], 'proposed');
    expect(item(member)['approvals'], hasLength(1));
    await approve(member, b.actorId);
    await author.load();
    expect(item(author)['status'], 'effective');
    expect(item(author)['approvals'], hasLength(2));
    final detail = await a.get(
      '$base/reference?kind=commitment&id=$id&version=1',
    );
    expect(detail['sourceIds'], contains(message));
    expect(detail['current'], true);
    final ref = {'kind': 'commitment', 'id': id, 'version': 1};
    final linked = await send(a, {
      'type': 'message.send',
      'content': 'Rileggiamo insieme la decisione.',
      'reference': ref,
    });
    final topic = await send(b, {
      'type': 'message.send',
      'content': '@Miriam crea un filone chiamato "Collaudo"',
    });
    final topicId = topic['operationResult']['workstreamId'];
    expect(topic['operationResult']['outcome'], 'created');
    await send(b, {
      'type': 'question.open',
      'sourceId': linked['messageId'],
      'content': 'Chi verifica il venerdì?',
    });
    final snapshot = await a.get('$base/workspace');
    final rows = groupRows(snapshot['messages']);
    expect(
      rows.singleWhere((m) => m['id'] == linked['messageId'])['reference'],
      ref,
    );
    final receipt = rows.singleWhere((m) => m['id'] == topic['replyMessageId']);
    expect(receipt['operationResult']['workstreamId'], topicId);
    expect(receipt['citation_source_ids'], [topic['messageId']]);
    final attention = await a.get('$base/attention?limit=30');
    expect(
      groupRows(attention['workstreams'])
          .singleWhere((t) => t['id'] == topicId)['title'],
      'Collaudo',
    );
    final question = groupRows(snapshot['questions'])
        .singleWhere((q) => q['source_id'] == linked['messageId']);
    expect(question['recorded_by'], b.actorId);
    final source = await b.get(
      '$base/reference?kind=source&id=${linked['messageId']}&version=1',
    );
    expect(source['content'], 'Rileggiamo insieme la decisione.');
    expect(source['provenance']['sourceKind'], 'message');
  }, timeout: const Timeout(Duration(minutes: 1)));
}
