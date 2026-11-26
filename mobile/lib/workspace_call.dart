import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'call_device.dart';
import 'call_session.dart';
import 'chat_journal.dart';
import 'voice_device.dart';

class WorkspaceCallPage extends StatefulWidget {
  const WorkspaceCallPage({
    super.key,
    required this.api,
    required this.workspace,
    this.canWrite = true,
    this.vault = const DeviceDraftVault(),
    this.audio,
    this.permission,
  });
  final RimiamApi api;
  final String workspace;
  final bool canWrite;
  final DraftVault vault;
  final HumanAudio Function()? audio;
  final Future<bool> Function()? permission;
  @override
  State<WorkspaceCallPage> createState() => _CallPageState();
}

class _CallPageState extends State<WorkspaceCallPage>
    with WidgetsBindingObserver {
  late final session = HumanCallSession(
    widget.api,
    widget.workspace,
    widget.vault,
    permission: widget.permission ?? humanMicrophonePermission,
    makeAudio: widget.audio ?? DeviceHumanAudio.new,
  );
  final player = ManualAudioPlayer();
  Timer? poll;
  String? playing, playError;
  int generation = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    session.addListener(update);
    unawaited(session.initialize());
    poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (session.current) unawaited(session.refresh());
    });
  }

  void update() {
    if (!mounted) return;
    if (playing != null && (!session.known || session.wanted)) {
      playing = null;
      generation++;
      unawaited(player.stop());
    }
    setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        (state == AppLifecycleState.inactive && session.connected)) {
      session.background();
      ++generation;
      playing = null;
      unawaited(player.stop());
    } else if (state == AppLifecycleState.resumed) {
      session.resume();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    poll?.cancel();
    generation++;
    unawaited(player.stop());
    session.removeListener(update);
    session.dispose();
    super.dispose();
  }

  Future<bool> dialog(String title, String body, {String? accept}) async =>
      await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(uiText(ctx, title)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(uiText(ctx, body)),
                if (consentWordings.contains(body) && uiText(ctx, body) != body)
                  ExpansionTile(
                    title: Text(uiText(ctx, 'Testo originale del consenso')),
                    children: [SelectableText(body)],
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(
                accept == null ? uiText(ctx, 'Chiudi') : uiText(ctx, 'Annulla'),
              ),
            ),
            if (accept != null)
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(uiText(ctx, accept)),
              ),
          ],
        ),
      ) ??
      false;
  Future<void> join() async {
    if (session.view?['configured'] != true) {
      await dialog(
        uiText(context, 'Chiamata non disponibile'),
        uiText(
          context,
          'Il servizio per le chiamate audio non è configurato su questa installazione.',
        ),
      );
      return;
    }
    await session.join();
  }

  Future<void> consent(CallRow c) async {
    final wording = session.wording, epoch = c['epoch'];
    if (!consentWordings.contains(wording) ||
        !await dialog(
          uiText(context, 'Acconsentire alla registrazione?'),
          wording!,
          accept: uiText(context, 'Acconsento'),
        ))
      return;
    if (!mounted ||
        session.open?['id'] != c['id'] ||
        session.open?['epoch'] != epoch ||
        session.wording != wording ||
        !session.connected ||
        session.self?['consented'] == true)
      return;
    await session.command({
      'type': 'call.recording.consent',
      'callId': c['id'],
      'epoch': epoch,
      'consentText': wording,
    });
  }

  Future<void> analyze(CallRow c) async {
    if (!await dialog(
      uiText(context, 'Analizzare le trascrizioni?'),
      uiText(
        context,
        'Emme potrà usare i segmenti autorizzati per preparare un risultato nello spazio.',
      ),
      accept: uiText(context, 'Richiedi analisi'),
    ))
      return;
    if (mounted && session.known && widget.canWrite)
      await session.command({'type': 'call.analyze', 'callId': c['id']});
  }

  Future<void> listen(String id) async {
    final token = ++generation, previous = playing;
    playing = null;
    await player.stop();
    if (!mounted || !session.known || session.wanted || token != generation)
      return;
    if (previous == id) {
      update();
      return;
    }
    playing = id;
    playError = null;
    update();
    try {
      await player.playFile(
        'mp3',
        (file, valid) => widget.api.downloadCallAudio(
          widget.workspace,
          id,
          file,
          allowed: () =>
              valid() &&
              session.known &&
              !session.wanted &&
              token == generation,
        ),
      );
    } catch (e) {
      if (token == generation) playError = 'Impossibile riprodurre l’audio.';
    } finally {
      if (token == generation) {
        playing = null;
        update();
      }
    }
  }

  Widget record(CallRow call, CallRow r) {
    final segments = callRows(r, 'segments');
    final who = callRows(
      call,
      'participants',
    ).where((p) => p['id'] == r['participantId']).firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          title: Text(who?['name'] ?? uiText(context, 'Registrazione')),
          subtitle: Text(
            uiText(context, 'Consenso #{0}{1}', [
              r['consentEpoch'],
              r['consentEventVersion'] == null
                  ? ''
                  : ' · evento ${r['consentEventVersion']}',
            ]),
          ),
          trailing: r['state'] == 'complete'
              ? IconButton(
                  tooltip: playing == r['id']
                      ? uiText(context, 'Ferma ascolto')
                      : uiText(context, 'Ascolta registrazione'),
                  icon: Icon(
                    playing == r['id'] ? Icons.stop : Icons.play_arrow,
                  ),
                  onPressed: () => listen(r['id']),
                )
              : null,
        ),
        for (final s in segments)
          ListTile(
            title: Text(s['content'] ?? ''),
            subtitle: Text(
              uiText(context, 'Fonte · {0} s · {1}', [
                s['startSeconds'],
                s['qualification'],
              ]),
            ),
          ),
      ],
    );
  }

  Widget history(CallRow c) {
    final records = callRows(c, 'recordings');
    final events = callRows(c, 'events');
    return ExpansionTile(
      title: Text(
        c['state'] == 'ended'
            ? uiText(context, 'Chiamata conclusa')
            : uiText(context, 'Materiali della chiamata'),
      ),
      children: [
        if (records.isEmpty)
          ListTile(
            title: Text(uiText(context, 'Nessuna registrazione autorizzata')),
          ),
        for (final r in records) record(c, r),
        if (events.isNotEmpty)
          ExpansionTile(
            title: Text(uiText(context, 'Storia dei consensi')),
            children: [
              for (final e in events)
                ListTile(
                  title: Text(e['consentText'] ?? e['kind']),
                  subtitle: Text(
                    uiText(context, 'Evento {0} · {1}', [
                      e['version'],
                      e['createdAt'],
                    ]),
                  ),
                ),
            ],
          ),
        if (records.any(
          (r) => {
            'failed',
            'needs_configuration',
          }.contains(r['transcriptionStatus']),
        ))
          TextButton(
            onPressed: widget.canWrite && session.actionsAvailable
                ? () => session.command({
                    'type': 'call.transcription.retry',
                    'callId': c['id'],
                  })
                : null,
            child: Text(uiText(context, 'Riprova trascrizione')),
          ),
        if (c['state'] == 'ended' &&
            records.any((r) => callRows(r, 'segments').isNotEmpty))
          TextButton(
            onPressed: widget.canWrite && session.actionsAvailable
                ? () => analyze(c)
                : null,
            child: Text(
              c['analysisRequested'] == true
                  ? uiText(context, 'Prosegui l’analisi richiesta')
                  : uiText(context, 'Richiedi analisi a Emme'),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = session, c = s.open, v = s.view;
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Chiamata audio'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (s.error != null || playError != null)
            Text(uiText(context, s.error ?? playError!)),
          if (v == null && s.error == null) const LinearProgressIndicator(),
          if (v == null && s.error != null)
            TextButton(
              onPressed: () => s.ready ? s.refresh() : s.initialize(),
              child: Text(uiText(context, 'Riprova')),
            ),
          if (s.status.isNotEmpty) Text(uiText(context, s.status)),
          if (s.known) ...[
            if (!s.wanted)
              FilledButton.icon(
                onPressed: s.actionsAvailable && widget.canWrite ? join : null,
                icon: const Icon(Icons.call),
                label: Text(uiText(context, 'Entra in chiamata')),
              ),
            if (s.wanted || s.self != null)
              OutlinedButton.icon(
                onPressed: () => s.leave(orphan: c?['id']),
                icon: const Icon(Icons.call_end),
                label: Text(uiText(context, 'Lascia chiamata')),
              ),
            if (s.connected)
              TextButton.icon(
                onPressed: s.toggleSpeaker,
                icon: Icon(
                  s.loudspeaker == true ? Icons.volume_up : Icons.hearing,
                ),
                label: Text(
                  s.loudspeaker == true
                      ? uiText(context, 'Usa auricolare')
                      : uiText(context, 'Usa altoparlante'),
                ),
              ),
            if (s.connected)
              TextButton.icon(
                onPressed: s.toggleMute,
                icon: Icon(s.muted ? Icons.mic_off : Icons.mic),
                label: Text(
                  s.muted
                      ? uiText(context, 'Riattiva microfono')
                      : uiText(context, 'Silenzia microfono'),
                ),
              ),
            if (s.exits.pending != null)
              TextButton(
                onPressed: s.working ? null : () => s.recover(true),
                child: Text(uiText(context, 'Verifica uscita o ritiro')),
              ),
            if (s.actions.pending != null)
              TextButton(
                onPressed: s.working ? null : () => s.recover(false),
                child: Text(uiText(context, 'Verifica operazione')),
              ),
            if (c != null) ...[
              Text(uiText(context, callRecordingState(c))),
              for (final p in callRows(
                c,
                'participants',
              ).where((p) => p['state'] != 'left'))
                ListTile(
                  title: Text(p['name']),
                  subtitle: Text(
                    [
                      uiText(
                        context,
                        p['state'] == 'admitted'
                            ? 'In chiamata'
                            : 'In attesa o in uscita',
                      ),
                      if (p['consented'] == true)
                        uiText(context, 'Consenso espresso'),
                    ].join(' · '),
                  ),
                ),
              if (s.connected && c['recordingRequested'] != true)
                if (v?['recordingConfigured'] == true)
                  TextButton(
                    onPressed: s.actionsAvailable
                        ? () => s.command({
                            'type': 'call.recording.request',
                            'callId': c['id'],
                          })
                        : null,
                    child: Text(uiText(context, 'Chiedi di registrare')),
                  )
                else
                  Text(
                    uiText(
                      context,
                      'La registrazione non è configurata su questa installazione.',
                    ),
                  ),
              if (s.connected &&
                  c['recordingRequested'] == true &&
                  s.self?['consented'] != true)
                if (consentWordings.contains(s.wording))
                  TextButton(
                    onPressed: s.actionsAvailable ? () => consent(c) : null,
                    child: Text(uiText(context, 'Consenso alla registrazione')),
                  )
                else
                  Text(
                    uiText(
                      context,
                      'Aggiorna l’app per leggere le nuove condizioni di registrazione.',
                    ),
                  ),
              if (c['recordingRequested'] == true && s.self != null)
                TextButton(
                  onPressed: () => s.leave(withdraw: true, orphan: c['id']),
                  child: Text(
                    uiText(context, 'Ritira consenso e scollega audio'),
                  ),
                ),
            ],
            if (!s.wanted)
              for (final call in callRows(v, 'calls').where(
                (r) =>
                    r['state'] == 'ended' ||
                    callRows(r, 'recordings').isNotEmpty,
              ))
                history(call),
          ],
        ],
      ),
    );
  }
}
