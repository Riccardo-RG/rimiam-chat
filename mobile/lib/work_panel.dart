part of 'workspace_work.dart';

const workPhases = {
  'queued': 'In coda',
  'working': 'In corso',
  'needs_input': 'Serve un chiarimento',
  'paused': 'In pausa',
  'stopped': 'Fermata',
  'completed': 'Completata',
};

extension _WorkPanel on _WorkState {
  Future<void> newWork() async {
    if (!write || view['canControl'] != true) return;
    final epoch = group.epoch,
        objective = await groupText(
          context,
          title: uiText(context, 'Avvia analisi'),
          label: uiText(context, 'Cosa vuoi analizzare?'),
          action: uiText(context, 'Continua'),
          max: 3900,
        );
    if (objective == null || !mounted || epoch != group.epoch) return;
    await approve(
      uiText(context, 'Avviare l’analisi?'),
      uiText(
        context,
        '{0}\n\nIl modello configurato per lo spazio riceverà il materiale pertinente. Il risultato sarà consultabile dal gruppo.',
        [objective],
      ),
      uiText(context, 'Avvia analisi'),
      {'type': 'work.converse', 'text': 'Analizza $objective'},
    );
  }

  Future<void> steer(GroupRecord w, String kind, String label) async {
    final epoch = group.epoch;
    final input = await groupText(
      context,
      title: label,
      label: uiText(context, 'Indicazione'),
      max: 4000,
      action: uiText(context, 'Controlla'),
      detail: w['contract']['objective'],
    );
    if (input == null || !mounted || epoch != group.epoch) return;
    await approve(
      uiText(context, 'Condividere questa indicazione?'),
      uiText(
        context,
        '{0}\n\nL’indicazione entra nel lavoro dello spazio ed è disponibile al modello che lo esegue.',
        [input],
      ),
      uiText(context, 'Conferma'),
      {
        'type': 'work.converse',
        'workId': w['id'],
        'expectedRevision': w['revision'],
        'instruction': kind,
        'text': input,
      },
    );
  }

