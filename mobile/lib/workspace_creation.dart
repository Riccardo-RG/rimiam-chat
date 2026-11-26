import 'ui_language.dart';

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'attachments.dart';
import 'legacy_mobile_data.dart';
import 'legacy_recovery.dart';
import 'chat_journal.dart';
import 'direct_contacts.dart';

typedef WorkspaceTarget = ({String id, String name});
typedef _Json = Map<String, dynamic>;

const _maxInvites = 25;
final _emailPattern = RegExp(
  r"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+.\-]*)[A-Za-z0-9_+\-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$",
);

class CreationRecipient {
  const CreationRecipient.contact(String id, this.label) : contactId = id;
  const CreationRecipient.email(String email) : contactId = null, label = email;
  final String? contactId;
  final String label;
  String get key => contactId == null ? 'email:$label' : 'contact:$contactId';
  _Json get target =>
      contactId == null ? {'email': label} : {'contactId': contactId};
  _Json get stored => {...target, 'label': label};
  factory CreationRecipient.restore(_Json json) => json['contactId'] != null
      ? CreationRecipient.contact(
          json['contactId'] as String,
          json['label'] as String,
        )
      : CreationRecipient.email(json['email'] as String);
}

// The draft becomes immutable before delivery. Its command ID and attachment
// references are committed to protected storage before the server can be called.
class WorkspaceCreationDraft {
  WorkspaceCreationDraft(
    this.api,
    this.vault, {
    AttachmentStaging Function(String)? staging,
  }) : _staging = staging ?? ((scope) => AttachmentStaging(scope: scope)),
       actor = api.actorId,
       key =
           'rimiam.create.v1.${sha256.convert(utf8.encode(jsonEncode([api.origin.origin, api.actorId])))}';
  final AttachmentStaging Function(String) _staging;
  AttachmentStaging get staging => _staging(stagingScope);
  final RimiamApi api;
  final DraftVault vault;
  final String actor, key;
  String name = '', description = '', email = '', connectionId = 'default';
  String? commandId, revision;
  late String flow;
  bool history = false, ready = false, busy = false, finished = false;
  List<CreationRecipient> recipients = [];
  List<StagedAttachment> files = [];
  String get stagingScope =>
      jsonEncode([api.origin.origin, actor, 'create', flow]);
  Future<void> _writes = Future.value();

  Future<void>? _opening;
  Future<void> open({WorkspaceTarget? initialContact}) async {
    if (!ready)
      await (_opening ??= _restore().whenComplete(() => _opening = null));
    if (commandId == null &&
        !busy &&
        initialContact != null &&
        !recipients.any((r) => r.contactId == initialContact.id) &&
        recipients.length < _maxInvites) {
      recipients.add(
        CreationRecipient.contact(initialContact.id, initialContact.name),
      );
      history = false;
      await save();
    }
  }

  Future<void> _restore() async {
    final raw = await vault.read(key);
    if (raw == null) {
      flow = api.newId();
    } else {
      final value = jsonDecode(raw) as _Json;
      if (value['v'] != 1) throw const FormatException('Bozza non leggibile');
      flow = value['flow'] as String;
      name = value['name'] as String;
      description = value['description'] as String;
      email = value['email'] as String;
      connectionId = value['connectionId'] as String;
      history = value['history'] as bool;
      revision = value['revision'] as String?;
      commandId = value['commandId'] as String?;
      recipients = (value['recipients'] as List)
          .cast<_Json>()
          .map(CreationRecipient.restore)
          .toList();
      files = (value['files'] as List)
          .cast<_Json>()
          .map(StagedAttachment.fromJson)
          .toList();
    }
    ready = true;
  }

  Future<void> _replace(String? raw) {
    final attempt = _writes.then((_) => vault.replace(key, raw));
    _writes = attempt.catchError((Object _) {});
    return attempt;
  }

  Future<void> save() => _replace(
    jsonEncode({
      'v': 1,
      'flow': flow,
      'name': name,
      'description': description,
      'email': email,
      'connectionId': connectionId,
      'history': history,
      'revision': revision,
      'commandId': commandId,
      'recipients': recipients.map((r) => r.stored).toList(),
      'files': files.map((f) => f.toJson()).toList(),
    }),
  );

