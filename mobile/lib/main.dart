import 'ui_language.dart';
import 'beta_notice.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'account_entry.dart';
import 'agenda.dart';
import 'conversations_home.dart';
import 'direct_contacts.dart';
import 'direct_conversation.dart';
import 'journey.dart';
import 'installation_gate.dart';
import 'personal_chat.dart';
import 'studio_theme.dart';
import 'studio_appearance.dart';
import 'native_push.dart';
import 'workspace_creation.dart';
import 'workspace_tool_host.dart';
import 'personal_navigation.dart';
import 'assistant_settings.dart';
import 'file_library.dart';

void main() => runApp(
  InterfaceLanguage(
    builder: (locale) => StudioAppearance(
      builder: (mode, accent) => MaterialApp(
        title: 'RIMIAM',
        navigatorObservers: [homeRouteObserver, workspaceOverlayObserver],
        locale: locale,
        supportedLocales: interfaceLanguages,
        localizationsDelegates: const [
          UiMessages.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        themeMode: mode,
        theme: studioTheme(Brightness.light, accent: accent),
        darkTheme: studioTheme(Brightness.dark, accent: accent),
        home: InstallationGate(
          builder: (origin, change) => Entry(
            key: ValueKey(origin),
            origin: origin,
            changeInstallation: change,
          ),
        ),
        debugShowCheckedModeBanner: false,
      ),
    ),
  ),
);

class Entry extends StatefulWidget {
  const Entry({
    super.key,
    required this.origin,
    required this.changeInstallation,
  });
  final Uri origin;
  final VoidCallback changeInstallation;
  @override
  State<Entry> createState() => _EntryState();
}

class _EntryState extends State<Entry> {
  late final api = RimiamApi(widget.origin);
  Map<String, dynamic>? rules;
  bool atHome = false;
  bool busy = false;
  String? error;
  bool checkingSession = true;
  bool closingSession = false;

  @override
  void initState() {
    super.initState();
    unawaited(checkSession());
  }

  Future<void> checkSession() => run(() async {
    if (closingSession) await api.logout();
    if (await api.restoreSession()) await loadHome();
    if (mounted)
      setState(() {
        checkingSession = false;
        closingSession = false;
      });
  });

  Future<void> signOut() async {
    setState(() {
      atHome = false;
      rules = null;
      checkingSession = true;
      closingSession = true;
    });
    await checkSession();
  }

  @override
  void dispose() {
    api.close();
    super.dispose();
  }

  Future<void> run(Future<void> Function() operation) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await operation();
    } on Object catch (problem) {
      if (mounted) setState(() => error = accountIssue(problem));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> loadHome() async {
    final policy = await api.get('/api/v1/beta-rules');
    if (policy['actorId'] != api.actorId) {
      throw StateError('Sessione non corrispondente');
    }
    if (policy['acceptedAt'] == null) {
      if (mounted) setState(() => rules = policy);
      return;
    }
    if (mounted) {
      setState(() {
        rules = null;
        atHome = true;
      });
    }
  }

  Future<void> signedIn() => run(() async {
    setState(() => checkingSession = true);
    await loadHome();
    if (mounted) setState(() => checkingSession = false);
  });

  @override
  Widget build(BuildContext context) {
    Future<void> visit(Widget page) async {
      await Navigator.of(context)
          .push(MaterialPageRoute<void>(builder: (_) => page));
    }

    Future<void> enterSpace(String id, String name) =>
        visit(WorkspaceJourney(api: api, workspaceId: id, workspaceName: name));
    Future<void> createSpace() async {
      final owner = api.actorId;
      final result = await Navigator.of(context).push<WorkspaceTarget>(
        MaterialPageRoute(builder: (_) => WorkspaceCreation(api: api)),
      );
      if (mounted && owner == api.actorId && result != null) {
        await enterSpace(result.id, result.name);
      }
    }

    if (atHome && !checkingSession) {
      final owner = api.actorId;
      Widget personalPage(PersonalSection section, Widget child) =>
          PersonalNavigation(
            key: ValueKey((api.origin, owner, section)),
            api: api,
            initial: section,
            child: child,
            openSpace: enterSpace,
            sessionIsCurrent: () =>
                mounted && atHome && !checkingSession && api.actorId == owner,
            buildSection: (next) => switch (next) {
              PersonalSection.emme => PersonalChatPage(api: api),
              PersonalSection.documents => FileLibrary(api: api),
              PersonalSection.settings => AssistantSettingsScreen(api: api),
              PersonalSection.today => AgendaPage(api: api),
              PersonalSection.home => throw StateError(
                'Home is the initial route',
              ),
            },
          );
      return NativePushNavigation(
        key: ValueKey((api.origin, api.actorId)),
        api: api,
        onOpen: (workspaceId, messageId) {
          unawaited(
            visit(
              WorkspaceJourney(
                api: api,
                workspaceId: workspaceId,
                workspaceName: 'Spazio',
                initialMessageId: messageId,
              ),
            ),
          );
        },
        child: personalPage(
          PersonalSection.home,
          ConversationsHome(
            api: api,
            logout: signOut,
            createSpace: createSpace,
            enterSpace: enterSpace,
            agenda: HomeAgendaPreview(
              api: api,
              open: (action) => visit(
                personalPage(
                  PersonalSection.today,
                  AgendaPage(api: api, initialAction: action),
                ),
              ),
            ),
            open: (row, messageId) => visit(
              row.direct
                  ? DirectConversation(api: api, id: row.id, name: row.name)
                  : WorkspaceJourney(
                      api: api,
                      workspaceId: row.id,
                      initialMessageId: messageId,
                      workspaceName: row.name,
                    ),
            ),
            contacts: () => visit(DirectContacts(api: api)),
            personal: () => visit(
              personalPage(PersonalSection.emme, PersonalChatPage(api: api)),
            ),
          ),
        ),
      );
    }
    final consent = rules;
    final contents = <Widget>[];
    if (checkingSession) {
      contents.add(
        Padding(
          padding: const EdgeInsets.only(top: 32, bottom: 16),
          child: Image.asset(
            'assets/brand.png',
            width: 56,
            height: 56,
            excludeFromSemantics: true,
          ),
        ),
      );
      contents.add(
        Text(
          closingSession
              ? uiText(context, 'Uscita in corso')
              : uiText(context, 'Verifica della sessione'),
        ),
      );
      if (!busy) {
        contents.add(
          FilledButton(
            onPressed: checkSession,
            child: Text(uiText(context, 'Riprova')),
          ),
        );
      }
    } else if (consent != null) {
      contents.add(
        BetaNotice(
          version: consent['version'] as String,
          source: consent['text'] as String,
        ),
      );
      contents.add(
        FilledButton(
          onPressed: busy
              ? null
              : () => run(() async {
                  await api.post('/api/v1/beta-rules', {
                    'expectedActorId': api.actorId,
                    'version': consent['version'],
                    'contentDigest': consent['contentDigest'],
                  });
                  await loadHome();
                }),
          child: Text(uiText(context, 'Accetta e continua')),
        ),
      );
    } else {
      contents.add(
        AccountEntry(
          api: api,
          changeInstallation: widget.changeInstallation,
          authenticated: signedIn,
        ),
      );
    }
    if (busy && !MediaQuery.disableAnimationsOf(context)) {
      contents.add(const LinearProgressIndicator());
    }
    if (error != null) contents.add(SelectableText(uiText(context, error!)));
    return Scaffold(
      appBar: AppBar(
        title: Text(
          consent != null ? uiText(context, 'Regole della beta') : 'RIMIAM',
        ),
      ),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(16), children: contents),
      ),
    );
  }
}
