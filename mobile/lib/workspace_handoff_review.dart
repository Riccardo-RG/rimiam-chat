import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'agenda_commands.dart' show agendaLocalZone;
import 'api.dart';
import 'chat_journal.dart';
import 'library_collection.dart';
import 'library_document_editor.dart';
import 'ui_language.dart';
import 'workspace_direction.dart' show WorkspaceProposalEditor;
import 'workspace_governance.dart';
import 'workspace_task_editor.dart';

/// A handoff is a suggestion bound to immutable evidence. Loading or inspecting
/// it never sends a command; a human action accepts only the operation reviewed.
class HandoffReviewModel {
  HandoffReviewModel(
    RimiamApi api,
    DraftVault vault,
    String workspace, {
    required this.id,
    required this.source,
    required String kind,
  }) : group = GroupGovernance(
         api,
         workspace,
         direction: kind.startsWith('project.') || kind == 'goal.change',
         journalName: 'conversation-handoff.$id',
         vault: vault,
       );
  final GroupGovernance group;
  final String id, source;
  GroupRecord? handoff;
  int _read = 0;
  void hide() {
    _read++;
    handoff = null;
    group.suspend();
  }

  Future<void> load() async {
    _read++;
    final epoch = group.epoch;
    handoff = null;
    try {
      await group.load();
      group.check();
      if (group.snapshot['workspace']?['personal'] == true) {
        throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
      }
      if (epoch != group.epoch)
        throw const ApiError(403, 'AUTH_CONTEXT_CHANGED');
      await refresh();
    } catch (e) {
      if (groupDenied(e) && epoch == group.epoch) hide();
      rethrow;
    }
  }

  // Cheap refresh of the exact source. The API verifies membership on each
  // read. A revoked member must also lose access to an editor already open.
  Future<void> refresh() async {
    final call = ++_read;
    final epoch = group.epoch;
    group.check();
    final response = await group.api.get(
      '${group.path}/handoffs?sourceId=${Uri.encodeQueryComponent(source)}',
    );
    if (call != _read) return;
    group.check();
    if (epoch != group.epoch) throw const ApiError(403, 'AUTH_CONTEXT_CHANGED');
    final current = groupRows(response['handoffs'])
        .where((h) => h['id'] == id && h['sourceId'] == source)
        .firstOrNull;
    if (current == null) throw const ApiError(404, 'HANDOFF_NOT_FOUND');
    handoff = current;
  }

  Future<GroupRecord> apply(GroupRecord command) async {
    if (group.journal.pending != null)
      throw StateError('Verifica prima il salvataggio precedente.');
    await load();
    if (!group.canWrite) throw const ApiError(403, 'CONTRIBUTION_REQUIRED');
    if (handoff?['status'] != 'ready')
      throw const ApiError(409, 'HANDOFF_TARGET_STALE');
    return group.journal.send(group.workspaceId, {
      ...command,
      'conversationOrigin': {'handoffId': id},
    }, allowed: () => group.canWrite && handoff?['status'] == 'ready');
  }

  Future<void> verify() async {
    await load();
    final pending = group.journal.pending;
    if (pending == null) return;
    final cmd = pending['command'] as GroupRecord;
    if (pending['space'] != group.workspaceId ||
        cmd['conversationOrigin']?['handoffId'] != id)
      throw const FormatException('Conferma non riconosciuta.');
    if (handoff?['status'] == 'ready' && group.canWrite) {
      await group.journal.send(
        group.workspaceId,
        cmd,
        allowed: () => group.canWrite && handoff?['status'] == 'ready',
      );
      return;
    }
    // Once applied by anyone or no longer current, only a read is permitted.
    final requestId = pending['id'] as String;
    final receipt = await group.api.get(
      '${group.path}/receipts/${Uri.encodeComponent(requestId)}',
    );
    group.check();
    if (receipt['status'] != 'committed' || receipt['commandId'] != requestId)
      throw const FormatException('Conferma non riconosciuta.');
    await group.journal.stopVerification();
  }

  Future<({GroupRecord? task, List<GroupRecord> members})> taskData() async {
    final target = handoff?['target'];
    String? next;
    final visited = <String>{};
    do {
      final page = await group.api.get(
        '${group.path}/tasks${next == null ? '' : '?before=${Uri.encodeQueryComponent(next)}'}',
      );
      group.check();
      final item = groupRows(page['tasks'])
          .where((t) => t['id'] == target?['id'])
          .firstOrNull;
      if (target == null ||
          item != null && target['version'] == item['version'])
        return (task: item, members: groupRows(page['members']));
      if (item != null) break;
      next = page['next'] as String?;
    } while (next != null && visited.add(next));
    throw const ApiError(409, 'HANDOFF_TARGET_STALE');
  }
}

