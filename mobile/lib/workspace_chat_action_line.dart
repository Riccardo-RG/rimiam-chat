import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'agenda_commands.dart' show agendaLocalZone;
import 'api.dart';
import 'chat_journal.dart';
import 'ui_language.dart';
import 'workspace_command_journal.dart';
import 'workspace_governance.dart' show groupDate, groupIssue;
import 'workspace_tasks.dart';

typedef _Row = Map<String, dynamic>;

/// Inline projections returned for this viewer by history and workspace sync.
/// A personal reminder destination is private even if its request is in a group.
class WorkspaceChatActionLine extends StatefulWidget {
  WorkspaceChatActionLine({
    Key? key,
    required this.api,
    required this.workspace,
    required this.messageId,
    required this.authorId,
    required this.canWrite,
    this.taskOffer,
    this.reminder,
    required this.refresh,
    this.vault = const DeviceDraftVault(),
    this.timeZone = agendaLocalZone,
  }) : super(key: key ?? ValueKey((api, api.actorId, workspace, messageId)));
  final RimiamApi api;
  final String workspace, messageId;
  final String? authorId;
  final bool canWrite;
  final _Row? taskOffer, reminder;
  final Future<void> Function() refresh;
  final DraftVault vault;
  final Future<String> Function() timeZone;

  @override
  State<WorkspaceChatActionLine> createState() => _ChatLineState();
}

