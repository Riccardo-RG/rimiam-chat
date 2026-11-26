import 'ui_language.dart';
import 'personal_navigation.dart';

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'agenda_commands.dart' show agendaLocalZone;
import 'attachment_preview.dart';
import 'file_library.dart';
import 'library_collection.dart';
import 'library_document_view.dart';
import 'personal_attachment.dart';
import 'workspace_chat_action_line.dart';
import 'assistant_request_feedback.dart';
import 'legacy_mobile_data.dart';
import 'legacy_recovery.dart';
import 'chat_journal.dart';
import 'journey.dart';
import 'message_sources.dart';
import 'studio_theme.dart';
import 'workspace_governance.dart';
import 'workspace_work.dart';

const _endpoint = '/api/v1/personal-chats';
typedef _Json = Map<String, dynamic>;
List<_Json> _rows(dynamic value) => (value as List).cast<_Json>();
String _address(String text) =>
    RegExp(
      r'^\s*(?:(?:ciao|ehi|hey|hello|hi)[\s,]+)?@?emme(?![\p{L}\p{M}\p{N}_])',
      caseSensitive: false,
      unicode: true,
    ).hasMatch(text)
    ? text
    : '@Emme $text';
bool _denied(Object e) =>
    e is ApiError && (e.status == 401 || e.status == 403 || e.status == 404);

/// Direct questions and workspace consultations have different receipts. Keep the
/// exact intent, including the selected workspace version, across process exits.
class _PersonalDraft {
  _PersonalDraft(this.vault, Uri origin, this.actor, this.thread)
    : key =
          'rimiam.personal.v1.${sha256.convert(utf8.encode(jsonEncode([origin.origin, actor, thread])))}';
  final DraftVault vault;
  final String key, actor, thread;
  String text = '';
  String? importedLegacyId;
  _Json? pending;
  bool busy = false, loaded = false, storageFailed = false;
  Future<void> _writes = Future.value();
  Future<void>? _opening;
  int _revision = 0;
  Future<void> open() => loaded
      ? Future.value()
      : (_opening ??= _restore().whenComplete(() => _opening = null));
  Future<void> _restore() async {
    final value = await vault.read(key);
    if (value != null) {
      final record = jsonDecode(value) as _Json;
      if (record['v'] != 1) throw const FormatException();
      text = record['text'] as String;
      importedLegacyId = record['importedLegacyId'] as String?;
      pending = record['pending'] as _Json?;
    }
    loaded = true;
  }

  Future<void> save() {
    final value = text.isEmpty && pending == null && importedLegacyId == null
        ? null
        : jsonEncode({
            'v': 1,
            'text': text,
            'pending': pending,
            if (importedLegacyId != null) 'importedLegacyId': importedLegacyId,
          });
    final revision = ++_revision;
    final write = _writes.then((_) => vault.replace(key, value));
    _writes = write.then(
      (_) {
        if (revision == _revision) storageFailed = false;
      },
      onError: (Object _, StackTrace __) {
        if (revision == _revision) storageFailed = true;
      },
    );
    return write;
  }

  Future<void> send(
    RimiamApi api,
    _Json selection,
    bool Function() allowed,
    String? timeZone,
  ) async {
    if (busy || !loaded || !allowed() || api.actorId != actor) return;
    final previous = pending, question = text.trim();
    if (previous == null && question.isEmpty) return;
    final request =
        previous ??
        {
          'id': api.newId(),
          'question': question,
          'target': selection['id'],
          'version': selection['version'],
          if (selection['id'] == null && timeZone != null) 'timeZone': timeZone,
        };
    final id = request['id'] as String,
        body = request['question'] as String,
        target = request['target'] as String?;
    final path = '/api/v1/workspaces/$thread';
    final content = _address(body);
    if ((target == null ? content.length > 12000 : body.length > 2000))
      throw const FormatException('Domanda troppo lunga');
    pending = request;
    busy = true;
    try {
      await save();
      if (!allowed() || api.actorId != actor) return;
      if (target == null) {
        bool confirmed(_Json r) =>
            r['commandId'] == id && r['status'] == 'committed';
        bool sent = false;
        if (previous != null) {
          try {
            final r = await api.get('$path/receipts/$id');
            if (!confirmed(r)) throw const FormatException('Ricevuta inattesa');
            sent = true;
          } on ApiError catch (e) {
            if (e.code != 'RECEIPT_NOT_FOUND' || e.status != 404) rethrow;
          }
        }
        if (!sent && allowed() && api.actorId == actor) {
          final r = await api.post('$path/commands', {
            'commandId': id,
            'expectedActorId': actor,
            'command': {
              'type': 'message.send',
              'content': content,
              if (request['timeZone'] != null)
                'clientTimeZone': request['timeZone'],
            },
          });
          if (!confirmed(r)) throw const FormatException('Ricevuta inattesa');
        } else if (!sent)
          return;
      } else {
        final state = await api.get('$_endpoint?thread=$thread');
        final turn = _rows(state['turns'])
            .where((t) => t['id'] == id)
            .firstOrNull;
        if (turn != null) {
          if (turn['target'] != target ||
              turn['selectionVersion'] != request['version'] ||
              turn['question'] != body)
            throw const FormatException('Consultazione inattesa');
        } else {
          if (!allowed() || api.actorId != actor) return;
          final current = state['selection'] as _Json;
          if (current['id'] != target ||
              current['version'] != request['version']) {
            pending = null;
            await save();
            throw const ApiError(409, 'CONSULTATION_SELECTION_CHANGED');
          }
          await api.post(_endpoint, {
            'action': 'ask',
            'expectedActorId': actor,
            'thread': thread,
            'target': target,
            'expectedVersion': request['version'],
            'id': id,
            'question': body,
          });
        }
      }
      final original = text;
      pending = null;
      text = '';
      try {
        await save();
      } catch (_) {
        text = original;
        pending = request;
        rethrow;
      }
    } finally {
      busy = false;
    }
  }
}

