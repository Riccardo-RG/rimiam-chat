import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';

typedef AccessJson = Map<String, dynamic>;
typedef AccessSend = Future<bool> Function(AccessJson c);
List<AccessJson> accessRows(AccessJson? object, String key) =>
    ((object?[key] ?? []) as List).cast<AccessJson>();

bool mayRemove(List<AccessJson> relationships, String actor, String other) {
  return actor != other &&
      relationships.any(
        (r) =>
            r['holderId'] == actor &&
            r['active'] == true &&
            r['available'] == true &&
            r['removeMembers'] == true,
      ) &&
      !relationships.any(
        (r) =>
            r['holderId'] == other &&
            r['active'] == true &&
            (r['kind'] == 'stewardship' || r['protected'] == true),
      );
}

String _kind(String value) =>
    value == 'stewardship' ? 'Gestione degli accessi' : 'Delega agli inviti';

class WorkspaceAccess extends StatefulWidget {
  const WorkspaceAccess({
    super.key,
    required this.api,
    required this.base,
    required this.view,
    required this.send,
    required this.busy,
    required this.more,
  });
  final RimiamApi api;
  final String base;
  final AccessJson view;
  final AccessSend send;
  final bool busy;
  final Future<void> Function() more;
  @override
  State<WorkspaceAccess> createState() => _WorkspaceAccessState();
}

class _WorkspaceAccessState extends State<WorkspaceAccess> {
  List<AccessJson> get rel => accessRows(widget.view, 'relationships');
  List<AccessJson> get members => accessRows(widget.view, 'members');
  String name(String id) =>
      members.where((m) => m['id'] == id).firstOrNull?['name'] ??
      'Partecipante storico';
  Future<void> propose() async {
    final v = widget.view['accessRevision'] as int;
    final command = await Navigator.of(context).push<AccessJson>(
      MaterialPageRoute(
        builder: (_) => _AccessProposal(
          members: members.where((m) => m['active'] == true).toList(),
          relationships: rel,
          revision: v,
        ),
      ),
    );
    if (command != null && mounted && !widget.busy) await widget.send(command);
  }

