import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'workspace_governance.dart';

const _kind = {
  'decision': 'Decisione',
  'constraint': 'Vincolo',
  'commitment': 'Impegno',
};
const _goalModes = {
  'revise': 'Rivedi obiettivo',
  'replace': 'Sostituisci obiettivo',
  'subgoal': 'Aggiungi sotto-obiettivo',
  'complete': 'Concludi obiettivo',
  'abandon': 'Abbandona obiettivo',
};
const _states = {
  'pending': 'In attesa',
  'adopted': 'Adottata',
  'blocked': 'Bloccata',
  'stale': 'Da aggiornare',
  'proposed': 'Proposta',
  'effective': 'In vigore',
  'superseded': 'Superata',
};

class WorkspaceDirectionScreen extends StatefulWidget {
  const WorkspaceDirectionScreen({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.workspaceName,
    this.proposalId,
    this.vault = const DeviceDraftVault(),
  });
  final RimiamApi api;
  final String workspaceId, workspaceName;
  final String? proposalId;
  final DraftVault vault;
  @override
  State<WorkspaceDirectionScreen> createState() => _DirectionState();
}

class _DirectionState extends State<WorkspaceDirectionScreen>
    with WidgetsBindingObserver {
  late final g = GroupGovernance(
    widget.api,
    widget.workspaceId,
    direction: true,
    vault: widget.vault,
  );
  bool busy = true, foreground = true;
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
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if ((s == AppLifecycleState.paused || s == AppLifecycleState.hidden) &&
        foreground) {
      foreground = false;
      setState(g.suspend);
    } else if (s == AppLifecycleState.resumed && !foreground) {
      foreground = true;
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      busy = true;
      issue = null;
    });
    try {
      await g.load();
    } catch (e) {
      if (mounted) setState(() => issue = groupIssue(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  bool get writable => g.canWrite && !busy && g.journal.pending == null;
  Future<void> _act(GroupRecord command) async {
    if (busy || !g.canWrite) return;
    setState(() {
      busy = true;
      issue = null;
    });
    try {
      await g.send(command);
      if (mounted) await _load();
    } catch (e) {
      if (mounted)
        setState(() {
          issue = groupIssue(e);
          busy = false;
          if (groupDenied(e)) g.admitted = false;
        });
    }
  }

  Future<void> _reference(GroupRecord r) async {
    final target = await openGroupReference(context, g, r);
    if (target != null && mounted) Navigator.pop(context, target);
  }

  Future<void> _edit(GroupRecord? goal) async {
    final text = await groupText(
      context,
      title: goal == null
          ? uiText(context, 'Definisci obiettivo')
          : uiText(context, 'Modifica obiettivo'),
      label: uiText(context, 'Obiettivo condiviso'),
      initial: goal?['content'] as String? ?? '',
      detail: goal == null
          ? null
          : uiText(
              context,
              'Modifichi la versione {0}. Il gruppo vedrà un avviso in chat.',
              [goal['version']],
            ),
      action: uiText(context, 'Salva obiettivo'),
    );
    if (!mounted || text == null || goal?['content'] == text) return;
    await _act(
      goal == null
          ? {'type': 'goal.establish', 'content': text}
          : {
              'type': 'goal.editShared',
              'goalId': goal['id'],
              'expectedVersion': goal['version'],
              'content': text,
            },
    );
  }

  Future<void> _propose({
    GroupRecord? previous,
    String operation = 'establish',
    GroupRecord? goalEvolution,
  }) async {
    final cmd = await Navigator.push<GroupRecord>(
      context,
      MaterialPageRoute(
        builder: (_) => WorkspaceProposalEditor(
          group: g,
          previous: previous,
          operation: operation,
          evolve: goalEvolution,
        ),
      ),
    );
    if (mounted && cmd != null) await _act(cmd);
  }

  List<Widget> _approvals(GroupRecord item, {required bool transition}) {
    final approvals = groupRows(item['approvals']),
        scopeId = transition
            ? item['goalId']
            : (item['replacesActId'] ?? item['goalId']);
    final scopeKind = transition || item['replacesActId'] == null
        ? 'goal'
        : 'act';
    final scopeVersion = scopeKind == 'act' ? 1 : item['goalVersion'];
    final cap = transition
        ? switch (item['mode']) {
            'complete' || 'abandon' => 'goal.conclude',
            'subgoal' => 'goal.subgoal',
            _ => 'goal.change',
          }
        : switch (item['operation']) {
            'replace' => 'act.replace',
            'revoke' => 'act.revoke',
            _ => 'act.create',
          };
    final result = <Widget>[];
    for (final person in groupIds(item['people'])) {
      final recorded = approvals
          .where((a) => a['personId'] == person)
          .firstOrNull;
      final mandate = groupRows(g.project['mandates'])
          .where(
            (m) =>
                m['available'] == true &&
                m['holderId'] == g.actor &&
                m['grantorId'] == person &&
                m['scope']?['id'] == scopeId &&
                m['scope']?['kind'] == scopeKind &&
                m['scope']?['version'] == scopeVersion &&
                m['capability'] == cap,
          )
          .firstOrNull;
      result.add(
        Text(
          '${g.name(person)} · ${recorded == null ? 'in attesa' : 'approvato da ${g.name(recorded['actorId'])}'}',
        ),
      );
      if (recorded == null &&
          writable &&
          (transition
              ? item['status'] == 'pending'
              : item['status'] == 'proposed') &&
          (person == g.actor || mandate != null)) {
        final own = person == g.actor,
            accessRevision = g.project['accessRevision'];
        result.add(
          TextButton(
            onPressed: () async {
              if (!await groupConfirm(
                    context,
                    uiText(context, 'Conferma l’approvazione'),
                    '${item['content']}\n\n${own ? 'Approvi per te.' : 'Rappresenti ${g.name(person)} tramite il mandato indicato.'}',
                    uiText(context, 'Approva'),
                  ) ||
                  !mounted)
                return;
              await _act({
                'type': transition ? 'goal.approve' : 'project.approve',
                if (transition)
                  'transitionId': item['id']
                else
                  'proposalId': item['proposalId'],
                'representedPersonId': person,
                'expectedAccessRevision': accessRevision,
                'confirmExactContent': true,
                if (!own) 'mandateId': mandate!['id'],
              });
            },
            child: Text(
              own
                  ? uiText(context, 'Approva per te')
                  : uiText(context, 'Approva per {0} con mandato', [
                      g.name(person),
                    ]),
            ),
          ),
        );
      }
    }
    return result;
  }

  Widget _actTile(
    GroupRecord a, {
    bool transition = false,
    bool expanded = false,
  }) {
    final source = a['sourceId'] as String?, content = a['content'] as String;
    return ExpansionTile(
      initiallyExpanded: expanded,
      tilePadding: EdgeInsets.zero,
      title: Text(content),
      subtitle: Text(
        '${transition ? _goalModes[a['mode']] : _kind[a['kind']]} · ${_states[a['status']] ?? a['status']}',
      ),
      children: [
        if ((a['reason'] as String? ?? '').isNotEmpty)
          Text(a['reason'] as String),
        if (transition &&
            groupRows(a['obligations']).any((o) => o['blocking'] == true))
          Text(
            uiText(
              context,
              'Alcuni atti collegati richiedono una modifica separata.',
            ),
          ),
        ..._approvals(a, transition: transition),
        if (source != null)
          TextButton.icon(
            onPressed: () =>
                _reference({'kind': 'source', 'id': source, 'version': 1}),
            icon: const Icon(Icons.link),
            label: Text(uiText(context, 'Fonte originale')),
          ),
        if (!transition &&
            a['status'] == 'effective' &&
            a['operation'] != 'revoke' &&
            a['actId'] != null &&
            writable)
          Wrap(
            children: [
              TextButton(
                onPressed: () => _propose(previous: a, operation: 'replace'),
                child: Text(uiText(context, 'Proponi sostituzione')),
              ),
              TextButton(
                onPressed: () => _propose(previous: a, operation: 'revoke'),
                child: Text(uiText(context, 'Proponi revoca')),
              ),
            ],
          ),
      ],
    );
  }

  Widget _goalHistory(GroupRecord goal) {
    final v = goal['version'], id = goal['id'];
    final adherents = groupRows(goal['adherences'])
        .where((a) => a['version'] == v);
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text(goal['content'] as String),
      subtitle: Text(uiText(context, 'Versione {0}', [v])),
      children: [
        for (final old in groupRows(goal['versions']))
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(old['content'] as String),
            subtitle: Text(
              uiText(context, 'v{0} · {1} · {2}', [
                old['version'],
                g.name(old['actor']),
                groupDate(context, old['createdAt']),
              ]),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _reference({
              'kind': 'goal',
              'id': id,
              'version': old['version'],
            }),
          ),
        Text(
          uiText(context, 'Adesioni alla versione {0} · {1}', [
            v,
            adherents.isEmpty
                ? 'Nessuna'
                : adherents.map((a) => g.name(a['personId'])).join(', '),
          ]),
        ),
        if (writable && goal['status'] == 'active') ...[
          if (!adherents.any((a) => a['personId'] == g.actor))
            TextButton(
              onPressed: () async {
                if (!await groupConfirm(
                      context,
                      uiText(context, 'Aderisci alla versione {0}?', [v]),
                      goal['content'] as String,
                      uiText(context, 'Aderisco'),
                    ) ||
                    !mounted)
                  return;
                await _act({'type': 'goal.adhere', 'goalId': id, 'version': v});
              },
              child: Text(uiText(context, 'Aderisci personalmente')),
            ),
          TextButton(
            onPressed: () => _propose(goalEvolution: goal),
            child: Text(uiText(context, 'Proponi un’evoluzione')),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final proj = g.project,
        goal = g.goal,
        acts = groupRows(proj['acts']),
        decisions = acts
            .where(
              (a) =>
                  a['kind'] == 'decision' &&
                  a['status'] == 'effective' &&
                  a['operation'] != 'revoke',
            )
            .toList();
    final focused = widget.proposalId;
    final goalProposal = focused == null
        ? null
        : groupRows(proj['goalProposals'])
              .where((p) => p['id'] == focused)
              .firstOrNull;
    final actProposal = focused == null
        ? null
        : acts.where((p) => p['proposalId'] == focused).firstOrNull;
    final addressed = acts
        .where(
          (a) =>
              a['status'] == 'proposed' &&
              groupIds(a['people']).contains(g.actor) &&
              !groupRows(a['approvals']).any((p) => p['personId'] == g.actor),
        )
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          uiText(context, focused == null ? 'Direzione' : 'Proposta'),
        ),
        actions: [
          IconButton(
            tooltip: uiText(context, 'Aggiorna'),
            icon: const Icon(Icons.refresh),
            onPressed: busy ? null : _load,
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Text(
              widget.workspaceName,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (busy) const LinearProgressIndicator(),
            if (issue != null)
              Semantics(liveRegion: true, child: Text(uiText(context, issue!))),
            if (g.admitted && g.journal.pending != null)
              OutlinedButton(
                onPressed: busy
                    ? null
                    : () => _act(g.journal.pending!['command'] as GroupRecord),
                child: Text(uiText(context, 'Verifica modifica')),
              ),
            if (g.admitted && focused != null) ...[
              if (goalProposal != null)
                _actTile(goalProposal, transition: true, expanded: true)
              else if (actProposal != null)
                _actTile(actProposal, expanded: true)
              else
                Text(uiText(context, 'Questa proposta non è più disponibile.')),
            ] else if (g.admitted) ...[
              const SizedBox(height: 10),
              Text(
                uiText(context, 'Obiettivo'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              SelectableText(
                goal?['content'] as String? ??
                    uiText(context, 'Lo spazio non ha un obiettivo corrente.'),
              ),
              if (writable &&
                  (goal?['status'] == 'active' ||
                      groupRows(proj['goals']).isEmpty))
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    icon: const Icon(Icons.edit_outlined),
                    label: Text(
                      goal == null
                          ? uiText(context, 'Definisci obiettivo')
                          : uiText(context, 'Modifica obiettivo'),
                    ),
                    onPressed: () => _edit(goal),
                  ),
                ),
              const Divider(),
              Text(
                uiText(context, 'Decisioni già prese'),
                style: Theme.of(context).textTheme.titleMedium,
              ),
              if (decisions.isEmpty)
                Text(uiText(context, 'Ancora nessuna decisione adottata.')),
              for (final item in decisions) _actTile(item),
              if (addressed.isNotEmpty)
                ExpansionTile(
                  title: Text(
                    uiText(context, 'In attesa di te · {0}', [
                      addressed.length,
                    ]),
                  ),
                  children: [for (final a in addressed) _actTile(a)],
                ),
              const Divider(),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text(uiText(context, 'Proposte e storia')),
                children: [
                  for (final prev in groupRows(proj['goals']))
                    _goalHistory(prev),
                  for (final change in groupRows(proj['goalProposals']))
                    _actTile(change, transition: true),
                  for (final act in acts) _actTile(act),
                  if (writable)
                    TextButton.icon(
                      onPressed: () => _propose(),
                      icon: const Icon(Icons.add),
                      label: Text(uiText(context, 'Nuova proposta')),
                    ),
                ],
              ),
            ] else if (!busy)
              TextButton(
                onPressed: _load,
                child: Text(uiText(context, 'Ricarica')),
              ),
          ],
        ),
      ),
    );
  }
}

class WorkspaceProposalEditor extends StatefulWidget {
  const WorkspaceProposalEditor({
    required this.group,
    this.previous,
    required this.operation,
    this.evolve,
    this.initialContent,
    this.initialReason,
  });
  final GroupGovernance group;
  final GroupRecord? previous, evolve;
  final String operation;
  final String? initialContent, initialReason;
  @override
  State<WorkspaceProposalEditor> createState() => _ProposalState();
}

class _ProposalState extends State<WorkspaceProposalEditor> {
  late final initialGoal = widget.evolve ?? widget.group.goal;
  late final text = TextEditingController(
    text:
        widget.initialContent ??
        widget.previous?['content'] as String? ??
        widget.evolve?['content'] as String? ??
        '',
  );
  late final reason = TextEditingController(text: widget.initialReason);
  final selected = <String>{}, block = <String>{};
  late String kind = widget.operation == 'revoke'
      ? 'decision'
      : widget.previous?['kind'] as String? ?? 'decision';
  String mode = 'revise';
  bool keepSub = false, link = true;
  @override
  void dispose() {
    text.dispose();
    reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.group,
        goal = initialGoal,
        evolution = widget.evolve != null;
    final useCurrent = evolution && {'complete', 'abandon'}.contains(mode);
    final content = useCurrent ? goal!['content'] as String : text.text.trim();
    final people = groupRows(g.project['members'])
        .where((p) => p['active'] == true && p['eligible'] == true);
    final valid =
        content.isNotEmpty &&
        reason.text.trim().isNotEmpty &&
        (evolution || selected.isNotEmpty);
    return Scaffold(
      appBar: AppBar(
        title: Text(
          evolution
              ? uiText(context, 'Evoluzione dell’obiettivo')
              : uiText(context, 'Nuova proposta'),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            if (evolution)
              DropdownButton<String>(
                isExpanded: true,
                value: mode,
                items: [
                  for (final e in _goalModes.entries)
                    DropdownMenuItem(value: e.key, child: Text(e.value)),
                ],
                onChanged: (m) => setState(() => mode = m!),
              )
            else if (widget.previous == null)
              DropdownButton<String>(
                isExpanded: true,
                value: kind,
                items: [
                  for (final e in _kind.entries)
                    DropdownMenuItem(value: e.key, child: Text(e.value)),
                ],
                onChanged: (k) => setState(() => kind = k!),
              )
            else
              Text(
                widget.operation == 'revoke'
                    ? uiText(context, 'Proposta di revoca')
                    : uiText(context, 'Proposta di sostituzione'),
              ),
            if (useCurrent)
              SelectableText(content)
            else
              TextField(
                controller: text,
                decoration: InputDecoration(
                  labelText: uiText(context, 'Testo della proposta'),
                ),
                minLines: 2,
                maxLines: 5,
                maxLength: 12000,
                onChanged: (_) => setState(() {}),
              ),
            TextField(
              controller: reason,
              decoration: InputDecoration(labelText: uiText(context, 'Motivo')),
              minLines: 1,
              maxLines: 4,
              maxLength: 4000,
              onChanged: (_) => setState(() {}),
            ),
            if (!evolution && goal != null)
              CheckboxListTile(
                value: link,
                onChanged: (v) => setState(() => link = v!),
                title: Text(uiText(context, 'Collega all’obiettivo corrente')),
              ),
            if (mode == 'replace' && evolution)
              CheckboxListTile(
                value: keepSub,
                onChanged: (v) => setState(() => keepSub = v!),
                title: Text(
                  uiText(
                    context,
                    'Mantieni il precedente come sotto-obiettivo',
                  ),
                ),
              ),
            Text(
              evolution
                  ? uiText(context, 'Altre persone interessate')
                  : uiText(context, 'Chi deve approvare?'),
            ),
            for (final p in people)
              CheckboxListTile(
                value: selected.contains(p['id']),
                title: Text(p['name'] as String),
                onChanged: selected.length >= 20 && !selected.contains(p['id'])
                    ? null
                    : (v) => setState(() {
                        if (v == true) {
                          selected.add(p['id'] as String);
                        } else {
                          selected.remove(p['id']);
                        }
                      }),
              ),
            if (evolution)
              ExpansionTile(
                title: Text(
                  uiText(context, 'Atti da modificare separatamente'),
                ),
                children: [
                  for (final a in groupRows(g.project['acts']).where(
                    (a) =>
                        a['actId'] != null &&
                        a['status'] == 'effective' &&
                        a['operation'] != 'revoke',
                  ))
                    CheckboxListTile(
                      title: Text(a['content'] as String),
                      value: block.contains(a['actId']),
                      onChanged: (v) => setState(() {
                        if (v == true) {
                          block.add(a['actId'] as String);
                        } else {
                          block.remove(a['actId']);
                        }
                      }),
                    ),
                ],
              ),
            FilledButton(
              onPressed: valid
                  ? () {
                      Navigator.pop(context, <String, dynamic>{
                        if (evolution) ...{
                          'type': 'goal.propose',
                          'goalId': goal!['id'],
                          'expectedVersion': goal['version'],
                          'mode': mode,
                          'affectedPeople': selected.toList(),
                          'previousBecomesSubgoal':
                              mode == 'replace' && keepSub,
                          'blockingActIds': block.toList(),
                          'preserveExistingObligations': true,
                        } else ...{
                          'type': 'project.propose',
                          'kind': kind,
                          'operation': widget.operation,
                          'people': selected.toList(),
                          if (widget.previous != null)
                            'replacesActId': widget.previous!['actId'],
                          'goal': link && goal != null
                              ? {'id': goal['id'], 'version': goal['version']}
                              : null,
                        },
                        'content': content,
                        'reason': reason.text.trim(),
                      });
                    }
                  : null,
              child: Text(uiText(context, 'Sottoponi proposta')),
            ),
          ],
        ),
      ),
    );
  }
}
