import 'ui_language.dart';

import 'dart:async';
import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'timeline_visibility.dart';

class WorkspaceReadingTimeline extends StatefulWidget {
  const WorkspaceReadingTimeline({
    super.key,
    required this.api,
    required this.actor,
    required this.workspaceId,
    required this.ids,
    required this.row,
    required this.reading,
    required this.onRefresh,
    this.onRecap,
    this.initialMessageId,
  });
  final RimiamApi api;
  final String actor, workspaceId;
  final List<String> ids;
  final Map<String, dynamic>? reading;
  final IndexedWidgetBuilder row;
  final String? initialMessageId;
  final VoidCallback onRefresh;
  final ValueChanged<String>? onRecap;
  @override
  State<WorkspaceReadingTimeline> createState() =>
      WorkspaceReadingTimelineState();
}

class WorkspaceReadingTimelineState extends State<WorkspaceReadingTimeline>
    with WidgetsBindingObserver {
  final _scroll = ScrollController(keepScrollOffset: false);
  final _center = GlobalKey(), _viewport = GlobalKey();
  final _rows = <String, BuildContext>{};
  final _seen = <String>{};
  int? _admission;
  int _cursor = 0, _move = 0;
  String? _pivot, _firstUnread, _lastRequest;
  bool _alignBottom = true,
      _atEnd = true,
      _away = false,
      _moving = false,
      _scheduled = false,
      _posting = false,
      _again = false,
      _readError = false;
  ({String id, int offset, bool bottom})? _lastSaved;
  Set<String> _unread = {}, _mentions = {};
  List<String> _requests = [];
  String get _path =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspaceId)}/reading';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _ingest();
    _enter();
  }

  void _ingest() {
    final r = widget.reading;
    if (r == null) return;
    final admission = r['admission'] as int;
    if (_admission != admission) {
      _seen.clear();
      _cursor = 0;
      _lastSaved = null;
      _firstUnread = (r['unreadIds'] as List).firstOrNull as String?;
      _admission = admission;
    }
    _cursor = math.max(_cursor, r['cursorVersion'] as int);
    _unread = (r['unreadIds'] as List).cast<String>().toSet()..removeAll(_seen);
    _mentions = (r['mentionIds'] as List).cast<String>().toSet()
      ..removeAll(_seen);
    _requests = (r['requestIds'] as List).cast<String>();
  }

  void _enter() {
    final target = widget.initialMessageId;
    final entry = target != null && widget.ids.contains(target)
        ? target
        : widget.ids.reversed.where(_mentions.contains).firstOrNull;
    _position(entry ?? widget.ids.lastOrNull, bottom: entry == null);
  }

  @override
  void didUpdateWidget(covariant WorkspaceReadingTimeline old) {
    super.didUpdateWidget(old);
    final previous = _admission;
    if (!identical(old.reading, widget.reading)) _ingest();
    if (previous != _admission ||
        old.initialMessageId != widget.initialMessageId) {
      _enter();
    } else if (old.ids.lastOrNull != widget.ids.lastOrNull &&
        _atEnd &&
        TickerMode.valuesOf(context).enabled &&
        !_moving) {
      _position(widget.ids.lastOrNull, bottom: true);
    } else {
      _schedule();
    }
  }

  void _position(String? id, {required bool bottom}) {
    final move = ++_move;
    _pivot = id;
    _alignBottom = bottom;
    _atEnd = bottom && id == widget.ids.lastOrNull;
    _moving = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || move != _move) return;
      if (_scroll.hasClients) _scroll.jumpTo(0);
      _moving = false;
      _schedule();
      WidgetsBinding.instance.scheduleFrame();
    });
  }

  void _jump(String? id, {bool bottom = false}) {
    if (id == null || !widget.ids.contains(id)) return;
    setState(() => _position(id, bottom: bottom));
  }

  void showLatest() => _jump(widget.ids.lastOrNull, bottom: true);
  void showMessage(String id) => _jump(id);

  @override
  void didChangeMetrics() => _schedule();
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _schedule();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (TickerMode.valuesOf(context).enabled) _schedule();
  }

  void _schedule() {
    if (!mounted || _scheduled) return;
    _scheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scheduled = false;
      unawaited(_record());
    });
  }

  Future<void> _record() async {
    final state = WidgetsBinding.instance.lifecycleState;
    if (!mounted ||
        _moving ||
        !TickerMode.valuesOf(context).enabled ||
        !_scroll.hasClients ||
        _scroll.position.isScrollingNotifier.value ||
        (state != null && state != AppLifecycleState.resumed) ||
        ModalRoute.of(context)?.isCurrent != true ||
        widget.api.actorId != widget.actor)
      return;
    final visible = visibleConversationRows(_rows, _viewport);
    if (visible.isEmpty) return;
    _atEnd =
        _scroll.position.extentAfter <= 3 && visible.last.id == widget.ids.last;
    final away = _scroll.position.extentAfter > 100;
    if (away != _away) setState(() => _away = away);
    final admission = _admission;
    if (admission == null) return;
    if (_posting) {
      _again = true;
      return;
    }
    final seen = visible
        .map((m) => m.id)
        .where((id) => _unread.contains(id) || _mentions.contains(id))
        .take(100)
        .toList();
    final bookmark = _atEnd
        ? (id: visible.last.id, offset: 0, bottom: true)
        : (
            id: visible.first.id,
            offset: visible.first.y.round().clamp(-200000, 200000),
            bottom: false,
          );
    final save = bookmark != _lastSaved;
    if (seen.isEmpty && !save) return;
    final expected = _cursor;
    _posting = true;
    try {
      final response = await widget.api.post(_path, {
        'expectedActorId': widget.actor,
        'admission': admission,
        'seen': seen,
        if (save)
          'anchor': {
            'id': bookmark.id,
            'offset': bookmark.offset,
            'atBottom': bookmark.bottom,
            'expectedVersion': expected,
          },
      });
      if (!mounted ||
          _admission != admission ||
          widget.actor != widget.api.actorId)
        return;
      final version = response['cursorVersion'] as int;
      setState(() {
        _seen.addAll(seen);
        _unread.removeAll(seen);
        _mentions.removeAll(seen);
        if (save) _lastSaved = bookmark;
        _cursor = math.max(_cursor, version);
        _readError = false;
      });
      if (save && version != expected + 1) widget.onRefresh();
    } catch (e) {
      if (mounted && admission == _admission) {
        setState(() => _readError = true);
        if (e is ApiError &&
            (e.status == 401 ||
                e.status == 403 ||
                e.code == 'READING_ADMISSION_CHANGED'))
          widget.onRefresh();
      }
    } finally {
      _posting = false;
      if (_again && mounted) {
        _again = false;
        if (!_readError) {
          _schedule();
          WidgetsBinding.instance.scheduleFrame();
        }
      }
    }
  }

  Widget _message(int index) {
    final id = widget.ids[index];
    return Builder(
      key: ValueKey(id),
      builder: (c) {
        _rows[id] = c;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (id == _firstUnread)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
                child: Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(uiText(c, 'Primo messaggio non letto'), style: Theme.of(c).textTheme.labelSmall),
                    if (widget.onRecap != null)
                      TextButton(
                        onPressed: () => widget.onRecap!(id),
                        child: Text(uiText(c, 'Riassumi da qui')),
                      ),
                  ],
                ),
              ),
            if (_requests.contains(id))
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 2),
                child: Text(
                  uiText(c, 'Risposta richiesta'),
                  style: Theme.of(c).textTheme.labelSmall,
                ),
              ),
            widget.row(c, index),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final index = _pivot == null ? -1 : widget.ids.indexOf(_pivot!);
    final pivot = index < 0
        ? widget.ids.length
        : index + (_alignBottom ? 1 : 0);
    final requests = _requests.where(widget.ids.contains).toList();
    final mentions = _mentions.where(widget.ids.contains).toList();
    return Column(
      children: [
        if (mentions.isNotEmpty || requests.isNotEmpty || _readError)
          Align(
            alignment: Alignment.centerLeft,
            child: Wrap(
              children: [
                if (mentions.isNotEmpty)
                  TextButton.icon(
                    onPressed: () => _jump(mentions.first),
                    icon: const Icon(Icons.alternate_email, size: 16),
                    label: Text(
                      uiText(context, 'Menzione successiva · {0}', [
                        mentions.length,
                      ]),
                    ),
                  ),
                if (requests.isNotEmpty)
                  TextButton(
                    onPressed: () {
                      final next =
                          requests[(requests.indexOf(_lastRequest ?? '') + 1) %
                              requests.length];
                      _lastRequest = next;
                      _jump(next);
                    },
                    child: Text(
                      uiText(context, 'Da rispondere · {0}', [requests.length]),
                    ),
                  ),
                if (_readError)
                  TextButton(
                    onPressed: () {
                      widget.onRefresh();
                      _schedule();
                    },
                    child: Text(uiText(context, 'Aggiorna lettura')),
                  ),
              ],
            ),
          ),
        Expanded(
          child: SizedBox.expand(
            key: _viewport,
            child: Stack(
              children: [
                NotificationListener<ScrollNotification>(
                  onNotification: (n) {
                    if (n is ScrollEndNotification) _schedule();
                    return false;
                  },
                  child: CustomScrollView(
                    key: const Key('workspace-timeline'),
                    controller: _scroll,
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    center: _center,
                    anchor: _alignBottom ? 1 : 0,
                    slivers: [
                      SliverList.builder(
                        itemCount: pivot,
                        itemBuilder: (_, i) => _message(pivot - i - 1),
                      ),
                      SliverList.builder(
                        key: _center,
                        itemCount: widget.ids.length - pivot,
                        itemBuilder: (_, i) => _message(pivot + i),
                      ),
                    ],
                  ),
                ),
                if (_away)
                  Positioned(
                    right: 12,
                    bottom: 8,
                    child: FilledButton.tonalIcon(
                      onPressed: showLatest,
                      icon: const Icon(Icons.arrow_downward, size: 16),
                      label: Text(uiText(context, 'Vai in fondo')),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