class WorkspaceHandoffReview extends StatefulWidget {
  WorkspaceHandoffReview({
    Key? key,
    required this.api,
    this.vault = const DeviceDraftVault(),
    required this.workspaceId,
    required this.workspaceName,
    required this.handoff,
  }) : super(
         key: key ?? ValueKey((api, api.actorId, workspaceId, handoff['id'])),
       );
  final RimiamApi api;
  final DraftVault vault;
  final String workspaceId, workspaceName;
  final GroupRecord handoff;
  @override
  State<WorkspaceHandoffReview> createState() => _Review();
}

class _Review extends State<WorkspaceHandoffReview>
    with WidgetsBindingObserver {
  late final m = HandoffReviewModel(
    widget.api,
    widget.vault,
    widget.workspaceId,
    id: widget.handoff['id'],
    source: widget.handoff['sourceId'],
    kind: widget.handoff['kind'],
  );
  bool busy = false, active = true, checking = false;
  Timer? refreshTimer;
  String? error;
  GroupGovernance get g => m.group;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    run(m.load);
    refreshTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => checkAccess(),
    );
  }

  Future<void> checkAccess() async {
    if (!mounted || !active || checking || m.handoff == null) return;
    final epoch = g.epoch;
    checking = true;
    try {
      await m.refresh();
      if (mounted && active && g.epoch == epoch) setState(() {});
    } catch (e) {
      if (mounted &&
          active &&
          g.epoch == epoch &&
          (groupDenied(e) || e is ApiError && e.status == 404)) {
        m.hide();
        final route = ModalRoute.of(context);
        if (route != null && !route.isCurrent)
          Navigator.popUntil(context, (r) => r == route);
        setState(() => error = groupIssue(e));
      }
    } finally {
      checking = false;
    }
  }

  @override
  void dispose() {
    refreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    m.hide();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if ((s == AppLifecycleState.paused || s == AppLifecycleState.hidden) &&
        active) {
      m.hide();
      setState(() {
        active = false;
        busy = false;
        error = null;
      });
      if (ModalRoute.of(context)?.isCurrent == false)
        Navigator.popUntil(context, (r) => r == ModalRoute.of(context));
    } else if (s == AppLifecycleState.resumed && !active) {
      setState(() => active = true);
      run(m.load);
    }
  }

  Future<void> run(Future<void> Function() f) async {
    if (busy || !active) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await f();
    } catch (e) {
      if (mounted && active) {
        if (groupDenied(e)) m.hide();
        setState(() => error = groupIssue(e));
      }
    } finally {
      if (mounted && active) setState(() => busy = false);
    }
  }

  bool get visible =>
      mounted && active && g.admitted && g.actor == widget.api.actorId;
  Future<void> save(GroupRecord command) async {
    await m.apply(command);
    if (visible) await m.load();
  }

  Future<void> go(GroupRecord ref) async {
    // An account or membership may have changed while this panel remained open.
    await m.load();
    if (visible) Navigator.pop(context, ref);
  }

  Future<void> goal(GroupRecord h) async {
    final value = await groupText(
      context,
      title: uiText(context, 'Obiettivo dello spazio'),
      label: uiText(context, 'Testo dell’obiettivo condiviso'),
      action: uiText(context, 'Salva obiettivo'),
      initial: h['suggestedText'],
    );
    if (value == null || !visible) return;
    final target = h['target'];
    await save({
      'type': target == null ? 'goal.establish' : 'goal.editShared',
      'content': value,
      if (target != null) ...{
        'goalId': target['id'],
        'expectedVersion': target['version'],
      },
    });
  }

  Future<void> project(GroupRecord h) async {
    final k = h['kind'], target = h['target'];
    final previous = groupRows(g.project['acts'])
        .where(
          (a) =>
              a['proposalId'] == target?['id'] &&
              a['actId'] != null &&
              a['status'] == 'effective',
        )
        .firstOrNull;
    final evolve = k == 'goal.change'
        ? groupRows(g.project['goals'])
              .where(
                (v) =>
                    v['id'] == target?['id'] &&
                    v['version'] == target?['version'] &&
                    v['status'] == 'active',
              )
              .firstOrNull
        : null;
    if (k == 'goal.change' && evolve == null ||
        (k == 'project.replace' || k == 'project.revoke') && previous == null)
      throw const ApiError(409, 'HANDOFF_TARGET_STALE');
    final cmd = await Navigator.push<GroupRecord>(
      context,
      MaterialPageRoute(
        builder: (_) => WorkspaceProposalEditor(
          group: g,
          previous: previous,
          operation: k == 'project.replace'
              ? 'replace'
              : k == 'project.revoke'
              ? 'revoke'
              : 'establish',
          evolve: evolve,
          initialContent: h['suggestedText'],
          initialReason: h['summary'],
        ),
      ),
    );
    if (cmd != null && visible) await save(cmd);
  }

  Future<void> information(GroupRecord h, GroupRecord candidate) async {
    if (candidate['classification'] != 'descriptive' ||
        candidate['context_revision'] !=
            g.snapshot['workspace']?['context_revision'])
      throw const ApiError(409, 'HANDOFF_TARGET_STALE');
    final correcting = h['kind'] == 'information.correct', target = h['target'];
    String? reason;
    if (correcting) {
      final base = groupRows(g.snapshot['information'])
          .where(
            (i) =>
                i['id'] == target?['id'] &&
                i['current_version'] == target?['version'],
          )
          .firstOrNull;
      if (base == null) throw const ApiError(409, 'HANDOFF_TARGET_STALE');
      reason = await groupText(
        context,
        title: uiText(context, 'Correggi riferimento'),
        label: uiText(context, 'Motivo della correzione'),
        action: uiText(context, 'Conferma correzione'),
        detail: uiText(context, 'Versione {0}\n{1}\n\nNuovo testo\n{2}', [
          base['current_version'],
          base['content'],
          candidate['content'],
        ]),
      );
      if (reason == null) return;
    } else if (!await groupConfirm(
      context,
      uiText(context, 'Accettare il riferimento?'),
      candidate['content'],
      uiText(context, 'Accetta'),
    )) {
      return;
    }
    if (visible)
      await save({
        'type': correcting ? 'information.correct' : 'information.accept',
        'candidateId': candidate['id'],
        'descriptiveOnly': true,
        if (correcting) ...{
          'informationId': target['id'],
          'expectedVersion': target['version'],
          'reason': reason,
        },
      });
  }

  Future<void> task(GroupRecord h, GroupRecord? candidate) async {
    final data = await m.taskData();
    if (!visible) return;
    final cmd = await Navigator.push<GroupRecord>(
      context,
      MaterialPageRoute(
        builder: (ctx) => Scaffold(
          appBar: AppBar(title: Text(uiText(ctx, 'Attività'))),
          body: SafeArea(
            child: WorkspaceTaskEditor(
              task: data.task,
              candidate:
                  candidate ??
                  (h['candidateId'] == null ? null : {'id': h['candidateId']}),
              members: data.members,
              suggestedText: h['suggestedText'],
              initialReason: h['summary'],
              sourceMessage: h['sourceMessageId'],
              timeZone: agendaLocalZone,
              busy: false,
              close: () => Navigator.pop(ctx),
              submit: (cmd) async {
                Navigator.pop(ctx, cmd);
                return false;
              },
            ),
          ),
        ),
      ),
    );
    if (cmd != null && visible) await save(cmd);
  }

  Future<void> document(GroupRecord h) async {
    final library = LibraryCollection(
      widget.api,
      widget.vault,
      workspace: widget.workspaceId,
    );
    await library.load();
    if (!visible || !library.canWrite) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => LibraryDocumentEditor(
          library: library,
          initialTitle: (h['summary'] as String).characters
              .take(160)
              .toString(),
          initialPurpose: h['summary'],
          initialText: h['suggestedText'],
          sourceIds: groupIds(h['sourceIds']),
          send: (cmd) async {
            try {
              return await m.apply(cmd);
            } catch (_) {
              if (g.journal.pending != null &&
                  visible &&
                  ModalRoute.of(context)?.isCurrent == false)
                Navigator.pop(context);
              rethrow;
            }
          },
        ),
      ),
    );
    if (visible) await m.load();
  }

  Widget action(
    String label,
    Future<void> Function() fn, {
    bool primary = false,
  }) {
    final child = Text(uiText(context, label));
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: primary
          ? FilledButton(onPressed: busy ? null : () => run(fn), child: child)
          : TextButton(onPressed: busy ? null : () => run(fn), child: child),
    );
  }

  @override
  Widget build(BuildContext context) {
    final h = visible ? m.handoff : null,
        kind = h?['kind'],
        status = h?['status'],
        target = h?['target'] as GroupRecord?,
        application = h?['application'];
    final candidate = groupRows(g.snapshot['candidates'])
        .where((c) => c['id'] == h?['candidateId'])
        .firstOrNull;
    final ref = application?['resultReference'] as GroupRecord?,
        prepared = application?['prepared'];
    final ready =
        h != null &&
        status == 'ready' &&
        g.canWrite &&
        g.journal.pending == null;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          uiText(context, switch (status) {
            'applied' => 'Passaggio registrato',
            'stale' => 'Suggerimento superato',
            _ => 'Suggerimento di Emme',
          }),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (busy && h == null) const LinearProgressIndicator(),
            if (error != null) ...[
              Text(uiText(context, error!)),
              action('Ricarica', m.load),
            ],
            if (h != null) ...[
              Text(h['summary'], style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              SelectableText(h['suggestedText']),
              action(
                'Vai al messaggio',
                () => go({
                  'kind': 'source',
                  'id': h['sourceMessageId'],
                  'version': 1,
                }),
              ),
              for (final (n, id) in groupIds(h['sourceIds']).indexed)
                TextButton.icon(
                  onPressed: busy
                      ? null
                      : () => run(
                          () => go({'kind': 'source', 'id': id, 'version': 1}),
                        ),
                  icon: const Icon(Icons.link),
                  label: Text(uiText(context, 'Fonte {0}', [n + 1])),
                ),
              if (target != null) action('Apri riferimento', () => go(target)),
              if (status == 'stale')
                Text(
                  uiText(
                    context,
                    'Il riferimento è cambiato. Rivedi la versione prima di prendere una decisione.',
                  ),
                ),
              if (status == 'applied') ...[
                Text(
                  uiText(context, 'Registrato da {0}', [
                    g.name(application['actor']),
                  ]),
                ),
                if (ref != null) action('Apri risultato', () => go(ref)),
                if (prepared != null)
                  action(
                    'Esamina la proposta registrata',
                    () => go({
                      'destination':
                          prepared['kind'] == 'task_revision_proposal'
                          ? 'tasks'
                          : 'direction',
                      'preparedId': prepared['id'],
                      if (prepared['kind'] == 'task_revision_proposal')
                        'taskId': h['target']?['id'],
                    }),
                  ),
              ],
              if (status == 'navigation')
                action(
                  kind == 'email.prepare'
                      ? 'Apri Posta privata'
                      : 'Apri Calendario',
                  () => go({
                    'destination': kind == 'email.prepare'
                        ? 'email'
                        : 'calendar',
                  }),
                ),
              if (g.journal.pending != null) ...[
                action('Verifica salvataggio', () async {
                  await m.verify();
                  await m.load();
                }),
                action('Interrompi verifica', () async {
                  if (await groupConfirm(
                        context,
                        uiText(context, 'Interrompi verifica'),
                        uiText(
                          context,
                          'Il comando potrebbe essere già stato registrato.',
                        ),
                        uiText(context, 'Interrompi verifica'),
                      ) &&
                      visible)
                    await g.journal.stopVerification();
                }),
              ],
              if (ready) ...[
                if (kind == 'goal.establish' || kind == 'goal.change')
                  action(
                    'Salva obiettivo dello spazio',
                    () => goal(h),
                    primary: true,
                  ),
                if (kind == 'goal.change' || kind.startsWith('project.'))
                  action(
                    kind == 'goal.change'
                        ? 'Prepara invece una proposta sul ciclo di vita'
                        : 'Esamina proposta',
                    () => project(h),
                    primary: kind != 'goal.change',
                  ),
                if (kind == 'information.accept' ||
                    kind == 'information.correct')
                  if (candidate == null)
                    Text(
                      uiText(
                        context,
                        'La proposta associata non è più disponibile.',
                      ),
                    )
                  else ...[
                    SelectableText(candidate['content']),
                    action(
                      'Fonte della proposta',
                      () => go({
                        'kind': 'source',
                        'id': candidate['source_id'],
                        'version': 1,
                      }),
                    ),
                    action(
                      kind == 'information.accept'
                          ? 'Accetta riferimento'
                          : 'Correggi riferimento',
                      () => information(h, candidate),
                      primary: true,
                    ),
                  ],
                if (kind == 'artifact.prepare')
                  action('Prepara documento', () => document(h), primary: true),
                if (kind == 'task.create' || kind == 'task.change')
                  action(
                    kind == 'task.create'
                        ? 'Crea attività'
                        : 'Modifica attività',
                    () => task(h, candidate),
                    primary: true,
                  ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
