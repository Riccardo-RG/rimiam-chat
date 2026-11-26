part of 'workspace_integrations.dart';

String envelopeSummary(GroupRecord e) {
  final kind = switch (e['kind']) {
    'forward' => 'Inoltro',
    'reply' => 'Risposta',
    _ => 'Nuova email',
  };
  return [
    kind,
    'Da · ${e['sender']}',
    'A · ${groupIds(e['to']).join(', ')}',
    if (groupIds(e['cc']).isNotEmpty) 'Cc · ${groupIds(e['cc']).join(', ')}',
    if (groupIds(e['bcc']).isNotEmpty) 'Ccn · ${groupIds(e['bcc']).join(', ')}',
    'Oggetto · ${e['subject']}',
    '',
    e['body'] as String,
    for (final f in groupRows(e['attachments']))
      'Allegato · ${f['filename']} · v${f['version']}',
  ].join('\n');
}

GroupRecord _emptyEnvelope(String sender) => {
  'sender': sender,
  'to': <String>[],
  'cc': <String>[],
  'bcc': <String>[],
  'subject': '',
  'body': '',
  'attachments': <GroupRecord>[],
  'kind': 'new',
  'target': null,
};

extension _MailPanel on _IntegrationState {
  List<GroupRecord> get mailConnections =>
      groupRows(view['connections']).where((r) => r['active'] == true).toList();
  Future<void> editMail({
    GroupRecord? draft,
    GroupRecord? message,
    GroupRecord? observation,
    String? kind,
    GroupRecord? composition,
  }) async {
    if (!writable) return;
    GroupRecord env;
    String? connection;
    if (draft != null) {
      env = {...draft['envelope'] as GroupRecord};
      connection = draft['connectionId'];
    } else if (message != null && observation != null) {
      final linked = mailConnections
          .where(
            (r) =>
                r['id'] == observation['connectionId'] && r['canSend'] == true,
          )
          .firstOrNull;
      if (linked == null) return;
      connection = linked['id'];
      env = {
        ..._emptyEnvelope(linked['sender']),
        'kind': kind,
        'target': {
          'observationId': observation['id'],
          'messageId': message['id'],
        },
        'to': kind == 'reply'
            ? (groupIds(message['replyTo']).isEmpty
                  ? [message['from']]
                  : groupIds(message['replyTo']))
            : <String>[],
        'subject':
            (kind == 'reply' ? 'Re: ' : 'Fwd: ') +
            (message['subject'] as String),
        'body': kind == 'forward' ? message['body'] : '',
      };
    } else {
      final linked = mailConnections
          .where((r) => r['canSend'] == true)
          .firstOrNull;
      connection = linked?['id'];
      env = _emptyEnvelope(linked?['sender'] ?? m.email);
    }
    if (composition != null) {
      if (draft == null ||
          composition['draftId'] != draft['id'] ||
          composition['version'] != draft['version'])
        return;
      env = {
        ...env,
        'body': composition['suggestion']['body'],
        'subject': composition['suggestion']['subject'],
      };
    }
    final command = await showEditor(
      _MailEditor(
        envelope: env,
        existing: draft,
        compositionId: composition?['id'],
        connection: connection,
        email: m.email,
        connections: mailConnections,
        files: [
          ...groupRows(view['workspaceAttachments']),
          ...groupRows(view['attachments']),
        ],
      ),
    );
    if (command != null && mounted && writable) await send(command);
  }

  Future<void> suggest(GroupRecord draft) async {
    final epoch = m.epoch;
    final instruction = await groupText(
      context,
      title: uiText(context, 'Scrivi con Emme'),
      label: uiText(context, 'Istruzioni'),
      max: 4000,
      detail: uiText(
        context,
        'Il modello riceve l’oggetto, il testo di questa bozza e le tue istruzioni.',
      ),
      action: uiText(context, 'Chiedi un suggerimento'),
    );
    if (!mounted || instruction == null || m.epoch != epoch || !writable)
      return;
    GroupRecord? accepted;
    await operation(() async {
      final sug = await widget.api.post('${m.base}/email-compose', {
        'draftId': draft['id'],
        'version': draft['version'],
        'instruction': instruction,
      });
      m.guard(epoch);
      if (!mounted) return;
      if (sug['draftId'] != draft['id'] || sug['version'] != draft['version'])
        throw const FormatException('La versione della bozza è cambiata.');
      final result = sug['suggestion'];
      if (result['needsClarification'] != null)
        throw FormatException(result['needsClarification']);
      if (await groupConfirm(
        context,
        uiText(context, 'Suggerimento per la bozza'),
        '${result['subject']}\n\n${result['body']}',
        uiText(context, 'Apri in modifica'),
      ))
        accepted = sug;
    });
    if (mounted && m.epoch == epoch && accepted != null)
      await editMail(draft: draft, composition: accepted);
  }

