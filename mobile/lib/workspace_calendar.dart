part of 'workspace_integrations.dart';

extension _CalendarPanel on _IntegrationState {
  List<GroupRecord> get calendars =>
      groupRows(view['connections']).where((c) => c['active'] == true).toList();
  GroupRecord? publication(GroupRecord entry, String conn, String resource) =>
      groupRows(view['publications'])
          .where(
            (p) =>
                p['connectionId'] == conn &&
                p['resourceId'] == resource &&
                p['temporal']?['id'] == entry['id'] &&
                p['temporal']?['kind'] == entry['kind'],
          )
          .firstOrNull;
  Future<void> editEvent({GroupRecord? entry, GroupRecord? commitment}) async {
    final epoch = m.epoch, revision = view['contextRevision'];
    String zone;
    try {
      zone = await agendaLocalZone();
    } catch (_) {
      if (mounted) problem('Verifica il fuso orario del dispositivo.');
      return;
    }
    if (!mounted || epoch != m.epoch || !writable) return;
    final cmd = await showEditor(
      _EventForm(
        entry: entry,
        commitment: commitment,
        members: groupRows(view['members']),
        day: selectedDay,
        zone: zone,
        revision: revision,
      ),
    );
    if (cmd == null || !mounted || !writable) return;
    final p = (cmd['payload'] ?? cmd['time']) as GroupRecord;
    final title = commitment?['content'] ?? p['title'];
    final invites = cmd['audience'];
    final people = groupIds(invites?['people']);
    final audience = invites == null
        ? ''
        : switch (invites['kind']) {
            'all' => 'Tutto lo spazio',
            'people' =>
              groupRows(view['members'])
                  .where((p) => people.contains(p['id']))
                  .map((m) => m['name'])
                  .join(', '),
            _ => 'Solo nel calendario dello spazio',
          };
    await confirmCommand(
      'Salvare nello spazio?',
      '$title\n${_period(context, p)}\n$audience',
      'Salva',
      cmd,
    );
  }

  Future<void> proposeCalendar(
    GroupRecord t,
    GroupRecord c,
    GroupRecord r, {
    GroupRecord? action,
  }) async {
    final link = publication(t, c['id'], r['id']),
        op = action?['operation'] ?? (link == null ? 'create' : 'update');
    if (op == 'update' && link == null) return;
    final cmd = <String, dynamic>{
      'type': action == null ? 'calendar.propose' : 'calendar.revise',
      if (action != null) ...{
        'actionId': action['id'],
        'expectedVersion': action['version'],
      },
      'connectionId': c['id'],
      'resourceId': r['id'],
      'operation': op,
      if (op == 'update') 'publicationId': link!['id'],
      'temporal': {
        for (final k in ['kind', 'id', 'version']) k: t[k],
      },
      'payload': t['payload'],
      'reason': 'Pubblicazione della versione interna corrente',
      'shareWithWorkspace': true,
    };
    await confirmCommand(
      'Condividere la proposta nello spazio?',
      '${t['payload']['title']}\n${_period(context, t['payload'])}\nDestinazione · ${r['label']}\nPer pubblicare servirà la tua autorizzazione.',
      action == null ? 'Prepara proposta' : 'Aggiorna proposta',
      cmd,
    );
  }

