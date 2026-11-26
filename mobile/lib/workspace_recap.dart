import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'message_sources.dart';
import 'ui_language.dart';
import 'workspace_governance.dart';

/// The server owns the private answer and personal IDs. Only the request identity
/// and its original start message are kept locally for a lost response.
class WorkspaceRecap {
  WorkspaceRecap(this.api, this.vault, this.workspace)
    : actor = api.actorId,
      key =
          'rimiam.recap.v1.${sha256.convert(utf8.encode(jsonEncode([api.origin.origin, api.actorId, workspace])))}';
  final RimiamApi api;
  final DraftVault vault;
  final String workspace, actor, key;
  String get path => '/api/v1/workspaces/${Uri.encodeComponent(workspace)}';
  String? id, anchor;
  GroupRecord? answer;
  bool canShare = false, busy = false;
  int epoch = 0;
  bool get current => actor.isNotEmpty && api.actorId == actor;
  void hide() {
    epoch++;
    answer = null;
    canShare = false;
  }

  void check(int version) {
    if (!current || epoch != version)
      throw const ApiError(403, 'AUTH_CONTEXT_CHANGED');
  }

  Future<void> access(int version) async {
    check(version);
    final view = await api.get('$path/workspace');
    check(version);
    final member = groupRows(view['members'])
        .where((m) => m['user_id'] == actor && m['active'] == true)
        .firstOrNull;
    if (view['workspace']?['id'] != workspace ||
        view['workspace']?['personal'] == true ||
        member == null) {
      hide();
      throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    }
    canShare = member['contributes'] == true;
  }

  static final uuid = RegExp(
    r'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',
    caseSensitive: false,
  );
  // A fast second tap may create two routes before either has written storage.
  // Both must reserve the same server operation for a given user and anchor.
  static final _reservations = <(DraftVault, String), Future<String>>{};
  String _anchorKey(String id) => '$key.$id';
  Future<String> _reserve(String chosen, int version) {
    final slot = (vault, _anchorKey(chosen));
    return _reservations.putIfAbsent(slot, () async {
      try {
        final existing = await vault.read(slot.$2);
        check(version);
        if (existing != null) {
          if (!uuid.hasMatch(existing))
            throw const FormatException('Riepilogo salvato non valido.');
          return existing;
        }
        final next = api.newId();
        await vault.replace(slot.$2, next);
        return next;
      } finally {
        _reservations.remove(slot);
      }
    });
  }

  Future<void> open(String? selectedAnchor) async {
    if (busy) return;
    final version = epoch;
    busy = true;
    try {
      await access(version);
      final raw = await vault.read(key);
      check(version);
      final previous = raw == null ? null : jsonDecode(raw) as GroupRecord;
      if (previous != null &&
          (!uuid.hasMatch(previous['id'] as String) ||
              !uuid.hasMatch(previous['anchor'] as String)))
        throw const FormatException('Riepilogo salvato non valido.');
      final chosen = selectedAnchor ?? previous?['anchor'] as String?;
      if (chosen == null) throw const ApiError(404, 'NO_SAVED_RECAP');
      if (!uuid.hasMatch(chosen))
        throw const FormatException('Messaggio iniziale non valido.');
      final requestId = await _reserve(chosen, version);
      check(version);
      await vault.replace(key, jsonEncode({'id': requestId, 'anchor': chosen}));
      check(version);
      id = requestId;
      anchor = chosen;
      await _call(version, sharing: false);
    } catch (e) {
      if (e is ApiError &&
          e.code == 'READING_ADMISSION_CHANGED' &&
          current &&
          anchor != null) {
        final slot = _anchorKey(anchor!);
        if (await vault.read(slot) == id) await vault.replace(slot, null);
      }
      if (groupDenied(e)) {
        answer = null;
        canShare = false;
      }
      rethrow;
    } finally {
      busy = false;
    }
  }

  Future<void> share() async {
    if (busy || answer == null || answer?['sharedMessageId'] != null) return;
    final version = epoch;
    busy = true;
    try {
      await access(version);
      if (!canShare) throw const ApiError(403, 'CONTRIBUTION_REQUIRED');
      await _call(version, sharing: true);
    } catch (e) {
      if (groupDenied(e)) {
        answer = null;
        canShare = false;
      }
      rethrow;
    } finally {
      busy = false;
    }
  }

  Future<void> _call(int version, {required bool sharing}) async {
    final response = await api.post('$path/consultation', {
      'action': sharing ? 'share' : 'summarize',
      'id': id,
      'expectedActorId': actor,
      if (!sharing) ...{'kind': 'recap', 'anchorId': anchor},
    });
    check(version);
    if (response['id'] != id ||
        response['kind'] != 'recap' ||
        response['answer'] is! String ||
        response['references'] is! List ||
        response['personalIds'] is! List ||
        (sharing && response['sharedMessageId'] is! String))
      throw const FormatException('Riepilogo non riconosciuto.');
    answer = response;
  }

