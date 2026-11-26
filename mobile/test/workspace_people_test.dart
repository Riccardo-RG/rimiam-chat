import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;
import 'package:material_ui/material_ui.dart';

import 'dart:typed_data';

import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/profile_photo_codec.dart';
import '../lib/workspace_people.dart';

class Vault implements DraftVault {
  final data = <String, String>{};
  @override
  Future<String?> read(String k) async => data[k];
  @override
  Future<void> replace(String k, String? value) async {
    if (value == null) {
      data.remove(k);
    } else {
      data[k] = value;
    }
  }
}

class Fixture extends RimiamApi {
  Fixture({this.steward = true}) : super(Uri.parse('http://127.0.0.1')) {
    actorId = 'a';
  }
  final bool steward;
  bool denied = false, protected = false;
  int version = 3;
  String? phone;
  final commands = <Map<String, dynamic>>[];
  final requests = <String>[];
  final invitations = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> get members => [
    {'user_id': 'a', 'name': 'Ada Rossi', 'active': true, 'contributes': true},
    {'user_id': 'b', 'name': 'Matteo Blu', 'active': true, 'contributes': true},
  ];
  @override
  Future<Map<String, dynamic>> get(String path) async {
    requests.add(path);
    if (denied) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    final u = Uri.parse(path);
    if (u.path.endsWith('/workspace'))
      return {
        'workspace': {'id': 'w', 'name': 'Lancio'},
        'members': members,
        'invitations': invitations,
      };
    if (u.path.endsWith('/access'))
      return {
        'accessRevision': 11,
        'next': null,
        'proposals': [],
        'relationships': [
          if (steward)
            {
              'id': 'r',
              'holderId': 'a',
              'holderName': 'Ada Rossi',
              'kind': 'stewardship',
              'active': true,
              'available': true,
              'invitations': true,
              'removeMembers': true,
              'changeAccess': true,
              'protected': false,
            },
          if (protected)
            {
              'id': 'r2',
              'holderId': 'b',
              'holderName': 'Matteo Blu',
              'kind': 'stewardship',
              'active': true,
              'available': true,
              'invitations': true,
              'removeMembers': true,
              'changeAccess': true,
              'protected': true,
            },
        ],
        'members': [
          for (final m in members)
            {'id': m['user_id'], 'name': m['name'], 'active': true},
        ],
      };
    if (u.path.endsWith('/identity-photos'))
      return {
        'actor': 'a',
        'own': {'version': 0, 'present': false},
        'rooms': {},
        'members': {},
      };
    if (u.path.endsWith('/profiles/b') || u.path.endsWith('/profile')) {
      final mine = u.path.endsWith('/profile');
      return {
        'id': mine ? 'a' : 'b',
        'name': mine ? 'Ada Rossi' : 'Matteo Blu',
        'email': mine ? 'ada@example.test' : 'matteo@example.test',
        'phone': phone,
        'version': version,
      };
    }
    throw StateError(path);
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    if (path.endsWith('/profile')) {
      expect(body['expectedVersion'], version);
      expect(body['expectedActorId'], 'a');
      phone = body['phone'];
      version++;
      return get(path);
    }
    if (path.endsWith('/commands')) {
      final command = body['command'] as Map<String, dynamic>;
      commands.add(command);
      var result = <String, dynamic>{};
      if (command['type'] == 'invitation.create') {
        invitations.add({
          'id': 'i',
          'recipient_email': command['email'],
          'expires_at': '2100-01-01T00:00:00Z',
          'accepted_at': null,
          'revoked_at': null,
        });
        result = {
          'invitationId': 'i',
          'invitationUrl': 'https://test.invalid/?invite=synthetic',
        };
      }
      if (command['type'] == 'invitation.revoke')
        invitations.single['revoked_at'] = '2026-10-01';
      return {
        'status': 'committed',
        'commandId': body['commandId'],
        'result': result,
      };
    }
    throw StateError(path);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('trasforma foto ruotata in JPEG entro 512 px senza orientamento EXIF, gestisce trasparenza e limita dimensioni', () async {
    final img = image.Image(width: 800, height: 400, numChannels: 3)
      ..exif.imageIfd.orientation = 6;
    final result = await profilePhotoJpeg(image.encodeJpg(img));
    final decoded = image.decodeJpg(result)!;
    expect([decoded.width, decoded.height], [256, 512]);
    expect(decoded.exif.imageIfd.hasOrientation, isFalse);
    expect(result.length, lessThanOrEqualTo(360000));
    final transparent = image.Image(width: 4, height: 4, numChannels: 4);
    final white = image
        .decodeJpg(await profilePhotoJpeg(image.encodePng(transparent)))!
        .getPixel(0, 0);
    expect(white.r, greaterThan(248));
    expect(white.b, greaterThan(248));
    await expectLater(
      profilePhotoJpeg(Uint8List(8 * 1024 * 1024 + 1)),
      throwsFormatException,
    );
  });
  testWidgets(
    'il comando invito apre il modulo una sola volta con la delega attiva',
    (t) async {
      final a = Fixture();
      await t.pumpWidget(
        MaterialApp(
          home: WorkspacePeoplePage(
            api: a,
            workspace: 'w',
            vault: Vault(),
            inviteOnOpen: true,
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Indirizzo email'), findsOneWidget);
      expect(a.commands, isEmpty);
      await t.pageBack();
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Aggiorna partecipanti'));
      await t.pumpAndSettle();
      expect(find.text('Indirizzo email'), findsNothing);
    },
  );
  testWidgets(
    'il comando invito senza autorizzazione apre la lista partecipanti',
    (t) async {
      final a = Fixture(steward: false);
      await t.pumpWidget(
        MaterialApp(
          home: WorkspacePeoplePage(
            api: a,
            workspace: 'w',
            vault: Vault(),
            inviteOnOpen: true,
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Indirizzo email'), findsNothing);
      expect(
        find.text('Gli inviti sono gestiti da chi ha la delega nello spazio.'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'un partecipante vede iniziali e scheda. Senza accesso la scheda scompare',
    (t) async {
      final a = Fixture(steward: false);
      await t.pumpWidget(
        MaterialApp(
          home: WorkspacePeoplePage(api: a, workspace: 'w', vault: Vault()),
        ),
      );
      await t.pumpAndSettle();
      expect(find.byTooltip('Invita una persona'), findsNothing);
      expect(find.byTooltip('Opzioni per Matteo Blu'), findsNothing);
      expect(find.text('MB'), findsOneWidget);
      await t.tap(find.text('Matteo Blu'));
      await t.pumpAndSettle();
      expect(find.text('matteo@example.test'), findsOneWidget);
      expect(find.text('Salva numero'), findsNothing);
      a.denied = true;
      await t.tap(find.byTooltip('Aggiorna profilo'));
      await t.pumpAndSettle();
      expect(find.text('matteo@example.test'), findsNothing);
      expect(find.text('Il profilo non è più disponibile.'), findsOneWidget);
    },
  );
  testWidgets(
    'invito con cronologia esplicita, revoca con conferma, link nascosto dopo revoca',
    (t) async {
      final a = Fixture();
      await t.pumpWidget(
        MaterialApp(
          home: WorkspacePeoplePage(api: a, workspace: 'w', vault: Vault()),
        ),
      );
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Invita una persona'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), '  Giulia@example.test  ');
      expect(
        t
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Invia invito'),
            )
            .onPressed,
        isNull,
      );
      await t.tap(find.byType(SwitchListTile));
      await t.tap(find.byType(CheckboxListTile));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(FilledButton, 'Crea invito'));
      await t.pumpAndSettle();
      expect(a.commands.single, {
        'type': 'invitation.create',
        'email': 'giulia@example.test',
        'sendEmail': false,
        'fullHistoryDisclosed': true,
      });
      expect(find.text('Copia il link dell’invito'), findsOneWidget);
      final opts = find.byTooltip('Opzioni invito');
      if (opts.evaluate().isEmpty) {
        await t.tap(find.text('Inviti · 1'));
        await t.pumpAndSettle();
      }
      await t.ensureVisible(opts);
      await t.tap(opts);
      await t.pumpAndSettle();
      await t.tap(find.text('Revoca invito'));
      await t.pumpAndSettle();
      expect(a.commands.length, 1);
      await t.tap(find.widgetWithText(FilledButton, 'Revoca invito'));
      await t.pumpAndSettle();
      expect(a.commands.last, {
        'type': 'invitation.revoke',
        'invitationId': 'i',
      });
      expect(find.text('Copia il link dell’invito'), findsNothing);
    },
  );
  testWidgets('rimozione con revisione e conferma, titolare protetto escluso', (
    t,
  ) async {
    final a = Fixture();
    await t.pumpWidget(
      MaterialApp(
        home: WorkspacePeoplePage(api: a, workspace: 'w', vault: Vault()),
      ),
    );
    await t.pumpAndSettle();
    await t.tap(find.byTooltip('Opzioni per Matteo Blu'));
    await t.pumpAndSettle();
    await t.tap(find.text('Rimuovi accesso'));
    await t.pumpAndSettle();
    expect(a.commands, isEmpty);
    await t.tap(find.widgetWithText(FilledButton, 'Rimuovi accesso'));
    await t.pumpAndSettle();
    expect(a.commands.single, {
      'type': 'member.remove',
      'personId': 'b',
      'expectedAccessRevision': 11,
      'confirmed': true,
    });
    a.protected = true;
    await t.tap(find.byTooltip('Aggiorna partecipanti'));
    await t.pumpAndSettle();
    expect(find.byTooltip('Opzioni per Matteo Blu'), findsNothing);
  });
  testWidgets('il telefono facoltativo è versionato e correggibile', (t) async {
    final a = Fixture();
    await t.pumpWidget(MaterialApp(home: AccountProfilePage(api: a)));
    await t.pumpAndSettle();
    final field = find.byType(TextField);
    await t.enterText(field, '123');
    await t.pump();
    await t.ensureVisible(find.text('Salva numero'));
    await t.tap(find.text('Salva numero'));
    await t.pumpAndSettle();
    expect(a.version, 3);
    expect(
      find.text('Controlla il numero, con prefisso se necessario.'),
      findsOneWidget,
    );
    await t.enterText(field, '+39 020 123456');
    await t.pump();
    await t.ensureVisible(find.text('Salva numero'));
    await t.tap(find.text('Salva numero'));
    await t.pumpAndSettle();
    expect(a.phone, '+39 020 123456');
    expect(a.version, 4);
    await t.enterText(field, '');
    await t.pump();
    await t.ensureVisible(find.text('Salva numero'));
    await t.tap(find.text('Salva numero'));
    await t.pumpAndSettle();
    expect(a.phone, isNull);
    expect(a.version, 5);
  });
}
