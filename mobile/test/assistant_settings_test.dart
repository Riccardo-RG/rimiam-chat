import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/api.dart';
import '../lib/assistant_settings_model.dart';
import '../lib/assistant_settings.dart';
import '../lib/assistant_rhythm.dart';
import '../lib/assistant_instruction_export.dart';
import '../lib/chat_journal.dart';

SettingsJson connection(String id, String kind, {bool active = true}) => {
  'id': id,
  'kind': kind,
  'label': id == 'default' ? 'Modello locale' : id,
  'destination': 'https://$id.example.test',
  'configured': active,
  'provider': id == 'default' ? 'ollama' : 'agent',
  'revision': List.filled(64, id == 'default' ? '1' : '2').join(),
};
SettingsJson config(String? space, {bool manager = true}) => {
  'revision': 2,
  'displayName': 'Emme',
  'connectionId': 'default',
  'instructions': space == null ? 'Personal style.' : 'Group style.',
  'defaultInstructions': 'Installation default.',
  'baseInstructions': 'Fixed policy.',
  'effectiveInstructions': 'Saved effective guidance.',
  'canManage': manager,
  'needsReconfirmation': false,
  'managedSpaces': [
    if (space == null)
      {
        'workspaceId': 'space',
        'workspaceName': 'Lancio',
        'displayName': 'Emme',
        'connectionId': 'default',
      },
  ],
  'connections': [
    connection('default', 'model'),
    if (manager) connection('Atelier', 'agent'),
    if (manager) connection('Disabled', 'model', active: false),
  ],
};

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('http://127.0.0.1')) {
    actorId = 'tester';
  }
  SettingsJson personal = config(null),
      shared = config('space'),
      pref = {'mode': 'discreet', 'version': 0};
  bool writer = true, lose = false, lostAccess = false, stale = false;
  final gets = <String>[], posts = <SettingsJson>[];
  @override
  Future<SettingsJson> get(String path) async {
    gets.add(path);
    if (lostAccess) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (path.endsWith('/attention')) return {'preference': pref};
    if (path.endsWith('/workspace'))
      return {
        'members': [
          {'user_id': actorId, 'active': true, 'contributes': writer},
        ],
      };
    return path.contains('?') ? shared : personal;
  }

  @override
  Future<SettingsJson> post(String path, SettingsJson body) async {
    posts.add(body);
    if (path.endsWith('/commands')) {
      pref = {
        'mode': body['command']['mode'],
        'version': (pref['version'] as int) + 1,
      };
      return {'commandId': body['commandId'], 'status': 'committed'};
    }
    final scoped = body.containsKey('workspaceId'),
        prev = scoped ? shared : personal;
    if (stale) {
      stale = false;
      final concurrent = {
        ...prev,
        'revision': (prev['revision'] as int) + 1,
        'instructions': 'Modified on another device.',
      };
      if (scoped) {
        shared = concurrent;
      } else {
        personal = concurrent;
      }
      throw const ApiError(409, 'ASSISTANT_SETTINGS_STALE');
    }
    final next = {
      ...prev,
      'revision': (prev['revision'] as int) + 1,
      'instructions': body['instructions'],
      'displayName': body['displayName'],
      'connectionId': body['connectionId'],
    };
    if (scoped) {
      shared = next;
    } else {
      personal = next;
    }
    if (lose) throw const SocketException('Synthetic lost response.');
    return next;
  }
}

class _Vault implements DraftVault {
  final data = <String, String>{};
  @override
  Future<String?> read(String k) async => data[k];
  @override
  Future<void> replace(String k, String? v) async {
    if (v == null) {
      data.remove(k);
    } else {
      data[k] = v;
    }
  }
}

Future<void> visit(WidgetTester t, Widget screen) async {
  await t.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => t.binding.setSurfaceSize(null));
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}

Future<void> tap(WidgetTester t, String label) async {
  if (find.text(label).evaluate().isEmpty) {
    await t.scrollUntilVisible(
      find.text(label),
      250,
      scrollable: find.byType(Scrollable).first,
    );
  }
  final f = find.text(label).last;
  await t.ensureVisible(f);
  await t.pumpAndSettle();
  await t.tap(f);
  await t.pumpAndSettle();
}