  Future<void> history(AccessJson r) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => _AccessHistory(
          api: widget.api,
          base: widget.base,
          relationship: r['id'],
          name: r['holderName'],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext c) {
    final actor = widget.api.actorId, revision = widget.view['accessRevision'];
    final manages = rel.any(
      (r) =>
          r['active'] == true &&
          r['available'] == true &&
          r['holderId'] == actor &&
          r['kind'] == 'stewardship' &&
          r['changeAccess'] == true,
    );
    return ExpansionTile(
      title: Text(uiText(c, 'Accordi e deleghe')),
      children: [
        for (final r in rel)
          ListTile(
            title: Text(r['holderName']),
            subtitle: Text(
              '${_kind(r['kind'])} · ${r['active'] != true
                  ? 'Terminata'
                  : r['available'] == true
                  ? 'Attiva'
                  : 'Indisponibile'}${r['protected'] == true ? ' · protetta' : ''}',
            ),
            trailing: IconButton(
              tooltip: uiText(c, 'Cronologia di {0}', [r['holderName']]),
              icon: const Icon(Icons.history),
              onPressed: () => history(r),
            ),
          ),
        if (manages)
          TextButton(
            onPressed: widget.busy ? null : propose,
            child: Text(uiText(c, 'Proponi una modifica agli accessi')),
          ),
        for (final p in accessRows(widget.view, 'proposals'))
          ExpansionTile(
            title: Text(p['reason']),
            subtitle: Text(
              {
                    'pending': 'In attesa',
                    'adopted': 'Approvata',
                    'stale': 'Superata',
                  }[p['status']] ??
                  '',
            ),
            children: [
              for (final target in accessRows(p, 'targets'))
                ListTile(
                  title: Text(
                    '${target['active'] == true ? 'Assegna o aggiorna' : 'Termina'} · ${_kind(target['kind'])}',
                  ),
                  subtitle: Text(name(target['holderId'])),
                ),
              for (final term in p['terms'])
                Padding(padding: const EdgeInsets.all(8), child: Text(term)),
              for (final required in accessRows(p, 'required'))
                Builder(
                  builder: (c) {
                    final role = required['role'], id = required['personId'];
                    final approved = accessRows(
                      p,
                      'approvals',
                    ).any((a) => a['role'] == role && a['personId'] == id);
                    return ListTile(
                      title: Text(name(id)),
                      subtitle: Text(
                        '${role == 'holder' ? 'Adesione personale' : 'Autorizzazione'} · ${approved ? 'registrata' : 'in attesa'}',
                      ),
                      trailing:
                          id == actor &&
                              !approved &&
                              p['status'] == 'pending' &&
                              p['baseAccessRevision'] == revision
                          ? TextButton(
                              onPressed: widget.busy
                                  ? null
                                  : () async {
                                      final yes = await showDialog<bool>(
                                        context: context,
                                        builder: (c) => AlertDialog(
                                          title: Text(
                                            role == 'holder'
                                                ? uiText(
                                                    c,
                                                    'Accettare i termini?',
                                                  )
                                                : uiText(
                                                    c,
                                                    'Autorizzare questa modifica?',
                                                  ),
                                          ),
                                          content: SingleChildScrollView(
                                            child: Text(
                                              [
                                                p['reason'],
                                                ...p['terms'],
                                              ].join('\n\n'),
                                            ),
                                          ),
                                          actions: [
                                            TextButton(
                                              onPressed: () =>
                                                  Navigator.pop(c, false),
                                              child: Text(uiText(c, 'Annulla')),
                                            ),
                                            FilledButton(
                                              onPressed: () =>
                                                  Navigator.pop(c, true),
                                              child: Text(
                                                uiText(c, 'Conferma'),
                                              ),
                                            ),
                                          ],
                                        ),
                                      );
                                      if (yes == true && mounted)
                                        await widget.send({
                                          'type': 'access.approve',
                                          'proposalId': p['id'],
                                          'expectedAccessRevision': revision,
                                          'role': role,
                                          'acceptTerms': true,
                                        });
                                    },
                              child: Text(
                                role == 'holder'
                                    ? uiText(c, 'Accetta')
                                    : uiText(c, 'Autorizza'),
                              ),
                            )
                          : null,
                    );
                  },
                ),
            ],
          ),
        if (widget.view['next'] != null)
          TextButton(
            onPressed: widget.busy ? null : widget.more,
            child: Text(uiText(c, 'Altre proposte')),
          ),
      ],
    );
  }
}

class _AccessProposal extends StatefulWidget {
  const _AccessProposal({
    required this.members,
    required this.relationships,
    required this.revision,
  });
  final List<AccessJson> members, relationships;
  final int revision;
  @override
  State<_AccessProposal> createState() => _AccessProposalState();
}