  Future<String> original(String source) async {
    final version = epoch;
    if (!groupRows(answer?['references']).any(
          (r) =>
              r['kind'] == 'source' && r['version'] == 1 && r['id'] == source,
        ) &&
        !groupIds(answer?['personalIds']).contains(source))
      throw const FormatException('Fonte non disponibile.');
    await access(version);
    return source;
  }
}

/// Pushing this screen from the first-unread action is the request to summarize.
/// Closing it simply pops. Selecting a citation returns its original message ID.
class WorkspaceRecapScreen extends StatefulWidget {
  WorkspaceRecapScreen({
    required this.api,
    required this.workspaceId,
    this.anchorId,
    this.vault = const DeviceDraftVault(),
    Key? key,
  }) : super(key: key ?? ValueKey((api, api.actorId, workspaceId, anchorId)));
  final RimiamApi api;
  final String workspaceId;
  final String? anchorId;
  final DraftVault vault;
  @override
  State<WorkspaceRecapScreen> createState() => _Screen();
}

class _Screen extends State<WorkspaceRecapScreen> with WidgetsBindingObserver {
  late final recap = WorkspaceRecap(
    widget.api,
    widget.vault,
    widget.workspaceId,
  );
  bool waiting = false, active = true;
  String? problem;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    run(() => recap.open(widget.anchorId));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    recap.hide();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      recap.hide();
      if (mounted)
        setState(() {
          active = false;
          waiting = false;
          problem = null;
        });
    } else if (state == AppLifecycleState.resumed && !active && mounted) {
      setState(() {
        active = true;
        problem = 'Riapri il riepilogo per continuare.';
      });
    }
  }

  Future<void> run(Future<void> Function() operation) async {
    if (waiting || !active) return;
    final epoch = recap.epoch;
    setState(() {
      waiting = true;
      problem = null;
    });
    try {
      await operation();
    } catch (e) {
      if (mounted && active && (epoch == recap.epoch || groupDenied(e))) {
        setState(
          () => problem = switch (e) {
            ApiError(code: 'NO_SAVED_RECAP') =>
              'Nessun riepilogo da riprendere.',
            ApiError(code: 'CONSULTATION_RUNNING') =>
              'Il riepilogo è in preparazione. Riprova tra poco.',
            ApiError(code: 'MESSAGE_NOT_FOUND') =>
              'Il messaggio iniziale non è disponibile.',
            _ => groupIssue(e),
          },
        );
      }
    } finally {
      if (mounted && active) setState(() => waiting = false);
    }
  }

  Future<void> source(String id) => run(() async {
    final message = await recap.original(id);
    if (mounted && active && recap.current) Navigator.pop(context, message);
  });
  @override
  Widget build(BuildContext context) {
    final result = active && recap.current ? recap.answer : null;
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Riepilogo personale'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (waiting && result == null) ...[
              const LinearProgressIndicator(),
              Text(uiText(context, 'Emme sta leggendo…')),
            ],
            if (problem != null) ...[
              Text(uiText(context, problem!)),
              if (active && recap.current)
                TextButton(
                  onPressed: waiting
                      ? null
                      : () => run(() => recap.open(widget.anchorId)),
                  child: Text(uiText(context, 'Riprova')),
                ),
            ],
            if (result != null) ...[
              Text(
                uiText(context, 'Solo tu'),
                style: Theme.of(context).textTheme.labelMedium,
              ),
              const SizedBox(height: 8),
              SelectableText(result['answer'] as String),
              MessageSources(
                entries: groupRows(result['references']),
                open: (r) {
                  if (r['kind'] == 'source' && r['version'] == 1)
                    source(r['id'] as String);
                },
              ),
              if (groupIds(result['personalIds']).isNotEmpty) ...[
                const Divider(),
                Text(
                  uiText(context, 'Ti riguarda'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                for (final (n, id) in groupIds(result['personalIds']).indexed)
                  TextButton(
                    onPressed: waiting ? null : () => source(id),
                    child: Text(
                      uiText(context, 'Vai al messaggio {0}', [n + 1]),
                    ),
                  ),
              ],
              const Divider(),
              if (result['sharedMessageId'] != null)
                Text(uiText(context, 'Condiviso nella chat dello spazio'))
              else if (recap.canShare)
                OutlinedButton.icon(
                  onPressed: waiting ? null : () => run(recap.share),
                  icon: const Icon(Icons.share_outlined),
                  label: Text(uiText(context, 'Condividi in chat')),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