class _ChatLineState extends State<WorkspaceChatActionLine>
    with WidgetsBindingObserver {
  late final actor = widget.api.actorId;
  late final journal = WorkspaceCommandJournal(
    widget.api,
    widget.vault,
    namespace: 'chat-action',
    collection: '${widget.workspace}:${widget.messageId}',
  );
  bool expanded = false, loaded = false, working = false, foreground = true;
  String? notice;
  Object? completed;
  bool get current => mounted && foreground && widget.api.actorId == actor;
  _Row? get reminder => widget.authorId == actor ? widget.reminder : null;
  Object get revision {
    final t = widget.taskOffer, r = reminder;
    return (
      t?['taskId'],
      t?['version'],
      t?['person'],
      t?['status'],
      r?['id'],
      r?['version'],
      r?['at'],
      r?['closed'],
      r?['destination'],
      r?['day'],
    );
  }

  bool get editable =>
      current && widget.canWrite && loaded && !working && completed != revision;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.hidden || s == AppLifecycleState.paused) {
      foreground = false;
    }
    if (s == AppLifecycleState.resumed) {
      foreground = true;
    }
  }

  Future<void> load() async {
    if (working || loaded || !current) return;
    setState(() {
      working = true;
      notice = null;
    });
    try {
      await journal.load();
      if (current) setState(() => loaded = true);
    } catch (_) {
      if (current)
        setState(
          () => notice =
              'Impossibile leggere l’operazione salvata sul dispositivo.',
        );
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  bool applies(String target, _Row command) {
    if (!current || !widget.canWrite) return false;
    final t = widget.taskOffer, r = reminder;
    switch (command['type']) {
      case 'task.accept':
      case 'task.decline':
        return target == widget.workspace &&
            t != null &&
            t['status'] == 'pending' &&
            t['person'] == actor &&
            t['taskId'] == command['taskId'] &&
            t['version'] == command['expectedVersion'];
      case 'reminder.set_time':
        return target == widget.workspace &&
            r != null &&
            r['id'] == null &&
            r['closed'] == false &&
            command['messageId'] == widget.messageId;
      case 'followup.occurrence':
        return r != null &&
            r['closed'] == false &&
            r['destination'] == target &&
            r['id'] == command['followupId'] &&
            r['at'] == command['scheduledAt'] &&
            r['version'] == command['expectedVersion'];
      default:
        return false;
    }
  }

  Future<void> send(String target, _Row command) async {
    if (working || !loaded || !applies(target, command)) return;
    final snapshot = revision;
    setState(() {
      working = true;
      notice = null;
    });
    try {
      await journal.send(
        target,
        command,
        allowed: () => applies(target, command),
      );
      if (!current) return;
      setState(() => completed = snapshot);
      await widget.refresh();
    } catch (e) {
      if (current)
        setState(
          () => notice = journal.pending == null
              ? groupIssue(e)
              : 'Invio da verificare.',
        );
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> verify() async {
    final request = journal.pending;
    if (request == null || working || !current) return;
    final target = request['space'] as String, cmd = request['command'] as _Row;
    if (applies(target, cmd)) {
      await send(target, cmd);
      return;
    }
    // Access, recipient, version or state may have changed. In that case, only
    // inspect the receipt. Never resend the original mutation.
    setState(() {
      working = true;
      notice = null;
    });
    try {
      final id = request['id'] as String;
      final receipt = await widget.api.get(
        '/api/v1/workspaces/${Uri.encodeComponent(target)}/receipts/${Uri.encodeComponent(id)}',
      );
      if (!current) return;
      if (receipt['commandId'] != id || receipt['status'] != 'committed')
        throw const FormatException();
      await journal.stopVerification();
      if (current) await widget.refresh();
    } on ApiError catch (e) {
      if (e.status == 404 && e.code == 'RECEIPT_NOT_FOUND' && current) {
        await journal.stopVerification();
        if (current)
          setState(
            () => notice =
                'Operazione non confermata. Riapri la versione corrente.',
          );
      } else if (current) {
        setState(() => notice = groupIssue(e));
      }
    } catch (e) {
      if (current) setState(() => notice = groupIssue(e));
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> editReminder(_Row r) async {
    if (!editable || journal.pending != null || r['closed'] == true) return;
    final snapshot = revision;
    final edited = await showDialog<_ReminderEdit>(
      context: context,
      builder: (_) => _ReminderDialog(r),
    );
    if (edited == null || !current) return;
    if (snapshot != revision || !widget.canWrite) {
      setState(() => notice = 'Il promemoria è cambiato. Riapri la conferma.');
      return;
    }
    final at = edited.at.toUtc().toIso8601String();
    if (r['id'] == null) {
      await send(widget.workspace, {
        'type': 'reminder.set_time',
        'messageId': widget.messageId,
        'remindAt': at,
      });
      return;
    }
    if (r['destination'] is! String ||
        r['version'] is! int ||
        r['at'] is! String) {
      setState(() => notice = 'Il promemoria è cambiato. Riapri la conferma.');
      return;
    }
    try {
      final zone = await widget.timeZone();
      if (!current || snapshot != revision) return;
      await send(r['destination'] as String, {
        'type': 'followup.occurrence',
        'action': edited.following ? 'replace_following' : 'replace',
        'followupId': r['id'],
        'expectedVersion': r['version'],
        'scheduledAt': r['at'],
        'replacement': {
          'content': edited.text,
          'remindAt': at,
          'timeZone': zone,
        },
      });
    } catch (_) {
      if (current)
        setState(() => notice = 'Controlla il fuso orario e riprova.');
    }
  }

  String offerStatus(_Row t) => switch (t['status']) {
    'accepted' =>
      t['acceptedBy'] == null
          ? uiText(context, 'Incarico accettato')
          : uiText(context, '{0} ha accettato', [t['acceptedBy']]),
    'declined' => uiText(context, '{0} ha rifiutato', [t['personName']]),
    'outdated' => uiText(context, 'Proposta superata'),
    _ => uiText(context, 'Proposta per {0}', [t['personName']]),
  };
  @override
  Widget build(BuildContext context) {
    final t = widget.taskOffer, r = reminder;
    if (t == null && r == null) return const SizedBox.shrink();
    final isTask = t != null;
    final title = isTask ? t['title'] as String : uiText(context, 'Promemoria');
    final description = isTask
        ? offerStatus(t)
        : [
            uiText(
              context,
              r!['audience'] == 'personal' ? 'Solo io' : 'Per tutti',
            ),
            if (r['at'] != null) groupDate(context, r['at']),
            if (r['closed'] == true) uiText(context, 'Chiuso'),
            if (r['id'] == null)
              uiText(
                context,
                r['day'] == null ? 'Per quale data e ora?' : 'A che ora?',
              ),
          ].join(' · ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton.icon(
          icon: Icon(
            isTask ? Icons.task_alt_outlined : Icons.alarm_outlined,
            size: 18,
          ),
          label: Text('$title · $description', textAlign: TextAlign.start),
          onPressed: () {
            setState(() => expanded = !expanded);
            if (expanded) unawaited(load());
          },
        ),
        if (expanded) ...[
          if (working) const LinearProgressIndicator(),
          if (notice != null)
            Semantics(liveRegion: true, child: Text(uiText(context, notice!))),
          if (!loaded && !working)
            TextButton(
              onPressed: load,
              child: Text(uiText(context, 'Riprova')),
            ),
          if (t != null) ...[
            if ((t['description'] as String).isNotEmpty)
              Text(t['description'] as String),
            if (t['due'] != null)
              Text(
                uiText(context, 'Scadenza · {0}', [
                  groupDate(context, t['due']),
                ]),
              ),
            if (t['person'] == actor &&
                t['status'] == 'pending' &&
                journal.pending == null &&
                widget.canWrite)
              Wrap(
                children: [
                  for (final yes in [true, false])
                    TextButton(
                      onPressed: editable
                          ? () => send(widget.workspace, {
                              'type': yes ? 'task.accept' : 'task.decline',
                              'taskId': t['taskId'],
                              'expectedVersion': t['version'],
                              'reason': yes
                                  ? 'Accettazione personale dalla conversazione'
                                  : 'Proposta rifiutata dalla conversazione',
                              if (yes) 'representSelf': true,
                            })
                          : null,
                      child: Text(uiText(context, yes ? 'Accetta' : 'Rifiuta')),
                    ),
                ],
              ),
            TextButton(
              onPressed: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => WorkspaceTasksPage(
                    api: widget.api,
                    workspace: widget.workspace,
                    canWrite: widget.canWrite,
                    initialTaskId: t['taskId'] as String,
                    vault: widget.vault,
                  ),
                ),
              ),
              child: Text(uiText(context, 'In programma')),
            ),
          ] else if (r != null) ...[
            Text(r['content'] as String),
            if (r['closed'] == false &&
                widget.canWrite &&
                journal.pending == null)
              TextButton(
                onPressed: editable ? () => editReminder(r) : null,
                child: Text(
                  uiText(
                    context,
                    r['id'] != null
                        ? 'Modifica promemoria'
                        : r['day'] != null
                        ? 'Imposta orario'
                        : 'Imposta data e ora',
                  ),
                ),
              ),
          ],
          if (journal.pending != null)
            TextButton(
              onPressed: working ? null : verify,
              child: Text(uiText(context, 'Verifica invio')),
            ),
          if (completed == revision && !working)
            TextButton(
              onPressed: widget.refresh,
              child: Text(uiText(context, 'Aggiorna')),
            ),
        ],
      ],
    );
  }
}

typedef _ReminderEdit = ({DateTime at, String text, bool following});

class _ReminderDialog extends StatefulWidget {
  const _ReminderDialog(this.row);
  final _Row row;
  @override
  State<_ReminderDialog> createState() => _ReminderDialogState();
}

class _ReminderDialogState extends State<_ReminderDialog> {
  late final r = widget.row;
  late final title = TextEditingController(text: r['content'] as String);
  late DateTime at = r['at'] != null
      ? DateTime.parse(r['at'] as String).toLocal()
      : r['day'] != null
      ? DateTime.parse("${r['day']}T12:00:00")
      : DateTime.now().add(const Duration(hours: 1));
  bool following = false, timeChosen = false, invalid = false;
  @override
  void dispose() {
    title.dispose();
    super.dispose();
  }

  Future<void> select({required bool date}) async {
    final original = at;
    if (date) {
      final d = await showDatePicker(
        context: context,
        initialDate: at,
        firstDate: DateTime(1900),
        lastDate: DateTime(2200),
      );
      if (d == null || !mounted) return;
      at = DateTime(d.year, d.month, d.day, at.hour, at.minute);
    } else {
      final t = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(at),
      );
      if (t == null || !mounted) return;
      final next = DateTime(at.year, at.month, at.day, t.hour, t.minute);
      if (next.hour != t.hour || next.minute != t.minute) {
        setState(() => invalid = true);
        return;
      }
      at = next;
      timeChosen = true;
    }
    setState(
      () => invalid =
          date && (at.hour != original.hour || at.minute != original.minute),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fmt = MaterialLocalizations.of(context);
    return AlertDialog(
      title: Text(
        uiText(
          context,
          r['id'] == null ? 'Imposta orario' : 'Modifica promemoria',
        ),
      ),
      scrollable: true,
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (r['id'] != null)
            TextField(
              controller: title,
              maxLength: 2000,
              decoration: InputDecoration(
                labelText: uiText(context, 'Cosa ricordare'),
              ),
              onChanged: (_) => setState(() {}),
            ),
          if (r['id'] == null && r['day'] != null)
            Text(fmt.formatFullDate(at))
          else
            TextButton.icon(
              icon: const Icon(Icons.event_outlined),
              onPressed: () => select(date: true),
              label: Text(fmt.formatMediumDate(at)),
            ),
          TextButton.icon(
            icon: const Icon(Icons.schedule),
            onPressed: () => select(date: false),
            label: Text(
              fmt.formatTimeOfDay(
                TimeOfDay.fromDateTime(at),
                alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(
                  context,
                ),
              ),
            ),
          ),
          if (r['id'] != null && r['recurring'] == true)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: following,
              onChanged: (v) => setState(() => following = v),
              title: Text(uiText(context, 'Anche le scadenze successive')),
            ),
          if (invalid)
            Text(
              uiText(
                context,
                'Scegli un orario valido nel fuso del dispositivo.',
              ),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(uiText(context, 'Annulla')),
        ),
        FilledButton(
          onPressed:
              invalid ||
                  title.text.trim().isEmpty ||
                  (!timeChosen && r['id'] == null)
              ? null
              : () => Navigator.pop(context, (
                  at: at,
                  text: title.text.trim(),
                  following: following,
                )),
          child: Text(uiText(context, 'Salva')),
        ),
      ],
    );
  }
}
