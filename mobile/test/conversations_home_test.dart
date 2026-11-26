import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api.dart';
import '../lib/conversations_home.dart';

Map<String, dynamic> entry(String id, String name, int day, int unread) => {
  'id': id,
  'name': name,
  'lastActivityAt': '2026-11-${day}T10:00:00Z',
  'preview': 'Ultimo messaggio',
  'unreadCount': unread,
};

class _Directory extends RimiamApi {
  _Directory() : super(Uri.parse('http://localhost'));
  bool hideSpaces = false;
  bool invited = false;
  int accepted = 0;
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (path == '/api/v1/invitations')
      return {
        'invitations': [
          if (invited)
            {
              'id': 'invite',
              'workspaceName': 'Spazio di prova',
              'inviterName': 'Giulia',
              'expiresAt': '2027-01-01T12:00:00Z',
            },
        ],
      };
    if (path != '/api/v1/workspaces') throw StateError(path);
    if (hideSpaces) throw const ApiError(403, 'ACCESS_DENIED');
    return {
      'workspaces': [
        {
          ...entry('space', 'Lancio RIMIAM', 24, 2),
          'mentionCount': 1,
          'firstMentionId': 'msg-42',
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    expect(path, '/api/v1/invitations/invite/accept');
    expect(body, {'fullHistoryAccepted': true});
    invited = false;
    accepted++;
    return {'workspaceId': 'admitted'};
  }

  @override
  Future<List<dynamic>> getList(String path) async {
    if (path != '/api/v1/direct-chats') throw StateError(path);
    return [entry('contact', 'Matteo Rossi', 25, 1)];
  }
}

void main() {
  testWidgets(
    'an invitation opens the correct space only after the history disclosure',
    (tester) async {
      final api = _Directory()
        ..actorId = 'member'
        ..invited = true;
      addTearDown(api.close);
      String? target;
      await tester.pumpWidget(
        MaterialApp(
          home: ConversationsHome(
            api: api,
            open: (_, _) async {},
            contacts: () async {},
            personal: () async {},
            logout: () async {},
            createSpace: () async {},
            enterSpace: (id, name) async => target = id,
            agenda: const SizedBox(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ti invita Giulia'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Accetta ed entra'),
            )
            .onPressed,
        isNull,
      );
      expect(target, isNull);
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Accetta ed entra'));
      await tester.pumpAndSettle();
      expect(target, 'admitted');
      expect(api.accepted, 1);
      expect(find.text('Ti invita Giulia'), findsNothing);
    },
  );
  testWidgets(
    'conversation actions remain reachable with 200 percent text at 320 px',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _Directory();
      addTearDown(api.close);
      var personalOpened = false;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: ConversationsHome(
            api: api,
            open: (_, _) async {},
            createSpace: () async {},
            enterSpace: (_, _) async {},
            agenda: const SizedBox(),
            contacts: () async {},
            logout: () async {},
            personal: () async {
              personalOpened = true;
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final personal = find.text('Tu ed Emme');
      await tester.scrollUntilVisible(
        personal.hitTestable(),
        180,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(personal);
      await tester.pumpAndSettle();
      expect(personalOpened, isTrue);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'group spaces and contacts share the activity order; return refreshes access',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _Directory();
      addTearDown(api.close);
      Conversation? opened;
      String? target;
      final visits = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: ConversationsHome(
            api: api,
            open: (row, messageId) async {
              opened = row;
              target = messageId;
            },
            createSpace: () async {},
            enterSpace: (_, _) async {},
            agenda: const SizedBox(),
            contacts: () async {
              visits.add('contacts');
            },
            personal: () async {
              visits.add('personal');
            },
            logout: () async {
              visits.add('logout');
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      final direct = find.text('Matteo Rossi'),
          space = find.text('Lancio RIMIAM');
      expect(
        tester.getTopLeft(direct).dy,
        lessThan(tester.getTopLeft(space).dy),
      );
      expect(find.text('MR'), findsOneWidget);
      expect(find.textContaining('@ 1'), findsOneWidget);
      await tester.tap(find.text('@ 1'));
      await tester.pumpAndSettle();
      expect(opened?.id, 'space');
      expect(target, 'msg-42');
      await tester.tap(direct);
      await tester.pumpAndSettle();
      expect(opened?.id, 'contact');
      expect(opened?.direct, isTrue);
      api.hideSpaces = true;
      await tester.tap(find.byTooltip('Scrivi a un contatto'));
      await tester.pumpAndSettle();
      expect(space, findsNothing);
      expect(direct, findsOneWidget);
      expect(
        find.text('Spazi temporaneamente non disponibili.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Tu ed Emme'));
      await tester.pumpAndSettle();
      expect(visits, ['contacts', 'personal']);
    },
  );
}
