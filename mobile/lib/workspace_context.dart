import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'workspace_governance.dart';
import 'workspace_consultation.dart';

class WorkspaceContextScreen extends StatefulWidget {
  const WorkspaceContextScreen({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.workspaceName,
    this.vault = const DeviceDraftVault(),
  });
  final RimiamApi api;
  final String workspaceId, workspaceName;
  final DraftVault vault;
  @override
  State<WorkspaceContextScreen> createState() => _ContextState();
}

class _ContextState extends State<WorkspaceContextScreen>
    with WidgetsBindingObserver {
  late final group = GroupGovernance(
    widget.api,
    widget.workspaceId,
    direction: false,
    vault: widget.vault,
  );
  late final reading = WorkspaceConsultation(group, widget.vault);
  final input = TextEditingController();
  bool loading = true,
      working = false,
      inspect = false,
      started = false,
      consultationReady = false,
      active = true;
  int generation = 0;
  String section = 'Riferimenti', dates = 'Tutto il periodo';
  String? issue;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    input.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if ((state == AppLifecycleState.paused ||
            state == AppLifecycleState.hidden) &&
        active) {
      generation++;
      setState(() {
        active = false;
        group.suspend();
        reading.turns.clear();
        input.clear();
        started = false;
        consultationReady = false;
      });
    } else if (state == AppLifecycleState.resumed && !active) {
      active = true;
      _load();
    }
  }

  Future<void> _load() async {
    final gen = ++generation;
    setState(() {
      loading = true;
      issue = null;
    });
    try {
      await group.load();
      if (!mounted || gen != generation) return;
      consultationReady = false;
      try {
        await reading.load();
        if (!mounted || gen != generation) return;
        consultationReady = true;
      } catch (e) {
        if (groupDenied(e)) rethrow;
        if (!mounted || gen != generation) return;
        issue = 'Consultazione personale non disponibile. Puoi comunque sfogliare i riferimenti.';
      }
      if (!mounted || gen != generation) return;
      setState(() => started = true);
    } catch (e) {
      if (mounted && gen == generation)
        setState(() {
          issue = groupIssue(e);
          started = false;
        });
    } finally {
      if (mounted && gen == generation) setState(() => loading = false);
    }
  }

  Future<void> _consult(GroupRecord request) async {
    if (working || reading.busy || !started || !consultationReady) return;
    final gen = generation;
    setState(() {
      working = true;
      issue = null;
    });
    try {
      await reading.run(request);
      if (!mounted || gen != generation) return;
      if (request['action'] == 'ask' &&
          input.text.trim() == request['question'])
        input.clear();
    } catch (e) {
      if (mounted && gen == generation)
        setState(() {
          issue = groupIssue(e);
          if (groupDenied(e)) {
            group.admitted = false;
            reading.turns.clear();
            started = false;
          }
        });
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> _command(GroupRecord command) async {
    if (working || !group.canWrite) return;
    setState(() {
      working = true;
      issue = null;
    });
    try {
      await group.send(command);
      if (mounted) await _load();
    } catch (e) {
      if (mounted)
        setState(() {
          issue = groupIssue(e);
          if (groupDenied(e)) {
            group.admitted = false;
            started = false;
          }
        });
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> _ref(GroupRecord ref) async {
    final target = await openGroupReference(context, group, ref);
    if (mounted && target != null) Navigator.pop(context, target);
  }

  bool _matches(GroupRecord item) {
    final d = DateTime.tryParse(item['created_at'] as String? ?? '')?.toLocal();
    if (dates == 'Tutto il periodo' || d == null) return true;
    final now = DateTime.now(),
        start = DateTime(now.year, now.month, now.day - 6);
    return dates == 'Ultimi 7 giorni' ? !d.isBefore(start) : d.isBefore(start);
  }

  bool get mayAct =>
      group.canWrite && !working && group.journal.pending == null;
  Future<void> _review(GroupRecord c, String action) async {
    GroupRecord cmd;
    final info = groupRows(group.snapshot['information'])
        .where((i) => i['subject'] == c['subject'])
        .firstOrNull;
    switch (action) {
      case 'retry':
        cmd = {
          'type': 'interpretation.retry',
          'interpretationId': c['interpretation_id'],
        };
      case 'question':
        cmd = {
          'type': 'question.open',
          'sourceId': c['source_id'],
          'candidateId': c['id'],
          'content': c['content'],
        };
      case 'accept':
        if (!await groupConfirm(
              context,
              uiText(context, 'Accettare il riferimento?'),
              c['content'] as String,
              uiText(context, 'Accetta'),
            ) ||
            !mounted)
          return;
        cmd = {
          'type': 'information.accept',
          'candidateId': c['id'],
          'descriptiveOnly': true,
        };
      case 'correct':
        if (info == null) return;
        final why = await groupText(
          context,
          title: uiText(context, 'Correggi riferimento'),
          detail: uiText(context, 'Versione {0}\n{1}\n\nNuovo testo\n{2}', [
            info['current_version'],
            info['content'],
            c['content'],
          ]),
          label: uiText(context, 'Motivo della correzione'),
          action: uiText(context, 'Conferma correzione'),
        );
        if (!mounted || why == null) return;
        cmd = {
          'type': 'information.correct',
          'informationId': info['id'],
          'expectedVersion': info['current_version'],
          'candidateId': c['id'],
          'reason': why,
          'descriptiveOnly': true,
        };
      case 'commit':
        final people = await groupPeople(
          context,
          group,
          title: uiText(context, 'Chi riguarda l’impegno?'),
          includeSelf: true,
        );
        if (!mounted || people == null) return;
        if (!await groupConfirm(
              context,
              uiText(context, 'Proporre questo impegno?'),
              uiText(context, '{0}\n\n{1}. Ciascuno potrà approvare per sé.', [
                c['content'],
                people.map(group.name).join(', '),
              ]),
              uiText(context, 'Proponi'),
            ) ||
            !mounted)
          return;
        cmd = {
          'type': 'commitment.propose',
          'candidateId': c['id'],
          'people': people.toList(),
        };
      default:
        return;
    }
    await _command(cmd);
  }

  Widget _candidate(GroupRecord c) {
    final stale =
        c['context_revision'] !=
        group.snapshot['workspace']['context_revision'];
    final correction = groupRows(group.snapshot['information'])
        .any((i) => i['subject'] == c['subject']);
    final sources = {
      c['source_id'],
      ...groupIds(c['source_ids']),
    }.whereType<String>();
    return ExpansionTile(
      key: ValueKey(c['id']),
      tilePadding: EdgeInsets.zero,
      title: Text(c['subject'] as String),
      subtitle: Text(
        c['origin'] == 'inferred'
            ? uiText(context, 'Deduzione di Emme')
            : uiText(context, 'Da una fonte condivisa'),
      ),
      children: [
        SelectableText(c['content'] as String),
        if ((c['qualification'] as String? ?? '').isNotEmpty)
          Text(c['qualification'] as String),
        for (final id in sources)
          TextButton(
            onPressed: () => _ref({'kind': 'source', 'id': id, 'version': 1}),
            child: Text(
              sources.length == 1
                  ? uiText(context, 'Fonte originale')
                  : uiText(context, 'Fonte {0}', [
                      sources.toList().indexOf(id) + 1,
                    ]),
            ),
          ),
        if (mayAct && stale)
          TextButton(
            onPressed: () => _review(c, 'retry'),
            child: Text(uiText(context, 'Richiedi una nuova lettura')),
          ),
        if (mayAct && !stale) ...[
          if (c['classification'] == 'descriptive')
            TextButton(
              onPressed: () => _review(c, correction ? 'correct' : 'accept'),
              child: Text(
                correction
                    ? uiText(context, 'Valuta come correzione')
                    : uiText(context, 'Accetta come riferimento'),
              ),
            ),
          if (c['classification'] == 'question')
            TextButton(
              onPressed: () => _review(c, 'question'),
              child: Text(uiText(context, 'Conserva come domanda aperta')),
            ),
          TextButton(
            onPressed: () => _review(c, 'commit'),
            child: Text(uiText(context, 'Proponi come impegno')),
          ),
        ],
      ],
    );
  }

  List<Widget> _records() {
    final items = switch (section) {
      'Riferimenti' => groupRows(group.snapshot['information']),
      'Da valutare' => group.proposed,
      _ => groupRows(
        group.snapshot['questions'],
      ).where((q) => q['status'] == 'open').toList(),
    };
    final result = items
        .where((item) => section == 'Domande' || _matches(item))
        .toList();
    return [
      Wrap(
        spacing: 6,
        children: [
          for (final slug in ['Riferimenti', 'Da valutare', 'Domande'])
            ChoiceChip(
              label: Text(slug),
              selected: section == slug,
              onSelected: (_) => setState(() => section = slug),
            ),
        ],
      ),
      if (items.isNotEmpty && section != 'Domande')
        DropdownButton<String>(
          value: dates,
          items: [
            for (final val in [
              'Tutto il periodo',
              'Ultimi 7 giorni',
              'Precedenti',
            ])
              DropdownMenuItem(value: val, child: Text(val)),
          ],
          onChanged: (v) {
            if (v != null) setState(() => dates = v);
          },
        ),
      if (result.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text(
            section == 'Da valutare'
                ? uiText(context, 'Nessuna proposta da valutare.')
                : section == 'Domande'
                ? uiText(context, 'Nessuna domanda aperta.')
                : uiText(context, 'Nessun riferimento in questo periodo.'),
          ),
        ),
      for (final row in result)
        if (section == 'Da valutare')
          _candidate(row)
        else
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text((row['subject'] ?? row['content']) as String),
            subtitle: section == 'Riferimenti'
                ? Text(
                    uiText(context, 'Accettato da {0} · v{1}', [
                      group.name(row['accepted_by']),
                      row['current_version'],
                    ]),
                  )
                : null,
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _ref({
              'id': row['id'],
              'kind': section == 'Riferimenti' ? 'information' : 'question',
              'version': row['current_version'] ?? row['version'],
            }),
          ),
    ];
  }

  Future<void> _share(GroupRecord turn) async {
    if (!await groupConfirm(
          context,
          uiText(context, 'Condividere nella chat dello spazio?'),
          turn['answer'] as String,
          uiText(context, 'Condividi'),
        ) ||
        !mounted)
      return;
    await _consult(reading.action('share', turn['id'] as String));
  }

  @override
  Widget build(BuildContext context) {
    final ready = started && active && !loading,
        free = consultationReady && !working && reading.pending == null;
    return Scaffold(
      appBar: AppBar(
        title: Text(uiText(context, 'Contesto condiviso')),
        actions: [
          IconButton(
            tooltip: uiText(context, 'Aggiorna'),
            icon: const Icon(Icons.refresh),
            onPressed: loading || working ? null : _load,
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            Text(
              widget.workspaceName,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (loading) const LinearProgressIndicator(),
            if (issue != null)
              Semantics(liveRegion: true, child: Text(uiText(context, issue!))),
            if (!started && !loading)
              TextButton(
                onPressed: _load,
                child: Text(uiText(context, 'Ricarica')),
              ),
            if (ready) ...[
              Text(
                uiText(
                  context,
                  'Chiedi a Emme del contesto di questo spazio. La risposta resta visibile solo a te.',
                ),
              ),
              if (reading.turns.isEmpty) ...[
                for (final q in [
                  'Quali riferimenti abbiamo già accettato?',
                  'Quali questioni sono ancora aperte?',
                ])
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: free ? () => _consult(reading.ask(q)) : null,
                      child: Text(q),
                    ),
                  ),
                if (reading.last != null)
                  TextButton.icon(
                    icon: const Icon(Icons.history),
                    onPressed: free
                        ? () => _consult(
                            reading.action(
                              'resume',
                              reading.last!['id'] as String,
                            ),
                          )
                        : null,
                    label: Text(
                      uiText(context, 'Riprendi l’ultima consultazione · {0}', [
                        groupDate(context, reading.last!['createdAt']),
                      ]),
                    ),
                  ),
              ],
              for (final t in reading.turns) ...[
                const Divider(),
                Text(
                  t['question'] as String,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(groupDate(context, t['createdAt'])),
                SelectableText(t['answer'] as String),
                for (final r in groupRows(t['references']))
                  TextButton.icon(
                    icon: const Icon(Icons.link),
                    label: Text(r['label'] as String),
                    onPressed: () => _ref(r),
                  ),
                if (t['sharedMessageId'] != null)
                  TextButton(
                    onPressed: () =>
                        Navigator.pop(context, t['sharedMessageId'] as String),
                    child: Text(uiText(context, 'Vedi in chat')),
                  )
                else if (group.canWrite)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      icon: const Icon(Icons.ios_share),
                      label: Text(uiText(context, 'Condividi in chat')),
                      onPressed: free ? () => _share(t) : null,
                    ),
                  ),
              ],
              if (working) const LinearProgressIndicator(),
              if (reading.pending != null && !working) ...[
                Text(
                  reading.pending!['action'] == 'share'
                      ? uiText(context, 'Condivisione da verificare.')
                      : uiText(context, 'Richiesta in sospeso · {0}', [
                          reading.pending!['question'],
                        ]),
                ),
                Wrap(
                  children: [
                    TextButton(
                      onPressed: () => _consult(reading.pending!),
                      child: Text(uiText(context, 'Riprova')),
                    ),
                    TextButton(
                      onPressed: () async {
                        try {
                          await reading.abandonRetry();
                          if (mounted) setState(() => issue = null);
                        } catch (e) {
                          if (mounted) setState(() => issue = groupIssue(e));
                        }
                      },
                      child: Text(
                        uiText(context, 'Lascia in sospeso e continua'),
                      ),
                    ),
                  ],
                ),
              ],
              TextField(
                controller: input,
                minLines: 1,
                maxLines: 4,
                maxLength: 2000,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: reading.turns.isEmpty
                      ? uiText(context, 'La tua domanda')
                      : uiText(context, 'Continua la consultazione'),
                ),
              ),
              FilledButton(
                onPressed: free && input.text.trim().isNotEmpty
                    ? () => _consult(reading.ask(input.text))
                    : null,
                child: Text(uiText(context, 'Chiedi a Emme')),
              ),
              if (reading.turns.isNotEmpty)
                TextButton(
                  onPressed: free
                      ? () => setState(() {
                          reading.turns.clear();
                          input.clear();
                          issue = null;
                        })
                      : null,
                  child: Text(uiText(context, 'Nuova consultazione')),
                ),
              const Divider(),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(uiText(context, 'Riferimenti e proposte')),
                trailing: Icon(inspect ? Icons.expand_less : Icons.expand_more),
                onTap: () => setState(() => inspect = !inspect),
              ),
              if (group.journal.pending != null)
                TextButton(
                  onPressed: working
                      ? null
                      : () => _command(
                          group.journal.pending!['command'] as GroupRecord,
                        ),
                  child: Text(uiText(context, 'Verifica modifica')),
                ),
              if (inspect) ..._records(),
            ],
          ],
        ),
      ),
    );
  }
}
