part of 'workspace_work.dart';

const _researchStates = {
  'queued': 'In coda',
  'running': 'In corso',
  'completed': 'Fonti raccolte',
  'ready': 'Pronta',
  'failed': 'Richiede attenzione',
  'needs_configuration': 'Servizio da configurare',
  'cancelled': 'Interrotta',
  'stale': 'Da aggiornare',
  'analyzing': 'Sintesi in preparazione',
};

extension _ResearchPanel on _WorkState {
  Future<void> requestResearch() async {
    if (!write) return;
    final epoch = group.epoch, selection = view['selection'];
    final String? origin = selection?['id'];
    final input = await showDialog<GroupRecord>(
      context: context,
      builder: (_) => _ResearchRequest(
        private: widget.personal,
        origin: selection?['label'],
        space: widget.workspaceName,
      ),
    );
    if (input == null || !mounted || group.epoch != epoch || !write) return;
    await run(
      () => group.send({
        'type': widget.personal
            ? 'research.private_request'
            : 'research.request',
        'query': input['query'],
        'discloseQuery': true,
        if (widget.personal) ...{
          'analyzeExcerpts': true,
          'notify': input['notify'],
          if (origin != null) 'originId': origin,
        },
      }),
    );
  }

  Future<void> openCitation(GroupRecord c) async {
    final uri = Uri.tryParse(c['url'] ?? '');
    if (uri == null ||
        !{'http', 'https'}.contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty)
      return;
    final epoch = group.epoch;
    if (await groupConfirm(
          context,
          uiText(context, 'Aprire la fonte esterna?'),
          '${c['title']}\n$uri',
          uiText(context, 'Apri'),
        ) &&
        mounted &&
        group.epoch == epoch &&
        group.admitted) {
      await run(() async {
        if (!await launchUrl(uri, mode: LaunchMode.externalApplication))
          throw const FormatException(
            'Impossibile aprire la fonte nel browser.',
          );
      }, reload: false);
    }
  }

  Future<void> publishResearch(GroupRecord r) async {
    final targets = groupRows(view['targets'])
        .where((t) => t['contributes'] == true)
        .toList();
    if (!write || targets.isEmpty || r['status'] != 'ready') return;
    final epoch = group.epoch;
    final to = await showDialog<GroupRecord>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: Text(uiText(ctx, 'Condividi il risultato')),
        children: [
          for (final t in targets)
            SimpleDialogOption(
              onPressed: groupIds(r['shared']).contains(t['id'])
                  ? null
                  : () => Navigator.pop(ctx, t),
              child: Text(
                '${t['name']}${groupIds(r['shared']).contains(t['id']) ? ' · Già condiviso' : ''}',
              ),
            ),
        ],
      ),
    );
    if (to == null || !mounted || epoch != group.epoch) return;
    await approve(
      uiText(context, 'Condividere in {0}?', [to['name']]),
      uiText(
        context,
        '{0}\n\nIl gruppo vedrà il risultato e i rimandi alle fonti.',
        [r['query']],
      ),
      uiText(context, 'Condividi in {0}', [to['name']]),
      {
        'type': 'research.private_publish',
        'workId': r['id'],
        'generation': r['generation'],
        'destinationId': to['id'],
      },
    );
  }

  void readInitialResearch() {
    if (!foreground ||
        initialResearchClosed ||
        ModalRoute.of(context)?.isCurrent != true)
      return;
    final item = initialResearchTitle.currentContext;
    if (item == null) return;
    final box = item.findRenderObject(),
        viewport = Scrollable.maybeOf(item)?.context.findRenderObject();
    if (box is! RenderBox ||
        viewport is! RenderBox ||
        !box.hasSize ||
        !viewport.hasSize)
      return;
    final visible = viewport.localToGlobal(Offset.zero) & viewport.size;
    if (!(box.localToGlobal(Offset.zero) & box.size).overlaps(visible)) return;
    final target = groupRows(view['research'])
        .where((r) => r['id'] == widget.initialWorkId)
        .firstOrNull;
    if (target != null) readResearch(target);
  }

  Future<void> readResearch(GroupRecord r, {bool retry = false}) async {
    final id = "${r['id']}:${r['generation']}";
    if (!widget.personal ||
        r['status'] != 'ready' ||
        r['read'] == true ||
        confirmedReads.contains(id) ||
        (failedReads.contains(id) && !retry) ||
        !group.admitted ||
        widget.api.actorId != group.actor ||
        acting)
      return;
    final epoch = group.epoch;
    await run(() async {
      try {
        await widget.api.post('/api/v1/personal-chats', {
          'action': 'research_read',
          'expectedActorId': group.actor,
          'thread': widget.workspaceId,
          'workId': r['id'],
        });
        if (mounted && epoch == group.epoch) {
          confirmedReads.add(id);
          failedReads.remove(id);
        }
      } catch (e) {
        if (groupDenied(e)) rethrow;
        if (mounted && epoch == group.epoch) failedReads.add(id);
      }
    }, reload: false);
  }

  List<Widget> researchItems() {
    final private = widget.personal, results = groupRows(view['research']);
    return [
      if (group.canWrite)
        FilledButton.tonalIcon(
          onPressed: write ? requestResearch : null,
          icon: const Icon(Icons.travel_explore),
          label: Text(
            private
                ? uiText(context, 'Nuova ricerca privata')
                : uiText(context, 'Nuova ricerca'),
          ),
        ),
      if (results.isEmpty)
        Text(
          private
              ? uiText(context, 'Le tue ricerche private compariranno qui.')
              : uiText(context, 'Le ricerche dello spazio compariranno qui.'),
        ),
      for (final r in [
        ...results.where((r) => r['id'] == widget.initialWorkId),
        ...results.where((r) => r['id'] != widget.initialWorkId),
      ])
        ExpansionTile(
          key: ValueKey('${r['id']}:${r['generation']}'),
          initiallyExpanded: widget.initialWorkId == r['id'],
          onExpansionChanged: (open) {
            if (r['id'] == widget.initialWorkId) initialResearchClosed = !open;
            if (open && private) readResearch(r);
          },
          title: Text(
            r['query'],
            key: r['id'] == widget.initialWorkId ? initialResearchTitle : null,
          ),
          subtitle: Text(
            uiText(
              context,
              _researchStates[r['status']] ?? 'Stato non disponibile',
            ),
          ),
          children: [
            if (private && r['summary'] is String) SelectableText(r['summary']),
            if (private) ...[
              if (failedReads.contains("${r['id']}:${r['generation']}") &&
                  r['read'] != true)
                act(
                  uiText(context, 'Riprova conferma di lettura'),
                  acting ? null : () => readResearch(r, retry: true),
                ),
              for (final c in groupRows(r['citations']))
                act(c['title'], acting ? null : () => openCitation(c)),
              if (r['status'] == 'ready' &&
                  groupRows(view['targets'])
                      .any((t) => t['contributes'] == true))
                act(
                  uiText(context, 'Condividi nello spazio…'),
                  write ? () => publishResearch(r) : null,
                ),
            ] else ...[
              for (final f in groupRows(
                group.snapshot['sources'],
              ).where((s) => s['work_id'] == r['id'] && s['withdrawn'] != true))
                act(
                  f['title'],
                  () => showRef({
                    'id': f['id'],
                    'version': f['document_version'] ?? 1,
                    'kind': 'source',
                  }),
                ),
              for (final h in groupRows(
                group.snapshot['researchEvents'],
              ).where((h) => h['work_id'] == r['id']).toList().reversed.take(3))
                Text(
                  '${groupDate(context, h['created_at'])} · ${uiText(context, _researchStates[h['status']] ?? 'Stato non disponibile')}',
                ),
            ],
            if (group.canWrite &&
                (private || r['requested_by'] == group.actor)) ...[
              if ({'failed', 'needs_configuration'}.contains(r['status']) ||
                  private && r['error'] != null)
                act(
                  uiText(context, 'Riprova ricerca'),
                  write
                      ? () => approve(
                          uiText(context, 'Riprovare la ricerca?'),
                          uiText(
                            context,
                            '{0}\n\nIl servizio esterno potrebbe elaborare nuovamente i termini o gli estratti.',
                            [r['query']],
                          ),
                          uiText(context, 'Riprova'),
                          {
                            'type': private && r['brief'] == true
                                ? 'research.brief_retry'
                                : 'research.retry',
                            'workId': r['id'],
                            if (private && r['brief'] == true)
                              'generation': r['generation'],
                          },
                        )
                      : null,
                ),
              if ({
                    'queued',
                    'running',
                    'failed',
                    'needs_configuration',
                  }.contains(r['status']) &&
                  r['brief'] != true)
                act(
                  uiText(context, 'Interrompi ricerca'),
                  write
                      ? () => approve(
                          uiText(context, 'Interrompere la ricerca?'),
                          r['query'],
                          uiText(context, 'Interrompi'),
                          {'type': 'research.cancel', 'workId': r['id']},
                        )
                      : null,
                ),
            ],
          ],
        ),
    ];
  }
}

