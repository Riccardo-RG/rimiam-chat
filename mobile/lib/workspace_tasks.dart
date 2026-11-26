import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'agenda_commands.dart' show agendaLocalZone;
import 'api.dart';
import 'chat_journal.dart';
import 'workspace_command_journal.dart';
import 'workspace_task_comments.dart';
import 'workspace_task_editor.dart';

const _states = {
  'open': 'Aperta',
  'in_progress': 'In corso',
  'standby': 'In pausa',
  'completed': 'Completata',
  'cancelled': 'Annullata',
};
bool _closed(TaskRow t) => {'completed', 'cancelled'}.contains(t['status']);
bool _offered(TaskRow t) =>
    !_closed(t) &&
    t['suggestedPerson'] != null &&
    t['responsible'] == null &&
    t['declinedBy'] == null;
int _order(TaskRow a, TaskRow b, String actor) {
  int section(TaskRow t) => _offered(t) && t['suggestedPerson'] == actor
      ? 0
      : _closed(t)
      ? 2
      : 1;
  final group = section(a).compareTo(section(b));
  if (group != 0) return group;
  final left = DateTime.tryParse(a['dueAt'] as String? ?? ''),
      right = DateTime.tryParse(b['dueAt'] as String? ?? '');
  if (left != null && right == null) return -1;
  if (right != null && left == null) return 1;
  final diff = left?.compareTo(right!) ?? 0;
  return diff != 0
      ? diff
      : (b['createdAt'] as String).compareTo(a['createdAt'] as String);
}

String _time(BuildContext context, String raw) {
  final d = DateTime.parse(raw).toLocal(),
      l = MaterialLocalizations.of(context);
  return '${l.formatCompactDate(d)} · ${l.formatTimeOfDay(TimeOfDay.fromDateTime(d), alwaysUse24HourFormat: true)}';
}

List<TaskRow> _rows(Map<String, dynamic> r, String key) =>
    (r[key] as List).cast<TaskRow>();

class WorkspaceTasksPage extends StatefulWidget {
  WorkspaceTasksPage({
    Key? key,
    required this.api,
    required this.workspace,
    required this.canWrite,
    this.createOnOpen = false,
    this.initialTaskId,
    this.proposalId,
    this.vault = const DeviceDraftVault(),
    this.timeZone = agendaLocalZone,
  }) : super(key: key ?? ValueKey((api, api.actorId, workspace)));
  final RimiamApi api;
  final String workspace;
  final bool canWrite, createOnOpen;
  final String? initialTaskId;
  final String? proposalId;
  final DraftVault vault;
  final Future<String> Function() timeZone;
  @override
  State<WorkspaceTasksPage> createState() => _WorkspaceTasksState();
}

