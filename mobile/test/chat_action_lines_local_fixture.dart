import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';

typedef Record = Map<String, dynamic>;

/// Run explicitly against tests/run-native-server.ts; all actors and messages
/// are synthetic. The fixture uses its local database, without an AI provider.
void main() {
  test('due membri ricevono le stesse proposte e proiezioni promemoria personali distinte', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final origin = Uri.parse('http://127.0.0.1:3102');
    final owner = RimiamApi(origin), peer = RimiamApi(origin);
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
                .cast<Record>()
                .singleWhere(
                  (s) => s['name'] == 'Native shared verification',
                )['id']
            as String;
    Future<Record> postCommand(
      RimiamApi who,
      String space,
      Record command,
    ) async =>
        (await who.post('/api/v1/workspaces/$space/commands', {
              'commandId': who.newId(),
              'expectedActorId': who.actorId,
              'command': command,
            }))['result']
            as Record;
    Future<List<Record>> rows(RimiamApi who) async =>
        ((await who.get('/api/v1/workspaces/$w/workspace'))['messages'] as List)
            .cast<Record>();
    final tag = owner.newId();
    final task = await postCommand(owner, w, {
      'type': 'task.create',
      'content': {
        'title': 'Proiezione chat $tag',
        'description': 'Verificare la proposta',
        'timeZone': 'Europe/Rome',
        'suggestedPerson': peer.actorId,
        'dueAt': null,
        'references': [],
      },
    });
    Future<Record> projection(RimiamApi who) async =>
        (await rows(who)).singleWhere(
              (m) => m['taskOffer']?['taskId'] == task['taskId'],
            )['taskOffer']
            as Record;
    final offer = await projection(peer);
    expect(offer['status'], 'pending');
    expect(offer['person'], peer.actorId);
    await postCommand(peer, w, {
      'type': 'task.accept',
      'taskId': task['taskId'],
      'expectedVersion': offer['version'],
      'representSelf': true,
      'reason': 'Accettazione personale dalla conversazione',
    });
    expect((await projection(owner))['status'], 'accepted');
    final message = await postCommand(owner, w, {
      'type': 'message.send',
      'content': '@Emme ricordami domani di verificare la proiezione $tag',
      'clientTimeZone': 'Europe/Rome',
    });
    Future<Record?> reminder(RimiamApi who) async =>
        (await rows(who))
                .singleWhere((m) => m['id'] == message['messageId'])['reminder']
            as Record?;
    final missing = await reminder(owner);
    expect(missing?['id'], isNull);
    expect(missing?['day'], isNotNull);
    expect(await reminder(peer), isNull);
    final when = DateTime.now().toUtc().add(const Duration(days: 1));
    await postCommand(owner, w, {
      'type': 'reminder.set_time',
      'messageId': message['messageId'],
      'remindAt': when.toIso8601String(),
    });
    final r = (await reminder(owner))!;
    expect(r['destination'], isNot(w));
    await postCommand(owner, r['destination'], {
      'type': 'followup.occurrence',
      'action': 'replace',
      'followupId': r['id'],
      'expectedVersion': r['version'],
      'scheduledAt': r['at'],
      'replacement': {
        'content': 'Promemoria modificato $tag',
        'remindAt': when.add(const Duration(hours: 1)).toIso8601String(),
        'timeZone': 'Europe/Rome',
      },
    });
    expect((await reminder(owner))!['content'], 'Promemoria modificato $tag');
    expect(await reminder(peer), isNull);
  });
}