class _ResearchRequest extends StatefulWidget {
  const _ResearchRequest({
    required this.private,
    required this.origin,
    required this.space,
  });
  final bool private;
  final String? origin;
  final String space;
  @override
  State<_ResearchRequest> createState() => _ResearchRequestState();
}

class _ResearchRequestState extends State<_ResearchRequest> {
  final query = TextEditingController();
  bool disclose = false, notify = false;
  @override
  void dispose() {
    query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.private
          ? uiText(context, 'Nuova ricerca privata')
          : uiText(context, 'Nuova ricerca'),
    ),
    scrollable: true,
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: query,
          minLines: 1,
          maxLines: 4,
          maxLength: 500,
          decoration: InputDecoration(
            labelText: uiText(context, 'Cosa vuoi approfondire?'),
          ),
          onChanged: (_) => setState(() {
            disclose = false;
          }),
        ),
        if (widget.private && widget.origin != null)
          Text(
            uiText(context, 'Conversazione consultata · {0}', [widget.origin]),
          ),
        Text(
          widget.private
              ? uiText(context, 'Il risultato sarà visibile solo a te.')
              : uiText(context, 'Il risultato sarà visibile in {0}.', [
                  widget.space,
                ]),
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: disclose,
          onChanged: (v) => setState(() => disclose = v == true),
          title: Text(
            widget.private
                ? uiText(
                    context,
                    'Autorizzo l’invio dei termini al servizio di ricerca e l’analisi degli estratti con il modello.',
                  )
                : uiText(
                    context,
                    'Autorizzo l’invio di questi termini al servizio di ricerca.',
                  ),
          ),
        ),
        if (widget.private)
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: notify,
            onChanged: (v) => setState(() => notify = v),
            title: Text(uiText(context, 'Avvisami quando è pronta')),
          ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(uiText(context, 'Annulla')),
      ),
      FilledButton(
        onPressed: disclose && query.text.trim().isNotEmpty
            ? () => Navigator.pop(context, <String, dynamic>{
                'query': query.text.trim(),
                'notify': notify,
              })
            : null,
        child: Text(uiText(context, 'Avvia ricerca')),
      ),
    ],
  );
}