class _AccessProposalState extends State<_AccessProposal> {
  String mode = 'delegation';
  String? target;
  final chosen = <String>{};
  final reason = TextEditingController();
  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) {
    final candidates = mode == 'revoke'
        ? widget.relationships
              .where(
                (r) =>
                    r['active'] == true &&
                    r['protected'] != true &&
                    r['kind'] == 'invitation_delegate',
              )
              .map(
                (r) => (id: r['id'] as String, name: r['holderName'] as String),
              )
              .toList()
        : widget.members
              .where(
                (m) =>
                    mode != 'delegation' ||
                    !widget.relationships.any(
                      (r) => r['active'] == true && r['holderId'] == m['id'],
                    ),
              )
              .map((m) => (id: m['id'] as String, name: m['name'] as String))
              .toList();
    final eligible =
        reason.text.trim().isNotEmpty &&
        (mode == 'stewardship' ? chosen.isNotEmpty : target != null);
    return Scaffold(
      appBar: AppBar(title: Text(uiText(c, 'Proposta di accesso'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            DropdownButtonFormField(
              initialValue: mode,
              isExpanded: true,
              decoration: InputDecoration(labelText: uiText(c, 'Modifica')),
              items: [
                DropdownMenuItem(
                  value: 'delegation',
                  child: Text(uiText(c, 'Delega gli inviti')),
                ),
                DropdownMenuItem(
                  value: 'revoke',
                  child: Text(uiText(c, 'Revoca una delega')),
                ),
                DropdownMenuItem(
                  value: 'stewardship',
                  child: Text(uiText(c, 'Modifica la gestione degli accessi')),
                ),
              ],
              onChanged: (v) => setState(() {
                mode = v!;
                target = null;
                chosen.clear();
              }),
            ),
            if (mode == 'stewardship')
              Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  uiText(
                    c,
                    'Scegli tutte le persone che dovranno gestire gli accessi.',
                  ),
                ),
              ),
            for (final p in candidates)
              CheckboxListTile(
                value: mode == 'stewardship'
                    ? chosen.contains(p.id)
                    : target == p.id,
                title: Text(p.name),
                onChanged: (v) => setState(() {
                  if (mode == 'stewardship') {
                    if (v == true && chosen.length < 20) {
                      chosen.add(p.id);
                    } else {
                      chosen.remove(p.id);
                    }
                  } else {
                    target = v == true ? p.id : null;
                  }
                }),
              ),
            TextField(
              controller: reason,
              maxLength: 4000,
              minLines: 1,
              maxLines: 3,
              decoration: InputDecoration(labelText: uiText(c, 'Motivo')),
              onChanged: (_) => setState(() {}),
            ),
            FilledButton(
              onPressed: !eligible
                  ? null
                  : () => Navigator.pop(c, {
                      'type': 'access.propose',
                      'expectedAccessRevision': widget.revision,
                      'reason': reason.text.trim(),
                      'change': {
                        'kind': mode,
                        if (mode == 'stewardship')
                          'people': chosen.toList()
                        else if (mode == 'delegation')
                          'personId': target
                        else
                          'relationshipId': target,
                      },
                    }),
              child: Text(uiText(c, 'Invia proposta')),
            ),
          ],
        ),
      ),
    );
  }
}

class _AccessHistory extends StatefulWidget {
  const _AccessHistory({
    required this.api,
    required this.base,
    required this.relationship,
    required this.name,
  });
  final RimiamApi api;
  final String base, relationship, name;
  @override
  State<_AccessHistory> createState() => _AccessHistoryState();
}

class _AccessHistoryState extends State<_AccessHistory>
    with WidgetsBindingObserver {
  List<AccessJson> versions = [];
  int? before;
  bool busy = false;
  String? issue;
  int generation = 0;
  late final actor = widget.api.actorId;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    read();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
      generation++;
      setState(() {
        versions = [];
        before = null;
      });
    }
    if (s == AppLifecycleState.resumed) read();
  }

  Future<void> read() async {
    final g = ++generation;
    setState(() => busy = true);
    try {
      final v = await widget.api.get(
        '${widget.base}/access-history?id=${Uri.encodeQueryComponent(widget.relationship)}${before == null ? '' : '&before=$before'}',
      );
      if (mounted && g == generation && widget.api.actorId == actor)
        setState(() {
          versions = [...versions, ...accessRows(v, 'versions')];
          before = v['nextBefore'];
          issue = null;
        });
    } catch (_) {
      if (mounted && g == generation)
        setState(() {
          versions = [];
          before = null;
          issue = 'Cronologia non disponibile.';
        });
    } finally {
      if (mounted && g == generation) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext c) => Scaffold(
    appBar: AppBar(title: Text(uiText(c, 'Cronologia · {0}', [widget.name]))),
    body: ListView(
      children: [
        for (final v in versions)
          ListTile(
            title: Text(
              uiText(c, 'Versione {0} · {1}', [
                v['version'],
                v['active'] == true ? 'Attiva' : 'Terminata',
              ]),
            ),
            subtitle: Text(
              [
                v['basis'],
                if (v['protected'] == true) 'Accordo protetto',
              ].join(' · '),
            ),
          ),
        if (busy) const LinearProgressIndicator(),
        if (issue != null) Text(uiText(c, issue!)),
        if (issue != null || before != null)
          TextButton(
            onPressed: busy ? null : read,
            child: Text(
              before == null
                  ? uiText(c, 'Riprova')
                  : uiText(c, 'Versioni precedenti'),
            ),
          ),
      ],
    ),
  );
}