class _WorkspaceTasksState extends State<WorkspaceTasksPage>
    with WidgetsBindingObserver {
  late final actor = widget.api.actorId,
      journal = WorkspaceCommandJournal(
        widget.api,
        widget.vault,
        namespace: 'tasks',
        collection: widget.workspace,
      );
  String get base =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspace)}';
  List<TaskRow> tasks = [], members = [], ideas = [], proposals = [], due = [];
  String? next, issue, selectedId;
  TaskRow? editing, candidate;
  int epoch = 0, limit = 3, verifiedComment = 0;
  String? verifiedCommentTask;
  late final Timer poll;
  bool paged = false, openedFromCommand = false;
  bool loaded = false,
      saving = false,
      loading = false,
      mine = false,
      moreDue = false,
      editor = false,
      active = true;
  bool get current => mounted && active && actor == widget.api.actorId;
  bool get writable =>
      current &&
      loaded &&
      widget.canWrite &&
      !saving &&
      journal.pending == null;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    poll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (current &&
          loaded &&
          !paged &&
          !editor &&
          !saving &&
          !loading &&
          journal.pending == null &&
          ModalRoute.of(context)?.isCurrent != false) {
        unawaited(load(focus: selectedId, quiet: true));
      }
    });
    unawaited(
      load(
        restore: true,
        focus: widget.initialTaskId,
        selectFocus: widget.initialTaskId != null,
      ),
    );
  }

  @override
  void dispose() {
    poll.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
      ++epoch;
      setState(() {
        active = false;
        loaded = false;
      });
    } else if (s == AppLifecycleState.resumed) {
      setState(() => active = true);
      unawaited(
        load(
          restore: true,
          focus: selectedId ?? widget.initialTaskId,
          selectFocus: widget.initialTaskId != null,
        ),
      );
    }
  }

  Future<void> load({
    bool append = false,
    bool restore = false,
    bool selectFocus = false,
    bool quiet = false,
    String? focus,
  }) async {
    final generation = ++epoch;
    final cursor = append ? next : null;
    final query = focus != null
        ? '?focus=${Uri.encodeQueryComponent(focus)}'
        : cursor != null
        ? '?before=${Uri.encodeQueryComponent(cursor)}'
        : '';
    if (quiet) {
      loading = true;
    } else {
      setState(() => loading = true);
    }
    try {
      final result = await Future.wait([
        widget.api.get('$base/tasks$query'),
        widget.api.get('$base/schedule?mine=$mine&limit=$limit'),
      ]);
      if (!current || generation != epoch) return;
      if (restore && !journal.busy) await journal.load();
      if (!current || generation != epoch) return;
      final page = result[0], upcoming = result[1];
      setState(() {
        final fresh = _rows(page, 'tasks');
        final byId = {
          if (append || focus != null)
            for (final t in tasks) t['id']: t,
          for (final t in fresh) t['id']: t,
        };
        if (focus != null && fresh.isEmpty) byId.remove(focus);
        tasks = byId.values.toList()..sort((a, b) => _order(a, b, actor));
        if (focus == null) {
          next = page['next'];
          paged = append;
        }
        members = _rows(page, 'members');
        ideas = _rows(page, 'suggestions');
        final vids = fresh.map((t) => t['id']).toSet();
        proposals = [
          if (append || focus != null)
            ...proposals.where(
              (p) => !vids.contains(p['taskId']) && p['taskId'] != focus,
            ),
          ..._rows(page, 'proposals'),
        ];
        due = _rows(upcoming, 'entries');
        moreDue = upcoming['more'] == true;
        if (selectFocus)
          selectedId = fresh.any((t) => t['id'] == focus) ? focus : null;
        if (selectedId != null && tasks.every((t) => t['id'] != selectedId))
          selectedId = null;
        loaded = true;
        issue = selectFocus && focus != null && selectedId == null
            ? 'Questa attività non è più disponibile.'
            : null;
      });
      if (widget.createOnOpen && !openedFromCommand) {
        openedFromCommand = true;
        if (writable &&
            !editor &&
            selectedId == null &&
            journal.draft == null) {
          edit();
        } else {
          setState(
            () => issue = widget.canWrite
                ? 'Riprendi l’operazione precedente prima di creare una nuova attività.'
                : 'Puoi consultare le attività di questo spazio.',
          );
        }
      }
    } catch (e) {
      if (current && generation == epoch)
        setState(() {
          issue = 'Impossibile aggiornare le attività.';
          if (e is ApiError && {401, 403, 404}.contains(e.status)) {
            loaded = false;
            tasks = [];
            due = [];
            members = [];
            ideas = [];
            proposals = [];
            editor = false;
            editing = null;
            candidate = null;
            selectedId = null;
            next = null;
          }
        });
    } finally {
      if (mounted && generation == epoch) setState(() => loading = false);
    }
  }

  Future<bool> send(TaskRow cmd) async {
    if (!current || !loaded || saving || !widget.canWrite) return false;
    setState(() {
      saving = true;
      issue = null;
    });
    final recoveringComment =
        journal.pending != null && cmd['type'] == 'task.comment';
    try {
      await journal.send(
        widget.workspace,
        cmd,
        allowed: () => current && loaded && widget.canWrite,
      );
      if (current) {
        if (recoveringComment) {
          verifiedComment++;
          verifiedCommentTask = cmd['taskId'] as String;
        }
        await load(focus: cmd['taskId'] as String?);
      }
      return true;
    } catch (e) {
      if (current) {
        if (journal.pending == null && e is ApiError)
          await load(focus: selectedId);
        if (current)
          setState(
            () => issue = journal.pending != null
                ? 'Il salvataggio è da verificare.'
                : e is ApiError && e.status == 409
                ? 'L’attività è cambiata. Riaprila per usare la versione aggiornata.'
                : 'Impossibile salvare la modifica.',
          );
      }
      return false;
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  String name(Object? id) =>
      members.where((m) => m['id'] == id).firstOrNull?['name'] as String? ??
      'Membro non disponibile';
  String assignment(TaskRow t) {
    if (t['responsible'] != null)
      return t['responsibleAvailable'] != true
          ? '${name(t['responsible'])} · accesso cessato'
          : t['responsible'] == actor
          ? 'Te ne occupi tu'
          : name(t['responsible']);
    if (t['declinedBy'] != null) return 'Proposta rifiutata';
    if (_offered(t))
      return t['suggestedPerson'] == actor
          ? 'In attesa di te'
          : 'In attesa di ${name(t['suggestedPerson'])}';
    return 'Non assegnata';
  }

  void edit({TaskRow? task, TaskRow? idea}) {
    if (writable)
      setState(() {
        editing = task;
        candidate = idea;
        editor = true;
        issue = null;
      });
  }

  void closeEditor() {
    if (mounted)
      setState(() {
        editing = null;
        candidate = null;
        editor = false;
      });
  }

  Future<bool> confirm(String body, String label) async =>
      (await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          content: Text(body),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: Text(uiText(c, 'Annulla')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: Text(label),
            ),
          ],
        ),
      )) ??
      false;
  Widget controls(TaskRow t) {
    final closed = _closed(t),
        assigned = t['responsible'] != null,
        self = assigned && t['responsible'] == actor,
        manages = !assigned || self && t['responsibleAvailable'] == true;
    TaskRow command(String type, String reason) => {
      'type': type,
      'taskId': t['id'],
      'expectedVersion': t['version'],
      'reason': reason,
    };
    Widget button(String label, VoidCallback action) =>
        TextButton(onPressed: writable ? action : null, child: Text(label));
    final focused = widget.initialTaskId == t['id'] ? widget.proposalId : null;
    final changes = proposals.where(
      (p) =>
          p['taskId'] == t['id'] &&
          p['baseVersion'] == t['version'] &&
          (focused == null || p['id'] == focused),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if ((t['description'] as String).isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(t['description'] as String),
          ),
        if (widget.canWrite)
          Wrap(
            children: [
              if (!closed &&
                  !assigned &&
                  (t['suggestedPerson'] == null ||
                      _offered(t) && t['suggestedPerson'] == actor))
                button(
                  t['suggestedPerson'] == null
                      ? uiText(context, 'Me ne occupo')
                      : uiText(context, 'Accetta incarico'),
                  () => send({
                    ...command(
                      'task.accept',
                      'Accettazione personale della responsabilità',
                    ),
                    'representSelf': true,
                  }),
                ),
              if (_offered(t) && t['suggestedPerson'] == actor)
                button(
                  uiText(context, 'Rifiuta incarico'),
                  () => send(
                    command(
                      'task.decline',
                      'Proposta rifiutata dalla persona indicata',
                    ),
                  ),
                ),
              if (!closed)
                button(
                  assigned
                      ? uiText(context, 'Proponi una modifica')
                      : uiText(context, 'Modifica o assegna'),
                  () => edit(task: t),
                ),
              if (!closed && self)
                button(uiText(context, 'Lascia incarico'), () async {
                  if (await confirm(
                        uiText(
                          context,
                          'Vuoi lasciare questo incarico? L’attività resterà nello spazio.',
                        ),
                        uiText(context, 'Lascia incarico'),
                      ) &&
                      current)
                    await send({
                      ...command(
                        'task.relinquish',
                        'Rinuncia personale alla responsabilità',
                      ),
                      'representSelf': true,
                    });
                }),
              if (manages)
                for (final s
                    in closed
                        ? ['open']
                        : ['in_progress', 'standby', 'completed'])
                  if (s != t['status'])
                    button(
                      s == 'open'
                          ? uiText(context, 'Riapri attività')
                          : s == 'standby'
                          ? uiText(context, 'Metti in pausa')
                          : s == 'completed'
                          ? uiText(context, 'Completa')
                          : uiText(context, 'Avvia'),
                      () => send({
                        ...command(
                          'task.status',
                          'Aggiornamento operativo dell’attività',
                        ),
                        'status': s,
                        'noNormativeEffect': true,
                      }),
                    ),
            ],
          ),
        if (focused != null && (closed || changes.isEmpty))
          Text(uiText(context, 'Questa proposta non è più aperta.')),
        if (changes.isNotEmpty && !closed)
          ExpansionTile(
            initiallyExpanded: focused != null,
            title: Text(
              uiText(context, 'Modifiche proposte · {0}', [changes.length]),
            ),
            children: [
              for (final p in changes)
                ListTile(
                  title: Text(p['content']['title'] as String),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${name(p['actor'])} · ${p['reason']}'),
                      if ((p['content']['description'] as String).isNotEmpty)
                        Text(p['content']['description'] as String),
                      if (p['content']['dueAt'] != null)
                        Text(_time(context, p['content']['dueAt'])),
                      if (p['content']['suggestedPerson'] != null)
                        Text(
                          uiText(context, 'Persona proposta · {0}', [
                            name(p['content']['suggestedPerson']),
                          ]),
                        ),
                      if (widget.canWrite && self && manages)
                        button(uiText(context, 'Accetta modifica'), () async {
                          if (await confirm(
                                uiText(
                                  context,
                                  'Accetti la responsabilità della versione proposta?',
                                ),
                                uiText(context, 'Accetta modifica'),
                              ) &&
                              current)
                            await send({
                              ...command(
                                'task.adopt_revision',
                                'Accettazione personale della revisione proposta',
                              ),
                              'proposalId': p['id'],
                              'acceptResponsibility': true,
                            });
                        }),
                    ],
                  ),
                ),
            ],
          ),
        WorkspaceTaskComments(
          key: ValueKey((
            t['id'],
            verifiedCommentTask == t['id'] ? verifiedComment : 0,
          )),
          api: widget.api,
          workspace: widget.workspace,
          task: t,
          canWrite: widget.canWrite && !saving && journal.pending == null,
          submit: send,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final selected = tasks.where((t) => t['id'] == selectedId).firstOrNull;
    final subpage = loaded && (editor || selected != null);
    final deepSelection =
        !editor && selected != null && selectedId == widget.initialTaskId;
    void back() {
      if (editor) {
        closeEditor();
      } else if (deepSelection) {
        Navigator.maybePop(context);
      } else if (selected != null) {
        setState(() => selectedId = null);
      } else {
        Navigator.maybePop(context);
      }
    }

    final visible = tasks.where(
      (t) =>
          !mine ||
          t['responsible'] == actor ||
          _offered(t) && t['suggestedPerson'] == actor,
    );
    return PopScope(
      canPop: !subpage || deepSelection,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && subpage) back();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: subpage ? BackButton(onPressed: back) : null,
          title: Text(
            editor
                ? uiText(context, 'Dettagli attività')
                : selected != null
                ? uiText(context, 'Attività')
                : uiText(context, 'In programma'),
          ),
          actions: [
            IconButton(
              tooltip: uiText(context, 'Aggiorna attività'),
              onPressed: current && !saving
                  ? () => load(
                      focus: selectedId ?? widget.initialTaskId,
                      selectFocus:
                          selectedId != null || widget.initialTaskId != null,
                    )
                  : null,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: !current
              ? const SizedBox.shrink()
              : Column(
                  children: [
                    if (loading || saving) const LinearProgressIndicator(),
                    if (issue != null)
                      ListTile(
                        title: Text(uiText(context, issue!)),
                        trailing: TextButton(
                          onPressed: saving
                              ? null
                              : () => load(restore: !loaded),
                          child: Text(uiText(context, 'Aggiorna')),
                        ),
                      ),
                    if (loaded && journal.pending != null)
                      ListTile(
                        title: Text(
                          uiText(context, 'Salvataggio da verificare'),
                        ),
                        subtitle: Wrap(
                          children: [
                            TextButton(
                              onPressed: saving || !widget.canWrite
                                  ? null
                                  : () async {
                                      final c =
                                          journal.pending!['command']
                                              as TaskRow;
                                      if (await send(c) && mounted)
                                        closeEditor();
                                    },
                              child: Text(
                                uiText(context, 'Verifica e riprova'),
                              ),
                            ),
                            TextButton(
                              onPressed: saving
                                  ? null
                                  : () async {
                                      if (await confirm(
                                            uiText(
                                              context,
                                              'La modifica potrebbe essere già stata salvata. Interrompere la verifica su questo dispositivo?',
                                            ),
                                            uiText(
                                              context,
                                              'Interrompi verifica',
                                            ),
                                          ) &&
                                          current) {
                                        try {
                                          await journal.stopVerification();
                                          if (current) {
                                            closeEditor();
                                            await load();
                                          }
                                        } catch (_) {
                                          if (current)
                                            setState(
                                              () => issue = 'Impossibile interrompere la verifica.',
                                            );
                                        }
                                      }
                                    },
                              child: Text(
                                uiText(context, 'Interrompi verifica'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    if (loaded && editor)
                      Expanded(
                        child: WorkspaceTaskEditor(
                          key: ValueKey((editing?['id'], candidate?['id'])),
                          task: editing,
                          candidate: candidate,
                          members: members,
                          timeZone: widget.timeZone,
                          submit: send,
                          close: closeEditor,
                          busy:
                              saving ||
                              !widget.canWrite ||
                              journal.pending != null,
                        ),
                      )
                    else if (loaded && selected != null)
                      Expanded(
                        child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            Text(
                              selected['title'] as String,
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            Text(
                              [
                                _states[selected['status']],
                                assignment(selected),
                                if (selected['dueAt'] != null)
                                  _time(context, selected['dueAt']),
                              ].join(' · '),
                            ),
                            controls(selected),
                          ],
                        ),
                      )
                    else if (loaded)
                      Expanded(
                        child: ListView(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                          children: [
                            Wrap(
                              spacing: 8,
                              children: [
                                FilterChip(
                                  label: Text(uiText(context, 'Solo mie')),
                                  selected: mine,
                                  onSelected: (v) {
                                    setState(() => mine = v);
                                    load();
                                  },
                                ),
                                if (widget.canWrite)
                                  FilledButton.icon(
                                    onPressed: writable ? () => edit() : null,
                                    icon: const Icon(Icons.add),
                                    label: Text(
                                      uiText(context, 'Nuova attività'),
                                    ),
                                  ),
                              ],
                            ),
                            ListTile(
                              title: Text(uiText(context, 'Prossime scadenze')),
                            ),
                            if (due.isEmpty)
                              Text(
                                uiText(
                                  context,
                                  'Nessuna scadenza in programma.',
                                ),
                              ),
                            for (final d in due)
                              ListTile(
                                leading: Icon(
                                  d['kind'] == 'task'
                                      ? Icons.checklist
                                      : Icons.notifications_none,
                                ),
                                title: Text(d['title'] as String),
                                subtitle: d['at'] == null
                                    ? null
                                    : Text(_time(context, d['at'] as String)),
                                onTap: d['kind'] == 'task'
                                    ? () => load(
                                        focus: d['id'] as String,
                                        selectFocus: true,
                                      )
                                    : null,
                              ),
                            if (moreDue && limit < 500)
                              TextButton(
                                onPressed: () {
                                  setState(
                                    () => limit = (limit + 10).clamp(1, 500),
                                  );
                                  load();
                                },
                                child: Text(uiText(context, 'Altre scadenze')),
                              ),
                            const Divider(),
                            ListTile(title: Text(uiText(context, 'Attività'))),
                            if (visible.isEmpty)
                              Text(
                                mine
                                    ? uiText(
                                        context,
                                        'Nessuna attività per te.',
                                      )
                                    : uiText(
                                        context,
                                        'Ancora nessuna attività.',
                                      ),
                              ),
                            for (final t in visible)
                              ListTile(
                                leading: Icon(
                                  _closed(t)
                                      ? Icons.check_circle_outline
                                      : Icons.radio_button_unchecked,
                                ),
                                title: Text(t['title'] as String),
                                subtitle: Text(
                                  [
                                    _states[t['status']] ?? t['status'],
                                    assignment(t),
                                    if (t['dueAt'] != null)
                                      _time(context, t['dueAt'] as String),
                                  ].join(' · '),
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => setState(
                                  () => selectedId = t['id'] as String,
                                ),
                              ),
                            if (next != null)
                              TextButton(
                                onPressed: loading
                                    ? null
                                    : () => load(append: true),
                                child: Text(
                                  uiText(context, 'Carica altre attività'),
                                ),
                              ),
                            if (ideas.isNotEmpty)
                              ExpansionTile(
                                title: Text(
                                  uiText(context, 'Suggerimenti · {0}', [
                                    ideas.length,
                                  ]),
                                ),
                                children: [
                                  for (final c in ideas)
                                    ListTile(
                                      title: Text(c['subject'] as String),
                                      subtitle: Text(
                                        c['content'] as String,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      trailing: widget.canWrite
                                          ? TextButton(
                                              onPressed: writable
                                                  ? () => edit(idea: c)
                                                  : null,
                                              child: Text(
                                                uiText(
                                                  context,
                                                  'Prepara attività',
                                                ),
                                              ),
                                            )
                                          : null,
                                    ),
                                ],
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}
