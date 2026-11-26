part of 'workspace_activity.dart';

extension _Questions on _ActivityState {
  Future<void> newQuestion([String? initialId]) async {
    final source = initialId == null
        ? await pick('Scegli il messaggio o il file di origine', sources)
        : sources.where((s) => s['id'] == initialId).firstOrNull;
    if (!canEdit) return;
    if (source == null) {
      if (initialId != null) missingQuestionSource();
      return;
    }
    final draft = await showDialog<({String id, String text})>(
      context: context,
      useRootNavigator: false,
      builder: (ctx) => _QuestionDraft(
        source: source,
        select: () => pick('Scegli il messaggio o il file di origine', sources),
      ),
    );
    if (canEdit && draft != null)
      await save({
        'type': 'question.open',
        'sourceId': draft.id,
        'content': draft.text,
      });
  }

  Future<void> changeAnswer(GroupRecord question) async {
    final open = question['status'] == 'open';
    GroupRecord? selected;
    if (open) {
      selected = await pick('Scegli un riferimento accettato', [
        for (final info in groupRows(group.snapshot['information']))
          {
            'id': info['id'],
            'version': info['current_version'],
            'label': "${info['subject']} · v${info['current_version']}",
          },
      ]);
      if (!canEdit || selected == null) return;
    }
    final reason = await groupText(
      context,
      title: open
          ? uiText(context, 'Collega una risposta')
          : uiText(context, 'Riapri domanda'),
      label: uiText(context, 'Motivo'),
      action: open
          ? uiText(context, 'Collega risposta')
          : uiText(context, 'Riapri'),
      max: 4000,
    );
    if (reason == null || !canEdit) return;
    await save({
      'type': open ? 'question.answer' : 'question.reopen',
      'questionId': question['id'],
      'expectedVersion': question['version'],
      'reason': reason,
      if (selected != null) ...{
        'informationId': selected['id'],
        'informationVersion': selected['version'],
      },
    });
  }

  List<Widget> questionsView() {
    final all = groupRows(group.snapshot['questions']);
    final rows = all.where((q) => historical == (q['status'] == 'answered'));
    return [
      if (group.canWrite)
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.tonalIcon(
            onPressed: canEdit ? newQuestion : null,
            icon: const Icon(Icons.add),
            label: Text(uiText(context, 'Nuova domanda')),
          ),
        ),
      Wrap(
        spacing: 8,
        children: [
          for (final entry in [(false, 'Da chiarire'), (true, 'Con risposta')])
            ChoiceChip(
              label: Text(entry.$2),
              selected: historical == entry.$1,
              onSelected: (_) => switchHistory(entry.$1),
            ),
        ],
      ),
      if (rows.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 18),
          child: Text(
            historical
                ? uiText(context, 'Nessuna domanda con una risposta collegata.')
                : uiText(context, 'Nessuna domanda aperta.'),
          ),
        ),
      for (final q in rows)
        ExpansionTile(
          key: ValueKey((q['id'], q['version'])),
          title: Text(q['content'] as String),
          children: [
            ListTile(
              title: Text(uiText(context, 'Fonte della domanda')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => reference({
                'kind': 'source',
                'id': q['source_id'],
                'version': 1,
              }),
            ),
            if (q['answer_information_id'] != null)
              ListTile(
                title: Text(
                  uiText(context, 'Risposta collegata · v{0}', [
                    q['answer_information_version'],
                  ]),
                ),
                onTap: () => reference({
                  'kind': 'information',
                  'id': q['answer_information_id'],
                  'version': q['answer_information_version'],
                }),
              ),
            if (group.canWrite)
              ListTile(
                title: Text(
                  historical
                      ? uiText(context, 'Riapri domanda')
                      : uiText(context, 'Collega una risposta'),
                ),
                onTap: canEdit ? () => changeAnswer(q) : null,
              ),
            ExpansionTile(
              title: Text(uiText(context, 'Cronologia')),
              children: [
                for (final v in groupRows(
                  group.snapshot['questionHistory'],
                ).where((v) => v['question_id'] == q['id']))
                  ListTile(
                    title: Text(
                      uiText(context, 'v{0} · {1}', [
                        v['version'],
                        group.name(v['recorded_by']),
                      ]),
                    ),
                    subtitle: Text(groupDate(context, v['created_at'])),
                    onTap: () => reference({
                      'kind': 'question',
                      'id': q['id'],
                      'version': v['version'],
                    }),
                  ),
              ],
            ),
          ],
        ),
    ];
  }
}

class _QuestionDraft extends StatefulWidget {
  const _QuestionDraft({required this.source, required this.select});
  final GroupRecord source;
  final Future<GroupRecord?> Function() select;
  @override
  State<_QuestionDraft> createState() => _QuestionDraftState();
}

class _QuestionDraftState extends State<_QuestionDraft> {
  late GroupRecord source = widget.source;
  final editor = TextEditingController();
  @override
  void dispose() {
    editor.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    scrollable: true,
    title: Text(uiText(context, 'Nuova domanda')),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          uiText(context, 'Fonte'),
          style: Theme.of(context).textTheme.labelMedium,
        ),
        Text(
          source['label'] as String,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
        ),
        TextButton(
          onPressed: () async {
            final next = await widget.select();
            if (mounted && next != null) setState(() => source = next);
          },
          child: Text(uiText(context, 'Cambia fonte')),
        ),
        TextField(
          controller: editor,
          minLines: 2,
          maxLines: 5,
          maxLength: 4000,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: uiText(context, 'Cosa resta da chiarire?'),
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
        onPressed: editor.text.trim().isEmpty
            ? null
            : () => Navigator.pop(context, (
                id: source['id'] as String,
                text: editor.text.trim(),
              )),
        child: Text(uiText(context, 'Registra domanda')),
      ),
    ],
  );
}
