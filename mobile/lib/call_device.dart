import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as lk;
import 'package:record/record.dart';

abstract interface class HumanAudio {
  Future<void> connect(String url, String token, void Function() lost);
  void microphone(bool enabled);
  Future<void> speaker(bool enabled);
  Future<void> close();
}

Future<bool> humanMicrophonePermission() async {
  final r = AudioRecorder();
  try {
    return await r.hasPermission();
  } finally {
    await r.dispose();
  }
}

class DeviceHumanAudio implements HumanAudio {
  final room = lk.Room();
  late final listener = room.createListener();
  lk.LocalAudioTrack? track;
  bool closed = false;
  @override
  Future<void> connect(String url, String token, void Function() lost) async {
    void fence() {
      microphone(false);
      if (!closed) lost();
    }

    listener
      ..on<lk.RoomReconnectingEvent>((_) => fence())
      ..on<lk.RoomDisconnectedEvent>((_) => fence());
    await room.connect(url, token);
    if (closed) {
      await room.disconnect();
      return;
    }
    final local = await lk.LocalAudioTrack.create();
    local.mediaStreamTrack.enabled = false;
    if (closed) {
      await local.stop();
      await local.dispose();
      return;
    }
    track = local;
    final me = room.localParticipant;
    if (me == null) throw StateError('Il collegamento audio è scaduto.');
    await me.publishAudioTrack(local);
    // The second authorization takes place after negotiation and publication.
  }

  @override
  void microphone(bool enabled) {
    if (enabled &&
        (closed || room.connectionState != lk.ConnectionState.connected))
      throw StateError('Audio scollegato.');
    track?.mediaStreamTrack.enabled = enabled;
  }

  @override
  Future<void> speaker(bool enabled) =>
      lk.AudioManager.instance.setSpeakerOutputPreferred(enabled);

  @override
  Future<void> close() async {
    if (closed) return;
    closed = true;
    microphone(false);
    final local = track;
    track = null;
    try {
      await listener.dispose();
      await room.disconnect();
    } finally {
      try {
        await local?.stop();
        await local?.dispose();
      } finally {
        await room.dispose();
      }
    }
  }
}
