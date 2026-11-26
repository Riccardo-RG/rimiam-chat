import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/account_entry.dart';
import '../lib/api.dart';
import '../lib/beta_notice.dart';
import '../lib/beta_rule_identity.dart';
import '../lib/chat_actions.dart';
import '../lib/conversations_home.dart';
import '../lib/ui_language.dart';
import '../lib/workspace_governance.dart';

class _Directory extends RimiamApi {
  _Directory() : super(Uri.parse('http://localhost'));

  @override
  Future<Map<String, dynamic>> get(String path) async => switch (path) {
    '/api/v1/workspaces' => {
      'workspaces': [
        {
          'id': 'space',
          'name': 'Invia',
          'preview': 'Oggi',
          'lastActivityAt': '2026-11-25T19:00:00Z',
          'unreadCount': 2,
          'mentionCount': 1,
          'firstMentionId': 'message-42',
        },
      ],
    },
    '/api/v1/invitations' => {'invitations': []},
    '/api/v1/native/social/providers' => {'google': true},
    _ => {},
  };

  @override
  Future<List<dynamic>> getList(String path) async => [];
}

Widget localized(Widget home, {Locale locale = const Locale('en')}) =>
    MaterialApp(
      locale: locale,
      supportedLocales: interfaceLanguages,
      localizationsDelegates: const [
        UiMessages.delegate,
        ...GlobalMaterialLocalizations.delegates,
      ],
      home: home,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await UiMessages.delegate.load(const Locale('en'));
  });
  test('device preferences select the first supported language and manual choice wins', () {
    expect(
      resolveInterfaceLanguage('system', const [
        Locale('de'),
        Locale('it', 'CH'),
        Locale('en'),
      ]),
      const Locale('it'),
    );
    expect(
      resolveInterfaceLanguage('en', const [Locale('it')]),
      const Locale('en'),
    );
    expect(
      resolveInterfaceLanguage('system', const [Locale('fr')]),
      const Locale('en'),
    );
    const copy = UiMessages(Locale('en'), {
      'Da {0} a {1}': 'From {0} to {1}',
      'Invia': 'Send',
    });
    expect(
      copy.text('Da {0} a {1}', ['Invia {1}', 'Oggi']),
      'From Invia {1} to Oggi',
    );
  });

  testWidgets(
    'language changes in place at login, keeps input and survives relaunch',
    (t) async {
      FlutterSecureStorage.setMockInitialValues({
        'rimiam.ui-language.v1': 'it',
      });
      final api = _Directory();
      addTearDown(api.close);
      Widget app() => InterfaceLanguage(
        builder: (l) => localized(
          Scaffold(
            body: ListView(
              children: [
                AccountEntry(
                  api: api,
                  callbacks: const Stream.empty(),
                  authenticated: () async {},
                  changeInstallation: () {},
                ),
              ],
            ),
          ),
          locale: l,
        ),
      );
      await t.pumpWidget(app());
      await t.pumpAndSettle();
      expect(find.text('Accedi'), findsWidgets);
      Finder email() => find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Email',
      );
      await t.enterText(email(), 'Invia');
      await t.testTextInput.receiveAction(TextInputAction.next);
      await t.tap(find.byType(DropdownButtonFormField<String>));
      await t.pumpAndSettle();
      await t.tap(find.text('English').last);
      await t.pumpAndSettle();
      expect(find.text('Sign in'), findsWidgets);
      expect(t.widget<TextField>(email()).controller!.text, 'Invia');
      expect(find.byTooltip('Show password'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      await t.pump();
      await t.pumpWidget(app());
      await t.pumpAndSettle();
      expect(find.text('Sign in'), findsWidgets);
    },
  );

  testWidgets(
    'Home translates controls and read counts while preserving space and message text',
    (t) async {
      final api = _Directory()..actorId = 'me';
      addTearDown(api.close);
      String? target;
      final semantics = t.ensureSemantics();
      await t.pumpWidget(
        localized(
          ConversationsHome(
            api: api,
            open: (room, id) async {
              target = id;
            },
            contacts: () async {},
            personal: () async {},
            logout: () async {},
            createSpace: () async {},
            enterSpace: (_, _) async {},
            agenda: const SizedBox(),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Your spaces'), findsOneWidget);
      expect(find.text('Invia'), findsOneWidget);
      expect(find.text('Oggi'), findsOneWidget);
      expect(find.byTooltip('New space'), findsOneWidget);
      final mention = find.text('@ 1');
      expect(t.getSemantics(mention).label.toLowerCase(), contains('mention'));
      expect(t.widget<Text>(find.text('2')).semanticsLabel, contains('unread'));
      await t.tap(mention);
      await t.pump();
      expect(target, 'message-42');
      await t.pumpWidget(const SizedBox());
      semantics.dispose();
    },
  );

  testWidgets(
    'published beta notice offers the original and preserves a customized rule verbatim',
    (t) async {
      await t.pumpWidget(
        localized(
          const Scaffold(
            body: BetaNotice(
              version: publishedBetaVersion,
              source: publishedBetaText,
            ),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Original Italian text'), findsOneWidget);
      expect(find.text(publishedBetaText), findsNothing);
      await t.tap(find.text('Original Italian text'));
      await t.pumpAndSettle();
      expect(find.text(publishedBetaText), findsOneWidget);
      await t.pumpWidget(
        localized(
          const Scaffold(
            body: BetaNotice(version: publishedBetaVersion, source: 'Invia'),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Invia'), findsOneWidget);
      expect(find.text('Original Italian text'), findsNothing);
      await t.pumpWidget(
        localized(
          const Scaffold(
            body: BetaNotice(version: 'different', source: publishedBetaText),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text(publishedBetaText), findsOneWidget);
    },
  );

  testWidgets(
    'formats display dates and command aliases for the selected locale',
    (t) async {
      final actions = await composerCatalog;
      final files = actions.firstWhere((a) => a.aliases.contains('/file'));
      expect(files.aliases, contains('/files'));
      Widget panel() => Builder(
        builder: (c) => Column(
          children: [
            Text(groupDate(c, '2026-11-21T12:00:00')),
            Text(files.displayShortcuts(c).join(' · ')),
            Text(files.displayLabel(c)),
          ],
        ),
      );
      await t.pumpWidget(localized(Scaffold(body: panel())));
      await t.pumpAndSettle();
      expect(find.textContaining('11/21/2026'), findsOneWidget);
      expect(find.textContaining('/files'), findsOneWidget);
      await t.pumpWidget(
        localized(Scaffold(body: panel()), locale: const Locale('it')),
      );
      await t.pumpAndSettle();
      expect(find.textContaining('21/11/2026'), findsOneWidget);
      expect(find.textContaining('/documenti'), findsOneWidget);
    },
  );
}