  List<CreationRecipient> get selection {
    final normalized = email.trim().toLowerCase();
    if (normalized.isEmpty) return [...recipients];
    if (!_emailPattern.hasMatch(normalized)) {
      throw const FormatException(
        'Completa l’indirizzo email o scegli un contatto.',
      );
    }
    final emailRecipient = CreationRecipient.email(normalized);
    if (recipients.any((r) => r.key == emailRecipient.key))
      return [...recipients];
    if (recipients.length >= _maxInvites)
      throw const FormatException('Puoi invitare fino a 25 persone.');
    return [...recipients, emailRecipient];
  }

  Future<void> _finish() async {
    await _replace(null);
    finished = true;
    try {
      if (files.isNotEmpty) await staging.discard(files);
    } catch (_) {
      /* A retained cache copy cannot invalidate a committed creation. */
    }
  }

  Future<void> discardLocalAttempt() async {
    _checkActor();
    if (!ready || busy || finished || commandId == null) return;
    busy = true;
    try {
      // Discard only local retry data. A delayed server commit is still valid.
      await _finish();
    } finally {
      busy = false;
    }
  }

  Future<bool> _confirmed(String id) async {
    try {
      final receipt = await api.get('/api/v1/workspaces/$id/receipts/$id');
      if (receipt['commandId'] != id ||
          receipt['status'] != 'committed' ||
          receipt['result']?['id'] != id) {
        throw const FormatException(
          'La conferma dello spazio non è riconoscibile.',
        );
      }
      return true;
    } on ApiError catch (e) {
      // A not-yet-created space is inaccessible. Neither answer proves failure.
      if (e.status == 403 || e.code == 'RECEIPT_NOT_FOUND') return false;
      rethrow;
    }
  }

  Future<List<_Json>> _payloads() async {
    if (files.isEmpty) return [];
    try {
      return await staging.payloads(files);
    } catch (_) {
      throw FormatException(
        commandId == null
            ? 'Un allegato non è leggibile. Rimuovilo e aggiungilo di nuovo.'
            : 'Un allegato non è leggibile. Verifica se il server ha ricevuto lo spazio.',
      );
    }
  }

  void _checkActor() {
    if (api.actorId != actor)
      throw const FormatException('È cambiato l’account attivo.');
  }

  Future<WorkspaceTarget?> submit({
    String? selectedRevision,
    bool verifyOnly = false,
  }) async {
    if (!ready || busy || finished || actor.isEmpty || actor != api.actorId)
      return null;
    if (verifyOnly && commandId == null) return null;
    busy = true;
    try {
      final previous = commandId;
      List<_Json>? bytes;
      if (previous == null) {
        if (name.trim().isEmpty ||
            name.trim().length > 120 ||
            description.trim().length > 2000) {
          throw const FormatException(
            'Inserisci un nome entro 120 caratteri e un’introduzione entro 2.000.',
          );
        }
        final selected = selection;
        if (selected.length > _maxInvites ||
            (selected.isNotEmpty && !history)) {
          throw const FormatException(
            'Conferma la visibilità della cronologia per gli invitati.',
          );
        }
        if (selectedRevision == null)
          throw const FormatException('Scegli una connessione disponibile.');
        bytes = await _payloads();
        _checkActor();
        recipients = selected;
        email = '';
        revision = selectedRevision;
        commandId = api.newId();
      }
      final id = commandId!;
      if (previous == null) {
        try {
          await save();
        } catch (_) {
          commandId = null;
          revision = null;
          throw const FormatException(
            'Impossibile salvare la bozza sul dispositivo. Lo spazio non è stato inviato.',
          );
        }
      }
      _checkActor();
      final confirmed = previous != null && await _confirmed(id);
      if (!confirmed) {
        if (verifyOnly) return null;
        bytes ??= await _payloads();
        _checkActor();
        _Json result;
        try {
          result = await api.post('/api/v1/workspaces', {
            'commandId': id,
            'expectedActorId': actor,
            'name': name.trim(),
            if (description.trim().isNotEmpty)
              'description': description.trim(),
            'assistantConnectionId': connectionId,
            'assistantConnectionRevision': revision,
            if (recipients.isNotEmpty)
              'invitations': {
                'recipients': recipients.map((r) => r.target).toList(),
                'fullHistoryDisclosed': true,
              },
            if (bytes.isNotEmpty) 'attachments': bytes,
          });
        } on ApiError catch (e) {
          if ({
            'ASSISTANT_CONNECTION_CHANGED',
            'ASSISTANT_CONNECTION_UNAVAILABLE',
            'PERSONAL_CONTACT_UNAVAILABLE',
            'CANNOT_INVITE_SELF',
            'INVALID_REQUEST',
          }.contains(e.code)) {
            commandId = null;
            revision = null;
            await save();
          }
          rethrow;
        }
        if (result['id'] != id)
          throw const FormatException(
            'La conferma dello spazio non è riconoscibile.',
          );
      }
      _checkActor();
      await _finish();
      return (id: id, name: name.trim());
    } finally {
      busy = false;
    }
  }
}

