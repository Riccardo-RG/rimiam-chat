part of 'workspace_activity.dart';

const _states = {
  'proposed': 'Proposto',
  'active': 'Attivo',
  'resolved': 'Concluso',
  'archived': 'Archiviato',
};
const _moves = {
  'active': ['resolve', 'archive'],
  'proposed': ['activate', 'archive'],
  'resolved': ['reopen', 'archive'],
  'archived': ['restore'],
};
const _verbs = {
  'resolve': 'Concludi',
  'archive': 'Archivia',
  'activate': 'Attiva',
  'reopen': 'Riapri',
  'restore': 'Ripristina',
};

extension _Topics on _ActivityState {
  Future<void> openTopicConversation(GroupRecord topic) async {
    final message = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => TopicConversationPage(
          api: widget.api,
          workspaceId: widget.workspaceId,
          topicId: topic['id'] as String,
          vault: widget.vault,
        ),
      ),
    );
    if (current && message != null) Navigator.pop(context, message);
  }

  Future<void> editTopic([GroupRecord? topic]) async {
    final result = await showDialog<({String title, String description})>(
      context: context,
      builder: (_) => _TopicEditor(topic: topic),
    );
    if (!canEdit || result == null) return;
    await save({
      'type': 'workstream.save',
      'title': result.title,
      'description': result.description,
      if (topic != null) ...{
        'id': topic['id'],
        'expectedVersion': topic['version'],
      },
    });
  }

  Future<void> transition(GroupRecord topic, String action) async {
    final verb = _verbs[action]!;
    if (await groupConfirm(
          context,
          uiText(context, '{0} l’argomento?', [verb]),
          topic['title'] as String,
          verb,
        ) &&
        canEdit) {
      await save({
        'type': 'workstream.transition',
        'workstreamId': topic['id'],
        'expectedVersion': topic['version'],
        'action': action,
      });
    }
  }

  Future<void> linkSource(GroupRecord topic) async {
    final links = groupRows(topic['sources']);
    final excluded = links
        .where((r) => r['included'] == true)
        .map((r) => r['id'])
        .toSet();
    final source = await pick(
      'Collega una fonte',
      sources.where((s) => !excluded.contains(s['id'])).toList(),
    );
    if (source == null || !canEdit) return;
    final prior = links.where((s) => s['id'] == source['id']).firstOrNull;
    await save({
      'type': 'workstream.link',
      'workstreamId': topic['id'],
      'sourceId': source['id'],
      'expectedVersion': prior?['version'] ?? 0,
      'included': true,
    });
  }

  Future<void> unlink(GroupRecord topic, GroupRecord source) async {
    if (await groupConfirm(
          context,
          uiText(context, 'Rimuovi il collegamento?'),
          uiText(context, 'La fonte rimane nello spazio.'),
          uiText(context, 'Rimuovi collegamento'),
        ) &&
        canEdit) {
      await save({
        'type': 'workstream.link',
        'workstreamId': topic['id'],
        'sourceId': source['id'],
        'expectedVersion': source['version'],
        'included': false,
      });
    }
  }

  List<Widget> activityView() {
    final topics = groupRows(attention['workstreams']).where(
      (t) => chosenTopic != null
          ? t['id'] == chosenTopic
          : historical || t['state'] == 'active' || t['state'] == 'proposed',
    );
    final events = groupRows(register['events']);
    return [
      ExpansionTile(
        title: Text(uiText(context, 'Argomenti')),
        initiallyExpanded: true,
        children: [
          if (chosenTopic != null)
            TextButton(
              onPressed: showAllTopics,
              child: Text(uiText(context, 'Tutti gli argomenti')),
            ),
          if (chosenTopic == null && group.canWrite)
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.tonalIcon(
                onPressed: canEdit ? editTopic : null,
                icon: const Icon(Icons.add),
                label: Text(uiText(context, 'Nuovo argomento')),
              ),
            ),
          if (chosenTopic == null)
            SwitchListTile(
              title: Text(uiText(context, 'Includi conclusi e archiviati')),
              value: historical,
              onChanged: switchHistory,
            ),
          if (topics.isEmpty)
            ListTile(
              title: Text(uiText(context, 'Nessun argomento in questa vista.')),
            ),
          for (final topic in topics)
            ExpansionTile(
              key: ValueKey(topic['id']),
              initiallyExpanded: chosenTopic == topic['id'],
              title: Text(topic['title'] as String),
              subtitle: Text(_states[topic['state']] ?? ''),
              children: [
                ListTile(
                  leading: const Icon(Icons.forum_outlined),
                  title: Text(uiText(context, 'Conversazione sull’argomento')),
                  onTap: () => openTopicConversation(topic),
                ),
                if (topic['description'] != '')
                  ListTile(
                    title: SelectableText(topic['description'] as String),
                  ),
                if (group.canWrite)
                  Wrap(
                    spacing: 6,
                    children: [
                      TextButton(
                        onPressed: canEdit ? () => editTopic(topic) : null,
                        child: Text(uiText(context, 'Modifica')),
                      ),
                      for (final action in _moves[topic['state']] ?? <String>[])
                        TextButton(
                          onPressed: canEdit
                              ? () => transition(topic, action)
                              : null,
                          child: Text(_verbs[action]!),
                        ),
                    ],
                  ),
                ExpansionTile(
                  title: Text(uiText(context, 'Fonti e cronologia')),
                  children: [
                    if (canEdit)
                      ListTile(
                        title: Text(uiText(context, 'Collega una fonte')),
                        onTap: () => linkSource(topic),
                      ),
                    for (final s in groupRows(
                      topic['sources'],
                    ).where((s) => s['included'] == true))
                      ListTile(
                        title: Text(
                          s['content'] as String,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => reference({
                          'kind': 'source',
                          'id': s['id'],
                          'version': 1,
                        }),
                        trailing: canEdit
                            ? IconButton(
                                tooltip: uiText(
                                  context,
                                  'Rimuovi collegamento',
                                ),
                                icon: const Icon(Icons.link_off),
                                onPressed: () => unlink(topic, s),
                              )
                            : null,
                      ),
                    for (final version in groupRows(topic['history']))
                      ListTile(
                        title: Text(
                          uiText(context, 'v{0} · {1}', [
                            version['version'],
                            version['title'],
                          ]),
                        ),
                        subtitle: Text(
                          groupDate(context, version['createdAt']),
                        ),
                        onTap: () => reference({
                          'kind': 'workstream',
                          'id': topic['id'],
                          'version': version['version'],
                        }),
                      ),
                  ],
                ),
              ],
            ),
        ],
      ),
      ExpansionTile(
        title: Text(uiText(context, 'Registro attività')),
        children: [
          if (events.isEmpty)
            ListTile(title: Text(uiText(context, 'Nessun aggiornamento.'))),
          for (final e in events)
            ExpansionTile(
              key: ValueKey(e['eventId']),
              title: Text(e['title'] as String),
              subtitle: Text(
                "${e['actorName']} · ${groupDate(context, e['occurredAt'])}",
              ),
              children: [
                ListTile(
                  title: SelectableText(e['summary'] as String),
                  subtitle: Text(e['qualification'] as String),
                ),
                TextButton(
                  onPressed: () => reference(e['reference'] as GroupRecord),
                  child: Text(uiText(context, 'Apri il passaggio')),
                ),
              ],
            ),
          if (register['next'] != null)
            TextButton(
              onPressed: () => viewPage(register['next'] as String),
              child: Text(uiText(context, 'Attività precedenti')),
            ),
          if (before != null)
            TextButton(
              onPressed: () => viewPage(null),
              child: Text(uiText(context, 'Torna alle più recenti')),
            ),
        ],
      ),
      ListTile(
        title: Text(uiText(context, 'Il ritmo di Emme')),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => AssistantRhythmScreen(
              api: widget.api,
              workspaceId: widget.workspaceId,
              workspaceName: widget.workspaceName,
              vault: widget.vault,
            ),
          ),
        ),
      ),
    ];
  }
}

class _TopicEditor extends StatefulWidget {
  const _TopicEditor({this.topic});
  final GroupRecord? topic;
  @override
  State<_TopicEditor> createState() => _TopicEditorState();
}

class _TopicEditorState extends State<_TopicEditor> {
  late final title = TextEditingController(
    text: widget.topic?['title'] as String?,
  );
  late final description = TextEditingController(
    text: widget.topic?['description'] as String?,
  );
  @override
  void dispose() {
    title.dispose();
    description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    scrollable: true,
    title: Text(
      widget.topic == null
          ? uiText(context, 'Nuovo argomento')
          : uiText(context, 'Modifica argomento'),
    ),
    content: Column(
      children: [
        TextField(
          controller: title,
          maxLength: 160,
          decoration: InputDecoration(labelText: uiText(context, 'Titolo')),
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: description,
          minLines: 2,
          maxLines: 4,
          maxLength: 4000,
          decoration: InputDecoration(
            labelText: uiText(context, 'Descrizione facoltativa'),
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
        onPressed: title.text.trim().isEmpty
            ? null
            : () => Navigator.pop(context, (
                title: title.text.trim(),
                description: description.text.trim(),
              )),
        child: Text(uiText(context, 'Salva argomento')),
      ),
    ],
  );
}