  Future<void> control(GroupRecord w, String text, String label) =>
      approve('$label?', w['contract']['objective'], label, {
        'type': 'work.converse',
        'workId': w['id'],
        'expectedRevision': w['revision'],
        'text': text,
      });
  Future<void> historyWork(GroupRecord w) async {
    final epoch = group.epoch;
    int? before;
    do {
      GroupRecord? data;
      await run(() async {
        data = await widget.api.get(
          '${group.path}/active-work-history?id=${Uri.encodeQueryComponent(w['id'])}${before != null ? '&before=$before' : ''}',
        );
      }, reload: false);
      if (data == null || !mounted || !group.admitted || epoch != group.epoch)
        return;
      final d = data!, next = d['nextBefore'];
      final choice = await showDialog<Object>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(uiText(ctx, 'Cronologia e fonti')),
          scrollable: true,
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final c in groupRows(d['contracts']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    uiText(ctx, 'v{0} · {1}', [c['version'], c['objective']]),
                  ),
                  subtitle: Text(
                    [
                      c['scope'],
                      c['expectedOutput'],
                      c['reason'],
                    ].whereType<String>().join('\n'),
                  ),
                ),
              for (final i in groupRows(d['inputs'])) ...[
                Text(i['content']),
                Text(i['qualification']),
                if (i['provenance']?['reference'] is Map)
                  TextButton(
                    onPressed: () =>
                        Navigator.pop(ctx, i['provenance']['reference']),
                    child: Text(uiText(ctx, 'Apri la fonte')),
                  ),
              ],
              for (final c in groupRows(d['contributions']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    uiText(ctx, 'Risultato · v{0}', [c['contractVersion']]),
                  ),
                  subtitle: Text(c['body']),
                ),
              for (final a in groupRows(d['events']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(a['content']),
                  subtitle: Text(groupDate(context, a['createdAt'])),
                ),
            ],
          ),
          actions: [
            if (next != null)
              TextButton(
                onPressed: () => Navigator.pop(ctx, next),
                child: Text(uiText(ctx, 'Precedenti')),
              ),
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(uiText(ctx, 'Chiudi')),
            ),
          ],
        ),
      );
      if (!mounted || group.epoch != epoch || !group.admitted) return;
      if (choice is GroupRecord) {
        await showRef(choice);
        return;
      }
      before = choice is int ? choice : null;
    } while (before != null);
  }

  List<Widget> workItems() {
    final controls = group.canWrite && view['canControl'] == true,
        works = groupRows(view['works']);
    final saved = groupRows(group.snapshot['artifactVersions'])
        .map((v) => v['contribution_id'])
        .whereType<String>()
        .toSet();
    return [
      if (controls)
        FilledButton.tonalIcon(
          onPressed: write ? newWork : null,
          icon: const Icon(Icons.add),
          label: Text(uiText(context, 'Avvia analisi')),
        ),
      if (works.isEmpty)
        Text(uiText(context, 'Nessuna analisi in questo spazio.')),
      for (final w in works)
        ExpansionTile(
          key: ValueKey(w['id']),
          title: Text(w['contract']['objective']),
          subtitle: Text(
            uiText(context, '{0} · v{1}', [
              uiText(
                context,
                workPhases[w['phase']] ?? 'Stato non disponibile',
              ),
              w['contract']['version'],
            ]),
          ),
          initiallyExpanded: w['id'] == widget.initialWorkId,
          children: [
            Text(
              [
                w['contract']['scope'],
                w['contract']['expectedOutput'],
                ...groupIds(w['contract']['anchors']),
              ].whereType<String>().join('\n'),
            ),
            if (w['error'] != null)
              Text(
                uiText(
                  context,
                  'Verifica il materiale e le indicazioni prima di riprendere.',
                ),
              ),
            for (final s in groupRows(
              view['suggestions'],
            ).where((s) => s['workId'] == w['id'] && s['status'] != 'applied'))
              ListTile(
                title: Text(s['text']),
                subtitle: Text(
                  s['status'] == 'stale'
                      ? uiText(context, 'Indicazione superata')
                      : uiText(context, 'Indicazione suggerita'),
                ),
                trailing:
                    controls &&
                        s['status'] == 'pending' &&
                        s['expectedRevision'] == w['revision']
                    ? act(
                        uiText(context, 'Applica'),
                        write
                            ? () => approve(
                                uiText(context, 'Applicare l’indicazione?'),
                                s['text'],
                                uiText(context, 'Applica'),
                                {
                                  'type': 'work.apply_suggestion',
                                  'suggestionId': s['id'],
                                  'confirmExactInstruction': true,
                                },
                              )
                            : null,
                      )
                    : null,
              ),
            for (final issue in groupRows(w['issues'])) ...[
              Text(issue['content']),
              if (controls &&
                  issue['kind'] == 'revision' &&
                  groupIds(issue['requiredPeople']).contains(group.actor) &&
                  !groupIds(issue['acknowledgedBy']).contains(group.actor))
                act(
                  uiText(context, 'Conferma questa direzione'),
                  write
                      ? () => control(
                          w,
                          'confermo: ${issue['id']}',
                          'Conferma direzione',
                        )
                      : null,
                ),
              if (controls && issue['actor'] == group.actor)
                act(
                  uiText(context, 'Ritira la tua richiesta'),
                  write
                      ? () => control(
                          w,
                          'ritiro: ${issue['id']}',
                          'Ritira richiesta',
                        )
                      : null,
                ),
              if (controls && issue['kind'] == 'context')
                act(
                  uiText(context, 'Usa il contesto aggiornato'),
                  write
                      ? () => control(
                          w,
                          'usa contesto aggiornato',
                          'Usa il contesto aggiornato',
                        )
                      : null,
                ),
            ],
            if (w['contribution'] case final GroupRecord c) ...[
              Text(
                w['validity'] == 'potentially_outdated'
                    ? uiText(context, 'Risultato da rivalutare')
                    : uiText(context, 'Risultato dell’analisi'),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              SelectableText(c['body']),
              Text(c['qualification']),
              for (final s in groupRows(c['sources']))
                if (s['reference'] != null)
                  act(s['label'], () => showRef(s['reference'])),
              if (controls)
                act(
                  saved.contains(c['id'])
                      ? uiText(context, 'Salvato in Condivisi')
                      : uiText(context, 'Salva in Condivisi'),
                  write && !saved.contains(c['id'])
                      ? () => approve(
                          uiText(context, 'Salvare in Condivisi?'),
                          uiText(
                            context,
                            'Il gruppo ritroverà questo risultato nei documenti dello spazio.',
                          ),
                          uiText(context, 'Salva'),
                          {
                            'type': 'artifact.from_contribution',
                            'contributionId': c['id'],
                            'title': _title(
                              c['objective'] ?? w['contract']['objective'],
                            ),
                            'purpose': 'Valutare il contributo di Emme',
                            'nonOperative': true,
                            'saveToLibrary': true,
                          },
                        )
                      : null,
                ),
            ],
            if (controls && !{'completed', 'stopped'}.contains(w['phase'])) ...[
              ExpansionTile(
                title: Text(uiText(context, 'Fornisci un’indicazione')),
                children: [
                  for (final e in const {
                    'input': 'Materiale',
                    'assumption': 'Ipotesi',
                    'objection': 'Obiezione',
                    'redirect': 'Nuova direzione',
                    'format': 'Formato del risultato',
                  }.entries)
                    act(
                      uiText(context, e.value),
                      write ? () => steer(w, e.key, e.value) : null,
                    ),
                ],
              ),
              Wrap(
                children: [
                  if (w['phase'] != 'paused')
                    act(
                      uiText(context, 'Pausa'),
                      write
                          ? () => control(w, 'pausa', 'Metti in pausa')
                          : null,
                    ),
                  if (w['phase'] == 'paused' && groupRows(w['issues']).isEmpty)
                    act(
                      uiText(context, 'Riprendi'),
                      write
                          ? () => control(w, 'riprendi', 'Riprendi analisi')
                          : null,
                    ),
                  act(
                    uiText(context, 'Ferma'),
                    write ? () => control(w, 'ferma', 'Ferma analisi') : null,
                  ),
                ],
              ),
            ],
            for (final e
                in groupRows(view['events'])
                    .where((e) => e['workId'] == w['id'])
                    .toList()
                    .reversed
                    .take(3)
                    .toList()
                    .reversed)
              Text(e['content']),
            act(
              uiText(context, 'Cronologia e fonti'),
              acting ? null : () => historyWork(w),
            ),
          ],
        ),
      if (pages.length > 1)
        act(
          uiText(context, 'Pagina precedente'),
          acting
              ? null
              : () {
                  pages.removeLast();
                  refresh();
                },
        ),
      if (view['next'] != null)
        act(
          uiText(context, 'Altre analisi'),
          acting
              ? null
              : () {
                  pages.add(view['next']);
                  refresh();
                },
        ),
    ];
  }
}

String _title(String value) {
  if (value.length <= 160) return value;
  final last = value.codeUnitAt(159);
  return value.substring(0, last >= 0xd800 && last <= 0xdbff ? 159 : 160);
}