class WorkspaceCreation extends StatefulWidget {
  WorkspaceCreation({
    Key? key,
    required this.api,
    this.vault = const DeviceDraftVault(),
    this.initialContact,
  }) : super(key: key ?? ValueKey((api, api.actorId)));
  final RimiamApi api;
  final DraftVault vault;
  final WorkspaceTarget? initialContact;
  @override
  State<WorkspaceCreation> createState() => _WorkspaceCreationState();
}

class _WorkspaceCreationState extends State<WorkspaceCreation> {
  static final _sessions =
      Expando<Map<(String, DraftVault), WorkspaceCreationDraft>>();
  late final WorkspaceCreationDraft draft;
  final _name = TextEditingController(),
      _intro = TextEditingController(),
      _email = TextEditingController();
  List<_Json> _connections = [];
  bool _loadingConnections = true, _storageError = false;
  int _saveRevision = 0;
  String _error = '';
  bool get _current => mounted && widget.api.actorId == draft.actor;
  bool get _editable =>
      draft.ready && draft.commandId == null && !draft.busy && _current;
  @override
  void initState() {
    super.initState();
    final sessions = _sessions[widget.api] ??= {};
    final key = (widget.api.actorId, widget.vault);
    final previous = sessions[key];
    draft = previous != null && !previous.finished
        ? previous
        : (sessions[key] = WorkspaceCreationDraft(widget.api, widget.vault));
    _restore();
    _catalog();
  }

  @override
  void dispose() {
    _name.dispose();
    _intro.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _restore() async {
    try {
      await draft.open(initialContact: widget.initialContact);
      if (!_current) return;
      _name.text = draft.name;
      _intro.text = draft.description;
      _email.text = draft.email;
      setState(() {
        _storageError = false;
        _error = '';
      });
    } catch (_) {
      if (_current)
        setState(() {
          _storageError = true;
          _error = 'Impossibile leggere la bozza sul dispositivo.';
        });
    }
  }

  Future<void> _catalog() async {
    if (_current) setState(() => _loadingConnections = true);
    try {
      final settings = await widget.api.get('/api/v1/assistant-settings');
      if (_current)
        setState(
          () => _connections = (settings['connections'] as List)
              .cast<_Json>()
              .where((c) => c['configured'] == true || c['id'] == 'default')
              .toList(),
        );
    } catch (_) {
      if (_current) setState(() => _connections = []);
    } finally {
      if (_current) setState(() => _loadingConnections = false);
    }
  }

  Future<void> _save() async {
    final seq = ++_saveRevision;
    try {
      await draft.save();
      if (_current && seq == _saveRevision && _storageError)
        setState(() => _storageError = false);
    } catch (_) {
      if (_current && seq == _saveRevision)
        setState(() => _storageError = true);
      rethrow;
    }
  }

  void _edit(VoidCallback change) {
    if (!_editable) return;
    setState(() {
      change();
      _error = '';
    });
    unawaited(_save().catchError((Object _) {}));
  }

  Future<void> _contacts() async {
    final chosen = await Navigator.of(context).push<WorkspaceTarget>(
      MaterialPageRoute(
        builder: (_) => DirectContacts(
          api: widget.api,
          vault: widget.vault,
          selectForInvitation: true,
        ),
      ),
    );
    if (!_current ||
        !_editable ||
        chosen == null ||
        draft.recipients.length >= _maxInvites ||
        draft.recipients.any((r) => r.contactId == chosen.id))
      return;
    _edit(() {
      draft.recipients.add(CreationRecipient.contact(chosen.id, chosen.name));
      draft.history = false;
    });
  }

  void _addEmail() {
    try {
      final selected = draft.selection;
      _edit(() {
        draft.recipients = selected;
        draft.email = '';
        _email.clear();
        draft.history = false;
      });
    } on FormatException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _discardAttempt() async {
    if (draft.busy || !_current) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(uiText(ctx, 'Dimenticare questo tentativo?')),
        content: Text(
          uiText(
            ctx,
            'La bozza e gli allegati verranno rimossi da questo dispositivo. Se il server ha già creato lo spazio, lo ritroverai nella Home.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(uiText(ctx, 'Mantieni')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(uiText(ctx, 'Dimentica tentativo')),
          ),
        ],
      ),
    );
    if (confirmed != true || !_current || draft.busy) return;
    final operation = draft.discardLocalAttempt();
    setState(() => _error = '');
    try {
      await operation;
      if (_current) Navigator.of(context).pop();
    } catch (_) {
      if (_current)
        setState(
          () => _error =
              'Il tentativo è ancora salvato sul dispositivo. Riprova.',
        );
    }
  }

