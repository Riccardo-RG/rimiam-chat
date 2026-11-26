import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'agenda_commands.dart' show agendaDay;
import 'agenda_editor.dart' show agendaPickTime, agendaTime;

typedef TaskRow = Map<String, dynamic>;

class WorkspaceTaskEditor extends StatefulWidget {
  const WorkspaceTaskEditor({
    super.key,
    required this.task,
    required this.candidate,
    required this.members,
    required this.timeZone,
    required this.submit,
    required this.close,
    required this.busy,
    this.suggestedText,
    this.initialReason,
    this.sourceMessage,
  });
  final TaskRow? task, candidate;
  final String? suggestedText, initialReason, sourceMessage;
  final List<TaskRow> members;
  final Future<String> Function() timeZone;
  final Future<bool> Function(TaskRow) submit;
  final VoidCallback close;
  final bool busy;
  @override
  State<WorkspaceTaskEditor> createState() => _TaskEditorState();
}

class _TaskEditorState extends State<WorkspaceTaskEditor> {
  late final title = TextEditingController(
    text:
        widget.task?['title'] ??
        widget.suggestedText?.characters.take(160).toString() ??
        widget.candidate?['subject'] ??
        '',
  );
  late final details = TextEditingController(
    text:
        widget.suggestedText ??
        widget.task?['description'] ??
        widget.candidate?['content'] ??
        '',
  );
  late final reason = TextEditingController(text: widget.initialReason);
  late String? person = widget.task?['suggestedPerson'];
  late DateTime? due = DateTime.tryParse(widget.task?['dueAt'] as String? ?? '')
      ?.toLocal();
  bool submitting = false;
  String? error;
  @override
  void dispose() {
    for (final c in [title, details, reason]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> chooseDue() async {
    final start = due ?? DateTime.now().add(const Duration(hours: 1));
    final date = await showDatePicker(
      context: context,
      initialDate: start,
      firstDate: DateTime(1900),
      lastDate: DateTime(2300),
    );
    if (date == null || !mounted) return;
    final chosen = await agendaPickTime(
      context,
      DateTime(date.year, date.month, date.day, start.hour, start.minute),
    );
    if (chosen != null && mounted) setState(() => due = chosen);
  }

  Future<void> save() async {
    if (submitting || widget.busy) return;
    final original = widget.task;
    if (title.text.trim().isEmpty ||
        original != null && reason.text.trim().isEmpty) {
      setState(
        () => error = title.text.trim().isEmpty
            ? 'Inserisci un titolo.'
            : 'Indica il motivo della modifica.',
      );
      return;
    }
    setState(() {
      submitting = true;
      error = null;
    });
    try {
      final originalDue = DateTime.tryParse(
        original?['dueAt'] as String? ?? '',
      );
      final preserveZone =
          original != null &&
          (due == null && originalDue == null ||
              due != null &&
                  originalDue != null &&
                  due!.isAtSameMomentAs(originalDue));
      final zone = preserveZone
          ? original['timeZone'] as String
          : await widget.timeZone();
      if (!mounted || widget.busy) return;
      if (zone.isEmpty) throw const FormatException();
      final content = <String, dynamic>{
        'title': title.text.trim(),
        'description': details.text.trim(),
        'dueAt': due?.toUtc().toIso8601String(),
        'timeZone': zone,
        'suggestedPerson': person,
        'references':
            original?['references'] ??
            [
              if (widget.sourceMessage != null)
                {'kind': 'message', 'id': widget.sourceMessage, 'version': 1},
            ],
      };
      final command = <String, dynamic>{
        'type': original == null
            ? 'task.create'
            : original['responsible'] == null
            ? 'task.revise'
            : 'task.propose_revision',
        'content': content,
        if (original == null && widget.candidate != null)
          'candidateId': widget.candidate!['id'],
        if (original != null) ...{
          'taskId': original['id'],
          'expectedVersion': original['version'],
          'reason': reason.text.trim(),
        },
      };
      if (await widget.submit(command) && mounted) widget.close();
    } catch (_) {
      if (mounted)
        setState(() => error = 'Controlla il fuso orario e riprova.');
    } finally {
      if (mounted) setState(() => submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final original = widget.task, readonly = submitting || widget.busy;
    final ids = widget.members.map((m) => m['id']).toSet();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          original == null
              ? uiText(context, 'Nuova attività')
              : original['responsible'] == null
              ? uiText(context, 'Modifica attività')
              : uiText(context, 'Proponi una modifica'),
          style: Theme.of(context).textTheme.titleLarge,
        ),
        TextField(
          controller: title,
          enabled: !readonly,
          maxLength: 160,
          decoration: InputDecoration(
            labelText: uiText(context, 'Titolo attività'),
          ),
        ),
        TextField(
          controller: details,
          enabled: !readonly,
          maxLength: 8000,
          minLines: 1,
          maxLines: 4,
          decoration: InputDecoration(
            labelText: uiText(context, 'Descrizione facoltativa'),
          ),
        ),
        DropdownButtonFormField<String>(
          initialValue: person ?? '',
          isExpanded: true,
          decoration: InputDecoration(labelText: uiText(context, 'Proponi a')),
          items: [
            DropdownMenuItem(
              value: '',
              child: Text(uiText(context, 'Nessuno')),
            ),
            if (person != null && !ids.contains(person))
              DropdownMenuItem(
                value: person,
                child: Text(uiText(context, 'Membro non disponibile')),
              ),
            for (final m in widget.members)
              DropdownMenuItem(
                value: m['id'] as String,
                child: Text(
                  m['name'] as String,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
          onChanged: readonly
              ? null
              : (v) => setState(() => person = v == '' ? null : v),
        ),
        if (person != null)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text(
              uiText(context, 'La persona scelta potrà accettare o rifiutare.'),
            ),
          ),
        Wrap(
          children: [
            TextButton.icon(
              onPressed: readonly ? null : chooseDue,
              icon: const Icon(Icons.calendar_month_outlined),
              label: Text(
                due == null
                    ? uiText(context, 'Aggiungi scadenza')
                    : '${agendaDay(due!)} · ${agendaTime(context, due!)}',
              ),
            ),
            if (due != null)
              TextButton(
                onPressed: readonly ? null : () => setState(() => due = null),
                child: Text(uiText(context, 'Rimuovi scadenza')),
              ),
          ],
        ),
        if (original != null)
          TextField(
            controller: reason,
            enabled: !readonly,
            maxLength: 2000,
            maxLines: 2,
            decoration: InputDecoration(
              labelText: uiText(context, 'Motivo della modifica'),
            ),
          ),
        if (error != null) Text(uiText(context, error!)),
        Wrap(
          spacing: 8,
          children: [
            FilledButton(
              onPressed: readonly ? null : save,
              child: Text(
                original == null
                    ? uiText(context, 'Crea attività')
                    : original['responsible'] == null
                    ? uiText(context, 'Salva modifica')
                    : uiText(context, 'Invia proposta'),
              ),
            ),
            TextButton(
              onPressed: readonly ? null : widget.close,
              child: Text(uiText(context, 'Annulla')),
            ),
          ],
        ),
      ],
    );
  }
}
