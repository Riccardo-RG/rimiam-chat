import 'dart:convert';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'attachment_staging.dart';
import 'chat_journal.dart';
import 'ui_language.dart';
import 'workspace_command_journal.dart';
import 'workspace_governance.dart' show groupRows, groupIssue;

class PersonalAttachment {
  PersonalAttachment(
    this.api,
    DraftVault vault,
    this.thread, {
    AttachmentStaging? staging,
  }) : actor = api.actorId,
       staging =
           staging ??
           AttachmentStaging(
             scope: jsonEncode([
               api.origin.origin,
               api.actorId,
               'private-upload',
               thread,
             ]),
           ),
       journal = WorkspaceCommandJournal(
         api,
         vault,
         namespace: 'private-upload',
         collection: thread,
       );
  final RimiamApi api;
  final String actor, thread;
  final AttachmentStaging staging;
  final WorkspaceCommandJournal journal;
  bool ready = false;
  int access = 0;
  StagedAttachment? get file => journal.draft?['file'] == null
      ? null
      : StagedAttachment.fromJson(
          journal.draft!['file'] as Map<String, dynamic>,
        );
  bool get allowed => ready && actor.isNotEmpty && api.actorId == actor;

  void suspend() {
    ready = false;
    access++;
  }

  Future<void> load() async {
    final epoch = ++access;
    ready = false;
    if (actor != api.actorId || actor.isEmpty)
      throw const ApiError(403, 'AUTH_CONTEXT_CHANGED');
    final responses = await Future.wait([
      api.get(
        '/api/v1/personal-chats?thread=${Uri.encodeQueryComponent(thread)}',
      ),
      api.get('/api/v1/workspaces/${Uri.encodeComponent(thread)}/workspace'),
    ]);
    final snapshot = responses.last;
    if (actor != api.actorId ||
        epoch != access ||
        snapshot['workspace']?['personal'] != true ||
        snapshot['workspace']?['id'] != thread ||
        !groupRows(snapshot['members']).any(
          (m) =>
              m['user_id'] == actor &&
              m['active'] == true &&
              m['contributes'] == true,
        ))
      throw const ApiError(403, 'PERSONAL_CHAT_REQUIRED');
    if (!journal.busy) await journal.load();
    if (epoch == access) ready = actor == api.actorId;
  }

  Future<void> _store(StagedAttachment? next) async {
    if (!allowed || journal.busy || journal.pending != null)
      throw const ApiError(403, 'PERSONAL_CHAT_REQUIRED');
    final old = journal.draft;
    journal.draft = next == null ? null : {'file': next.toJson()};
    try {
      await journal.store();
    } catch (_) {
      journal.draft = old;
      rethrow;
    }
  }

  Future<void> choose(XFile picked) async {
    if (!allowed || journal.pending != null)
      throw const ApiError(403, 'PERSONAL_CHAT_REQUIRED');
    final previous = file;
    final added = await staging.stage([picked], existing: const []);
    try {
      await _store(added.single);
    } catch (_) {
      await staging.discard(added);
      rethrow;
    }
    if (previous != null) await staging.discard([previous]);
  }

  Future<void> remove() async {
    final previous = file;
    await _store(null);
    if (previous != null) await staging.discard([previous]);
  }

  Future<void> save() async {
    final selected = file;
    if (!allowed || selected == null)
      throw const ApiError(403, 'PERSONAL_CHAT_REQUIRED');
    final command = {
      'type': 'document.upload',
      'filename': selected.filename,
      'conversationShare': <String, dynamic>{},
    };
    // A missing or corrupt local original can be replaced before a first
    // upload. During reconciliation, check the receipt before reading bytes.
    Future<Map<String, dynamic>> materialize() async => {
      ...command,
      ...(await staging.payloads([selected])).single,
    };
    final firstPayload = journal.pending == null ? await materialize() : null;
    await journal.send(
      thread,
      {...command, 'digest': selected.digest},
      allowed: () => allowed,
      fromEditor: true,
      materialize: firstPayload == null
          ? materialize
          : () async => firstPayload,
    );
    try {
      await staging.discard([selected]);
    } on FileSystemException {
      // The receipt is confirmed and the local decryption key is gone.
    }
  }
}

class PersonalAttachmentPage extends StatefulWidget {
  const PersonalAttachmentPage({super.key, required this.upload});
  final PersonalAttachment upload;
  @override
  State<PersonalAttachmentPage> createState() => _UploadState();
}

class _UploadState extends State<PersonalAttachmentPage>
    with WidgetsBindingObserver {
  PersonalAttachment get upload => widget.upload;
  bool busy = false, checking = true, active = true, saving = false;
  int checkVersion = 0;
  String? error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    upload.suspend();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      upload.suspend();
      setState(() => active = false);
    } else if (!active && state == AppLifecycleState.resumed) {
      active = true;
      check();
    }
  }

  Future<void> check() async {
    final version = ++checkVersion;
    setState(() {
      checking = true;
      error = null;
    });
    try {
      await upload.load();
    } catch (e) {
      if (mounted && active && version == checkVersion) error = groupIssue(e);
    }
    if (mounted && active && version == checkVersion)
      setState(() => checking = false);
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy || !active || !upload.allowed) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted && active)
        error = e is AttachmentProblem ? e.message : groupIssue(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> pick() async {
    final picked = await openFile();
    if (picked == null) return;
    try {
      if (!mounted || !active) return;
      await upload.load();
      if (mounted && active && upload.allowed) await upload.choose(picked);
    } finally {
      await AttachmentStaging.releasePickerCopies([picked]);
    }
  }

  @override
  Widget build(BuildContext context) {
    final file = upload.file,
        free = !busy && upload.allowed && active && !checking,
        pending = upload.journal.pending != null;
    return PopScope(
      canPop: !saving,
      child: Scaffold(
        appBar: AppBar(title: Text(uiText(context, 'Salva allegato'))),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (checking || busy) const LinearProgressIndicator(),
              if (error != null) Text(uiText(context, error!)),
              if (active && !checking && !upload.allowed)
                TextButton(
                  onPressed: check,
                  child: Text(uiText(context, 'Riprova')),
                ),
              if (active && upload.allowed) ...[
                Text(
                  uiText(
                    context,
                    'Il file sarà visibile solo a te nella chat personale.',
                  ),
                ),
                if (file == null)
                  OutlinedButton.icon(
                    onPressed: free ? () => run(pick) : null,
                    icon: const Icon(Icons.attach_file),
                    label: Text(uiText(context, 'Scegli file')),
                  )
                else ...[
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(file.filename),
                    trailing: IconButton(
                      tooltip: uiText(context, 'Rimuovi'),
                      icon: const Icon(Icons.close),
                      onPressed: free && !pending
                          ? () => run(upload.remove)
                          : null,
                    ),
                  ),
                  FilledButton(
                    onPressed: free
                        ? () => run(() async {
                            setState(() => saving = true);
                            try {
                              await upload.load();
                              await upload.save();
                              if (context.mounted && active)
                                Navigator.pop(context, true);
                            } finally {
                              if (mounted) setState(() => saving = false);
                            }
                          })
                        : null,
                    child: Text(
                      uiText(
                        context,
                        pending
                            ? 'Verifica e riprova'
                            : 'Salva nella chat personale',
                      ),
                    ),
                  ),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}
