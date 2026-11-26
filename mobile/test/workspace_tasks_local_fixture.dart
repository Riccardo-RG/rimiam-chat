// Run against tests/run-native-server.ts with its loopback database, local
// adapters and two fictional members of "Native shared verification".
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/workspace_command_journal.dart';

class _LostComment extends RimiamApi {
  _LostComment(super.origin);
  bool loseNext = false;
  int commentPosts = 0;
  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final result = await super.post(path, body);
    if (body['command']?['type'] == 'task.comment') {
      commentPosts++;
      if (loseNext) {
        loseNext = false;
        throw const SocketException('Conferma persa');
      }
    }
    return result;
  }
}

void main() {
  test('proposta, responsabilità, commento con risposta persa, revisione, pausa e completamento verificati da due membri', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final origin = Uri.parse('http://127.0.0.1:3102');
    final owner = _LostComment(origin), peer = RimiamApi(origin);
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
    final w =
        ((await owner.get('/api/v1/workspaces'))['workspaces'] as List)
                .singleWhere(
                  (s) => s['name'] == 'Native shared verification',
                )['id']
            as String;
    final base = '/api/v1/workspaces/$w';
    final title = 'Verifica attività ${owner.newId()}';
    Future<Map<String, dynamic>> cmd(
      RimiamApi a,
      Map<String, dynamic> content,
    ) => a.post('$base/commands', {
      'commandId': a.newId(),
      'expectedActorId': a.actorId,
      'command': content,
    });
    final content = {
      'title': title,
      'description': 'Confrontare il riepilogo',
      'suggestedPerson': peer.actorId,
      'dueAt': DateTime.now()
          .toUtc()
          .add(const Duration(days: 1))
          .toIso8601String(),
      'timeZone': 'Europe/Rome',
      'references': [],
    };
    final id =
        (await cmd(owner, {
              'type': 'task.create',
              'content': content,
            }))['result']['taskId']
            as String;
    Future<Map<String, dynamic>> row(RimiamApi who) async =>
        ((await who.get('$base/tasks?focus=$id'))['tasks'] as List).single
            as Map<String, dynamic>;
    Future<Map<String, dynamic>> act(
      RimiamApi who,
      String type,
      int version, [
      Map<String, dynamic> extra = const {},
    ]) => cmd(who, {
      'type': type,
      'taskId': id,
      'expectedVersion': version,
      'reason': 'Verifica su attività sintetica',
      ...extra,
    });
    expect((await row(peer))['responsible'], isNull);
    expect((await row(peer))['suggestedPerson'], peer.actorId);
    await expectLater(
      act(owner, 'task.accept', 1, {'representSelf': true}),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
    await act(peer, 'task.decline', 1);
    expect((await row(owner))['declinedBy'], peer.actorId);
    await act(owner, 'task.revise', 1, {'content': content});
    await act(peer, 'task.accept', 2, {'representSelf': true});
    expect((await row(owner))['responsible'], peer.actorId);
    final comment = {
      'type': 'task.comment',
      'taskId': id,
      'expectedVersion': 3,
      'body': 'Confermato dal collaudo',
    };
    final journal = WorkspaceCommandJournal(
      owner,
      const DeviceDraftVault(),
      namespace: 'tasks',
      collection: w,
    );
    owner.loseNext = true;
    await expectLater(
      journal.send(w, comment, allowed: () => true),
      throwsA(isA<SocketException>()),
    );
    final reopened = WorkspaceCommandJournal(
      owner,
      const DeviceDraftVault(),
      namespace: 'tasks',
      collection: w,
    );
    await reopened.load();
    await reopened.send(w, comment, allowed: () => true);
    expect(owner.commentPosts, 1);
    final comments =
        (await peer.get('$base/task-comments?id=$id'))['comments'] as List;
    expect(
      comments.where(
        (c) => c['body'] == comment['body'] && c['actor'] == owner.actorId,
      ),
      hasLength(1),
    );
    await expectLater(
      act(owner, 'task.status', 3, {
        'status': 'completed',
        'noNormativeEffect': true,
      }),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
    final proposed = {...content, 'description': 'Confrontare anche le date'};
    final proposal = (await act(owner, 'task.propose_revision', 3, {
      'content': proposed,
    }))['result']['proposalId'];
    expect((await row(peer))['description'], content['description']);
    await act(peer, 'task.adopt_revision', 3, {
      'proposalId': proposal,
      'acceptResponsibility': true,
    });
    expect((await row(owner))['description'], proposed['description']);
    await act(peer, 'task.status', 4, {
      'status': 'standby',
      'noNormativeEffect': true,
    });
    expect((await row(owner))['status'], 'standby');
    await act(peer, 'task.status', 5, {
      'status': 'completed',
      'noNormativeEffect': true,
    });
    expect((await row(owner))['status'], 'completed');
    await act(peer, 'task.status', 6, {
      'status': 'open',
      'noNormativeEffect': true,
    });
    await act(peer, 'task.relinquish', 7, {'representSelf': true});
    final finalRow = await row(owner);
    expect(finalRow['responsible'], isNull);
    expect(finalRow['status'], 'open');
  });
}
