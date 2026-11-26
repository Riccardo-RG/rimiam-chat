import 'ui_language.dart';
import 'studio_theme.dart';

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'direct_contacts.dart';
import 'participant_profile.dart';
import 'workspace_access.dart';
import 'workspace_command_journal.dart';

export 'participant_profile.dart' show MemberProfilePage, AccountProfilePage;

class WorkspacePeoplePage extends StatefulWidget {
  WorkspacePeoplePage({
    Key? key,
    required this.api,
    required this.workspace,
    this.inviteOnOpen = false,
    this.vault = const DeviceDraftVault(),
  }) : super(key: key ?? ValueKey((api, api.actorId, workspace)));
  final RimiamApi api;
  final String workspace;
  final bool inviteOnOpen;
  final DraftVault vault;
  @override
  State<WorkspacePeoplePage> createState() => _PeopleState();
}

bool pendingInvitation(AccessJson row) =>
    row['accepted_at'] == null &&
    row['revoked_at'] == null &&
    (DateTime.tryParse(row['expires_at'] as String? ?? '')
            ?.isAfter(DateTime.now()) ??
        false);
const _delivery = {
  'queued': 'Email in coda',
  'running': 'Invio email in corso',
  'submitted': 'Email affidata al servizio di invio. Recapito da verificare.',
  'needs_configuration': 'Puoi condividere il link con il destinatario.',
  'unknown': 'Esito email incerto. Verifica con il destinatario.',
  'cancelled': 'Invio annullato',
  'expired': 'Invio scaduto',
};

