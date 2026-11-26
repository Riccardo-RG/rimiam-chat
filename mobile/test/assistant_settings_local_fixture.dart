// Run explicitly against tests/run-native-server.ts on loopback. The fixture
// disables network AI, mail delivery, push and external account connections.
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/assistant_settings_model.dart';

void main() {
  test('two fixture accounts read scoped guidance and exercise creator and contributor rights against PostgreSQL', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final local = Uri.parse('http://127.0.0.1:3102');
    final owner = RimiamApi(local), peer = RimiamApi(local);
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
    final config = AssistantSettingsRepository(owner),
        reader = AssistantSettingsRepository(peer);
    final personal = await config.read(null);
    final id = owner.newId();
    final groupName = 'Verifica configurazione ${id.substring(0, 8)}';
    final created = await owner.post('/api/v1/workspaces', {
      'commandId': id,
      'expectedActorId': owner.actorId,
      'name': groupName,
      'assistantConnectionId': 'default',
      'assistantConnectionRevision': personal.connection('default')!.revision,
      'invitations': {
        'recipients': [
          {'contactId': peer.actorId},
        ],
        'fullHistoryDisclosed': true,
      },
    });
    expect(created['id'], id);
    final invite =
        ((await peer.get('/api/v1/invitations'))['invitations'] as List)
            .singleWhere((i) => i['workspaceName'] == groupName);
    await peer.post('/api/v1/invitations/${invite['id']}/accept', {
      'fullHistoryAccepted': true,
    });
    final initial = await config.read(id);
    final changed = await config.save(
      workspace: id,
      base: initial,
      connectionId: 'default',
      name: 'Iris',
      instructions: 'Use one clear sentence.',
    );
    expect(changed.name, 'Iris');
    expect(changed.effective, contains('Use one clear sentence.'));
    final member = await reader.read(id);
    expect(member.canManage, isFalse);
    expect(member.effective, changed.effective);
    await expectLater(
      peer.post('/api/v1/assistant-settings', {
        'workspaceId': id,
        'expectedActorId': peer.actorId,
        'expectedRevision': member.revision,
        'connectionRevision': member.connection('default')!.revision,
        'connectionId': 'default',
        'displayName': 'Tentativo',
        'instructions': '',
      }),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
    await expectLater(
      config.save(
        workspace: id,
        base: initial,
        connectionId: 'default',
        name: 'Indietro',
        instructions: '',
      ),
      throwsA(
        isA<ApiError>().having(
          (e) => e.code,
          'code',
          'ASSISTANT_SETTINGS_STALE',
        ),
      ),
    );
    final w = '/api/v1/workspaces/$id';
    final pref = (await peer.get('$w/attention'))['preference'];
    final receipt = await peer.post('$w/commands', {
      'expectedActorId': peer.actorId,
      'commandId': peer.newId(),
      'command': {
        'type': 'attention.preference',
        'mode': 'collaborative',
        'expectedVersion': pref['version'],
      },
    });
    expect(receipt['status'], 'committed');
    expect(
      (await owner.get('$w/attention'))['preference']['mode'],
      'collaborative',
    );
    final reset = await config.save(
      workspace: id,
      base: changed,
      connectionId: 'default',
      name: 'Iris',
      instructions: '',
    );
    expect(reset.instructions, isEmpty);
    expect(reset.name, 'Iris');
    final personalAfter = await config.read(null);
    expect(personalAfter.effective, personal.effective);
    expect(personalAfter.revision, personal.revision);
    expect(
      personalAfter.spaces.singleWhere(
        (s) => s['workspaceId'] == id,
      )['displayName'],
      'Iris',
    );
  });
}
