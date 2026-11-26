import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'workspace_task_editor.dart' show TaskRow;

class WorkspaceTaskComments extends StatefulWidget {
  const WorkspaceTaskComments({
    super.key,
    required this.api,
    required this.workspace,
    required this.task,
    required this.canWrite,
    required this.submit,
  });
  final RimiamApi api;
  final String workspace;
  final TaskRow task;
  final bool canWrite;
  final Future<bool> Function(TaskRow) submit;
  @override
  State<WorkspaceTaskComments> createState() => _TaskCommentsState();
}

class _TaskCommentsState extends State<WorkspaceTaskComments> {
  final body = TextEditingController();
  List<TaskRow> rows = [];
  String? next, issue;
  bool loading = false, posting = false, paged = false;
  Timer? watch;
  int? draftVersion;
  int generation = 0;
  String get url =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspace)}/task-comments?id=${Uri.encodeQueryComponent(widget.task['id'])}';
  @override
  void dispose() {
    watch?.cancel();
    body.dispose();
    super.dispose();
  }

  Future<void> read({bool older = false}) async {
    final g = ++generation;
    final who = widget.api.actorId;
    setState(() {
      loading = true;
      issue = null;
    });
    try {
      final view = await widget.api.get(
        older && next != null
            ? '$url&before=${Uri.encodeQueryComponent(next!)}'
            : url,
      );
      if (!mounted || g != generation || widget.api.actorId != who) return;
      final page = (view['comments'] as List).cast<TaskRow>();
      setState(() {
        rows = older
            ? [
                ...rows,
                ...page.where((r) => !rows.any((old) => old['id'] == r['id'])),
              ]
            : page;
        next = view['next'] as String?;
        paged = older;
      });
    } catch (e) {
      if (mounted && g == generation)
        setState(() {
          if (e is ApiError && {401, 403, 404}.contains(e.status)) {
            rows = [];
            next = null;
          }
          issue = 'Impossibile caricare i commenti.';
        });
    } finally {
      if (mounted && g == generation) setState(() => loading = false);
    }
  }

  Future<void> submit() async {
    final text = body.text.trim();
    if (posting ||
        text.isEmpty ||
        !widget.canWrite ||
        draftVersion != widget.task['version'])
      return;
    setState(() => posting = true);
    try {
      final success = await widget.submit({
        'type': 'task.comment',
        'taskId': widget.task['id'],
        'expectedVersion': widget.task['version'],
        'body': text,
      });
      if (success && mounted) {
        body.clear();
        draftVersion = null;
        await read();
      }
    } finally {
      if (mounted) setState(() => posting = false);
    }
  }

  @override
  Widget build(BuildContext context) => ExpansionTile(
    title: Text(uiText(context, 'Commenti')),
    onExpansionChanged: (v) {
      watch?.cancel();
      if (v) {
        read();
        watch = Timer.periodic(const Duration(seconds: 15), (_) {
          if (!paged &&
              !loading &&
              !posting &&
              ModalRoute.of(context)?.isCurrent != false)
            unawaited(read());
        });
      }
    },
    children: [
      if (loading) const LinearProgressIndicator(),
      if (issue != null)
        TextButton(
          onPressed: loading ? null : () => read(),
          child: Text(uiText(context, '{0} Riprova', [issue])),
        ),
      if (!loading && issue == null && rows.isEmpty)
        ListTile(title: Text(uiText(context, 'Ancora nessun commento.'))),
      for (final r in rows)
        ListTile(
          title: Text(r['authorName'] as String),
          subtitle: Text(r['body'] as String),
        ),
      if (next != null)
        TextButton(
          onPressed: loading ? null : () => read(older: true),
          child: Text(uiText(context, 'Commenti precedenti')),
        ),
      if (widget.canWrite) ...[
        TextField(
          controller: body,
          onChanged: (s) {
            setState(() {
              if (s.isEmpty) {
                draftVersion = null;
              } else {
                draftVersion ??= widget.task['version'] as int;
              }
            });
          },
          enabled: !posting,
          minLines: 1,
          maxLines: 4,
          maxLength: 2000,
          decoration: InputDecoration(labelText: uiText(context, 'Commento')),
        ),
        if (draftVersion != null && draftVersion != widget.task['version'])
          TextButton(
            onPressed: () =>
                setState(() => draftVersion = widget.task['version'] as int),
            child: Text(
              uiText(context, 'Attività aggiornata · usa la versione attuale'),
            ),
          ),
        TextButton(
          onPressed:
              posting ||
                  body.text.trim().isEmpty ||
                  draftVersion != widget.task['version']
              ? null
              : submit,
          child: Text(uiText(context, 'Invia commento')),
        ),
      ],
    ],
  );
}
