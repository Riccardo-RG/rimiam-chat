// Run explicitly with the PostgreSQL fixture tests/run-native-server.ts on 3102.
// New synthetic group for each run. Notices stay in the fixture, email is off.
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;

import '../lib/api.dart';
import '../lib/assistant_settings_model.dart';

void main() {
  test('invita, revoca, accetta, delega, rinuncia, rimuovi e lascia su un nuovo spazio sintetico', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final origin = Uri.parse('http://127.0.0.1:3102'),
        owner = RimiamApi(origin),
        peer = RimiamApi(origin);
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
        base = '/api/v1/workspaces/$w',
        ownerSettings = await AssistantSettingsRepository(owner).read(null);
    await owner.post('/api/v1/workspaces', {
      'commandId': w,
      'expectedActorId': owner.actorId,
      'name': 'Accessi Flutter ${w.substring(0, 8)}',
      'assistantConnectionId': 'default',
      'assistantConnectionRevision': ownerSettings
          .connection('default')!
          .revision,
    });
    Future<Map<String, dynamic>> command(
      RimiamApi api,
      Map<String, dynamic> c,
    ) async => (await api.post('$base/commands', {
      'commandId': api.newId(),
      'expectedActorId': api.actorId,
      'command': c,
    }))['result'];
    Future<Map<String, dynamic>> invite() => command(owner, {
      'type': 'invitation.create',
      'contactId': peer.actorId,
      'fullHistoryDisclosed': true,
      'sendEmail': false,
    });
    Future<void> accept(String id) async {
      await peer.post('/api/v1/invitations/$id/accept', {
        'fullHistoryAccepted': true,
      });
    }

    final denied = throwsA(
      isA<ApiError>().having((e) => e.status, 'status', anyOf(403, 404)),
    );
    await expectLater(peer.get('$base/access'), denied);
    final first = await invite();
    expect(
      Uri.parse(first['invitationUrl']).queryParameters['invite'],
      isNotEmpty,
    );
    await command(owner, {
      'type': 'invitation.revoke',
      'invitationId': first['invitationId'],
    });
    expect(
      ((await peer.get('/api/v1/invitations'))['invitations'] as List).where(
        (r) => r['id'] == first['invitationId'],
      ),
      isEmpty,
    );
    await accept((await invite())['invitationId']);
    final profile = await peer.get('$base/profiles/${owner.actorId}');
    expect(profile['email'], 'native-ios@example.test');
    final photo = image.encodeJpg(image.Image(width: 8, height: 8));
    await peer.post('/api/v1/identity-photos', {
      'expectedActorId': peer.actorId,
      'expectedVersion': 0,
      'workspace': w,
      'image': base64Encode(photo),
    });
    final dir = await owner.get('/api/v1/identity-photos?workspace=$w');
    expect(dir['rooms'][w], {'version': 1, 'present': true});
    final normalized = image.decodeJpg(
      await owner.getBytes('/api/v1/identity-photos?workspace=$w&image=1&v=1'),
    )!;
    expect([normalized.width, normalized.height], [256, 256]);
    await peer.post('/api/v1/identity-photos', {
      'expectedActorId': peer.actorId,
      'expectedVersion': 1,
      'workspace': w,
      'image': null,
    });
    final rev = (await owner.get('$base/access'))['accessRevision'] as int;
    final prop = await command(owner, {
      'type': 'access.propose',
      'expectedAccessRevision': rev,
      'reason': 'Delega per il collaudo',
      'change': {'kind': 'delegation', 'personId': peer.actorId},
    });
    expect(prop['adopted'], false);
    final approval = {
      'type': 'access.approve',
      'proposalId': prop['proposalId'],
      'expectedAccessRevision': rev,
      'acceptTerms': true,
    };
    await command(owner, {...approval, 'role': 'authority'});
    await command(peer, {...approval, 'role': 'holder'});
    final view = await peer.get('$base/access');
    final relation = (view['relationships'] as List).singleWhere(
      (r) => r['holderId'] == peer.actorId && r['active'] == true,
    );
    expect(relation['invitations'], true);
    expect(relation['removeMembers'], false);
    expect(
      (await owner.get(
        '$base/access-history?id=${relation['id']}',
      ))['versions'],
      isNotEmpty,
    );
    await command(peer, {'type': 'access.relinquish', 'confirmed': true});
    final current = await owner.get('$base/access');
    expect(
      (current['relationships'] as List).where(
        (r) => r['holderId'] == peer.actorId && r['active'] == true,
      ),
      isEmpty,
    );
    await command(owner, {
      'type': 'member.remove',
      'personId': peer.actorId,
      'expectedAccessRevision': current['accessRevision'],
      'confirmed': true,
    });
    await expectLater(peer.get('$base/profiles/${owner.actorId}'), denied);
    await expectLater(peer.get('$base/access'), denied);
    await accept((await invite())['invitationId']);
    await command(peer, {'type': 'member.leave', 'confirmed': true});
    await expectLater(peer.get('$base/workspace'), denied);
    expect((await owner.get('$base/workspace'))['workspace']['id'], w);
  });
}
