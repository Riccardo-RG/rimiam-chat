// Real local API and PostgreSQL, with identity providers, mail delivery and calendar providers disabled.
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/assistant_settings_model.dart';
import '../lib/chat_journal.dart';
import '../lib/integration_model.dart';
import '../lib/workspace_governance.dart';

void main() {
  test('a private draft, its history and Bcc are owner-only; internal space appointments appear for both without publishing to a provider', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final local = Uri.parse('http://127.0.0.1:3102'),
        a = RimiamApi(local),
        b = RimiamApi(local);
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
    final cfg = await AssistantSettingsRepository(a).read(null),
        w = a.newId(),
        name = 'Collaudo posta e calendario ${w.substring(0, 8)}';
    await a.post('/api/v1/workspaces', {
      'commandId': w,
      'expectedActorId': a.actorId,
      'name': name,
      'assistantConnectionId': 'default',
      'assistantConnectionRevision': cfg.connection('default')!.revision,
      'invitations': {
        'recipients': [
          {'contactId': b.actorId},
        ],
        'fullHistoryDisclosed': true,
      },
    });
    final invite = groupRows(
      (await b.get('/api/v1/invitations'))['invitations'],
    ).singleWhere((i) => i['workspaceName'] == name);
    await b.post('/api/v1/invitations/${invite['id']}/accept', {
      'fullHistoryAccepted': true,
    });
    final now = DateTime.now(),
        tomorrow = DateTime(now.year, now.month, now.day + 1, 11);
    final mail = WorkspaceIntegration(a, w, 'email', const DeviceDraftVault()),
        peerMail = WorkspaceIntegration(
          b,
          w,
          'email',
          const DeviceDraftVault(),
        );
    await mail.load(now, null);
    await peerMail.load(now, null);
    final envelope = <String, dynamic>{
      'sender': mail.email,
      'subject': 'Bozza riservata laboratorio',
      'body': 'Confronto privato.',
      'to': ['test-team@example.test'],
      'cc': <String>[],
      'bcc': ['privato@example.test'],
      'attachments': <GroupRecord>[],
      'kind': 'new',
      'target': null,
    };
    await mail.send({
      'type': 'email.draft.create',
      'connectionId': null,
      'envelope': envelope,
      'reason': 'Prima stesura',
    });
    await mail.load(now, null);
    final draft = groupRows(mail.data['drafts']).single;
    await mail.send({
      'type': 'email.draft.revise',
      'draftId': draft['id'],
      'expectedVersion': 1,
      'connectionId': null,
      'envelope': {...envelope, 'body': 'Confronto privato aggiornato.'},
      'reason': 'Seconda stesura',
    });
    await peerMail.load(now, null);
    expect(peerMail.data['drafts'], isEmpty);
    expect(peerMail.data['actions'], isEmpty);
    final history = '${mail.base}/email-history?draftId=${draft['id']}';
    final versions = groupRows((await a.get(history))['versions']);
    expect(versions.map((v) => v['version']), [1, 2]);
    expect(versions.last['envelope']['bcc'], ['privato@example.test']);
    await expectLater(
      b.get(history),
      throwsA(
        isA<ApiError>().having(
          (e) => [403, 404].contains(e.status),
          'denied',
          true,
        ),
      ),
    );
    final cal = WorkspaceIntegration(
          a,
          w,
          'calendar',
          const DeviceDraftVault(),
        ),
        peerCal = WorkspaceIntegration(
          b,
          w,
          'calendar',
          const DeviceDraftVault(),
        );
    await cal.load(now, null);
    final p = {
      'title': 'Prova di presentazione',
      'start': tomorrow.toUtc().toIso8601String(),
      'end': tomorrow
          .add(const Duration(minutes: 30))
          .toUtc()
          .toIso8601String(),
      'timeZone': 'Europe/Rome',
    };
    await cal.send({
      'type': 'temporal.create',
      'payload': p,
      'audience': {'kind': 'all'},
      'reason': 'Primo incontro',
      'representSelf': true,
      'expectedContextRevision': cal.data['contextRevision'],
    });
    await peerCal.load(now, null);
    final entry = groupRows(peerCal.data['temporal']).single;
    expect(entry['personId'], a.actorId);
    expect(entry['payload']['title'], p['title']);
    await peerCal.send({
      'type': 'temporal.respond',
      'eventId': entry['id'],
      'expectedVersion': entry['version'],
      'response': 'accepted',
    });
    await cal.load(now, null);
    await cal.send({
      'type': 'temporal.revise',
      'eventId': entry['id'],
      'expectedVersion': 1,
      'payload': {...p, 'title': 'Verifica finale'},
      'audience': {'kind': 'all'},
      'reason': 'Revisione',
      'representSelf': true,
      'expectedContextRevision': cal.data['contextRevision'],
    });
    await peerCal.load(now, null);
    expect(groupRows(peerCal.data['temporal']).single['version'], 2);
    final gh = await b.get(
      '${cal.base}/calendar-history?kind=scheduled_event&id=${entry['id']}',
    );
    expect(groupRows(gh['versions']).map((v) => v['version']), [1, 2]);
    expect(peerCal.data['actions'], isEmpty);
    expect(peerCal.data['observations'], isEmpty);
    expect(cal.providers['google']?['configured'], isFalse);
    await expectLater(
      cal.connect('google'),
      throwsA(isA<ApiError>().having((e) => e.code, 'code', 'NOT_CONFIGURED')),
    );
    final snapshot = await b.get('${cal.base}/workspace');
    for (final s in [
      ...groupRows(snapshot['sources']),
      ...groupRows(snapshot['messages']),
    ]) {
      expect(s.toString(), isNot(contains('privato@example.test')));
      expect(s.toString(), isNot(contains('Confronto privato')));
    }
  });
}