class _PeopleState extends State<WorkspacePeoplePage>
    with WidgetsBindingObserver {
  late final api = widget.api,
      actor = api.actorId,
      journal = WorkspaceCommandJournal(
        api,
        widget.vault,
        namespace: 'people',
        collection: widget.workspace,
      );
  String get base =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspace)}';
  AccessJson? snapshot, access, photos;
  ({String id, String url})? link;
  String? error, notice;
  int generation = 0;
  bool openedFromCommand = false;
  bool active = true,
      verified = false,
      writing = false,
      journalReady = false,
      ended = false;
  bool get current => mounted && active && actor == api.actorId;
  bool get locked =>
      !verified || !journalReady || writing || journal.pending != null;
  List<AccessJson> get members => accessRows(
    snapshot,
    'members',
  ).where((r) => r['active'] == true).toList();
  List<AccessJson> get ownRoles => accessRows(
    access,
    'relationships',
  ).where((r) => r['holderId'] == actor && r['active'] == true).toList();
  bool get invites =>
      ownRoles.any((r) => r['available'] == true && r['invitations'] == true);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    start();
  }

  Future<void> start() async {
    try {
      await journal.load();
      if (mounted) setState(() => journalReady = true);
    } catch (_) {
      if (mounted)
        setState(() => notice = 'Impossibile leggere le operazioni salvate.');
    }
    if (current) await read();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.hidden || s == AppLifecycleState.paused) {
      generation++;
      setState(() {
        active = false;
        verified = false;
        link = null;
      });
    }
    if (s == AppLifecycleState.resumed) {
      active = true;
      read();
    }
  }

  Future<void> read() async {
    final g = ++generation;
    try {
      final values = await Future.wait([
        api.get('$base/workspace'),
        api.get('$base/access'),
        api.get(
          '/api/v1/identity-photos?workspace=${Uri.encodeQueryComponent(widget.workspace)}',
        ),
      ]);
      if (!current || generation != g) return;
      if (values[0]['workspace']['id'] != widget.workspace ||
          values[2]['actor'] != actor ||
          !accessRows(
            values[0],
            'members',
          ).any((m) => m['active'] == true && m['user_id'] == actor))
        throw const ApiError(403, 'NOT_ACTIVE');
      setState(() {
        snapshot = values[0];
        access = values[1];
        photos = values[2];
        verified = true;
        error = null;
        if (!invites ||
            !accessRows(
              snapshot,
              'invitations',
            ).any((i) => i['id'] == link?.id && pendingInvitation(i)))
          link = null;
      });
      if (widget.inviteOnOpen && !openedFromCommand) {
        openedFromCommand = true;
        if (invites && !locked && journal.draft == null) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (current &&
                !locked &&
                invites &&
                ModalRoute.of(context)?.isCurrent == true) {
              unawaited(invite());
            }
          });
        } else {
          setState(
            () => notice = invites
                ? 'Verifica prima l’operazione precedente.'
                : 'Gli inviti sono gestiti da chi ha la delega nello spazio.',
          );
        }
      }
    } catch (e) {
      if (!current || g != generation) return;
      setState(() {
        snapshot = null;
        access = null;
        photos = null;
        link = null;
        verified = false;
        ended = e is ApiError && {403, 404}.contains(e.status);
        error = ended
            ? 'Lo spazio non è più disponibile.'
            : 'Impossibile caricare i partecipanti.';
      });
      if (ended &&
          journalReady &&
          journal.pending?['command']?['type'] == 'member.leave' &&
          !journal.busy) {
        try {
          final directory = await api.get('/api/v1/workspaces');
          if (!current ||
              g != generation ||
              accessRows(
                directory,
                'workspaces',
              ).any((w) => w['id'] == widget.workspace))
            return;
          await journal.stopVerification();
        } catch (_) {
          /* A future visit can recheck access. */
        }
      }
    }
  }

  Future<void> more() async {
    final before = access?['next'];
    if (locked || before == null) return;
    final g = generation;
    setState(() => writing = true);
    try {
      final next = await api.get(
        '$base/access?before=${Uri.encodeQueryComponent(before)}',
      );
      if (!current || g != generation) return;
      if (next['accessRevision'] != access?['accessRevision']) {
        await read();
        return;
      }
      setState(
        () => access = {
          ...next,
          'proposals': [
            ...accessRows(access, 'proposals'),
            ...accessRows(next, 'proposals'),
          ],
        },
      );
    } catch (_) {
      if (current) await read();
    } finally {
      if (mounted) setState(() => writing = false);
    }
  }

  Future<bool> ask(String title, String message, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: Text(uiText(c, 'Annulla')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: Text(action),
            ),
          ],
        ),
      ) ??
      false;
  Future<void> confirm(
    AccessJson command,
    String title,
    String body,
    String action,
  ) async {
    if (locked || !await ask(title, body, action) || !current || locked) return;
    await send(command);
  }

  Future<bool> send(AccessJson command) async {
    if (!current || !verified || !journalReady || writing) return false;
    final g = generation;
    setState(() {
      writing = true;
      notice = null;
      link = null;
    });
    try {
      final result = await journal.send(
        widget.workspace,
        command,
        allowed: () => current && verified,
      );
      if (!current) return true;
      if (command['type'] == 'member.leave') {
        setState(() {
          ended = true;
          verified = false;
          snapshot = null;
          access = null;
          photos = null;
        });
        Navigator.of(context).pop(true);
        return true;
      }
      final id = result['invitationId'], url = result['invitationUrl'];
      final uri = url is String ? Uri.tryParse(url) : null;
      if (command['type'] == 'invitation.create' &&
          id is String &&
          url is String &&
          uri != null &&
          {'https', 'http'}.contains(uri.scheme) &&
          uri.host.isNotEmpty &&
          uri.userInfo.isEmpty &&
          (uri.queryParameters['invite'] ?? '').isNotEmpty &&
          g == generation)
        link = (id: id, url: url);
      if (command['type'] == 'invitation.create') notice = 'Invito creato.';
      await read();
      return true;
    } catch (e) {
      if (current) {
        await read();
        if (current)
          setState(
            () => notice = journal.pending != null
                ? 'Esito da verificare.'
                : e is ApiError && e.status == 409
                ? 'Gli accessi sono cambiati. Controlla i dati aggiornati.'
                : 'Operazione non disponibile. Controlla i permessi e riprova.',
          );
      }
      return false;
    } finally {
      if (mounted) setState(() => writing = false);
    }
  }

  Future<void> invite() async {
    if (locked || !invites) return;
    final command = await Navigator.push<AccessJson>(
      context,
      MaterialPageRoute(
        builder: (_) => _InvitePerson(
          api: api,
          vault: widget.vault,
          members: members.map((r) => r['user_id'] as String).toSet(),
        ),
      ),
    );
    if (command != null && current && invites && !locked) await send(command);
  }

  Future<void> copy(String id) async {
    final selected = link;
    if (selected == null || selected.id != id) return;
    await read();
    if (!current || !verified || !invites || link != selected) return;
    try {
      await Clipboard.setData(ClipboardData(text: selected.url));
      if (current) setState(() => notice = 'Link copiato.');
    } catch (_) {
      if (current) setState(() => notice = 'Impossibile copiare il link.');
    }
  }

  Future<void> profile(String id) async {
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => MemberProfilePage(
          api: api,
          workspace: widget.workspace,
          member: id,
        ),
      ),
    );
    if (current) await read();
  }

  @override
  Widget build(BuildContext c) {
    final revision = access?['accessRevision'],
        mine = members.where((m) => m['user_id'] == actor).firstOrNull;
    final pending = accessRows(snapshot, 'invitations')
        .where((i) => i['revoked_at'] == null && i['accepted_at'] == null)
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(uiText(c, 'Persone e accesso')),
        actions: [
          IconButton(
            tooltip: uiText(c, 'Aggiorna partecipanti'),
            onPressed: writing ? null : read,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: Stack(
          children: [
            Visibility(
              visible: active && verified,
              maintainState: true,
              child: ListView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                children: [
                  if (snapshot != null) ...[
                    IdentityPhotoControls(
                      api: api,
                      name: snapshot!['workspace']['name'],
                      workspace: widget.workspace,
                      photo: photos?['rooms'][widget.workspace],
                      editable: !locked && mine?['contributes'] == true,
                      changeWorkspacePhoto: true,
                      onChanged: read,
                    ),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        uiText(c, 'Partecipanti · {0}', [members.length]),
                      ),
                      trailing: invites
                          ? IconButton(
                              tooltip: uiText(c, 'Invita una persona'),
                              icon: const Icon(Icons.person_add_alt),
                              onPressed: locked ? null : invite,
                            )
                          : null,
                    ),
                    for (final m in members)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        onTap: () => profile(m['user_id']),
                        leading: IdentityAvatar(
                          api: api,
                          name: m['name'],
                          photo: photos?['members'][m['user_id']],
                          workspace: widget.workspace,
                          person: m['user_id'],
                        ),
                        title: Text(m['name']),
                        subtitle: m['user_id'] == actor
                            ? Text(uiText(c, 'Tu'))
                            : null,
                        trailing:
                            revision != null &&
                                mayRemove(
                                  accessRows(access, 'relationships'),
                                  actor,
                                  m['user_id'],
                                )
                            ? PopupMenuButton<String>(
                                enabled: !locked,
                                tooltip: uiText(c, 'Opzioni per {0}', [
                                  m['name'],
                                ]),
                                onSelected: (_) => confirm(
                                  {
                                    'type': 'member.remove',
                                    'personId': m['user_id'],
                                    'expectedAccessRevision': revision,
                                    'confirmed': true,
                                  },
                                  uiText(c, 'Rimuovere {0}?', [m['name']]),
                                  uiText(
                                    c,
                                    'Perderà l’accesso allo spazio. La cronologia e gli impegni saranno conservati.',
                                  ),
                                  'Rimuovi accesso',
                                ),
                                itemBuilder: (_) => [
                                  PopupMenuItem(
                                    value: 'remove',
                                    child: Text(uiText(c, 'Rimuovi accesso')),
                                  ),
                                ],
                              )
                            : null,
                      ),
                    if (invites && pending.isNotEmpty)
                      ExpansionTile(
                        initiallyExpanded: link != null,
                        title: Text(
                          uiText(c, 'Inviti · {0}', [pending.length]),
                        ),
                        children: [
                          for (final row in pending)
                            ListTile(
                              title: Text(
                                row['recipient_name'] ??
                                    row['recipient_email'] ??
                                    uiText(c, 'Destinatario'),
                              ),
                              subtitle: Text(
                                pendingInvitation(row)
                                    ? uiText(c, 'In attesa · {0}', [
                                        _delivery[row['delivery_status']] ??
                                            'Solo link',
                                      ])
                                    : uiText(c, 'Scaduto'),
                              ),
                              trailing: pendingInvitation(row)
                                  ? PopupMenuButton<String>(
                                      tooltip: uiText(c, 'Opzioni invito'),
                                      enabled: !locked,
                                      itemBuilder: (_) => [
                                        if (row['id'] == link?.id)
                                          PopupMenuItem(
                                            value: 'copy',
                                            child: Text(
                                              uiText(c, 'Copia link'),
                                            ),
                                          ),
                                        PopupMenuItem(
                                          value: 'revoke',
                                          child: Text(
                                            uiText(c, 'Revoca invito'),
                                          ),
                                        ),
                                      ],
                                      onSelected: (v) => v == 'copy'
                                          ? copy(row['id'])
                                          : confirm(
                                              {
                                                'type': 'invitation.revoke',
                                                'invitationId': row['id'],
                                              },
                                              uiText(c, 'Revocare l’invito?'),
                                              uiText(
                                                c,
                                                'Il destinatario non potrà più utilizzare questo link.',
                                              ),
                                              'Revoca invito',
                                            ),
                                    )
                                  : null,
                            ),
                        ],
                      ),
                    if (link != null)
                      TextButton.icon(
                        onPressed: locked ? null : () => copy(link!.id),
                        icon: const Icon(Icons.link),
                        label: Text(uiText(c, 'Copia il link dell’invito')),
                      ),
                    if (access != null)
                      WorkspaceAccess(
                        api: api,
                        base: base,
                        view: access!,
                        send: send,
                        busy: locked,
                        more: more,
                      ),
                    ExpansionTile(
                      title: Text(uiText(c, 'La mia partecipazione')),
                      children: [
                        if (ownRoles.isNotEmpty)
                          ListTile(
                            title: Text(
                              uiText(c, 'Rinuncia alla gestione degli accessi'),
                            ),
                            onTap: locked
                                ? null
                                : () => confirm(
                                    {
                                      'type': 'access.relinquish',
                                      'confirmed': true,
                                    },
                                    uiText(c, 'Rinunciare alla gestione?'),
                                    uiText(
                                      c,
                                      'Resterai nello spazio. La gestione potrebbe diventare indisponibile.',
                                    ),
                                    'Rinuncia',
                                  ),
                          ),
                        ListTile(
                          title: Text(uiText(c, 'Lascia lo spazio')),
                          onTap: locked
                              ? null
                              : () => confirm(
                                  {'type': 'member.leave', 'confirmed': true},
                                  uiText(c, 'Lasciare lo spazio?'),
                                  uiText(
                                    c,
                                    'Perderai l’accesso. La cronologia e gli impegni resteranno nello spazio.',
                                  ),
                                  'Lascia lo spazio',
                                ),
                        ),
                      ],
                    ),
                    if (notice != null)
                      Semantics(
                        liveRegion: true,
                        child: Text(uiText(c, notice!)),
                      ),
                    if (journal.pending != null) ...[
                      FilledButton(
                        onPressed: writing
                            ? null
                            : () => send(journal.pending!['command']),
                        child: Text(uiText(c, 'Verifica e riprova')),
                      ),
                      TextButton(
                        onPressed: writing
                            ? null
                            : () async {
                                if (!await ask(
                                      'Interrompere la verifica?',
                                      'Se l’operazione è già avvenuta, resterà valida.',
                                      'Interrompi',
                                    ) ||
                                    !current)
                                  return;
                                try {
                                  await journal.stopVerification();
                                  if (current) await read();
                                } catch (_) {
                                  if (current)
                                    setState(
                                      () => notice = 'Impossibile interrompere la verifica.',
                                    );
                                }
                              },
                        child: Text(uiText(c, 'Interrompi verifica')),
                      ),
                    ],
                  ],
                ],
              ),
            ),
            if (active && !verified)
              Center(
                child: error == null
                    ? StudioLoading(
                        label: uiText(c, 'Caricamento degli accessi…'),
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(uiText(c, error!)),
                          TextButton(
                            onPressed: ended
                                ? () => Navigator.pop(c, true)
                                : read,
                            child: Text(
                              ended
                                  ? uiText(c, 'Torna agli spazi')
                                  : uiText(c, 'Riprova'),
                            ),
                          ),
                        ],
                      ),
              ),
          ],
        ),
      ),
    );
  }
}