  Future<void> searchMail(GroupRecord c) async {
    final epoch = m.epoch;
    final q = await groupText(
      context,
      title: uiText(context, 'Cerca nella tua posta'),
      label: uiText(context, 'Parole da cercare'),
      action: uiText(context, 'Cerca'),
      max: 500,
    );
    if (!mounted || q == null || epoch != m.epoch || !writable) return;
    await send({
      'type': 'email.read',
      'connectionId': c['id'],
      'request': {'mode': 'search', 'query': q},
    });
  }

  Future<void> disclose(GroupRecord o, GroupRecord msg) async {
    final epoch = m.epoch;
    final text = await groupText(
      context,
      title: uiText(context, 'Condividi un estratto'),
      label: uiText(context, 'Estratto esatto'),
      max: 12000,
      action: uiText(context, 'Anteprima'),
      detail: uiText(
        context,
        'Copia le parole del messaggio che vuoi rendere disponibili nello spazio.',
      ),
    );
    if (!mounted || text == null || epoch != m.epoch || !writable) return;
    if (!(msg['body'] as String).contains(text)) {
      problem('L’estratto deve corrispondere al testo originale.');
      return;
    }
    await confirmCommand(
      'Condividere in ${widget.workspaceName}?',
      '${text}\n\nSarà nella cronologia condivisa, visibile anche ai futuri partecipanti.',
      'Condividi',
      {
        'type': 'email.disclose',
        'observationId': o['id'],
        'messageId': msg['id'],
        'text': text,
        'fullHistoryDisclosed': true,
      },
    );
  }

  Future<void> exportMailFile(GroupRecord f, BuildContext button) async {
    final epoch = m.epoch;
    if (!await groupConfirm(
          context,
          uiText(button, 'Esportare una copia privata?'),
          f['filename'],
          uiText(button, 'Scegli destinazione'),
        ) ||
        !mounted ||
        m.epoch != epoch ||
        !button.mounted)
      return;
    final r = button.findRenderObject() as RenderBox;
    final anchor = r.localToGlobal(Offset.zero) & r.size;
    await operation(() async {
      final bytes = await widget.api.getBytes(
        '${m.base}/email-attachment?id=${Uri.encodeQueryComponent(f['id'])}',
      );
      m.guard(epoch);
      if (sha256.convert(bytes).toString() != f['hash'])
        throw const FormatException(
          'Il file ricevuto non corrisponde alla versione scelta.',
        );
      await sharePrivateBytes(
        bytes,
        name: f['filename'],
        mimeType: 'application/octet-stream',
        anchor: anchor,
      );
    });
  }

