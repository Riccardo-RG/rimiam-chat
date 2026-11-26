import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';

// This folder contains only temporary copies produced by the app's audio
// components, never the encrypted draft or a file chosen by the user.
final _audioCache = _prepareAudioCache();
Future<Directory> _prepareAudioCache() async {
  final dir = Directory('${Directory.systemTemp.path}/rimiam-audio-cache-v1');
  if (await dir.exists()) await dir.delete(recursive: true);
  return dir.create();
}

abstract interface class VoiceCapture {
  Future<bool> permission();
  Future<void> start();
  Future<XFile?> stop();
  Future<void> clear();
  Future<void> dispose();
}

class DeviceVoiceCapture implements VoiceCapture {
  AudioRecorder? _instance;
  AudioRecorder get _recorder => _instance ??= AudioRecorder();
  Directory? _directory;
  @override
  Future<bool> permission() => _recorder.hasPermission();
  @override
  Future<void> start() async {
    await clear();
    final dir = _directory = await (await _audioCache).createTemp('rec-');
    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        numChannels: 1,
        bitRate: 64000,
        sampleRate: 44100,
      ),
      path: '${dir.path}/Vocale.m4a',
    );
  }

  @override
  Future<XFile?> stop() async {
    final path = await _recorder.stop();
    return path == null ? null : XFile(path);
  }

  @override
  Future<void> clear() async {
    if ((await _instance?.isRecording()) == true) await _instance?.cancel();
    final dir = _directory;
    _directory = null;
    if (dir != null && await dir.exists()) await dir.delete(recursive: true);
  }

  @override
  Future<void> dispose() async {
    try {
      await clear();
    } finally {
      await _instance?.dispose();
    }
  }
}

/// Playback is always user-initiated. Give the native decoder a private
/// temporary file; credentials and access tokens never reach the player.
class ManualAudioPlayer {
  AudioPlayer? _player;
  Directory? _directory;
  int _generation = 0;
  Future<void> play(Uint8List bytes) {
    final ogg = bytes.length >= 4 && bytes[0] == 79 && bytes[1] == 103;
    final wav = bytes.length >= 4 && bytes[0] == 82 && bytes[1] == 73;
    final webm = bytes.length >= 4 && bytes[0] == 26 && bytes[1] == 69;
    final mp4 =
        bytes.length >= 8 &&
        String.fromCharCodes(bytes.sublist(4, 8)) == 'ftyp';
    final extension = ogg
        ? 'ogg'
        : wav
        ? 'wav'
        : webm
        ? 'webm'
        : mp4
        ? 'm4a'
        : 'mp3';
    return playFile(extension, (file, valid) async {
      if (valid()) await file.writeAsBytes(bytes, flush: true);
    });
  }

  Future<void> playFile(
    String extension,
    Future<void> Function(File file, bool Function() valid) download,
  ) async {
    final generation = _generation + 1;
    bool valid() => generation == _generation;
    await stop();
    if (!valid()) return;
    final dir = await (await _audioCache).createTemp('listen-');
    if (!valid()) {
      await dir.delete();
      return;
    }
    _directory = dir;
    final file = File('${dir.path}/audio.$extension');
    try {
      await download(file, valid);
      if (!valid()) return;
      final p = _player = AudioPlayer();
      await p.setFilePath(file.path);
      if (valid()) await p.play();
    } finally {
      if (valid()) await stop();
    }
  }

  Future<void> stop() async {
    ++_generation;
    final p = _player, dir = _directory;
    _player = null;
    _directory = null;
    try {
      await p?.dispose();
    } finally {
      if (dir != null && await dir.exists()) await dir.delete(recursive: true);
    }
  }
}
