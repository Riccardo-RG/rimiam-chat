import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'audio_issue.dart';
import 'call_device.dart';
import 'chat_journal.dart';
import 'workspace_command_journal.dart';

typedef CallRow = Map<String, dynamic>;
List<CallRow> callRows(Map? value, String key) =>
    (value?[key] as List? ?? []).whereType<CallRow>().toList();
const _disclosure =
    'Acconsento personalmente alla registrazione del mio audio, alla trascrizione e alla conservazione come Fonte condivisa del Workspace. Audio, trascrizione e relativa storia saranno visibili ai membri idonei secondo ADR-0009, inclusi i membri ammessi successivamente. Il ritiro interrompe le acquisizioni future, non elimina il materiale già autorizzato.';
const consentWordings = {
  '$_disclosure L\'analisi di Emme richiede una richiesta separata.',
  '$_disclosure L\'analisi di RIMIAM richiede una richiesta separata.',
};
String callRecordingState(CallRow call) {
  if (call['errorCode'] != null)
    return 'Stato della registrazione da verificare';
  if (callRows(call, 'recordings').any(
    (r) =>
        r['captureFenced'] != true &&
        {'active', 'starting', 'stopping', 'unknown'}.contains(r['state']),
  ))
    return 'Registrazione attiva o arresto da confermare';
  return call['recordingRequested'] == true
      ? 'Registrazione richiesta · in attesa dei consensi o dell’avvio'
      : 'Audio non registrato';
}

class HumanCallSession extends ChangeNotifier {
  HumanCallSession(
    this.api,
    this.space,
    DraftVault vault, {
    required this.permission,
    required this.makeAudio,
  }) : actions = WorkspaceCommandJournal(
         api,
         vault,
         namespace: 'call',
         collection: space,
       ),
       exits = WorkspaceCommandJournal(
         api,
         vault,
         namespace: 'call-exit',
         collection: space,
       );
  final RimiamApi api;
  final String space;
  final WorkspaceCommandJournal actions, exits;
  final Future<bool> Function() permission;
  final HumanAudio Function() makeAudio;
  String get base => '/api/v1/workspaces/${Uri.encodeComponent(space)}';
  CallRow? view;
  String? callId, participantId, error;
  String status = '';
  bool foreground = true,
      wanted = false,
      connected = false,
      muted = false,
      ready = false,
      closed = false,
      working = false;
  bool _reading = false, _refreshAgain = false, _starting = false;
  int _generation = 0;
  HumanAudio? _room;
  bool? loudspeaker;
  DateTime? _lease;
  Timer? _leaseFence;
  bool get current => !closed && foreground && api.actorId == actions.actor;
  bool get known => current && view != null && ready;
  bool get actionsAvailable =>
      known &&
      !working &&
      !actions.busy &&
      !exits.busy &&
      exits.pending == null &&
      actions.pending == null;
  CallRow? get open =>
      callRows(view, 'calls').where((c) => c['state'] == 'open').firstOrNull;
  CallRow? get self => callRows(open, 'participants').reversed
      .where(
        (p) =>
            p['userId'] == actions.actor &&
            !{'left', 'leaving'}.contains(p['state']),
      )
      .firstOrNull;
  String? get wording =>
      view?['currentConsentText'] as String? ?? view?['consentText'] as String?;
  void changed() {
    if (!closed) notifyListeners();
  }

  Future<void> initialize() async {
    try {
      await Future.wait([actions.load(), exits.load()]);
      ready = true;
      await refresh();
    } catch (e) {
      error = audioIssue(e);
      changed();
    }
  }

  Future<void> refresh() async {
    if (!current) return;
    if (_reading) {
      _refreshAgain = true;
      return;
    }
    _reading = true;
    final token = _generation;
    try {
      final next = await api.get('$base/calls');
      if (!current || token != _generation) return;
      view = next;
      changed();
      if (!wanted || callId == null) return;
      if (open?['id'] != callId || self?['id'] != participantId) {
        await leave();
        return;
      }
      if (self?['state'] != 'admitted') {
        if (_room != null) {
          await leave();
          return;
        }
        status = 'In attesa di ammissione';
        changed();
        return;
      }
      if (_room == null && !_starting) {
        await _startMedia(token);
      } else if (connected &&
          _lease != null &&
          DateTime.now().difference(_lease!) >= const Duration(seconds: 12)) {
        await _grant(token);
        if (_valid(token)) _renewLease();
      }
    } catch (e) {
      if (current && token == _generation) {
        view = null;
        error = audioIssue(e);
        if (wanted) await leave();
      }
    } finally {
      _reading = false;
      changed();
      if (_refreshAgain) {
        _refreshAgain = false;
        unawaited(refresh());
      }
    }
  }

  bool _valid(int token) => current && wanted && token == _generation;
  Future<CallRow> _grant(int token) async {
    final c = callId, p = participantId;
    final r = await api.post('$base/call-connect', {'callId': c});
    final url = Uri.tryParse(r['url'] is String ? r['url'] : '');
    if (!_valid(token) ||
        url == null ||
        url.scheme != 'wss' ||
        url.host.isEmpty ||
        url.userInfo.isNotEmpty ||
        url.hasFragment ||
        url.hasQuery ||
        r['callId'] != c ||
        r['participantId'] != p ||
        r['token'] is! String ||
        (r['token'] as String).isEmpty)
      throw StateError('Autorizzazione audio scaduta. Rientra nella chiamata.');
    return r;
  }