class PersonalChatPage extends StatefulWidget {
  PersonalChatPage({
    Key? key,
    required this.api,
    this.vault = const DeviceDraftVault(),
    this.research,
  }) : super(key: key ?? ValueKey((api, api.actorId, research)));
  final RimiamApi api;
  final DraftVault vault;
  final ({String thread, String workId})? research;
  @override
  State<PersonalChatPage> createState() => _PersonalChatPageState();
}

class _PersonalChatPageState extends State<PersonalChatPage>
    with WidgetsBindingObserver {
  late final _actor = widget.api.actorId;
  String? _thread, _nextId, _error, _retryThread;
  bool _retryNew = false;
  int _epoch = 0;
  bool _opening = false, _active = true, _history = false;
  bool _showInitialResult = true;
  bool get _valid => mounted && _active && widget.api.actorId == _actor;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_open(id: widget.research?.thread));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _active = false;
      _epoch++;
      setState(() {
        _thread = null;
        _history = false;
        _opening = false;
        _error = null;
      });
    } else if (state == AppLifecycleState.resumed && !_active) {
      _active = true;
      unawaited(_open());
    }
  }

  Future<void> _open({String? id, bool fresh = false}) async {
    if (_opening || !_valid) return;
    final epoch = ++_epoch;
    if (fresh) id = _nextId ??= widget.api.newId();
    setState(() {
      _opening = true;
      _retryNew = fresh;
      _retryThread = id;
      _error = null;
    });
    try {
      final reply = await widget.api.post(_endpoint, {
        'action': fresh ? 'new' : 'open',
        'expectedActorId': _actor,
        if (id != null) 'thread': id,
      });
      if (!_valid || epoch != _epoch) return;
      final selected = reply['id'] as String;
      if (selected.isEmpty || (id != null && id != selected))
        throw const FormatException();
      setState(() {
        _thread = selected;
        _nextId = null;
        _history = false;
      });
      final target = widget.research;
      if (_showInitialResult && target != null && target.thread == selected) {
        _showInitialResult = false;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_valid && _thread == selected) {
            unawaited(_research(selected, workId: target.workId));
          }
        });
      }
    } catch (e) {
      if (_valid && epoch == _epoch)
        setState(() {
          if (_denied(e)) {
            _thread = null;
            _history = false;
          }
          _error = 'Impossibile aprire la conversazione.';
        });
    } finally {
      if (_valid && epoch == _epoch) setState(() => _opening = false);
    }
  }

  Future<void> _research(String thread, {String? workId}) =>
      Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (context) => ResearchScreen(
            api: widget.api,
            workspaceId: thread,
            workspaceName: uiText(context, 'Tu ed Emme'),
            initialWorkId: workId,
            personal: true,
            vault: widget.vault,
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: PersonalNavTitle(
        _history
            ? uiText(context, 'Conversazioni')
            : uiText(context, 'Tu ed Emme'),
      ),
      actions: [
        if (_thread case final String thread when !_history && _valid)
          IconButton(
            tooltip: uiText(context, 'Ricerca privata'),
            icon: const Icon(Icons.travel_explore),
            onPressed: _opening ? null : () => _research(thread),
          ),
        if (!_history)
          IconButton(
            tooltip: uiText(context, 'Conversazioni precedenti'),
            icon: const Icon(Icons.history),
            onPressed: _opening ? null : () => setState(() => _history = true),
          ),
        if (_history)
          IconButton(
            tooltip: uiText(context, 'Torna alla conversazione'),
            icon: const Icon(Icons.chat_outlined),
            onPressed: _opening ? null : () => setState(() => _history = false),
          ),
        IconButton(
          tooltip: uiText(context, 'Nuova conversazione'),
          icon: const Icon(Icons.edit_outlined),
          onPressed: _opening ? null : () => _open(fresh: true),
        ),
      ],
    ),
    body: SafeArea(
      child: Column(
        children: [
          if (_error != null)
            ListTile(
              title: Text(uiText(context, _error!)),
              trailing: TextButton(
                onPressed: () => _open(id: _retryThread, fresh: _retryNew),
                child: Text(uiText(context, 'Riprova')),
              ),
            ),
          if (_opening) const LinearProgressIndicator(),
          if (_valid && _history)
            Expanded(
              child: _PersonalHistory(
                api: widget.api,
                onSelect: (id) => _open(id: id),
              ),
            )
          else if (_valid && _thread != null)
            Expanded(
              child: _Conversation(
                key: ValueKey(_thread),
                api: widget.api,
                actor: _actor,
                thread: _thread!,
                vault: widget.vault,
                openResearch: (id) => _research(_thread!, workId: id),
              ),
            ),
        ],
      ),
    ),
  );
}