  Future<void> _create({bool verify = false}) async {
    if (draft.busy || !_current) return;
    final connection = _connections
        .where((c) => c['id'] == draft.connectionId)
        .firstOrNull;
    final pending = draft.submit(
      selectedRevision: connection?['revision'] as String?,
      verifyOnly: verify,
    );
    setState(() => _error = '');
    try {
      final result = await pending;
      if (!_current) return;
      if (result != null) {
        Navigator.of(context).pop(result);
        return;
      }
      setState(
        () =>
            _error = 'Conferma ancora assente. Puoi riprovare lo stesso invio.',
      );
    } on ApiError catch (e) {
      if (!_current) return;
      final message = switch (e.code) {
        'ASSISTANT_CONNECTION_CHANGED' || 'ASSISTANT_CONNECTION_UNAVAILABLE' =>
          'La connessione è cambiata. Controlla la scelta e conferma di nuovo.',
        'PERSONAL_CONTACT_UNAVAILABLE' =>
          'Uno dei contatti non è più disponibile. Aggiorna gli inviti.',
        'CANNOT_INVITE_SELF' => 'Rimuovi il tuo indirizzo dagli invitati.',
        _ => draft.commandId == null ? 'Controlla i dati dello spazio.' : 'La creazione attende conferma. Verifica l’esito prima di riprovare.',
      };
      setState(() => _error = message);
      if (e.code.startsWith('ASSISTANT_CONNECTION')) await _catalog();
    } on FormatException catch (e) {
      if (_current) setState(() => _error = e.message);
    } catch (_) {
      if (_current)
        setState(
          () => _error = 'Impossibile completare la verifica. I dati della creazione restano sul dispositivo.',
        );
    } finally {
      if (_current) {
        if (_email.text != draft.email) _email.text = draft.email;
        setState(() {});
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = draft.commandId != null,
        selection = _connections
            .where((c) => c['id'] == draft.connectionId)
            .firstOrNull;
    final hasTargets =
        draft.recipients.isNotEmpty || draft.email.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Nuovo spazio'))),
      body: SafeArea(
        child: !draft.ready
            ? Center(
                child: _storageError
                    ? TextButton(
                        onPressed: _restore,
                        child: Text(uiText(context, '{0} Riprova', [_error])),
                      )
                    : const CircularProgressIndicator(),
              )
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  LegacyRecoveryPanel(
                    api: widget.api,
                    scope: const LegacyScope.creation(),
                    vault: widget.vault,
                    allowed: () => mounted && widget.api.actorId == draft.actor,
                  ),
                  if (pending) ...[
                    Text(
                      uiText(context, 'Creazione da verificare'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(draft.name),
                    if (_error.isNotEmpty) Text(uiText(context, _error)),
                    FilledButton(
                      onPressed: draft.busy
                          ? null
                          : () => _create(verify: true),
                      child: Text(uiText(context, 'Verifica creazione')),
                    ),
                    OutlinedButton(
                      onPressed: draft.busy ? null : () => _create(),
                      child: Text(uiText(context, 'Riprova lo stesso invio')),
                    ),
                    TextButton(
                      onPressed: draft.busy ? null : _discardAttempt,
                      child: Text(uiText(context, 'Dimentica tentativo')),
                    ),
                  ] else ...[
                    TextField(
                      controller: _name,
                      enabled: _editable,
                      maxLength: 120,
                      decoration: InputDecoration(
                        labelText: uiText(context, 'Nome dello spazio'),
                      ),
                      onChanged: (v) => _edit(() => draft.name = v),
                    ),
                    TextField(
                      controller: _intro,
                      enabled: _editable,
                      maxLength: 2000,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(
                        labelText: uiText(
                          context,
                          'Introduzione (facoltativa)',
                        ),
                      ),
                      onChanged: (v) => _edit(() => draft.description = v),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      uiText(context, 'Invita persone'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    for (final r in draft.recipients)
                      ListTile(
                        dense: true,
                        title: Text(r.label),
                        trailing: IconButton(
                          tooltip: uiText(context, 'Rimuovi {0}', [r.label]),
                          icon: const Icon(Icons.close),
                          onPressed: !_editable
                              ? null
                              : () => _edit(() {
                                  draft.recipients.remove(r);
                                  draft.history = false;
                                }),
                        ),
                      ),
                    TextField(
                      controller: _email,
                      enabled:
                          _editable && draft.recipients.length < _maxInvites,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      decoration: InputDecoration(
                        labelText: uiText(context, 'Indirizzo email'),
                      ),
                      onChanged: (v) => _edit(() {
                        draft.email = v;
                        draft.history = false;
                      }),
                      onSubmitted: (_) => _addEmail(),
                    ),
                    Wrap(
                      children: [
                        if (draft.email.trim().isNotEmpty)
                          TextButton.icon(
                            onPressed: _editable ? _addEmail : null,
                            icon: const Icon(Icons.add),
                            label: Text(uiText(context, 'Aggiungi email')),
                          ),
                        TextButton.icon(
                          onPressed:
                              _editable && draft.recipients.length < _maxInvites
                              ? _contacts
                              : null,
                          icon: const Icon(Icons.contacts_outlined),
                          label: Text(uiText(context, 'Scegli dalla rubrica')),
                        ),
                      ],
                    ),
                    if (hasTargets)
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: draft.history,
                        onChanged: _editable
                            ? (v) => _edit(() => draft.history = v == true)
                            : null,
                        title: Text(
                          uiText(
                            context,
                            'Confermo che chi accetta vedrà tutta la cronologia condivisa.',
                          ),
                        ),
                      ),
                    const Divider(),
                    Text(
                      uiText(context, 'Assistente dello spazio'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (_loadingConnections)
                      const LinearProgressIndicator()
                    else if (_connections.isEmpty)
                      TextButton(
                        onPressed: _catalog,
                        child: Text(
                          uiText(
                            context,
                            'Connessioni non disponibili · Riprova',
                          ),
                        ),
                      )
                    else ...[
                      DropdownButton<String>(
                        isExpanded: true,
                        value: selection?['id'] as String?,
                        hint: Text(uiText(context, 'Scegli una connessione')),
                        items: _connections
                            .map(
                              (c) => DropdownMenuItem(
                                value: c['id'] as String,
                                child: Text(
                                  c['label'] as String,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: _editable
                            ? (v) => _edit(() => draft.connectionId = v!)
                            : null,
                      ),
                      if (selection != null)
                        Text(
                          selection['configured'] == true
                              ? uiText(context, 'Destinazione: {0}', [
                                  selection['destination'],
                                ])
                              : uiText(
                                  context,
                                  'L’assistente sarà disponibile quando il servizio verrà configurato.',
                                ),
                        ),
                    ],
                    const SizedBox(height: 12),
                    AttachmentPicker(
                      staging: AttachmentStaging(scope: draft.stagingScope),
                      files: draft.files,
                      enabled: _editable,
                      onChanged: (next) async {
                        if (!_editable) return;
                        final before = draft.files;
                        setState(() => draft.files = next);
                        try {
                          await _save();
                        } catch (_) {
                          if (_current) setState(() => draft.files = before);
                          rethrow;
                        }
                        final keep = next.map((f) => f.id).toSet();
                        await AttachmentStaging(
                          scope: draft.stagingScope,
                        ).discard(
                          before.where((f) => !keep.contains(f.id)).toList(),
                        );
                      },
                    ),
                    if (_storageError)
                      Text(
                        uiText(
                          context,
                          'La bozza non è stata salvata sul dispositivo.',
                        ),
                      ),
                    if (_error.isNotEmpty) Text(uiText(context, _error)),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed:
                          _editable &&
                              draft.name.trim().isNotEmpty &&
                              selection != null &&
                              (!hasTargets || draft.history)
                          ? () => _create()
                          : null,
                      child: Text(
                        hasTargets
                            ? uiText(context, 'Crea spazio e invita')
                            : uiText(context, 'Crea spazio'),
                      ),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}
