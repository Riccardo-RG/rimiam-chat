import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'audio_issue.dart';
import 'attachment_staging.dart';
import 'chat_journal.dart';
import 'voice_device.dart';
import 'workspace_command_journal.dart';

class WorkspaceVoicePage extends StatefulWidget {
  const WorkspaceVoicePage({
    super.key,
    required this.api,
    required this.workspace,
    this.vault = const DeviceDraftVault(),
    this.canWrite = true,
    this.capture,
    this.staging,
    this.messageId,
  });
  final RimiamApi api;
  final String workspace;
  final String? messageId;
  final DraftVault vault;
  final bool canWrite;
  final VoiceCapture? capture;
  final AttachmentStaging? staging;
  @override
  State<WorkspaceVoicePage> createState() => _VoiceState();
}

class _VoiceState extends State<WorkspaceVoicePage>
    with WidgetsBindingObserver {
  late final journal = WorkspaceCommandJournal(
    widget.api,
    widget.vault,
    namespace: 'voice',
    collection: widget.workspace,
  );
  late final stage = widget.staging ?? AttachmentStaging(scope: journal.scope);
  late final capture = widget.capture ?? DeviceVoiceCapture();
  final player = ManualAudioPlayer();
  String get base =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspace)}';
  Map<String, dynamic>? view;
  String? error, playing, sent, awaitedSource, reply;
  int? replyRevision;
  String mode = 'message';
  bool replyUnavailable = false;
  bool consent = false,
      busy = false,
      recording = false,
      active = true,
      reading = false;
  int generation = 0, playback = 0;
  Timer? limit, poll;
  StagedAttachment? get clip => journal.draft?['file'] == null
      ? null
      : StagedAttachment.fromJson(journal.draft!['file']);
  bool get current => mounted && active && widget.api.actorId == journal.actor;
  bool get writable =>
      current && view != null && widget.canWrite && widget.messageId == null;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(load(restore: true));
    poll = Timer.periodic(const Duration(seconds: 6), (_) {
      if (current && !busy && !recording && !reading) unawaited(load());
    });
  }

  void refresh() {
    if (mounted) setState(() {});
  }

  Future<void> load({bool restore = false}) async {
    final version = generation;
    reading = true;
    try {
      final v = await widget.api.get('$base/voice');
      if (!current || version != generation) return;
      if (restore) {
        await journal.load();
        mode = journal.draft?['mode'] ?? 'message';
      }
      if (!current || version != generation) return;
      view = v;
      error = null;
      final source = awaitedSource;
      if (source != null && reply == null && !replyUnavailable) {
        final state = (v['messages'] as List? ?? [])
            .whereType<Map>()
            .where((m) => m['sourceId'] == source)
            .firstOrNull;
        if (state?['errorCode'] != null ||
            {'failed', 'stale'}.contains(state?['interpretationStatus'])) {
          replyUnavailable = true;
        } else {
          final change = await widget.api.get(
            '$base/changes?after=${replyRevision ?? 0}&limit=1',
          );
          if (!current || version != generation || awaitedSource != source)
            return;
          if (change['headRevision'] != replyRevision) {
            final contents = await widget.api.get('$base/workspace');
            if (!current || version != generation || awaitedSource != source)
              return;
            final matches = (contents['messages'] as List? ?? [])
                .whereType<Map>()
                .where(
                  (m) =>
                      m['actor_kind'] == 'miriam' &&
                      m['reply_to_source_id'] == source,
                );
            reply = matches.firstOrNull?['content'] as String?;
            replyRevision = change['headRevision'] as int?;
          }
        }
      }
    } catch (e) {
      if (current && version == generation) {
        view = null;
        error = audioIssue(e);
        await silence();
      }
    } finally {
      reading = false;
      refresh();
    }
  }

  Future<void> silence() async {
    ++playback;
    playing = null;
    await player.stop();
    limit?.cancel();
    if (recording) {
      recording = false;
      await capture.clear();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.hidden ||
        state == AppLifecycleState.paused ||
        (state == AppLifecycleState.inactive &&
            (recording || playing != null))) {
      active = false;
      generation++;
      view = null;
      unawaited(silence().whenComplete(refresh));
    } else if (state == AppLifecycleState.resumed && !active) {
      active = true;
      unawaited(load(restore: !journal.busy));
    }
  }

  @override
  void dispose() {
    active = false;
    generation++;
    playback++;
    limit?.cancel();
    poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    unawaited(player.stop());
    unawaited(capture.dispose());
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    busy = true;
    error = null;
    refresh();
    try {
      await action();
    } catch (e) {
      if (current) error = audioIssue(e);
    } finally {
      busy = false;
      refresh();
    }
  }

  Future<void> start() => run(() async {
    final token = generation;
    if (!writable ||
        !consent ||
        journal.pending != null ||
        (mode == 'miriam' && view?['transcriptionConfigured'] != true))
      return;
    if (!await capture.permission())
      throw const AttachmentProblem(
        'Consenti l’accesso al microfono nelle impostazioni del dispositivo.',
      );
    if (!writable || token != generation) return;
    await silence();
    if (!writable || token != generation) return;
    await capture.start();
    if (!writable || token != generation) {
      await capture.clear();
      return;
    }
    recording = true;
    limit = Timer(const Duration(minutes: 5), () {
      unawaited(stop());
    });
  });
  Future<void> stop() => run(() async {
    if (!recording) return;
    limit?.cancel();
    final token = generation;
    final audio = await capture.stop();
    recording = false;
    if (audio == null)
      throw const AttachmentProblem('Registrazione vuota. Registra di nuovo.');
    List<StagedAttachment> added = [];
    try {
      if (!writable || token != generation) return;
      added = await stage.stage([audio], existing: []);
      if (!writable || token != generation) return;
      journal.draft = {'file': added.single.toJson(), 'mode': mode};
      try {
        await journal.store();
      } catch (_) {
        journal.draft = null;
        rethrow;
      }
      added = [];
    } finally {
      await stage.discard(added);
      await capture.clear();
    }
  });
  Future<void> discard() => run(() async {
    final f = clip;
    if (f == null || journal.pending != null) return;
    final old = journal.draft;
    journal.draft = null;
    try {
      await journal.store();
    } catch (_) {
      journal.draft = old;
      rethrow;
    }
    await stage.discard([f]);
    consent = false;
  });
  Future<void> send() => run(() async {
    final f = clip;
    if (f == null || !writable || !consent) return;
    final token = generation;
    final command = {
      'type': 'voice.send',
      'mode': mode,
      'allowModelProcessing': true,
    };
    final receipt = await journal.send(
      widget.workspace,
      {...command, 'file': f.toJson()},
      allowed: () => writable && consent && token == generation,
      fromEditor: true,
      materialize: () async => {
        ...command,
        ...(await stage.payloads([f])).single,
      },
    );
    await stage.discard([f]);
    consent = false;
    if (current && token == generation) {
      sent = 'Vocale inviato';
      if (mode == 'miriam' && receipt['sourceId'] is String) {
        awaitedSource = receipt['sourceId'];
        reply = null;
        replyUnavailable = false;
        replyRevision = null;
      }
      await load();
    }
  });
  Future<void> listen(String source) async {
    final previous = playing;
    final change = ++playback;
    await player.stop();
    if (!current || change != playback) return;
    playing = previous == source ? null : source;
    refresh();
    if (playing == null) return;
    try {
      final audio = await widget.api.getBytes(
        '$base/source-file?id=${Uri.encodeQueryComponent(source)}',
      );
      if (current && change == playback) await player.play(audio);
    } catch (e) {
      if (current && change == playback)
        error = 'Impossibile riprodurre l’audio.';
    } finally {
      if (change == playback) {
        playing = null;
        refresh();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = view;
    final f = v == null ? null : clip;
    final entries = (v?['messages'] as List? ?? []).whereType<Map>().where(
      (m) => widget.messageId == null || widget.messageId == m['messageId'],
    );
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Messaggi vocali'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (error != null)
            Text(
              uiText(context, error!),
              semanticsLabel: uiText(context, 'Errore: {0}', [
                uiText(context, error!),
              ]),
            ),
          if (v == null && error == null) const LinearProgressIndicator(),
          if (v == null && error != null)
            TextButton(
              onPressed: () => load(restore: true),
              child: Text(uiText(context, 'Riprova')),
            ),
          if (v?['transcriptionConfigured'] == false)
            Text(
              uiText(
                context,
                'La trascrizione non è configurata su questa installazione.',
              ),
            ),
          if (writable) ...[
            SegmentedButton<String>(
              segments: [
                ButtonSegment(
                  value: 'message',
                  label: Text(uiText(context, 'Al gruppo')),
                ),
                ButtonSegment(
                  value: 'miriam',
                  label: Text(uiText(context, 'A Emme')),
                ),
              ],
              selected: {mode},
              onSelectionChanged: busy || recording || f != null
                  ? null
                  : (s) => setState(() => mode = s.single),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                uiText(
                  context,
                  'Autorizzo la trascrizione e la condivisione di audio e testo nello spazio',
                ),
              ),
              value: consent,
              onChanged: busy || recording
                  ? null
                  : (v) => setState(() => consent = v),
            ),
            if (f != null) ...[
              Text(
                uiText(context, 'Vocale pronto · {0} KB', [
                  (f.size / 1024).ceil(),
                ]),
              ),
              FilledButton(
                onPressed: busy || !consent ? null : send,
                child: Text(
                  journal.pending == null
                      ? uiText(context, 'Invia vocale')
                      : uiText(context, 'Verifica invio'),
                ),
              ),
              TextButton(
                onPressed: busy || journal.pending != null ? null : discard,
                child: Text(uiText(context, 'Scarta registrazione')),
              ),
            ] else if (recording)
              FilledButton.icon(
                onPressed: busy ? null : stop,
                icon: const Icon(Icons.stop),
                label: Text(uiText(context, 'Termina registrazione')),
              )
            else
              FilledButton.icon(
                onPressed:
                    busy ||
                        !consent ||
                        (mode == 'miriam' &&
                            v?['transcriptionConfigured'] != true)
                    ? null
                    : start,
                icon: const Icon(Icons.mic),
                label: Text(uiText(context, 'Registra')),
              ),
          ],
          if (v != null && awaitedSource != null) ...[
            SelectableText(
              reply ??
                  uiText(
                    context,
                    replyUnavailable
                        ? 'Emme non ha potuto rispondere a questo vocale. Lo ritrovi nella chat.'
                        : 'In attesa della risposta di Emme…',
                  ),
            ),
            TextButton(
              onPressed: () => setState(() {
                awaitedSource = null;
                reply = null;
                replyUnavailable = false;
                replyRevision = null;
              }),
              child: Text(uiText(context, 'Termina turno vocale')),
            ),
          ],
          if (sent != null)
            Text(
              uiText(context, sent!),
              style: Theme.of(context).textTheme.labelLarge,
            ),
          for (final m in entries)
            ListTile(
              title: Text(
                m['mode'] == 'miriam'
                    ? uiText(context, 'Vocale a Emme')
                    : uiText(context, 'Vocale al gruppo'),
              ),
              subtitle: Text(
                m['transcript'] as String? ??
                    (m['errorCode'] != null
                        ? uiText(context, 'Trascrizione non disponibile')
                        : uiText(context, 'Trascrizione in attesa')),
              ),
              trailing: IconButton(
                tooltip: playing == m['sourceId']
                    ? uiText(context, 'Ferma ascolto')
                    : uiText(context, 'Ascolta vocale'),
                icon: Icon(
                  playing == m['sourceId'] ? Icons.stop : Icons.play_arrow,
                ),
                onPressed: recording || busy
                    ? null
                    : () => listen(m['sourceId'] as String),
              ),
            ),
        ],
      ),
    );
  }
}