class _PersonalHistory extends StatefulWidget {
  const _PersonalHistory({required this.api, required this.onSelect});
  final RimiamApi api;
  final ValueChanged<String> onSelect;
  @override
  State<_PersonalHistory> createState() => _PersonalHistoryState();
}

/// An explicit message can become the first visible row without estimating
/// heights or building the whole conversation. The default opens at the end.
class _PersonalTimeline extends StatelessWidget {
  const _PersonalTimeline({
    required this.controller,
    required this.anchor,
    required this.itemCount,
    required this.itemBuilder,
  });
  final ScrollController controller;
  final int anchor, itemCount;
  final IndexedWidgetBuilder itemBuilder;
  @override
  Widget build(BuildContext context) {
    const center = ValueKey('personal-chat-anchor');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: CustomScrollView(
        controller: controller,
        center: center,
        anchor: anchor < 0 ? 1 : 0,
        slivers: [
          SliverList.builder(
            itemCount: itemCount - anchor - 1,
            itemBuilder: (c, i) => itemBuilder(c, anchor + 1 + i),
          ),
          SliverList.builder(
            key: center,
            itemCount: anchor + 1,
            itemBuilder: (c, i) => itemBuilder(c, anchor - i),
          ),
        ],
      ),
    );
  }
}

class _PersonalHistoryState extends State<_PersonalHistory> {
  final List<_Json> _threads = [];
  bool _loading = false, _more = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.get(
        '$_endpoint?offset=${_threads.length}',
      );
      if (mounted)
        setState(() {
          _threads.addAll(_rows(result['threads']));
          _more = result['more'] == true;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          if (_denied(e)) _threads.clear();
          _error = 'Impossibile caricare la cronologia.';
        });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    children: [
      for (final t in _threads)
        ListTile(
          title: Text(
            t['label'] as String,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            MaterialLocalizations.of(context)
                .formatShortDate(DateTime.parse(t['at'] as String).toLocal()),
          ),
          onTap: () => widget.onSelect(t['id'] as String),
        ),
      if (_loading)
        const LinearProgressIndicator()
      else if (_error != null)
        TextButton(
          onPressed: _load,
          child: Text(uiText(context, '{0} Riprova', [_error])),
        )
      else if (_more)
        TextButton(
          onPressed: _load,
          child: Text(uiText(context, 'Altre conversazioni')),
        )
      else if (_threads.isEmpty)
        ListTile(title: Text(uiText(context, 'Nessuna conversazione.'))),
    ],
  );
}

class _TurnSources extends StatelessWidget {
  const _TurnSources({super.key, required this.entries, required this.open});
  final List<_Json> entries;
  final ValueChanged<_Json> open;

  @override
  Widget build(BuildContext context) {
    if (entries.length <= 1)
      return MessageSources(entries: entries, open: open);
    // Keep this list inside its authorized turn so redacting that turn also
    // removes every expanded source label.
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      leading: const Icon(Icons.link, size: 17),
      title: Text(uiText(context, '{0} fonti', [entries.length])),
      expandedAlignment: Alignment.centerLeft,
      expandedCrossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final entry in entries)
          MessageSources(entries: [entry], open: open),
      ],
    );
  }
}

class _Conversation extends StatefulWidget {
  const _Conversation({
    super.key,
    required this.api,
    required this.actor,
    required this.thread,
    required this.vault,
    required this.openResearch,
  });
  final RimiamApi api;
  final String actor, thread;
  final DraftVault vault;
  final Future<void> Function(String) openResearch;
  @override
  State<_Conversation> createState() => _ConversationState();
}