class _InvitePerson extends StatefulWidget {
  const _InvitePerson({
    required this.api,
    required this.members,
    required this.vault,
  });
  final RimiamApi api;
  final DraftVault vault;
  final Set<String> members;
  @override
  State<_InvitePerson> createState() => _InviteState();
}

class _InviteState extends State<_InvitePerson> {
  final email = TextEditingController();
  ({String id, String name})? contact;
  String? warning;
  bool history = false, mail = true;
  @override
  void dispose() {
    email.dispose();
    super.dispose();
  }

  Future<void> choose() async {
    final value = await Navigator.push<({String id, String name})>(
      context,
      MaterialPageRoute(
        builder: (_) => DirectContacts(
          api: widget.api,
          vault: widget.vault,
          selectForInvitation: true,
        ),
      ),
    );
    if (!mounted || value == null) return;
    if (widget.members.contains(value.id)) {
      setState(() => warning = 'Questa persona è già nello spazio.');
      return;
    }
    setState(() {
      contact = value;
      email.clear();
      history = false;
      warning = null;
    });
  }

  @override
  Widget build(BuildContext c) {
    final address = email.text.trim().toLowerCase(),
        eligible =
            history &&
            (contact != null ||
                RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(address));
    return Scaffold(
      appBar: AppBar(title: Text(uiText(c, 'Invita una persona'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (contact == null)
              TextField(
                controller: email,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                decoration: InputDecoration(
                  labelText: uiText(c, 'Indirizzo email'),
                ),
                onChanged: (_) => setState(() {
                  history = false;
                  warning = null;
                }),
              )
            else
              ListTile(
                title: Text(contact!.name),
                trailing: IconButton(
                  onPressed: () => setState(() {
                    contact = null;
                    history = false;
                  }),
                  tooltip: uiText(c, 'Cambia destinatario'),
                  icon: const Icon(Icons.close),
                ),
              ),
            TextButton(
              onPressed: choose,
              child: Text(uiText(c, 'Scegli dai contatti')),
            ),
            if (warning != null) Text(warning!),
            SwitchListTile(
              title: Text(uiText(c, 'Invia anche via email')),
              value: mail,
              onChanged: (v) => setState(() => mail = v),
            ),
            CheckboxListTile(
              title: Text(
                uiText(
                  c,
                  'Chi accetta potrà leggere tutta la cronologia condivisa.',
                ),
              ),
              value: history,
              onChanged: (v) => setState(() => history = v ?? false),
            ),
            FilledButton(
              onPressed: !eligible
                  ? null
                  : () => Navigator.pop(c, {
                      'type': 'invitation.create',
                      if (contact != null)
                        'contactId': contact!.id
                      else
                        'email': address,
                      'sendEmail': mail,
                      'fullHistoryDisclosed': true,
                    }),
              child: Text(
                mail ? uiText(c, 'Invia invito') : uiText(c, 'Crea invito'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
