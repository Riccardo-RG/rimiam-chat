import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'incoming_invitations.dart';
import 'file_library.dart';
import 'assistant_settings.dart';
import 'participant_profile.dart';
import 'personal_chat.dart';
import 'personal_navigation.dart';
import 'studio_theme.dart';

class Conversation {
  Conversation(Map<String, dynamic> row, {required this.direct})
    : id = row['id'] as String,
      name = row['name'] as String,
      at = DateTime.parse(row['lastActivityAt'] as String).toLocal(),
      preview = row['preview'] as String?,
      unread = row['unreadCount'] as int,
      mentions = row['mentionCount'] as int? ?? 0,
      requests = row['requestCount'] as int? ?? 0,
      firstMention = row['firstMentionId'] as String?,
      firstRequest = row['firstRequestId'] as String?;
  final String id, name;
  final DateTime at;
  final String? preview, firstMention, firstRequest;
  final int unread, mentions, requests;
  final bool direct;
}

class ConversationsHome extends StatefulWidget {
  const ConversationsHome({
    super.key,
    required this.api,
    required this.open,
    required this.contacts,
    required this.personal,
    required this.logout,
    required this.createSpace,
    required this.enterSpace,
    required this.agenda,
  });
  final RimiamApi api;
  final Future<void> Function(Conversation room, String? messageId) open;
  final Future<void> Function() contacts, personal, logout, createSpace;
  final Future<void> Function(String id, String name) enterSpace;
  final Widget agenda;
  @override
  State<ConversationsHome> createState() => _ConversationsHomeState();
}