  void _renewLease() {
    _lease = DateTime.now();
    _leaseFence?.cancel();
    // Even a hung server read cannot keep an old microphone lease alive.
    _leaseFence = Timer(const Duration(seconds: 25), () {
      error = 'Autorizzazione audio scaduta.';
      unawaited(leave());
    });
  }

  Future<void> _startMedia(int token) async {
    _starting = true;
    try {
      final grant = await _grant(token);
      if (!_valid(token)) return;
      final room = _room = makeAudio();
      await room.connect(grant['url'], grant['token'], () {
        if (!_valid(token)) return;
        error = 'Collegamento interrotto. Puoi rientrare nella chiamata.';
        unawaited(leave());
      });
      if (!_valid(token)) {
        await room.close();
        return;
      }
      await _grant(token);
      if (!_valid(token)) return;
      room.microphone(!muted);
      connected = true;
      _renewLease();
      status = 'Chiamata connessa';
      changed();
    } finally {
      _starting = false;
    }
  }

  Future<void> join() async {
    if (!actionsAvailable || wanted || view?['configured'] != true) return;
    final token = ++_generation;
    wanted = true;
    working = true;
    error = null;
    status = 'Controllo il microfono…';
    changed();
    try {
      if (!await permission())
        throw StateError(
          'Consenti l’accesso al microfono nelle impostazioni del dispositivo.',
        );
      if (!_valid(token)) return;
      final r = await actions.send(space, {
        'type': 'call.join',
      }, allowed: () => _valid(token));
      if (r['callId'] is! String || r['participantId'] is! String)
        throw const FormatException('Ricevuta di ingresso incompleta.');
      if (!_valid(token)) {
        await _sendExit('call.leave', r['callId']);
        return;
      }
      callId = r['callId'];
      participantId = r['participantId'];
      status = 'In attesa di ammissione';
      await refresh();
    } catch (e) {
      if (token == _generation) {
        error = audioIssue(e);
        await leave();
      }
    } finally {
      working = false;
      changed();
    }
  }

  Future<void> command(CallRow input) async {
    if (!actionsAvailable) return;
    working = true;
    error = null;
    changed();
    try {
      await actions.send(space, input, allowed: () => known);
    } catch (e) {
      error = audioIssue(e);
    } finally {
      working = false;
      await refresh();
      changed();
    }
  }

  Future<void> recover(bool exit) async {
    final lane = exit ? exits : actions, req = lane.pending;
    if (req == null || !known || working) return;
    final c = req['command'] as CallRow;
    working = true;
    error = null;
    changed();
    try {
      if (exit) {
        await lane.send(space, c, allowed: () => current);
      } else {
        // Recovery only reads the receipt. An old join, recording consent, or
        // analysis request must never be re-executed without fresh intent.
        final id = req['id'];
        Map<String, dynamic>? receipt;
        try {
          receipt = await api.get('$base/receipts/$id');
        } on ApiError catch (e) {
          if (e.status != 404 || e.code != 'RECEIPT_NOT_FOUND') rethrow;
        }
        if (receipt != null &&
            (receipt['commandId'] != id || receipt['status'] != 'committed'))
          throw const FormatException('Ricevuta non riconosciuta.');
        if (receipt != null &&
            c['type'] == 'call.join' &&
            receipt['result']?['callId'] is String) {
          await _sendExit('call.leave', receipt['result']['callId']);
        }
        await lane.stopVerification();
        status = receipt == null
            ? 'Operazione non confermata. Puoi richiederla di nuovo.'
            : 'Operazione verificata';
      }
    } catch (e) {
      error = audioIssue(e);
    } finally {
      working = false;
      await refresh();
      changed();
    }
  }

  Future<void> toggleSpeaker() async {
    final room = _room;
    if (!connected || room == null) return;
    final next = loudspeaker != true;
    try {
      await room.speaker(next);
      if (identical(room, _room)) loudspeaker = next;
    } catch (_) {
      error = 'Non è stato possibile cambiare l’uscita audio.';
    }
    changed();
  }

  void toggleMute() {
    if (!current || !connected) return;
    try {
      _room?.microphone(muted);
      muted = !muted;
      changed();
    } catch (e) {
      error = audioIssue(e);
      unawaited(leave());
    }
  }

  Future<void> _sendExit(String type, String id) async {
    try {
      await exits.send(space, {
        'type': type,
        'callId': id,
      }, allowed: () => api.actorId == actions.actor);
    } catch (e) {
      error = 'Audio scollegato. Verifica l’uscita.';
      changed();
    }
  }

  Future<void> leave({bool withdraw = false, String? orphan}) async {
    final id = callId ?? orphan, room = _room;
    ++_generation;
    wanted = false;
    connected = false;
    muted = false;
    loudspeaker = null;
    callId = null;
    participantId = null;
    _lease = null;
    _leaseFence?.cancel();
    _room = null;
    room?.microphone(false);
    status = withdraw
        ? 'Microfono scollegato. Verifica il ritiro nella storia dei consensi.'
        : 'Audio scollegato';
    changed();
    try {
      await Future.wait([
        if (room != null) room.close(),
        if (id != null)
          _sendExit(withdraw ? 'call.recording.withdraw' : 'call.leave', id),
      ]);
    } catch (e) {
      error = audioIssue(e);
    } finally {
      if (current && id != null) unawaited(refresh());
    }
  }

  void background() {
    foreground = false;
    view = null;
    if (wanted || _room != null)
      unawaited(leave());
    else {
      ++_generation;
    }
    changed();
  }

  void resume() {
    foreground = true;
    unawaited(refresh());
  }

  @override
  void dispose() {
    closed = true;
    foreground = false;
    unawaited(leave());
    super.dispose();
  }
}
