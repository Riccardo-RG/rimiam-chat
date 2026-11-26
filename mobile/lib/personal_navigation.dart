import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'studio_theme.dart';
import 'ui_language.dart';

final homeRouteObserver = RouteObserver<PageRoute<dynamic>>();

enum PersonalSection {
  home('I tuoi spazi', Icons.home_outlined),
  emme('Tu ed Emme', Icons.chat_bubble_outline),
  documents('Documenti personali', Icons.folder_outlined),
  settings('Configura Emme', Icons.tune),
  today('Oggi', Icons.today_outlined);

  const PersonalSection(this.label, this.icon);
  final String label;
  final IconData icon;
}

/// Home stays the first route. Its personal destinations share one additional
/// route, so switching between them never stacks copies of the same page.
class PersonalNavigation extends StatefulWidget {
  const PersonalNavigation({
    super.key,
    required this.api,
    required this.initial,
    required this.child,
    required this.buildSection,
    required this.openSpace,
    required this.sessionIsCurrent,
  });
  final RimiamApi api;
  final PersonalSection initial;
  final Widget child;
  final Widget Function(PersonalSection) buildSection;
  final Future<void> Function(String, String) openSpace;
  final bool Function() sessionIsCurrent;

  static Widget page(
    BuildContext context,
    PersonalSection section,
    Widget child,
  ) =>
      context.findAncestorStateOfType<_PersonalNavigationState>()?.page(
        section,
        child,
      ) ??
      child;

  @override
  State<PersonalNavigation> createState() => _PersonalNavigationState();
}