void main() {
  testWidgets(
    'scope change protects the draft and requires confirmation of the agent destination',
    (t) async {
      final a = _Api();
      await visit(t, AssistantSettingsScreen(api: a));
      await t.enterText(find.byType(TextField).first, 'Privata');
      await tap(t, 'Tu ed Emme');
      await tap(t, 'Lancio');
      await tap(t, 'Annulla');
      expect(find.text('Privata'), findsOneWidget);
      await tap(t, 'Tu ed Emme');
      await tap(t, 'Lancio');
      await tap(t, 'Esci senza salvare');
      expect(find.text('Group style.'), findsOneWidget);
      await tap(t, 'Modello locale');
      await tap(t, 'Atelier');
      await tap(t, 'Salva impostazioni');
      expect(find.textContaining('https://Atelier.example.test'), findsWidgets);
      await tap(t, 'Annulla');
      expect(a.posts, isEmpty);
      await tap(t, 'Salva impostazioni');
      await tap(t, 'Conferma');
      expect(a.posts.single, {
        'workspaceId': 'space',
        'expectedActorId': 'tester',
        'expectedRevision': 2,
        'connectionRevision': List.filled(64, '2').join(),
        'connectionId': 'Atelier',
        'displayName': 'Emme',
        'instructions': 'Group style.',
      });
      expect(a.personal['displayName'], 'Emme');
    },
  );
  testWidgets(
    'reset keeps name and connection and checks a lost acknowledgement using GET only',
    (t) async {
      final a = _Api()..lose = true;
      await visit(t, AssistantSettingsScreen(api: a));
      await tap(t, 'Usa le istruzioni predefinite');
      await tap(t, 'Salva impostazioni');
      expect(a.posts.single.containsKey('workspaceId'), false);
      expect(a.posts.single['instructions'], '');
      await tap(t, 'Verifica versione salvata');
      expect(a.posts, hasLength(1));
      expect(a.gets, hasLength(2));
      expect(find.textContaining('Impostazioni verificate'), findsOneWidget);
    },
  );
  testWidgets(
    'a concurrent edit is reloaded explicitly and the draft survives cancellation',
    (t) async {
      final a = _Api()..stale = true;
      await visit(t, AssistantSettingsScreen(api: a));
      await t.enterText(find.byType(TextField).last, 'My separate draft.');
      await tap(t, 'Salva impostazioni');
      await tap(t, 'Verifica versione salvata');
      await tap(t, 'Annulla');
      expect(find.text('My separate draft.'), findsOneWidget);
      await tap(t, 'Verifica versione salvata');
      await tap(t, 'Carica versione salvata');
      expect(find.text('Modified on another device.'), findsOneWidget);
      expect(a.posts, hasLength(1));
    },
  );
  testWidgets(
    'ordinary member reads and exports saved settings, revoked member cannot export stale content',
    (t) async {
      final a = _Api()..shared = config('space', manager: false);
      final exported = <String>[];
      await visit(
        t,
        AssistantSettingsScreen(
          api: a,
          workspaceId: 'space',
          workspaceName: 'Lancio',
          exportInstructions: (s, r) async {
            exported.add(s);
          },
        ),
      );
      expect(
        t
            .widgetList<TextField>(find.byType(TextField))
            .every((f) => f.readOnly),
        true,
      );
      expect(find.text('Salva impostazioni'), findsNothing);
      await tap(t, 'Esporta istruzioni salvate (.md)');
      expect(exported, ['Saved effective guidance.']);
      a.lostAccess = true;
      await tap(t, 'Esporta istruzioni salvate (.md)');
      expect(exported, hasLength(1));
      expect(find.text('Group style.'), findsNothing);
      expect(find.textContaining('perso l’accesso'), findsOneWidget);
    },
  );
  testWidgets(
    'shared rhythm uses separate contributor rights and a versioned command',
    (t) async {
      final a = _Api()..shared = config('space', manager: false);
      await visit(
        t,
        AssistantRhythmScreen(
          api: a,
          workspaceId: 'space',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      await tap(t, 'Collaborativa');
      await tap(t, 'Salva ritmo');
      expect(a.posts.single['expectedActorId'], 'tester');
      expect(a.posts.single['command'], {
        'type': 'attention.preference',
        'mode': 'collaborative',
        'expectedVersion': 0,
      });
      a.writer = false;
      await visit(
        t,
        AssistantRhythmScreen(
          key: UniqueKey(),
          api: a,
          workspaceId: 'space',
          workspaceName: 'Lancio',
          vault: _Vault(),
        ),
      );
      expect(find.text('Salva ritmo'), findsNothing);
    },
  );
  testWidgets(
    'returning to the panel rechecks admission before showing a draft',
    (t) async {
      final a = _Api();
      await visit(
        t,
        AssistantSettingsScreen(
          api: a,
          workspaceId: 'space',
          workspaceName: 'Lancio',
        ),
      );
      await t.enterText(find.byType(TextField).last, 'Still private.');
      a.lostAccess = true;
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await t.pumpAndSettle();
      expect(find.text('Still private.'), findsNothing);
      expect(find.textContaining('perso l’accesso'), findsOneWidget);
      expect(a.posts, isEmpty);
    },
  );
  test(
    'refuses unavailable connector and rejects identity change before posting',
    () async {
      final a = _Api(), r = AssistantSettingsRepository(a);
      final base = await r.read(null);
      await expectLater(
        r.save(
          workspace: null,
          base: base,
          connectionId: 'Disabled',
          name: 'Emme',
          instructions: 'Private',
        ),
        throwsA(isA<ApiError>()),
      );
      a.actorId = 'other';
      await expectLater(
        r.save(
          workspace: null,
          base: base,
          connectionId: 'default',
          name: 'Emme',
          instructions: 'Private',
        ),
        throwsA(isA<ApiError>()),
      );
      expect(a.posts, isEmpty);
    },
  );
  test('deletes exported plaintext even when the system sheet fails', () async {
    late File temp;
    await expectLater(
      sharePrivateBytes(
        utf8.encode('Sintetico'),
        name: 'assistant-instructions.md',
        mimeType: 'text/markdown',
        anchor: const Rect.fromLTWH(0, 0, 22, 22),
        present: (f, m, r) async {
          temp = f;
          expect(await f.readAsString(), 'Sintetico');
          expect(m, 'text/markdown');
          throw const FormatException();
        },
      ),
      throwsFormatException,
    );
    expect(await temp.exists(), false);
  });
}
