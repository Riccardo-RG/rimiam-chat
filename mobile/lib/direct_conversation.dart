import 'ui_language.dart';

import 'dart:async';
import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'attachments.dart';
import 'attachment_preview.dart';
import 'legacy_mobile_data.dart';
import 'legacy_recovery.dart';
import 'chat_journal.dart';
import 'direct_recap.dart';
import 'direct_view.dart';
import 'journey.dart';
import 'workspace_creation.dart';
import 'timeline_visibility.dart';

class DirectConversation extends StatefulWidget {
  DirectConversation({
    Key? key,
    required this.api,
    required this.id,
    required this.name,
    this.vault = const DeviceDraftVault(),
  }) : super(key: key ?? ValueKey((api, api.actorId, id)));
  final RimiamApi api;
  final String id, name;
  final DraftVault vault;
  @override
  State<DirectConversation> createState() => _DirectConversationState();
}

class _DirectConversationState extends State<DirectConversation>
    with WidgetsBindingObserver {
  static final _journals = Expando<Map<String, ChatJournal>>();
  final _editor = TextEditingController(), _focus = FocusNode();
  final _scroll = ScrollController(keepScrollOffset: false);
  final _viewport = GlobalKey(), _center = GlobalKey();
  final _built = <String, BuildContext>{}, _seen = <String>{};
  late final Timer _poll;
  late final String _actor;
  ChatJournal? _journal;
  Map<String, dynamic>? _view;
  List<Map<String, dynamic>> _messages = const [];
  Map<String, Map<String, dynamic>> _byId = {};
  String? _pivotId, _lastAnchor;
  bool _away = false, _alignBottom = true, _restoring = false;
  bool _initial = true,
      _active = true,
      _reading = false,
      _queued = false,
      _marking = false,
      _checkScheduled = false,
      _userScrolled = false;
  int _cursor = 0, _epoch = 0;
  String _error = '';
  bool get _current =>
      mounted &&
      _active &&
      widget.api.actorId == _actor &&
      ModalRoute.of(context)?.isCurrent == true;
  @override
  void initState() {
    super.initState();
    _actor = widget.api.actorId;
    WidgetsBinding.instance.addObserver(this);
    _load();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_current) _load();
    });
  }

  @override
  void dispose() {
    _poll.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _journal?.removeListener(_journalChanged);
    _editor.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _lock() {
    _epoch++;
    _journal?.removeListener(_journalChanged);
    _journal = null;
    _view = null;
    _messages = const [];
    _byId = {};
    _editor.clear();
    _built.clear();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    _active = s == AppLifecycleState.resumed;
    if (_active) {
      _load();
    } else if (s == AppLifecycleState.hidden || s == AppLifecycleState.paused) {
      setState(_lock);
    }
  }

  Future<void> _load() async {
    if (!_active) return;
    if (_reading) {
      _queued = true;
      return;
    }
    _reading = true;
    final epoch = _epoch;
    try {
      final v = await readDirect(widget.api, widget.id, _actor);
      if (!mounted || _epoch != epoch || !_active) return;
      final rows = (v['messages'] as List).cast<Map<String, dynamic>>();
      final reading = v['reading'] as Map<String, dynamic>;
      setState(() {
        _messages = rows;
        _byId = {for (final m in rows) m['id'] as String: m};
        _view = v;
        _error = '';
        _cursor = math.max(_cursor, reading['cursorVersion'] as int);
        if (_initial) {
          final unread = reading['unreadIds'] as List;
          final anchor = reading['anchorId'] as String?;
          _pivotId = _byId.containsKey(anchor)
              ? anchor
              : unread.firstOrNull as String?;
          if (!_byId.containsKey(_pivotId)) _pivotId = null;
          _alignBottom =
              _pivotId == null ||
              (anchor == _pivotId && reading['anchorAtBottom'] == true);
          final offset = anchor == _pivotId && !_alignBottom
              ? (reading['anchorOffset'] as int? ?? 0)
              : 0;
          _lastAnchor = anchor == null ? null : '$anchor/$offset/$_alignBottom';
          _restoring = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            if (_scroll.hasClients && offset != 0) {
              final p = _scroll.position;
              _scroll.jumpTo(
                (-offset)
                    .toDouble()
                    .clamp(p.minScrollExtent, p.maxScrollExtent)
                    .toDouble(),
              );
            }
            _restoring = false;
            _scheduleRead();
            WidgetsBinding.instance.scheduleFrame();
          });
          _initial = false;
        }
      });
      if (_journal == null) {
        final cache = _journals[widget.api] ??= {};
        _journal = cache.putIfAbsent(
          '$_actor/${widget.id}',
          () => ChatJournal(
            vault: widget.vault,
            origin: widget.api.origin,
            actor: _actor,
            workspace: widget.id,
            direct: true,
          ),
        );
        _journal!.addListener(_journalChanged);
      }
      try {
        await _journal!.open();
      } catch (_) {
        /* Secure storage stays closed until retry. */
      }
      _journalChanged();
      _scheduleRead();
    } catch (e) {
      if (mounted && epoch == _epoch)
        setState(() {
          if (directDenied(e)) _lock();
          _error = 'Conversazione privata non disponibile.';
        });
    } finally {
      _reading = false;
      if (mounted && _active && _queued) {
        _queued = false;
        unawaited(_load());
      }
    }
  }

  void _journalChanged() {
    final j = _journal;
    if (!mounted || j == null || _view == null || widget.api.actorId != _actor)
      return;
    if (j.ready && _editor.text != j.text) {
      _editor.value = TextEditingValue(
        text: j.text,
        selection: TextSelection.collapsed(offset: j.text.length),
      );
    }
    setState(() {});
  }

  Future<void> _send() async {
    final j = _journal;
    if (j == null || j.sending || !_current) return;
    try {
      await j.submit(
        widget.api,
        mayPost: () => _current && _view != null && identical(_journal, j),
      );
      if (!mounted || j.pending != null) return;
      _jump(null);
      await _load();
    } catch (e) {
      if (mounted && directDenied(e)) {
        setState(() {
          _lock();
          _error = 'Accesso alla chat privata da verificare.';
        });
      }
    }
  }

  void _jump(String? id) {
    if (id != null && !_byId.containsKey(id)) return;
    setState(() {
      _pivotId = id;
      _alignBottom = id == null;
      _userScrolled = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_scroll.hasClients) _scroll.jumpTo(0);
      _scheduleRead();
    });
  }

  Future<void> _recap() async {
    final target = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) =>
            DirectRecap(api: widget.api, id: widget.id, vault: widget.vault),
      ),
    );
    if (!mounted) return;
    await _load();
    if (mounted && target != null) _jump(target);
  }

  void _scheduleRead() {
    if (!mounted || _checkScheduled) return;
    _checkScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkScheduled = false;
      unawaited(_markRead());
    });
  }

  Future<void> _markRead() async {
    final v = _view;
    if (v == null || !_current || _marking || _restoring) return;
    if (!_scroll.hasClients) return;
    final visible = visibleConversationRows(_built, _viewport);
    if (visible.isEmpty) return;
    final away = _scroll.position.extentAfter > 140;
    if (_away != away) setState(() => _away = away);
    final unread = (v['reading']['unreadIds'] as List).toSet();
    final ids = visible
        .map((row) => row.id)
        .where((id) => unread.contains(id) && !_seen.contains(id))
        .take(100)
        .toList();
    final bottom =
        _scroll.position.extentAfter <= 5 &&
        visible.last.id == _messages.last['id'];
    final id = bottom ? visible.last.id : visible.first.id;
    final offset = bottom ? 0 : visible.first.y.round().clamp(-200000, 200000);
    final key = '$id/$offset/$bottom';
    final updateAnchor =
        (_userScrolled || _lastAnchor == null) && key != _lastAnchor;
    if (ids.isEmpty && !updateAnchor) return;
    _marking = true;
    try {
      final result = await widget.api.post(directPath(widget.id), {
        'type': 'read',
        'expectedActorId': _actor,
        'seen': ids,
        if (updateAnchor)
          'anchor': {
            'id': id,
            'offset': offset,
            'expectedVersion': _cursor,
            'atBottom': bottom,
          },
      });
      if (!mounted) return;
      _seen.addAll(ids);
      if (updateAnchor) {
        _cursor = math.max(_cursor, result['cursorVersion'] as int);
        _lastAnchor = key;
      }
    } catch (e) {
      if (mounted && directDenied(e)) {
        setState(() {
          _lock();
          _error = 'Conversazione privata non disponibile.';
        });
      }
    } finally {
      _marking = false;
    }
  }

  Widget _row(Map<String, dynamic> m) {
    final id = m['id'] as String;
    final original = _byId[m['quoteId']];
    return Builder(
      key: ValueKey(id),
      builder: (rowContext) {
        _built[id] = rowContext;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      m['name'] as String,
                      style: Theme.of(rowContext).textTheme.labelLarge
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    MaterialLocalizations.of(rowContext).formatTimeOfDay(
                      TimeOfDay.fromDateTime(
                        DateTime.parse(m['sentAt'] as String).toLocal(),
                      ),
                    ),
                    style: Theme.of(rowContext).textTheme.labelSmall,
                  ),
                  IconButton(
                    tooltip: uiText(rowContext, 'Rispondi a {0}', [m['name']]),
                    icon: const Icon(Icons.reply, size: 18),
                    onPressed: _journal?.ready != true
                        ? null
                        : () {
                            _journal!.quote(id);
                            _focus.requestFocus();
                          },
                  ),
                ],
              ),
              if (original != null)
                TextButton.icon(
                  onPressed: () => _jump(original['id'] as String),
                  icon: const Icon(Icons.format_quote, size: 16),
                  label: Text(
                    '${original['name']} · ${original['text']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              if ((m['text'] as String).isNotEmpty) Text(m['text'] as String),
              for (final f in m['files'] as List)
                ReceivedAttachment(
                  api: widget.api,
                  path:
                      '${directPath(widget.id)}/files/${Uri.encodeComponent(f['id'] as String)}',
                  filename: f['filename'] as String,
                  mediaType: f['type'] as String?,
                  onMessage: () => _jump(id),
                ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _createWithPeer(WorkspaceTarget peer) async {
    if (!_current) return;
    final navigator = Navigator.of(context);
    final target = await navigator.push<WorkspaceTarget>(
      MaterialPageRoute(
        builder: (_) => WorkspaceCreation(
          api: widget.api,
          vault: widget.vault,
          initialContact: peer,
        ),
      ),
    );
    if (!_current || target == null) return;
    await navigator.push<void>(
      MaterialPageRoute(
        builder: (_) => WorkspaceJourney(
          api: widget.api,
          vault: widget.vault,
          workspaceId: target.id,
          workspaceName: target.name,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final v = _view,
        j = _journal,
        peer = v?['peer']['name'] as String? ?? widget.name;
    final index = _pivotId == null
        ? -1
        : _messages.indexWhere((m) => m['id'] == _pivotId);
    final pivot = index < 0 ? _messages.length : index + (_alignBottom ? 1 : 0);
    final quote = _byId[j?.quoteId];
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final compactWriting =
        keyboard > 0 && MediaQuery.sizeOf(context).height - keyboard < 260;
    return Scaffold(
      appBar: compactWriting
          ? null
          : AppBar(
              title: Text(peer, maxLines: 1, overflow: TextOverflow.ellipsis),
              actions: [
                IconButton(
                  tooltip: uiText(context, 'Riepilogo personale'),
                  onPressed: v == null ? null : _recap,
                  icon: const Icon(Icons.subject),
                ),
                if (v != null)
                  PopupMenuButton<String>(
                    tooltip: uiText(context, 'Altre azioni'),
                    onSelected: (_) => _createWithPeer((
                      id: v['peer']['id'] as String,
                      name: peer,
                    )),
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'space',
                        child: Text(
                          uiText(context, 'Crea uno spazio con {0}', [peer]),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            if (_error.isNotEmpty)
              ListTile(
                title: Text(uiText(context, _error)),
                trailing: TextButton(
                  onPressed: _load,
                  child: Text(uiText(context, 'Riprova')),
                ),
              ),
            if (v == null && _error.isEmpty) const LinearProgressIndicator(),
            Expanded(
              child: SizedBox.expand(
                key: _viewport,
                child: v == null
                    ? const SizedBox()
                    : _messages.isEmpty
                    ? Center(
                        child: Text(
                          uiText(context, 'Scrivi il primo messaggio a {0}.', [
                            peer,
                          ]),
                        ),
                      )
                    : Stack(
                        children: [
                          NotificationListener<ScrollNotification>(
                            onNotification: (n) {
                              if (n is ScrollUpdateNotification &&
                                  n.dragDetails != null)
                                _userScrolled = true;
                              if (n is ScrollEndNotification) _scheduleRead();
                              return false;
                            },
                            child: CustomScrollView(
                              controller: _scroll,
                              center: _center,
                              anchor: _alignBottom ? 1 : 0,
                              slivers: [
                                SliverList.builder(
                                  itemCount: pivot,
                                  itemBuilder: (context, i) =>
                                      _row(_messages[pivot - i - 1]),
                                ),
                                SliverList.builder(
                                  key: _center,
                                  itemCount: _messages.length - pivot,
                                  itemBuilder: (context, i) =>
                                      _row(_messages[pivot + i]),
                                ),
                              ],
                            ),
                          ),
                          if (_away && !compactWriting)
                            Positioned(
                              right: 8,
                              bottom: 4,
                              child: TextButton.icon(
                                onPressed: () => _jump(null),
                                icon: const Icon(
                                  Icons.arrow_downward,
                                  size: 16,
                                ),
                                label: Text(uiText(context, 'Vai in fondo')),
                              ),
                            ),
                        ],
                      ),
              ),
            ),
            if (v != null && j != null && j.ready && !compactWriting)
              LegacyRecoveryPanel(
                api: widget.api,
                scope: LegacyScope.direct(widget.id),
                vault: widget.vault,
                journal: j,
                allowed: () => _current && _view != null,
              ),
            if (v != null && j?.storageError == true)
              TextButton(
                onPressed: () async {
                  try {
                    await j?.saveAgain();
                  } catch (_) {}
                },
                child: Text(uiText(context, 'Riprova salvataggio protetto')),
              ),
            if (v != null && j != null && j.ready)
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 2, 4, 8),
                child: Column(
                  children: [
                    if (quote != null)
                      Row(
                        children: [
                          const Icon(Icons.format_quote, size: 18),
                          Expanded(
                            child: Text(
                              '${quote['name']} · ${quote['text']}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          IconButton(
                            tooltip: uiText(context, 'Rimuovi citazione'),
                            onPressed: () => j.quote(null),
                            icon: const Icon(Icons.close, size: 18),
                          ),
                        ],
                      ),
                    if (j.attachmentProblem != null) Text(j.attachmentProblem!),
                    if (j.pending != null && !j.sending)
                      TextButton(
                        onPressed: _send,
                        child: Text(uiText(context, 'Verifica e riprova')),
                      ),
                    ValueListenableBuilder<TextEditingValue>(
                      valueListenable: _editor,
                      builder: (context, value, child) {
                        final hint = RegExp(
                          r'^\s*(?:/|@(?:emme|miriam)\b|(?:chiedi\s+a|ask)\s+@?(?:emme|miriam)\b|emme\b)',
                          caseSensitive: false,
                        ).hasMatch(value.text);
                        return Column(
                          children: [
                            if (hint)
                              Text(
                                uiText(
                                  context,
                                  'Il messaggio arriva a {0}. Qui Emme può solo preparare il tuo riepilogo personale.',
                                  [peer],
                                ),
                              ),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Expanded(
                                  child: TextField(
                                    key: const Key('direct-composer'),
                                    controller: _editor,
                                    focusNode: _focus,
                                    onChanged: j.edit,
                                    minLines: 1,
                                    maxLines:
                                        MediaQuery.sizeOf(context).height -
                                                MediaQuery.viewInsetsOf(context)
                                                    .bottom <
                                            260
                                        ? 2
                                        : 4,
                                    textInputAction: TextInputAction.newline,
                                    maxLength: 12000,
                                    decoration: InputDecoration(
                                      isDense: true,
                                      hintText: uiText(
                                        context,
                                        'Messaggio privato',
                                      ),
                                      counterText: '',
                                    ),
                                  ),
                                ),
                                AttachmentPicker(
                                  compact: true,
                                  staging: j.staging,
                                  files: j.files,
                                  enabled: !j.sending && j.pending == null,
                                  onChanged: (next) async {
                                    await readDirect(
                                      widget.api,
                                      widget.id,
                                      _actor,
                                    );
                                    if (!mounted ||
                                        widget.api.actorId != _actor)
                                      throw const AttachmentProblem(
                                        'Riapri la conversazione per allegare.',
                                      );
                                    await j.replaceFiles(next);
                                  },
                                ),
                                IconButton(
                                  tooltip: uiText(context, 'Invia a {0}', [
                                    peer,
                                  ]),
                                  onPressed:
                                      j.sending ||
                                          j.pending != null ||
                                          (value.text.trim().isEmpty &&
                                              j.files.isEmpty) ||
                                          value.text.trim().length > 12000
                                      ? null
                                      : _send,
                                  icon: const Icon(Icons.arrow_upward),
                                ),
                              ],
                            ),
                          ],
                        );
                      },
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
