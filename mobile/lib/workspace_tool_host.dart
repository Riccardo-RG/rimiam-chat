import 'dart:async';
import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import 'ui_language.dart';

class WorkspaceToolHost extends StatefulWidget {
  const WorkspaceToolHost({
    super.key,
    required this.child,
    required this.authorized,
    required this.revoked,
  });
  final Widget child;
  final bool authorized, revoked;
  @override
  State<WorkspaceToolHost> createState() => WorkspaceToolHostState();
}

final workspaceOverlayObserver = WorkspaceToolRouteObserver();

class WorkspaceToolRouteObserver extends NavigatorObserver {
  final routes = <Route<dynamic>>[];
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    routes.add(route);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    routes.remove(route);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    routes.remove(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    if (oldRoute == null) return;
    final i = routes.indexOf(oldRoute);
    if (i >= 0 && newRoute != null) routes[i] = newRoute;
  }

  void dismissPopupsAbove(Route<dynamic> owner) {
    final i = routes.indexOf(owner);
    if (i < 0) return;
    final popups = routes
        .skip(i + 1)
        .takeWhile((route) => route is PopupRoute)
        .toList();
    for (final route in popups.reversed) {
      if (route.isActive) navigator?.removeRoute(route);
    }
  }
}

class WorkspaceToolHostState extends State<WorkspaceToolHost> {
  var _navigator = GlobalKey<NavigatorState>();
  var _stack = WorkspaceToolRouteObserver();
  Route<Object?>? _tool;
  Completer<Object?>? _result;
  bool _expanded = false, _switching = false;
  bool get isShowing => _tool != null;

  /// Keep a stable inner navigator when the effective width changes. A tool may
  /// push its own editors and return an original message or attachment to chat.
  Future<Object?> open(Widget page) async {
    if (!widget.authorized || _switching) return null;
    _switching = true;
    late final Completer<Object?> result;
    try {
      if (_tool != null) {
        final previous = _result;
        if (!await _close()) return null;
        await previous?.future;
      }
      final nav = _navigator.currentState;
      if (!mounted || !widget.authorized || nav == null) return null;
      final route = MaterialPageRoute<Object?>(builder: (_) => page);
      result = Completer<Object?>();
      setState(() {
        _tool = route;
        _result = result;
        _expanded = false;
      });
      unawaited(
        nav.push(route).then((value) {
          if (!mounted || _result != result) return;
          setState(() {
            _tool = null;
            _result = null;
          });
          result.complete(widget.authorized ? value : null);
        }),
      );
    } finally {
      _switching = false;
    }
    return result.future;
  }

  Future<bool> _close() async {
    final tool = _tool;
    final nav = _navigator.currentState;
    if (tool == null || nav == null) return true;
    // Honour each editor's PopScope. If it handles Back itself or asks for
    // confirmation, leave the editor in control of the next step.
    while (mounted && identical(tool, _tool) && nav.mounted) {
      final top = _stack.routes.lastOrNull;
      if (top == null || !await nav.maybePop()) return false;
      if (identical(top, _stack.routes.lastOrNull)) {
        // A tool can consume Back to close a read-only detail inside its
        // initial route. Wait for its PopScope to reflect the new state.
        await WidgetsBinding.instance.endOfFrame;
        if (!mounted || top.popDisposition != RoutePopDisposition.pop)
          return false;
        continue;
      }
      if (identical(top, tool)) return true;
    }
    return true;
  }

  void _abandon() {
    final pending = _result;
    _tool = null;
    _result = null;
    _expanded = false;
    _navigator = GlobalKey<NavigatorState>();
    _stack = WorkspaceToolRouteObserver();
    if (pending != null && !pending.isCompleted) pending.complete(null);
  }

  @override
  void didUpdateWidget(WorkspaceToolHost old) {
    super.didUpdateWidget(old);
    if (widget.revoked && _tool != null) {
      final owner = ModalRoute.of(context);
      _abandon();
      if (owner != null)
        WidgetsBinding.instance.addPostFrameCallback((_) {
          workspaceOverlayObserver.dismissPopupsAbove(owner);
        });
    }
  }

  @override
  void dispose() {
    _abandon();
    super.dispose();
  }

  Widget _toolView(BuildContext context, bool wide) {
    final navigator = Navigator(
      key: _navigator,
      observers: [_stack],
      onGenerateRoute: (_) =>
          MaterialPageRoute<void>(builder: (_) => const SizedBox.shrink()),
    );
    return Material(
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            if (wide && widget.authorized)
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    onPressed: () => setState(() => _expanded = !_expanded),
                    icon: Icon(
                      _expanded
                          ? Icons.view_sidebar_outlined
                          : Icons.open_in_full,
                      size: 16,
                    ),
                    label: Text(
                      uiText(context, _expanded ? 'Affianca' : 'Allarga'),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: _close,
                    icon: const Icon(Icons.close, size: 17),
                    label: Text(uiText(context, 'Chiudi')),
                  ),
                  const SizedBox(width: 6),
                ],
              ),
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Offstage(
                    offstage: !widget.authorized,
                    child: Semantics(
                      // The inner route's modal barrier must not hide the other
                      // pane and its independent window controls from VoiceOver.
                      container: true,
                      explicitChildNodes: true,
                      child: ScaffoldMessenger(child: navigator),
                    ),
                  ),
                  if (!widget.authorized)
                    Center(child: Text(uiText(context, 'Verifica accesso'))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, bounds) {
      final media = MediaQuery.of(context);
      final scale = math.max(1.0, media.textScaler.scale(16) / 16);
      final wide = bounds.maxWidth >= 760 * scale && bounds.maxHeight >= 480;
      final open = _tool != null;
      final split = wide && open && !_expanded;
      final splitWidth = math.max(
        352 * scale,
        math.min(520 * scale, bounds.maxWidth * .45),
      );
      final paneWidth = split ? splitWidth : bounds.maxWidth;
      final chatWidth = wide && open
          ? bounds.maxWidth - splitWidth - 1
          : bounds.maxWidth;
      final chatVisible = !open || split;
      Widget paneMedia(double width, Widget child) => MediaQuery(
        data: media.copyWith(size: Size(width, bounds.maxHeight)),
        child: child,
      );
      return PopScope(
        canPop: !open,
        onPopInvokedWithResult: (popped, _) {
          if (!popped && _tool != null) _navigator.currentState?.maybePop();
        },
        child: Stack(
          fit: StackFit.expand,
          children: [
            PositionedDirectional(
              key: const ValueKey('workspace-chat'),
              start: 0,
              top: 0,
              bottom: 0,
              width: chatWidth,
              child: Offstage(
                offstage: !chatVisible,
                child: TickerMode(
                  enabled: chatVisible,
                  child: ExcludeFocus(
                    excluding: !chatVisible,
                    child: paneMedia(chatWidth, widget.child),
                  ),
                ),
              ),
            ),
            if (split)
              PositionedDirectional(
                key: const ValueKey('tool-divider'),
                start: chatWidth,
                top: 0,
                bottom: 0,
                width: 1,
                child: ColoredBox(color: Theme.of(context).dividerColor),
              ),
            PositionedDirectional(
              key: const ValueKey('workspace-tool'),
              end: 0,
              top: 0,
              bottom: 0,
              width: paneWidth,
              child: Offstage(
                offstage: !open,
                child: ExcludeFocus(
                  excluding: !open || !widget.authorized,
                  child: paneMedia(paneWidth, _toolView(context, open && wide)),
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}