  List<Widget> mailContent() {
    final drafts = groupRows(view['drafts']),
        actions = groupRows(view['actions']);
    final awaitingReceipt = {
      for (final a in actions)
        if (const {'EXECUTING', 'OUTCOME_UNKNOWN'}.contains(a['status']))
          a['draftId'],
    };
    return [
      Text(uiText(context, 'Solo tu vedi la tua posta e le tue bozze.')),
      if (m.canWrite)
        FilledButton.tonalIcon(
          onPressed: writable ? () => editMail() : null,
          icon: const Icon(Icons.edit_outlined),
          label: Text(uiText(context, 'Nuova bozza')),
        ),
      if (!mailConnections.any((c) => c['canSend'] == true))
        Text(
          uiText(
            context,
            'Puoi salvare una bozza privata. Per inviarla, collega una casella.',
          ),
        ),
      Text(
        uiText(context, 'Bozze private'),
        style: Theme.of(context).textTheme.titleMedium,
      ),
      if (drafts.isEmpty) Text(uiText(context, 'Ancora nessuna bozza.')),
      for (final d in drafts)
        ExpansionTile(
          key: PageStorageKey('draft-${d['id']}'),
          title: Text(
            (d['envelope']['subject'] as String).isEmpty
                ? uiText(context, 'Senza oggetto')
                : d['envelope']['subject'],
          ),
          subtitle: Text(uiText(context, 'Versione {0}', [d['version']])),
          children: [
            SelectableText(
              envelopeSummary(d['envelope']),
              key: const PageStorageKey('draft-text'),
            ),
            TextButton(
              onPressed: working
                  ? null
                  : () => history(
                      '${m.base}/email-history?draftId=${d['id']}',
                      'Cronologia della bozza',
                    ),
              child: Text(uiText(context, 'Cronologia della bozza')),
            ),
            if (awaitingReceipt.contains(d['id']))
              Text(
                uiText(
                  context,
                  'Per modificare questa bozza, verifica prima l’esito dell’invio.',
                ),
              )
            else if (m.canWrite) ...[
              TextButton(
                onPressed: writable ? () => editMail(draft: d) : null,
                child: Text(uiText(context, 'Modifica bozza')),
              ),
              TextButton(
                onPressed: writable ? () => suggest(d) : null,
                child: Text(uiText(context, 'Scrivi con Emme')),
              ),
              if (mailConnections.any(
                    (c) => c['id'] == d['connectionId'] && c['canSend'] == true,
                  ) &&
                  !actions.any(
                    (a) =>
                        a['draftId'] == d['id'] && a['version'] == d['version'],
                  ))
                TextButton(
                  onPressed: writable
                      ? () => confirmCommand(
                          'Controlla invio',
                          envelopeSummary(d['envelope']),
                          'Prepara conferma',
                          {
                            'type': 'email.propose',
                            'draftId': d['id'],
                            'version': d['version'],
                            'discloseToRecipients': true,
                          },
                        )
                      : null,
                  child: Text(uiText(context, 'Controlla invio')),
                ),
            ],
          ],
        ),
      if (actions.isNotEmpty)
        Text(
          uiText(context, 'Invii'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
      for (final a in actions)
        ExpansionTile(
          key: PageStorageKey('send-${a['id']}'),
          title: Text(
            a['envelope']['subject'] == ''
                ? uiText(context, 'Senza oggetto')
                : a['envelope']['subject'],
          ),
          subtitle: Text(
            uiText(context, '{0} · v{1}', [
              externalState(a['status']),
              a['version'],
            ]),
          ),
          children: [
            SelectableText(
              envelopeSummary(a['envelope']),
              key: const PageStorageKey('delivery-text'),
            ),
            if (a['receipt'] != null)
              Text(
                uiText(context, 'Accettata dal servizio · {0}', [
                  groupDate(context, a['receipt']['acceptedAt']),
                ]),
              ),
            ...effects(a, envelopeSummary(a['envelope'])),
          ],
        ),
      if (m.canWrite)
        for (final c in mailConnections.where((c) => c['canRead'] == true))
          TextButton.icon(
            onPressed: writable ? () => searchMail(c) : null,
            icon: const Icon(Icons.search),
            label: Text(uiText(context, 'Cerca in {0}', [c['sender']])),
          ),
      for (final o in groupRows(view['observations']))
        ExpansionTile(
          key: PageStorageKey('mail-read-${o['id']}'),
          title: Text(
            uiText(context, 'Lettura privata · {0}', [
              groupDate(context, o['observedAt']),
            ]),
          ),
          subtitle: Text(
            o['request']['query'] ?? uiText(context, 'Messaggi selezionati'),
          ),
          children: [
            if (o['data']['complete'] != true)
              Text(uiText(context, 'Risultati parziali.')),
            if (groupRows(o['data']['messages']).isEmpty)
              Text(uiText(context, 'Nessun messaggio trovato.')),
            for (final msg in groupRows(o['data']['messages']))
              ExpansionTile(
                key: PageStorageKey('message-${msg['id']}'),
                title: Text(msg['subject']),
                subtitle: Text(msg['from']),
                children: [
                  Text(
                    uiText(context, '{0} · A {1}', [
                      groupDate(context, msg['sentAt']),
                      groupIds(msg['to']).join(', '),
                    ]),
                  ),
                  SelectableText(
                    msg['body'],
                    key: const PageStorageKey('private-message-text'),
                  ),
                  if (m.canWrite) ...[
                    if (mailConnections.any(
                      (c) =>
                          c['id'] == o['connectionId'] && c['canSend'] == true,
                    ))
                      Wrap(
                        children: [
                          for (final mode in ['reply', 'forward'])
                            TextButton(
                              onPressed: writable
                                  ? () => editMail(
                                      message: msg,
                                      observation: o,
                                      kind: mode,
                                    )
                                  : null,
                              child: Text(
                                mode == 'reply'
                                    ? uiText(context, 'Prepara risposta')
                                    : uiText(context, 'Prepara inoltro'),
                              ),
                            ),
                        ],
                      ),
                    if (msg['threadId'] != null)
                      TextButton(
                        onPressed: writable
                            ? () => send({
                                'type': 'email.read',
                                'connectionId': o['connectionId'],
                                'request': {
                                  'mode': 'thread',
                                  'targetId': msg['threadId'],
                                },
                              })
                            : null,
                        child: Text(
                          uiText(context, 'Leggi conversazione privata'),
                        ),
                      ),
                    if ((msg['body'] as String).isNotEmpty)
                      TextButton(
                        onPressed: writable ? () => disclose(o, msg) : null,
                        child: Text(uiText(context, 'Condividi un estratto')),
                      ),
                    for (final f in groupRows(msg['attachments']))
                      TextButton(
                        onPressed: writable
                            ? () => send({
                                'type': 'email.read',
                                'connectionId': o['connectionId'],
                                'request': {
                                  'mode': 'attachment',
                                  'observationId': o['id'],
                                  'messageId': msg['id'],
                                  'attachmentId': f['id'],
                                },
                              })
                            : null,
                        child: Text(
                          uiText(context, 'Recupera {0}', [f['filename']]),
                        ),
                      ),
                  ],
                ],
              ),
            if (writable && o['data']['nextCursor'] != null)
              TextButton(
                onPressed: () => send({
                  'type': 'email.read',
                  'connectionId': o['connectionId'],
                  'request': {
                    ...o['request'] as GroupRecord,
                    'cursor': o['data']['nextCursor'],
                  },
                }),
                child: Text(uiText(context, 'Continua lettura privata')),
              ),
          ],
        ),
      for (final f in groupRows(view['attachments']))
        ExpansionTile(
          key: PageStorageKey('mail-file-${f['id']}'),
          title: Text(f['filename']),
          subtitle: Text(
            uiText(context, 'Allegato privato · v{0}', [f['version']]),
          ),
          children: [
            Builder(
              builder: (button) => TextButton(
                onPressed: working ? null : () => exportMailFile(f, button),
                child: Text(uiText(button, 'Esporta una copia')),
              ),
            ),
            if (m.canWrite)
              TextButton(
                onPressed: writable
                    ? () => confirmCommand(
                        'Condividere il file nello spazio?',
                        '${f['filename']} · v${f['version']}\nAnche i futuri partecipanti potranno leggerlo.',
                        'Condividi file',
                        {
                          'type': 'email.attachment.disclose',
                          'attachmentId': f['id'],
                          'fullHistoryDisclosed': true,
                        },
                      )
                    : null,
                child: Text(uiText(context, 'Condividi file nello spazio')),
              ),
          ],
        ),
    ];
  }
}

class _MailEditor extends StatefulWidget {
  const _MailEditor({
    required this.envelope,
    required this.existing,
    required this.compositionId,
    required this.connection,
    required this.email,
    required this.connections,
    required this.files,
  });
  final GroupRecord envelope;
  final GroupRecord? existing;
  final String? compositionId, connection;
  final String email;
  final List<GroupRecord> connections, files;
  @override
  State<_MailEditor> createState() => _MailEditorState();
}

class _MailEditorState extends State<_MailEditor> {
  late final fields = <String, TextEditingController>{
    for (final k in ['to', 'cc', 'bcc', 'subject', 'body', 'reason'])
      k: TextEditingController(
        text: ['to', 'cc', 'bcc'].contains(k)
            ? groupIds(widget.envelope[k]).join(', ')
            : widget.envelope[k] ?? '',
      ),
  };
  late String sender = widget.envelope['sender'],
      connection = widget.connection ?? '';
  late final files = [...groupRows(widget.envelope['attachments'])];
  String? problem;
  @override
  void dispose() {
    for (final f in fields.values) {
      f.dispose();
    }
    super.dispose();
  }

  void save() {
    final envelope = {...widget.envelope, 'sender': sender};
    for (final k in ['to', 'cc', 'bcc']) {
      final list = fields[k]!.text
          .split(RegExp('[,;\\n]'))
          .map((e) => e.trim())
          .where((e) => e.isNotEmpty)
          .toList();
      if (list.length > 20 ||
          list.any(
            (e) =>
                e.length > 254 ||
                !RegExp(r'^\S+@[^\s@]+\.[^\s@]+$').hasMatch(e),
          )) {
        setState(
          () => problem = 'Controlla gli indirizzi e separali con una virgola.',
        );
        return;
      }
      envelope[k] = list;
    }
    envelope['subject'] = fields['subject']!.text;
    envelope['body'] = fields['body']!.text;
    if (fields['body']!.text.length > 24000 ||
        fields['subject']!.text.length > 500 ||
        fields['subject']!.text.contains(RegExp(r'[\r\n\x00]'))) {
      setState(
        () => problem = 'Controlla l’oggetto (500 caratteri, una riga) e il testo (24.000 caratteri).',
      );
      return;
    }
    envelope['attachments'] = files;
    final existing = widget.existing, why = fields['reason']!.text.trim();
    Navigator.pop(context, <String, dynamic>{
      'type': existing == null ? 'email.draft.create' : 'email.draft.revise',
      'connectionId': connection.isEmpty ? null : connection,
      if (existing != null) ...{
        'draftId': existing['id'],
        'expectedVersion': existing['version'],
        if (widget.compositionId != null) 'compositionId': widget.compositionId,
      },
      'envelope': envelope,
      'reason': why.isEmpty ? 'Salvataggio della bozza privata' : why,
    });
  }

  @override
  Widget build(BuildContext context) {
    final linked = widget.connections
        .where((c) => c['canSend'] == true)
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.existing == null
              ? uiText(context, 'Nuova bozza')
              : uiText(context, 'Modifica bozza'),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            Text(uiText(context, 'Da · {0}', [sender])),
            if (widget.envelope['target'] == null)
              DropdownButton<String>(
                isExpanded: true,
                value: connection,
                items: [
                  DropdownMenuItem(
                    value: '',
                    child: Text(
                      uiText(context, 'Solo bozza · {0}', [widget.email]),
                    ),
                  ),
                  for (final c in linked)
                    DropdownMenuItem(
                      value: c['id'] as String,
                      child: Text(c['sender']),
                    ),
                  if (connection.isNotEmpty &&
                      !linked.any((c) => c['id'] == connection))
                    DropdownMenuItem(
                      value: connection,
                      child: Text(uiText(context, 'Casella scollegata')),
                    ),
                ],
                onChanged: (value) {
                  if (value == null) return;
                  setState(() {
                    connection = value;
                    sender = value.isEmpty
                        ? widget.email
                        : linked
                                  .where((c) => c['id'] == value)
                                  .firstOrNull?['sender'] ??
                              sender;
                  });
                },
              ),
            for (final e in {
              'to': 'A',
              'cc': 'Cc',
              'bcc': 'Ccn',
              'subject': 'Oggetto',
              'body': 'Messaggio',
              'reason': 'Nota sulla versione (facoltativa)',
            }.entries)
              TextField(
                controller: fields[e.key],
                decoration: InputDecoration(labelText: e.value),
                minLines: e.key == 'body' ? 3 : 1,
                maxLines: e.key == 'body' ? 9 : 1,
                keyboardType: ['to', 'cc', 'bcc'].contains(e.key)
                    ? TextInputType.emailAddress
                    : null,
                maxLength: switch (e.key) {
                  'body' => 24000,
                  'subject' => 500,
                  'reason' => 2000,
                  _ => null,
                },
              ),
            if (widget.files.isNotEmpty || files.isNotEmpty)
              ExpansionTile(
                title: Text(uiText(context, 'Allegati · {0}', [files.length])),
                children: [
                  for (final f in {
                    ...{
                      for (final f in files)
                        '${f['kind']}:${f['id']}:${f['version']}': f,
                    },
                    ...{
                      for (final f in widget.files)
                        '${f['kind']}:${f['id']}:${f['version']}': f,
                    },
                  }.values)
                    Builder(
                      builder: (_) {
                        bool same(GroupRecord r) =>
                            r['kind'] == f['kind'] &&
                            r['id'] == f['id'] &&
                            r['version'] == f['version'] &&
                            r['hash'] == f['hash'];
                        final on = files.any(same);
                        return CheckboxListTile(
                          title: Text(f['filename']),
                          subtitle: Text(
                            uiText(context, 'v{0}', [f['version']]),
                          ),
                          value: on,
                          onChanged: !on && files.length >= 10
                              ? null
                              : (selected) => setState(() {
                                  if (selected == true) {
                                    files.add({
                                      for (final k in [
                                        'kind',
                                        'id',
                                        'version',
                                        'hash',
                                        'filename',
                                      ])
                                        k: f[k],
                                    });
                                  } else {
                                    files.removeWhere(same);
                                  }
                                }),
                        );
                      },
                    ),
                ],
              ),
            if (problem != null) Text(uiText(context, problem!)),
            FilledButton(
              onPressed: sender.isEmpty ? null : save,
              child: Text(uiText(context, 'Salva bozza')),
            ),
          ],
        ),
      ),
    );
  }
}