  List<Widget> calendarContent() {
    final temporal = groupRows(view['temporal']),
        commitments = groupRows(view['ownCommitments']);
    return [
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.date_range),
        title: Text(uiText(context, 'Periodo di 30 giorni')),
        subtitle: Text(
          uiText(context, 'Dal {0}', [
            MaterialLocalizations.of(context).formatMediumDate(selectedDay),
          ]),
        ),
        onTap: working
            ? null
            : () async {
                final value = await showDatePicker(
                  context: context,
                  initialDate: selectedDay,
                  firstDate: DateTime(2000),
                  lastDate: DateTime(2100),
                );
                if (value == null || !mounted) return;
                selectedDay = value;
                pages
                  ..clear()
                  ..add(null);
                await load();
              },
      ),
      if (!widget.personal) ...[
        Text(
          uiText(context, 'Appuntamenti dello spazio'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        if (m.canWrite)
          FilledButton.tonalIcon(
            onPressed: writable ? () => editEvent() : null,
            icon: const Icon(Icons.add),
            label: Text(uiText(context, 'Nuovo appuntamento')),
          ),
        if (temporal.isEmpty)
          Text(uiText(context, 'Nessun appuntamento nel periodo scelto.')),
        for (final t in temporal)
          ExpansionTile(
            key: PageStorageKey('event-${t['kind']}-${t['id']}'),
            title: Text(t['payload']['title']),
            subtitle: Text(groupDate(context, t['payload']['start'])),
            children: [
              SelectableText(
                _period(context, t['payload']),
                key: const PageStorageKey('event-period'),
              ),
              Text(uiText(context, 'v{0} · {1}', [t['version'], t['reason']])),
              TextButton(
                onPressed: working
                    ? null
                    : () => history(
                        '${m.base}/calendar-history?kind=${t['kind']}&id=${t['id']}',
                        'Cronologia appuntamento',
                      ),
                child: Text(uiText(context, 'Cronologia')),
              ),
              if (m.canWrite && t['personId'] == m.actor) ...[
                if (t['kind'] == 'scheduled_event')
                  TextButton(
                    onPressed: writable ? () => editEvent(entry: t) : null,
                    child: Text(uiText(context, 'Modifica nello spazio')),
                  ),
                for (final c in calendars)
                  for (final r in groupRows(
                    c['resources'],
                  ).where((r) => r['canWriteSelf'] == true))
                    TextButton(
                      onPressed: writable
                          ? () => proposeCalendar(t, c, r)
                          : null,
                      child: Text(
                        uiText(context, 'Proponi pubblicazione su {0}', [
                          r['label'],
                        ]),
                      ),
                    ),
              ],
              if (m.canWrite &&
                  t['kind'] == 'scheduled_event' &&
                  t['personId'] != m.actor &&
                  (t['audience']?['kind'] == 'all' ||
                      groupIds(t['audience']?['people']).contains(m.actor)))
                Wrap(
                  children: [
                    for (final op in ['accepted', 'declined'])
                      TextButton(
                        onPressed: writable
                            ? () => confirmCommand(
                                op == 'accepted'
                                    ? 'Accettare l’invito?'
                                    : 'Rifiutare l’invito?',
                                t['payload']['title'],
                                op == 'accepted' ? 'Accetta' : 'Rifiuta',
                                {
                                  'type': 'temporal.respond',
                                  'eventId': t['id'],
                                  'expectedVersion': t['version'],
                                  'response': op,
                                },
                              )
                            : null,
                        child: Text(
                          op == 'accepted'
                              ? uiText(context, 'Accetta invito')
                              : uiText(context, 'Rifiuta invito'),
                        ),
                      ),
                  ],
                ),
            ],
          ),
        if (m.canWrite && commitments.isNotEmpty)
          ExpansionTile(
            key: const PageStorageKey('my-commitments'),
            title: Text(uiText(context, 'Data dei miei impegni')),
            children: [
              for (final c in commitments)
                ListTile(
                  title: Text(c['content']),
                  trailing: const Icon(Icons.edit_calendar),
                  onTap: writable ? () => editEvent(commitment: c) : null,
                ),
            ],
          ),
        if (groupRows(view['actions']).isNotEmpty)
          Text(
            uiText(context, 'Pubblicazioni'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
        for (final a in groupRows(view['actions']))
          ExpansionTile(
            key: PageStorageKey('publication-${a['id']}'),
            title: Text(a['payload']['title']),
            subtitle: Text(
              uiText(context, '{0} · v{1}', [
                externalState(a['status']),
                a['version'],
              ]),
            ),
            children: [
              Text('${a['target']} · ${a['personName']}'),
              Text(_period(context, a['payload'])),
              Text(a['reason']),
              ...effects(
                a,
                '${a['payload']['title']}\n${_period(context, a['payload'])}\nDestinazione · ${a['target']}',
              ),
              TextButton(
                onPressed: working
                    ? null
                    : () => history(
                        '${m.base}/calendar-history?kind=action&id=${a['id']}',
                        'Cronologia pubblicazione',
                      ),
                child: Text(uiText(context, 'Cronologia pubblicazione')),
              ),
              if (m.canWrite &&
                  a['personId'] == m.actor &&
                  a['proposedBy'] == m.actor &&
                  const {
                    'PROPOSED',
                    'AUTHORIZED',
                    'FAILED',
                  }.contains(a['status']))
                for (final t in temporal.where(
                  (t) =>
                      t['kind'] == a['temporal']?['kind'] &&
                      t['id'] == a['temporal']?['id'],
                ))
                  for (final c in calendars.where(
                    (c) => c['id'] == a['connectionId'],
                  ))
                    for (final r in groupRows(c['resources']).where(
                      (r) =>
                          r['id'] == a['resourceId'] &&
                          r['canWriteSelf'] == true,
                    ))
                      if (a['operation'] == 'create' ||
                          publication(t, c['id'], r['id']) != null)
                        TextButton(
                          onPressed: writable
                              ? () => proposeCalendar(t, c, r, action: a)
                              : null,
                          child: Text(
                            uiText(
                              context,
                              'Aggiorna proposta dalla versione interna',
                            ),
                          ),
                        ),
            ],
          ),
      ],
      for (final c in calendars)
        for (final r in groupRows(
          c['resources'],
        ).where((r) => r['canRead'] == true))
          ExpansionTile(
            key: PageStorageKey('calendar-${c['id']}-${r['id']}'),
            title: Text(r['label']),
            subtitle: Text(uiText(context, 'Letture personali')),
            children: [
              for (final mode in ['events', 'availability'])
                TextButton(
                  onPressed: writable
                      ? () => send({
                          'type': 'calendar.read',
                          'connectionId': c['id'],
                          'resourceId': r['id'],
                          'mode': mode,
                          'start': view['window']['start'],
                          'end': view['window']['end'],
                        })
                      : null,
                  child: Text(
                    mode == 'events'
                        ? uiText(context, 'Leggi eventi privati')
                        : uiText(context, 'Leggi disponibilità'),
                  ),
                ),
            ],
          ),
      for (final o in groupRows(view['observations']))
        ExpansionTile(
          key: PageStorageKey('calendar-read-${o['id']}'),
          title: Text(
            uiText(context, 'Lettura privata · {0}', [
              groupDate(context, o['observedAt']),
            ]),
          ),
          children: [
            if (o['data']['complete'] != true)
              Text(uiText(context, 'Risultati parziali.')),
            if (groupRows(o['data']['events']).isEmpty &&
                groupRows(o['data']['busy']).isEmpty)
              Text(uiText(context, 'Nessun evento trovato.')),
            for (final e in groupRows(o['data']['events']))
              ListTile(
                title: Text(e['payload']['title']),
                subtitle: Text(
                  '${_period(context, e['payload'])}${e['deleted'] == true ? ' · rimosso' : ''}',
                ),
              ),
            for (final b in groupRows(o['data']['busy']))
              ListTile(
                title: Text(uiText(context, 'Occupato')),
                subtitle: Text(_period(context, b)),
              ),
            if (o['data']['nextCursor'] != null)
              for (final c in calendars.where(
                (c) => groupRows(c['resources']).any(
                  (r) => r['id'] == o['resourceId'] && r['canRead'] == true,
                ),
              ))
                TextButton(
                  onPressed: writable
                      ? () => send({
                          'type': 'calendar.read',
                          'connectionId': c['id'],
                          'resourceId': o['resourceId'],
                          'mode': o['mode'],
                          'start': o['start'],
                          'end': o['end'],
                          'cursor': o['data']['nextCursor'],
                        })
                      : null,
                  child: Text(uiText(context, 'Continua lettura privata')),
                ),
          ],
        ),
      for (final alert in groupRows(view['alerts'])) Text(alert['detail']),
    ];
  }
}

class _EventForm extends StatefulWidget {
  const _EventForm({
    required this.entry,
    required this.commitment,
    required this.members,
    required this.day,
    required this.zone,
    required this.revision,
  });
  final GroupRecord? entry, commitment;
  final List<GroupRecord> members;
  final DateTime day;
  final String zone;
  final int revision;
  @override
  State<_EventForm> createState() => _EventFormState();
}

class _EventFormState extends State<_EventForm> {
  late final title = TextEditingController(
        text:
            widget.commitment?['content'] ??
            widget.entry?['payload']?['title'] ??
            '',
      ),
      reason = TextEditingController();
  late DateTime start = widget.entry == null
      ? DateTime(
          widget.day.year,
          widget.day.month,
          widget.day.day,
          DateTime.now().hour + 1,
        )
      : DateTime.parse(widget.entry!['payload']['start']).toLocal();
  late DateTime end = widget.entry == null
      ? start.add(const Duration(hours: 1))
      : DateTime.parse(widget.entry!['payload']['end']).toLocal();
  late String audience = widget.entry?['audience']?['kind'] ?? 'calendar';
  late final people = groupIds(widget.entry?['audience']?['people']).toSet();
  @override
  void dispose() {
    title.dispose();
    reason.dispose();
    super.dispose();
  }

  Future<void> instant(bool first) async {
    final initial = first ? start : end;
    final d = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(1970),
      lastDate: DateTime(2200),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (t == null || !mounted) return;
    final next = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    if (next.hour != t.hour || next.minute != t.minute) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            uiText(
              context,
              'Questo orario non esiste nel fuso del dispositivo.',
            ),
          ),
        ),
      );
      return;
    }
    setState(() {
      if (first) {
        final span = end.difference(start);
        start = next;
        if (!end.isAfter(next))
          end = next.add(span.isNegative ? const Duration(hours: 1) : span);
      } else {
        end = next;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final own = widget.commitment, entry = widget.entry;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          own != null
              ? uiText(context, 'Data dell’impegno')
              : entry == null
              ? uiText(context, 'Nuovo appuntamento')
              : uiText(context, 'Modifica appuntamento'),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (own == null)
              TextField(
                controller: title,
                maxLength: 12000,
                decoration: InputDecoration(
                  labelText: uiText(context, 'Titolo'),
                ),
                onChanged: (_) => setState(() {}),
              )
            else
              Text(own['content']),
            for (final f in [true, false])
              ListTile(
                title: Text(
                  f ? uiText(context, 'Inizio') : uiText(context, 'Fine'),
                ),
                subtitle: Text(
                  groupDate(
                    context,
                    (f ? start : end).toUtc().toIso8601String(),
                  ),
                ),
                trailing: const Icon(Icons.edit_calendar),
                onTap: () => instant(f),
              ),
            Text(uiText(context, 'Ora locale · {0}', [widget.zone])),
            if (own == null) ...[
              DropdownButtonFormField<String>(
                initialValue: audience,
                decoration: InputDecoration(
                  labelText: uiText(context, 'Invitati'),
                ),
                items: [
                  DropdownMenuItem(
                    value: 'calendar',
                    child: Text(uiText(context, 'Solo nel calendario')),
                  ),
                  DropdownMenuItem(
                    value: 'all',
                    child: Text(uiText(context, 'Tutto lo spazio')),
                  ),
                  DropdownMenuItem(
                    value: 'people',
                    child: Text(uiText(context, 'Scegli persone')),
                  ),
                ],
                onChanged: (v) => setState(() => audience = v!),
              ),
              if (audience == 'people')
                for (final p in widget.members)
                  CheckboxListTile(
                    value: people.contains(p['id']),
                    title: Text(p['name']),
                    onChanged: (v) => setState(() {
                      if (v == true) {
                        people.add(p['id']);
                      } else {
                        people.remove(p['id']);
                      }
                    }),
                  ),
            ],
            TextField(
              controller: reason,
              decoration: InputDecoration(
                labelText: own == null
                    ? uiText(context, 'Nota (facoltativa)')
                    : uiText(context, 'Motivo'),
              ),
              maxLength: 2000,
              onChanged: (_) => setState(() {}),
            ),
            FilledButton(
              onPressed:
                  !end.isAfter(start) ||
                      title.text.trim().isEmpty ||
                      (own != null && reason.text.trim().isEmpty) ||
                      (own == null && audience == 'people' && people.isEmpty)
                  ? null
                  : () {
                      final sameTime =
                          entry != null &&
                          start.isAtSameMomentAs(
                            DateTime.parse(entry['payload']['start']),
                          ) &&
                          end.isAtSameMomentAs(
                            DateTime.parse(entry['payload']['end']),
                          );
                      final time = {
                        'start': start.toUtc().toIso8601String(),
                        'end': end.toUtc().toIso8601String(),
                        'timeZone': sameTime
                            ? entry['payload']['timeZone']
                            : widget.zone,
                      };
                      Navigator.pop(context, <String, dynamic>{
                        'expectedContextRevision': widget.revision,
                        'representSelf': true,
                        'reason': reason.text.trim().isEmpty
                            ? 'Appuntamento impostato nello spazio'
                            : reason.text.trim(),
                        if (own != null) ...{
                          'type': 'commitment.time.set',
                          'commitmentId': own['id'],
                          'expectedVersion': own['version'],
                          'time': time,
                        } else ...{
                          'type': entry == null
                              ? 'temporal.create'
                              : 'temporal.revise',
                          if (entry != null) ...{
                            'eventId': entry['id'],
                            'expectedVersion': entry['version'],
                          },
                          'payload': {...time, 'title': title.text.trim()},
                          'audience': {
                            'kind': audience,
                            if (audience == 'people') 'people': people.toList(),
                          },
                        },
                      });
                    },
              child: Text(uiText(context, 'Controlla')),
            ),
          ],
        ),
      ),
    );
  }
}