class _PersonalNavigationState extends State<PersonalNavigation>
    with WidgetsBindingObserver {
  final scaffold = GlobalKey<ScaffoldState>();
  late final owner = widget.api.actorId;
  late PersonalSection selected = widget.initial;
  late Widget content = widget.child;
  List<({String id, String name})> spaces = [];
  int epoch = 0;
  bool wide = false, foreground = true, failed = false;
  bool get active =>
      mounted &&
      foreground &&
      owner.isNotEmpty &&
      widget.api.actorId == owner &&
      widget.sessionIsCurrent();

  Widget page(PersonalSection section, Widget child) => PersonalNavigation(
    api: widget.api,
    initial: section,
    child: child,
    buildSection: widget.buildSection,
    openSpace: widget.openSpace,
    sessionIsCurrent: widget.sessionIsCurrent,
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didUpdateWidget(PersonalNavigation old) {
    super.didUpdateWidget(old);
    if (selected == widget.initial) content = widget.child;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = MediaQuery.sizeOf(context).width >= 840;
    if (next && !wide)
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (active && wide) refreshSpaces();
      });
    wide = next;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.hidden ||
        state == AppLifecycleState.paused) {
      epoch++;
      foreground = false;
      setState(() {
        spaces = [];
        failed = false;
      });
    } else if (!foreground && state == AppLifecycleState.resumed) {
      setState(() => foreground = true);
      if (wide || scaffold.currentState?.isDrawerOpen == true) refreshSpaces();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> refreshSpaces() async {
    if (!active) return;
    final request = ++epoch;
    try {
      final result = await widget.api.get('/api/v1/workspaces');
      final rows =
          (result['workspaces'] as List)
              .whereType<Map>()
              .where((r) => r['id'] is String && r['name'] is String)
              .toList()
            ..sort(
              (a, b) => (b['lastActivityAt'] as String? ?? '').compareTo(
                a['lastActivityAt'] as String? ?? '',
              ),
            );
      if (active && epoch == request)
        setState(() {
          spaces = [
            for (final r in rows)
              (id: r['id'] as String, name: r['name'] as String),
          ];
          failed = false;
        });
    } catch (_) {
      if (active && epoch == request)
        setState(() {
          spaces = [];
          failed = true;
        });
    }
  }

  Future<void> choose(PersonalSection to) async {
    if (!active || ModalRoute.of(context)?.isCurrent != true) return;
    if (scaffold.currentState?.isDrawerOpen == true)
      Navigator.of(context).pop();
    if (to == selected) return;
    FocusManager.instance.primaryFocus?.unfocus();
    final nav = Navigator.of(context);
    if (to == PersonalSection.home) {
      await nav.maybePop();
    } else if (selected == PersonalSection.home) {
      await nav.push<void>(
        MaterialPageRoute(builder: (_) => page(to, widget.buildSection(to))),
      );
    } else if (ModalRoute.of(context)?.popDisposition ==
        RoutePopDisposition.doNotPop) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            uiText(
              context,
              'Chiudi la modifica in corso prima di cambiare sezione.',
            ),
          ),
        ),
      );
    } else {
      setState(() {
        selected = to;
        content = widget.buildSection(to);
      });
    }
  }

  Widget spaceLink(({String id, String name}) space) => ListTile(
    dense: true,
    contentPadding: const EdgeInsetsDirectional.only(start: 32, end: 12),
    leading: const ImageIcon(spaceIcon, size: 19),
    title: Text(space.name, maxLines: 1, overflow: TextOverflow.ellipsis),
    onTap: active
        ? () async {
            if (scaffold.currentState?.isDrawerOpen == true)
              Navigator.of(context).pop();
            if (active) await widget.openSpace(space.id, space.name);
          }
        : null,
  );

  Widget navigation() => SafeArea(
    child: ListView(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      children: [
        if (!wide)
          Align(
            alignment: Alignment.centerRight,
            child: IconButton(
              tooltip: uiText(context, 'Chiudi'),
              icon: const Icon(Icons.close),
              onPressed: scaffold.currentState?.closeDrawer,
            ),
          ),
        for (final section in PersonalSection.values) ...[
          if (section == PersonalSection.emme) const Divider(),
          ListTile(
            dense: true,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
            selected: section == selected,
            selectedTileColor: Theme.of(context)
                .colorScheme
                .surfaceContainerHighest,
            leading: section == PersonalSection.emme
                ? const ImageIcon(emmeIcon)
                : Icon(section.icon),
            title: Text(uiText(context, section.label)),
            onTap: active ? () => choose(section) : null,
          ),
          if (section == PersonalSection.home) ...[
            if (failed)
              TextButton(
                onPressed: refreshSpaces,
                child: Text(uiText(context, 'Ricarica spazi')),
              ),
            if (active) ...spaces.take(3).map(spaceLink),
            if (active && spaces.length > 3)
              ExpansionTile(
                dense: true,
                title: Text(uiText(context, 'Altri spazi')),
                children: spaces.skip(3).map(spaceLink).toList(),
              ),
          ],
        ],
      ],
    ),
  );

  @override
  Widget build(BuildContext context) => _MenuAccess(
    open: wide
        ? null
        : () {
            if (active) scaffold.currentState?.openDrawer();
          },
    child: Scaffold(
      key: scaffold,
      resizeToAvoidBottomInset: false,
      drawerEnableOpenDragGesture: false,
      onDrawerChanged: (opened) {
        if (opened) {
          refreshSpaces();
        } else if (!wide && mounted) {
          epoch++;
          setState(() {
            spaces = [];
            failed = false;
          });
        }
      },
      drawer: wide ? null : Drawer(child: navigation()),
      body: Row(
        children: [
          if (wide) ...[
            SizedBox(width: 208, child: navigation()),
            const VerticalDivider(width: 1),
          ],
          Expanded(
            child: Visibility(
              visible: active,
              maintainState: true,
              child: content,
            ),
          ),
        ],
      ),
    ),
  );
}

class _MenuAccess extends InheritedWidget {
  const _MenuAccess({required this.open, required super.child});
  final VoidCallback? open;
  @override
  bool updateShouldNotify(_MenuAccess old) => old.open != open;
}

class PersonalNavTitle extends StatelessWidget {
  const PersonalNavTitle(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) {
    final open = context
        .dependOnInheritedWidgetOfExactType<_MenuAccess>()
        ?.open;
    final text = Text(title, maxLines: 1, overflow: TextOverflow.ellipsis);
    if (open == null) return text;
    return Tooltip(
      message: uiText(context, 'Apri navigazione'),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: open,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(child: text),
              const Icon(Icons.expand_more, size: 19),
            ],
          ),
        ),
      ),
    );
  }
}