class _ConversationsHomeState extends State<ConversationsHome>
    with WidgetsBindingObserver, RouteAware {
  late final Timer _timer;
  List<Conversation> _spaces = [], _direct = [];
  List<ReceivedInvite> _invites = [];
  ({String thread, String workId})? _readyResearch;
  String? _spaceIssue, _directIssue, _inviteIssue;
  Future<void>? _reading;
  bool _first = true, _foreground = true;
  PageRoute<dynamic>? _homeRoute;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route is PageRoute<dynamic> && !identical(route, _homeRoute)) {
      homeRouteObserver.unsubscribe(this);
      _homeRoute = route;
      homeRouteObserver.subscribe(this, route);
    }
  }

  @override
  void didPopNext() {
    if (_foreground && mounted) unawaited(_refresh());
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (_foreground && ModalRoute.of(context)?.isCurrent == true)
        unawaited(_refresh());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground && _readyResearch != null)
      setState(() => _readyResearch = null);
    if (_foreground && ModalRoute.of(context)?.isCurrent == true)
      unawaited(_refresh());
  }

  @override
  void dispose() {
    homeRouteObserver.unsubscribe(this);
    WidgetsBinding.instance.removeObserver(this);
    _timer.cancel();
    super.dispose();
  }

  Future<void> _part(bool direct) async {
    final actor = widget.api.actorId;
    try {
      final rows = direct
          ? await widget.api.getList('/api/v1/direct-chats')
          : (await widget.api.get('/api/v1/workspaces'))['workspaces'] as List;
      final entries = [
        for (final row in rows)
          Conversation(row as Map<String, dynamic>, direct: direct),
      ];
      if (!mounted || !_foreground || actor != widget.api.actorId) return;
      setState(() {
        if (direct) {
          _direct = entries;
          _directIssue = null;
        } else {
          _spaces = entries;
          _spaceIssue = null;
        }
      });
    } catch (_) {
      if (!mounted || !_foreground || actor != widget.api.actorId) return;
      setState(() {
        if (direct) {
          _direct = [];
          _directIssue = 'Chat private temporaneamente non disponibili.';
        } else {
          _spaces = [];
          _spaceIssue = 'Spazi temporaneamente non disponibili.';
        }
      });
    }
  }

  Future<void> _refreshInvites() async {
    final actor = widget.api.actorId;
    try {
      final response = await widget.api.get('/api/v1/invitations');
      if (!mounted || widget.api.actorId != actor) return;
      final list = (response['invitations'] as List)
          .map((v) => ReceivedInvite(v as Map<String, dynamic>))
          .toList();
      setState(() {
        _invites = list;
        _inviteIssue = null;
      });
    } on Object {
      if (mounted && widget.api.actorId == actor)
        setState(() {
          _invites = [];
          _inviteIssue = 'Inviti temporaneamente non disponibili.';
        });
    }
  }

  Future<void> _openInvites() async {
    final actor = widget.api.actorId;
    final selected = await Navigator.of(context)
        .push<({String id, String name})>(
          MaterialPageRoute(
            builder: (_) =>
                InvitationInbox(api: widget.api, items: List.of(_invites)),
          ),
        );
    if (!mounted || widget.api.actorId != actor) return;
    if (selected != null) await widget.enterSpace(selected.id, selected.name);
    if (mounted) await _refresh();
  }

  Future<void> _refreshResearch() async {
    final actor = widget.api.actorId;
    try {
      final home = await widget.api.get('/api/v1/personal-space');
      if (!mounted || !_foreground || widget.api.actorId != actor) return;
      final result = home['readyResearch'];
      setState(
        () => _readyResearch = switch (result) {
          {'thread': final String thread, 'workId': final String workId} => (
            thread: thread,
            workId: workId,
          ),
          _ => null,
        },
      );
    } catch (_) {
      if (mounted && widget.api.actorId == actor)
        setState(() => _readyResearch = null);
    }
  }

  Future<void> _refresh() => _reading ??=
      Future.wait([
            _part(false),
            _part(true),
            _refreshInvites(),
            _refreshResearch(),
          ])
          .then<void>((_) {
            if (mounted) setState(() => _first = false);
          })
          .whenComplete(() => _reading = null);

  Future<void> _visit(Future<void> Function() action) async {
    await action();
    if (mounted) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final entries = [..._spaces, ..._direct]
      ..sort((a, b) {
        final date = b.at.compareTo(a.at);
        return date == 0 ? a.id.compareTo(b.id) : date;
      });
    final initials = RegExp(r'\s+');
    String initialsOf(String name) {
      final parts = name
          .trim()
          .split(initials)
          .where((v) => v.isNotEmpty)
          .toList();
      if (parts.isEmpty) return '?';
      return (parts.first.characters.first +
              (parts.length > 1 ? parts.last.characters.first : ''))
          .toUpperCase();
    }

    final today = DateTime.now();
    final issue = [
      _spaceIssue,
      _directIssue,
      _inviteIssue,
    ].nonNulls.map((s) => uiText(context, s)).join(' ');
    return Scaffold(
      appBar: AppBar(
        title: PersonalNavTitle(uiText(context, 'I tuoi spazi')),
        actions: [
          IconButton(
            tooltip: uiText(context, 'Il mio profilo'),
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () => _visit(() async {
              await Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => AccountProfilePage(api: widget.api),
                ),
              );
            }),
          ),
          IconButton(
            tooltip: uiText(context, 'Esci dall’account'),
            onPressed: widget.logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          uiText(context, 'Conversazioni'),
                          style: theme.textTheme.titleLarge,
                        ),
                      ),
                      IconButton(
                        tooltip: uiText(context, 'Nuovo spazio'),
                        icon: const Icon(Icons.add),
                        onPressed: () => _visit(widget.createSpace),
                      ),
                      IconButton(
                        tooltip: uiText(context, 'Scrivi a un contatto'),
                        icon: const Icon(Icons.edit_outlined),
                        onPressed: () => _visit(widget.contacts),
                      ),
                    ],
                  ),
                  if (_first)
                    StudioLoading(
                      label: uiText(context, 'Caricamento dei tuoi spazi…'),
                    ),
                  if (_invites.isNotEmpty)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.mail_outline),
                      title: Text(
                        _invites.length == 1
                            ? _invites.first.space
                            : uiText(context, '{0} inviti agli spazi', [
                                _invites.length,
                              ]),
                      ),
                      subtitle: Text(
                        _invites.length == 1
                            ? uiText(context, 'Ti invita {0}', [
                                _invites.first.from,
                              ])
                            : uiText(context, 'Vedi gli inviti'),
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: _openInvites,
                    ),
                  if (issue.isNotEmpty)
                    ListTile(
                      title: Text(issue),
                      trailing: TextButton(
                        onPressed: _refresh,
                        child: Text(uiText(context, 'Riprova')),
                      ),
                    ),
                  if (!_first && issue.isEmpty && entries.isEmpty)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        uiText(context, 'Ancora nessuna conversazione.'),
                      ),
                    ),
                  for (final room in entries)
                    _conversationRow(
                      context,
                      room,
                      initialsOf(room.name),
                      today,
                    ),
                  const Divider(),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const ImageIcon(emmeIcon),
                    title: Text(uiText(context, 'Tu ed Emme')),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _visit(widget.personal),
                  ),
                  if (_readyResearch case final ready?)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.travel_explore),
                      title: Text(uiText(context, 'Ricerca pronta')),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _visit(
                        () => Navigator.push<void>(
                          context,
                          MaterialPageRoute(
                            builder: (_) => PersonalNavigation.page(
                              context,
                              PersonalSection.emme,
                              PersonalChatPage(
                                api: widget.api,
                                research: ready,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.folder_outlined),
                    title: Text(uiText(context, 'Documenti personali')),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _visit(() async {
                      await Navigator.push<void>(
                        context,
                        MaterialPageRoute(
                          builder: (_) => PersonalNavigation.page(
                            context,
                            PersonalSection.documents,
                            FileLibrary(api: widget.api),
                          ),
                        ),
                      );
                    }),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.tune),
                    title: Text(uiText(context, 'Configura Emme')),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _visit(() async {
                      await Navigator.push<void>(
                        context,
                        MaterialPageRoute(
                          builder: (_) => PersonalNavigation.page(
                            context,
                            PersonalSection.settings,
                            AssistantSettingsScreen(api: widget.api),
                          ),
                        ),
                      );
                    }),
                  ),
                  widget.agenda,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _conversationRow(
    BuildContext context,
    Conversation room,
    String initials,
    DateTime today,
  ) {
    final theme = Theme.of(context);
    final wrapDetails = MediaQuery.textScalerOf(context).scale(14) > 18;
    final date = DateUtils.isSameDay(room.at, today)
        ? TimeOfDay.fromDateTime(room.at).format(context)
        : MaterialLocalizations.of(context).formatShortDate(room.at);
    final meta = [
      Text(date, style: theme.textTheme.labelSmall),
      if (room.unread > 0)
        Text(
          '${room.unread}',
          semanticsLabel: uiText(context, '{0} non letti', [room.unread]),
          style: theme.textTheme.labelMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
    ];
    return ListTile(
      key: ValueKey((room.direct, room.id)),
      contentPadding: EdgeInsets.zero,
      leading: room.direct
          ? CircleAvatar(
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: FittedBox(fit: BoxFit.scaleDown, child: Text(initials)),
              ),
            )
          : const SizedBox(
              width: 40,
              child: Center(child: ImageIcon(spaceIcon, size: 27)),
            ),
      title: Text(
        room.name,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.titleMedium?.copyWith(
          fontWeight: room.unread > 0 ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
      subtitle: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            room.preview?.isNotEmpty == true
                ? room.preview!
                : room.direct
                ? uiText(context, 'Chat privata')
                : uiText(context, 'Spazio'),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (wrapDetails) Wrap(spacing: 8, runSpacing: 2, children: meta),
          if (!room.direct &&
              (room.firstMention != null || room.firstRequest != null))
            Wrap(
              children: [
                if (room.firstMention != null)
                  TextButton(
                    onPressed: () =>
                        _visit(() => widget.open(room, room.firstMention)),
                    child: Text(
                      '@ ${room.mentions}',
                      semanticsLabel: uiText(
                        context,
                        'Vai alla prima menzione non letta',
                      ),
                    ),
                  ),
                if (room.firstRequest != null)
                  TextButton(
                    onPressed: () =>
                        _visit(() => widget.open(room, room.firstRequest)),
                    child: Text(
                      uiText(context, 'Da decidere · {0}', [room.requests]),
                    ),
                  ),
              ],
            ),
        ],
      ),
      trailing: wrapDetails
          ? null
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: meta,
            ),
      onTap: () => _visit(() => widget.open(room, null)),
    );
  }
}