class _ConversationState extends State<_Conversation> {
  static final _cache = Expando<Map<String, _PersonalDraft>>();
  final _editor = TextEditingController();
  late final Timer _timer;
  final _retryIds = <String, String>{};
  final _scroll = ScrollController();
  List<_Json> _messages = [], _readings = [], _turns = [], _targets = [];
  List<_Json> _files = [], _research = [];
  String? _anchor, _timeZone;
  _Json _selection = {'id': null, 'version': 0};
  _PersonalDraft? _draft;
  bool Function(List<_Json>)? _checkOpenSource;
  VoidCallback? _closeOpenSource;
  bool _canWrite = false,
      _loading = false,
      _queued = false,
      _acting = false,
      _sending = false,
      _authorized = false;
  String? _loadError, _actionError;
  bool get _valid => mounted && widget.api.actorId == widget.actor;
  bool get _allowed => _valid && _authorized && _canWrite;
  String get _workspace =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.thread)}';
  @override
  void initState() {
    super.initState();
    agendaLocalZone().then((zone) {
      if (_valid) _timeZone = zone;
    }, onError: (Object _) {});
    unawaited(_load());
    _timer = Timer.periodic(
      const Duration(seconds: 6),
      (_) => unawaited(_load()),
    );
  }

  @override
  void dispose() {
    _timer.cancel();
    _closeOpenSource?.call();
    _editor.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _sync() {
    final text = _draft?.text ?? '';
    if (_editor.text != text)
      _editor.value = TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(offset: text.length),
      );
  }

  _Json? _lastSnapshot;
  Future<_Json> _snapshot() async {
    final last = _lastSnapshot;
    final revision = last?['workspace']['revision'];
    // Running work can change before a final publication advances the workspace.
    final working = _readings.any(
      (r) => r['status'] == 'queued' || r['status'] == 'running',
    );
    if (last != null && revision is int && !working) {
      final change = await widget.api.get(
        '$_workspace/changes?after=$revision&limit=1',
      );
      if (change['headRevision'] == revision) return last;
    }
    final raw = await widget.api.get('$_workspace/workspace');
    return {
      for (final key in [
        'workspace',
        'members',
        'messages',
        'interpretations',
        'sources',
      ])
        key: raw[key],
    };
  }

  Future<void> _load() async {
    if (_loading) {
      _queued = true;
      return;
    }
    _loading = true;
    try {
      // The personal endpoint proves ownership before accessing the device vault.
      final results = await Future.wait([
        widget.api.get('$_endpoint?thread=${widget.thread}'),
        _snapshot(),
      ]);
      if (!_valid) return;
      final state = results[0], snapshot = results[1];
      final workspace = snapshot['workspace'] as _Json;
      if (workspace['id'] != widget.thread || workspace['personal'] != true)
        throw const ApiError(403, 'PERSONAL_CHAT_REQUIRED');
      final member = _rows(snapshot['members'])
          .where((m) => m['user_id'] == widget.actor && m['active'] == true)
          .firstOrNull;
      if (member == null) throw const ApiError(403, 'MEMBER_REQUIRED');
      final messages = _rows(snapshot['messages']).toList()
        ..sort(
          (a, b) => (b['sequence'] as int).compareTo(a['sequence'] as int),
        );
      final turns = _rows(state['turns']);
      if (_checkOpenSource?.call(turns) == false) _closeOpenSource?.call();
      setState(() {
        _authorized = true;
        _lastSnapshot = snapshot;
        _canWrite = member['contributes'] == true;
        _messages = messages;
        _readings = _rows(snapshot['interpretations']);
        _selection = state['selection'] as _Json;
        _turns = turns;
        _targets = _rows(state['targets']);
        _files = groupRows(snapshot['sources']);
        _research = groupRows(state['research']);
        _loadError = null;
      });
      if (_canWrite) {
        final cache = _cache[widget.api] ??= {};
        final journal = cache.putIfAbsent(
          '${widget.actor}/${widget.thread}',
          () => _PersonalDraft(
            widget.vault,
            widget.api.origin,
            widget.actor,
            widget.thread,
          ),
        );
        await journal.open();
        if (!_allowed) return;
        setState(() {
          _draft = journal;
          _sync();
        });
      } else {
        setState(() {
          _draft = null;
          _sync();
        });
      }
    } catch (e) {
      if (_denied(e)) _closeOpenSource?.call();
      if (_valid)
        setState(() {
          _loadError = 'Impossibile aggiornare la conversazione.';
          if (_denied(e)) {
            _authorized = false;
            _lastSnapshot = null;
            _canWrite = false;
            _messages = [];
            _turns = [];
            _targets = [];
            _readings = [];
            _files = [];
            _research = [];
            _selection = {'id': null, 'version': 0};
            _draft = null;
            _sync();
          }
        });
    } finally {
      _loading = false;
      if (_valid && _queued) {
        _queued = false;
        unawaited(_load());
      }
    }
  }

  Future<void> _send() async {
    final d = _draft;
    if (!_allowed || d == null || d.busy || _acting || _sending) return;
    setState(() {
      _sending = true;
      _actionError = null;
    });
    try {
      await d.send(widget.api, _selection, () => _allowed, _timeZone);
      if (_valid) {
        _sync();
        await _load();
        if (_valid) _jump(null);
      }
    } catch (e) {
      if (_valid) {
        setState(
          () => _actionError =
              e is ApiError && e.code == 'CONSULTATION_SELECTION_CHANGED'
              ? 'Lo spazio consultato è cambiato. Controlla la destinazione prima di inviare.'
              : e is FormatException && e.message == 'Domanda troppo lunga'
              ? 'La domanda supera il limite di caratteri.'
              : d.storageFailed
              ? 'Impossibile salvare la domanda sul dispositivo. Riprova prima di chiudere.'
              : 'Invio da verificare. La domanda è salvata.',
        );
        if (_denied(e)) await _load();
      }
    } finally {
      if (_valid) setState(() => _sending = false);
    }
  }

  Future<void> _select(String? target) async {
    if (!_allowed || _acting || _sending || _draft?.pending != null) return;
    setState(() {
      _acting = true;
      _actionError = null;
    });
    try {
      await widget.api.post(_endpoint, {
        'action': 'select',
        'expectedActorId': widget.actor,
        'thread': widget.thread,
        'target': target,
        'expectedVersion': _selection['version'],
      });
      if (_valid) await _load();
    } catch (_) {
      if (_valid) {
        setState(
          () => _actionError =
              'Impossibile cambiare la conversazione consultata.',
        );
        await _load();
      }
    } finally {
      if (_valid) setState(() => _acting = false);
    }
  }

  Future<void> _source(_Json turn, _Json ref) async {
    if (!_valid || !_authorized || _acting || _closeOpenSource != null) return;
    final api = widget.api, workspace = turn['target'] as String;
    final navigator = Navigator.of(context), parent = ModalRoute.of(context);
    bool stillCited(List<_Json> rows) => rows.any(
      (t) =>
          t['id'] == turn['id'] &&
          t['target'] == workspace &&
          t['status'] == 'ready' &&
          groupRows(t['references']).any(
            (r) =>
                r['kind'] == ref['kind'] &&
                r['id'] == ref['id'] &&
                r['version'] == ref['version'],
          ),
    );
    Future<String> verify() async {
      final state = await api.get('$_endpoint?thread=${widget.thread}');
      final target = groupRows(state['targets'])
          .where((t) => t['id'] == workspace)
          .firstOrNull;
      if (!_valid || !stillCited(groupRows(state['turns'])) || target == null) {
        throw const ApiError(403, 'CONSULTATION_UNAVAILABLE');
      }
      return target['name'] as String;
    }

    setState(() {
      _acting = true;
      _actionError = null;
    });
    try {
      await verify();
      if (!_valid || parent?.isCurrent != true) return;
      final group = GroupGovernance(
        api,
        workspace,
        direction: false,
        referencesOnly: true,
      );
      final route = MaterialPageRoute<String>(
        builder: (_) => GroupReferencePage(group: group, reference: ref),
      );
      void close() {
        group.suspend();
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (navigator.mounted && route.isActive && parent!.isActive) {
            navigator.popUntil((r) => r == parent);
          }
        });
      }

      _checkOpenSource = stillCited;
      _closeOpenSource = close;
      final message = await navigator.push(route);
      _checkOpenSource = null;
      _closeOpenSource = null;
      if (message == null || !_valid || parent?.isCurrent != true) return;
      final name = await verify();
      if (!_valid || parent?.isCurrent != true) return;
      await navigator.push<void>(
        MaterialPageRoute(
          builder: (_) => WorkspaceJourney(
            api: api,
            workspaceId: workspace,
            workspaceName: name,
            initialMessageId: message,
            vault: widget.vault,
          ),
        ),
      );
    } catch (e) {
      if (_valid) {
        setState(() => _actionError = groupIssue(e));
        await _load();
      }
    } finally {
      _checkOpenSource = null;
      _closeOpenSource = null;
      if (_valid) setState(() => _acting = false);
    }
  }

  bool _canRetryTurn(_Json t) =>
      (t['status'] == 'pending' || t['status'] == 'failed') &&
      t['target'] == _selection['id'] &&
      t['selectionVersion'] == _selection['version'];

  void _jump(String? message) {
    if (!_valid ||
        !_authorized ||
        (message != null && !_messages.any((m) => m['id'] == message)))
      return;
    setState(() => _anchor = message);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_valid && _scroll.hasClients) _scroll.jumpTo(0);
    });
  }

  Future<void> _ownReference(_Json ref) async {
    if (!_valid || !_authorized) return;
    if (ref['kind'] == 'source' && _messages.any((m) => m['id'] == ref['id'])) {
      _jump(ref['id'] as String);
      return;
    }
    final group = GroupGovernance(
      widget.api,
      widget.thread,
      direction: false,
      referencesOnly: true,
    );
    final message = await openGroupReference(context, group, ref);
    if (message != null && _valid) _jump(message);
  }

  Future<void> _upload() async {
    if (!_allowed || _acting || _sending) return;
    FocusScope.of(context).unfocus();
    final model = PersonalAttachment(widget.api, widget.vault, widget.thread);
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => PersonalAttachmentPage(upload: model)),
    );
    if (_valid && saved == true) {
      await _load();
      if (_valid) _jump(null);
    }
  }

  Future<void> _document() async {
    if (!_allowed || _acting || _sending) return;
    final api = widget.api,
        vault = widget.vault,
        actor = widget.actor,
        thread = widget.thread;
    final target = _selection['id'] as String?,
        version = _selection['version'] as int;
    final library = LibraryCollection(
      api,
      vault,
      workspace: target,
      personalThread: target == null ? thread : null,
    );
    Future<String> verify() async {
      final state = await api.get(
        '$_endpoint?thread=${Uri.encodeQueryComponent(thread)}',
      );
      if (api.actorId != actor ||
          state['selection']?['id'] != target ||
          state['selection']?['version'] != version)
        throw const ApiError(409, 'CONSULTATION_SELECTION_CHANGED');
      return state['archive'] as String;
    }

    FocusScope.of(context).unfocus();
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (page) => LibraryDocumentsView(
          library: library,
          privateSelection: '$thread.$version',
          checkSelection: verify,
          openArchive: () => Navigator.push<void>(
            page,
            MaterialPageRoute(
              builder: (_) => FileLibrary(api: api, vault: vault),
            ),
          ),
        ),
      ),
    );
    if (_valid) await _load();
  }

  Future<void> _retryTurn(_Json t) async {
    if (!_allowed || _acting || _sending || !_canRetryTurn(t)) return;
    setState(() {
      _acting = true;
      _actionError = null;
    });
    try {
      await widget.api.post(_endpoint, {
        'action': 'ask',
        'expectedActorId': widget.actor,
        'thread': widget.thread,
        'id': t['id'],
        'target': t['target'],
        'question': t['question'],
        'expectedVersion': t['selectionVersion'],
      });
    } catch (e) {
      if (_valid) setState(() => _actionError = groupIssue(e));
    } finally {
      if (_valid) {
        await _load();
        if (_valid) setState(() => _acting = false);
      }
    }
  }

  Future<void> _retry(String reading) async {
    if (!_allowed || _acting) return;
    setState(() {
      _acting = true;
      _actionError = null;
    });
    final id = _retryIds.putIfAbsent(reading, widget.api.newId);
    try {
      final receipt = await widget.api.post('$_workspace/commands', {
        'commandId': id,
        'expectedActorId': widget.actor,
        'command': {
          'type': 'interpretation.retry',
          'interpretationId': reading,
        },
      });
      if (receipt['commandId'] != id || receipt['status'] != 'committed')
        throw const FormatException();
      _retryIds.remove(reading);
      if (_valid) await _load();
    } catch (_) {
      if (_valid)
        setState(() => _actionError = 'Impossibile riprovare la richiesta.');
    } finally {
      if (_valid) setState(() => _acting = false);
    }
  }

  String? _status(_Json? reading) {
    if (reading == null) return null;
    return switch (reading['status']) {
      'queued' => 'In attesa della risposta',
      'running' => 'Emme sta rispondendo…',
      'failed' => switch (reading['error_code']) {
        'AI_USAGE_LIMIT_REACHED' =>
          'Limite di utilizzo raggiunto. La domanda è salvata.',
        'AI_CONFIGURATION_REQUIRED' ||
        'AI_LIMIT_CONFIGURATION_INVALID' ||
        'ASSISTANT_CONNECTION_CHANGED' =>
          'Controlla la connessione di Emme. La domanda è salvata.',
        'AI_TIMEOUT' || 'AI_RATE_LIMITED' || 'AI_PROVIDER_UNAVAILABLE' =>
          'Emme è temporaneamente indisponibile. La domanda è salvata.',
        _ => 'Emme non ha potuto rispondere. La domanda è salvata.',
      },
      _ => null,
    };
  }

  @override
  Widget build(BuildContext context) {
    final d = _draft;
    final editable =
        _allowed &&
        d != null &&
        d.loaded &&
        !d.busy &&
        d.pending == null &&
        !_sending;
    final replies = _messages
        .where((m) => m['actor_kind'] == 'miriam')
        .map((m) => m['reply_to_source_id'])
        .toSet();
    final readings = {
      for (final r in _readings)
        if (r['explicitRequest'] != false &&
            r['otherMemberTarget'] != true &&
            r['hasPublishedReply'] != true &&
            !replies.contains(r['source_id']))
          (r['requestMessageId'] ?? r['source_id']): r,
    };
    final turns = {for (final t in _turns) t['messageId']: t};
    final byMessage = {for (final m in _messages) m['id'] as String: m};
    final byFile = {for (final f in _files) f['id'] as String: f};
    final byShare = <String, List<_Json>>{};
    for (final f in _files) {
      if (f['shared_message_id'] case final String id) {
        if (f['filename'] is String) (byShare[id] ??= []).add(f);
      }
    }
    for (final group in byShare.values) {
      if (group.length > 1)
        group.sort(
          (a, b) => (a['attachment_position'] as int? ?? 0).compareTo(
            b['attachment_position'] as int? ?? 0,
          ),
        );
    }
    final byResearch = {for (final r in _research) r['messageId']: r};
    return Column(
      children: [
        if (_loadError != null)
          ListTile(
            title: Text(_loadError!),
            trailing: TextButton(
              onPressed: _load,
              child: Text(uiText(context, 'Aggiorna')),
            ),
          )
        else if (!_authorized)
          const LinearProgressIndicator(),
        if (_authorized && d != null && d.loaded && _allowed)
          LegacyRecoveryPanel(
            api: widget.api,
            scope: LegacyScope.personal(widget.thread),
            vault: widget.vault,
            allowed: () => _allowed,
            onPersonalDraft: (id, text) async {
              if (!_allowed ||
                  d.busy ||
                  d.pending != null ||
                  d.text.isNotEmpty ||
                  d.importedLegacyId == id)
                throw const FormatException(
                  'Il campo contiene già una bozza o il recupero è già avvenuto.',
                );
              final oldId = d.importedLegacyId;
              d.text = text;
              d.importedLegacyId = id;
              try {
                await d.save();
              } catch (_) {
                d.text = '';
                d.importedLegacyId = oldId;
                rethrow;
              }
              if (mounted && _allowed) {
                _editor.text = text;
                setState(() {});
              }
            },
          ),
        if (_authorized)
          Row(
            children: [
              if (_targets.isNotEmpty || _selection['id'] != null)
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: _selection['id'] != null
                        ? TextButton.icon(
                            icon: const Icon(Icons.close, size: 17),
                            label: Text(
                              uiText(context, '{0} · Termina', [
                                _selection['label'],
                              ]),
                            ),
                            onPressed: editable && !_acting
                                ? () => _select(null)
                                : null,
                          )
                        : PopupMenuButton<String>(
                            tooltip: uiText(context, 'Consulta uno spazio'),
                            enabled: editable && !_acting,
                            itemBuilder: (_) => [
                              for (final t in _targets)
                                PopupMenuItem(
                                  value: t['id'] as String,
                                  child: Text(t['name'] as String),
                                ),
                            ],
                            onSelected: _select,
                            child: Padding(
                              padding: EdgeInsets.all(12),
                              child: ExcludeSemantics(
                                child: Text(
                                  uiText(context, 'Consulta uno spazio'),
                                ),
                              ),
                            ),
                          ),
                  ),
                )
              else
                const Spacer(),
              IconButton(
                tooltip: uiText(context, 'Prepara documento'),
                icon: const Icon(Icons.note_add_outlined),
                onPressed: editable && !_acting ? _document : null,
              ),
            ],
          ),
        Expanded(
          child: _authorized && _messages.isEmpty
              ? Center(
                  child: Text(uiText(context, 'Cosa vuoi chiedere a Emme?')),
                )
              : _PersonalTimeline(
                  controller: _scroll,
                  anchor: _messages.indexWhere((m) => m['id'] == _anchor),
                  itemCount: _messages.length,
                  itemBuilder: (context, i) {
                    final m = _messages[i],
                        id = m['id'],
                        emme = m['actor_kind'] == 'miriam',
                        turn = turns[id];
                    final ref = m['reference'] as _Json?;
                    final referred = ref?['kind'] == 'source'
                        ? byFile[ref?['id']]
                        : null;
                    final files = [
                      if (referred != null &&
                          referred['filename'] is String &&
                          referred['shared_message_id'] != id)
                        referred,
                      ...?byShare[id],
                    ];
                    final citations = messageSources(m, byMessage, byFile);
                    final research = byResearch[id];
                    final r = m['purpose'] == 'conversation' && !emme
                        ? readings[id]
                        : null;
                    final attributed =
                        r != null &&
                        (r['explicitRequest'] == true ||
                            r['requestMessageId'] != null ||
                            m['assistanceContext'] != null ||
                            _address(m['content'] as String) == m['content']);
                    final answer = turn?['status'] == 'ready'
                        ? (turn?['answer'] as String?)
                        : null;
                    final status = turn != null
                        ? (answer != null
                              ? null
                              : switch (turn['status']) {
                                  'pending' => 'Consultazione in corso…',
                                  'unavailable' => 'La conversazione di origine non è accessibile.',
                                  _ => 'Risposta non disponibile.',
                                })
                        : attributed
                        ? _status(r)
                        : null;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              if (emme)
                                Padding(
                                  padding: const EdgeInsets.only(right: 5),
                                  child: ImageIcon(
                                    emmeIcon,
                                    size: 16,
                                    color: Theme.of(context)
                                        .colorScheme
                                        .secondary,
                                  ),
                                ),
                              Expanded(
                                child: Text(
                                  emme
                                      ? m['author_name'] as String
                                      : uiText(context, 'Tu'),
                                  style: Theme.of(context).textTheme.labelLarge
                                      ?.copyWith(
                                        color: emme
                                            ? Theme.of(context)
                                                  .colorScheme
                                                  .secondary
                                            : null,
                                      ),
                                ),
                              ),
                            ],
                          ),
                          if (!files.any((f) => f['filename'] == m['content']))
                            SelectableText(
                              m['content'] as String,
                              style: Theme.of(context).textTheme.bodyLarge
                                  ?.copyWith(
                                    color: emme
                                        ? Theme.of(context)
                                              .colorScheme
                                              .secondary
                                        : null,
                                  ),
                            ),
                          for (final f in files)
                            ReceivedAttachment(
                              api: widget.api,
                              path:
                                  '$_workspace/source-file?id=${Uri.encodeQueryComponent(f['id'] as String)}',
                              filename: f['filename'] as String,
                              withdrawn: f['withdrawn'] == true,
                              mediaType: f['media_type'] as String?,
                              onMessage: () => _jump(id as String),
                            ),
                          if (citations.isNotEmpty)
                            MessageSources(
                              entries: citations,
                              open: _ownReference,
                            ),
                          if (m['reminder'] is _Json)
                            WorkspaceChatActionLine(
                              api: widget.api,
                              workspace: widget.thread,
                              messageId: id as String,
                              authorId: m['author_id'] as String?,
                              canWrite: _canWrite,
                              reminder: m['reminder'] as _Json,
                              vault: widget.vault,
                              refresh: _load,
                            ),
                          if (research != null)
                            TextButton.icon(
                              icon: const Icon(Icons.travel_explore, size: 17),
                              label: Text(
                                uiText(
                                  context,
                                  research['status'] == 'ready'
                                      ? 'Ricerca pronta'
                                      : 'Dettagli ricerca',
                                ),
                              ),
                              onPressed: () =>
                                  widget.openResearch(research['id'] as String),
                            ),
                          if (answer != null) ...[
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                ImageIcon(
                                  emmeIcon,
                                  size: 16,
                                  color: Theme.of(context)
                                      .colorScheme
                                      .secondary,
                                ),
                                const SizedBox(width: 5),
                                Text(
                                  uiText(context, 'Emme · Solo tu'),
                                  style: Theme.of(context).textTheme.labelLarge,
                                ),
                              ],
                            ),
                            SelectableText(
                              answer,
                              style: Theme.of(context).textTheme.bodyLarge
                                  ?.copyWith(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .secondary,
                                  ),
                            ),
                            _TurnSources(
                              key: ValueKey(turn!['id']),
                              entries: groupRows(turn['references']),
                              open: (ref) => _source(turn, ref),
                            ),
                          ],
                          if (status != null)
                            Text(
                              uiText(context, status),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          if (turn != null && _canRetryTurn(turn))
                            TextButton(
                              onPressed: editable && !_acting
                                  ? () => _retryTurn(turn)
                                  : null,
                              child: Text(
                                uiText(context, 'Riprova consultazione'),
                              ),
                            ),
                          if (status != null &&
                              turn == null &&
                              r?['status'] == 'failed' &&
                              assistantFailureReason(r?['error_code']) !=
                                  AssistantFailureReason.other)
                            TextButton(
                              onPressed: _allowed && !_acting
                                  ? () => _retry(r!['id'] as String)
                                  : null,
                              child: Text(
                                uiText(context, 'Riprova questa richiesta'),
                              ),
                            ),
                        ],
                      ),
                    );
                  },
                ),
        ),
        if (_actionError != null) Text(_actionError!),
        if (d?.storageFailed == true)
          TextButton(
            onPressed: () async {
              try {
                await d!.save();
              } catch (_) {}
              if (_valid) setState(() {});
            },
            child: Text(
              uiText(context, 'Salva nuovamente la bozza sul dispositivo'),
            ),
          ),
        if (_authorized)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton(
                  tooltip: uiText(context, 'Allega file'),
                  icon: const Icon(Icons.attach_file),
                  onPressed: editable && !_acting ? _upload : null,
                ),
                Expanded(
                  child: TextField(
                    controller: _editor,
                    enabled: editable,
                    maxLines: 4,
                    minLines: 1,
                    decoration: InputDecoration(
                      labelText: uiText(context, 'Messaggio privato'),
                    ),
                    onChanged: (text) {
                      d!.text = text;
                      unawaited(
                        d.save().catchError((Object _) {
                          if (_valid) setState(() {});
                        }),
                      );
                      setState(() {});
                    },
                  ),
                ),
                if (d?.pending != null && !_sending)
                  TextButton(
                    onPressed: _allowed ? _send : null,
                    child: Text(uiText(context, 'Verifica invio')),
                  )
                else
                  IconButton(
                    tooltip: uiText(context, 'Invia'),
                    icon: const Icon(Icons.send),
                    onPressed:
                        editable && !_acting && _editor.text.trim().isNotEmpty
                        ? _send
                        : null,
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
