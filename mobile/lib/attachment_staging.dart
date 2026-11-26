import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';
import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter/services.dart';

const attachmentByteLimit = 8 * 1024 * 1024;
const attachmentCountLimit = 10;

class AttachmentProblem implements Exception {
  const AttachmentProblem(this.message);
  final String message;
  @override
  String toString() => message;
}

class StagedAttachment {
  const StagedAttachment._(
    this.id,
    this.filename,
    this.size,
    this._key,
    this.digest,
  );
  final String id, filename, _key;
  final int size;
  final String digest;
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': filename,
    'size': size,
    'key': _key,
    'hash': digest,
  };
  factory StagedAttachment.fromJson(Map<String, dynamic> data) {
    final f = StagedAttachment._(
      data['id'] as String,
      data['name'] as String,
      data['size'] as int,
      data['key'] as String,
      data['hash'] as String,
    );
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(f.id) ||
        !AttachmentStaging.validName(f.filename) ||
        f.size <= 0 ||
        f.size > attachmentByteLimit ||
        !RegExp(r'^[0-9a-f]{64}$').hasMatch(f.digest) ||
        base64Decode(f._key).length != 32) {
      throw const FormatException('Riferimento allegato non valido.');
    }
    return f;
  }
}

class AttachmentStaging {
  AttachmentStaging({required String scope, Future<Directory> Function()? root})
    : namespace = sha256.convert(utf8.encode(scope)).toString(),
      _root = root ?? _deviceRoot;
  final String namespace;
  final Future<Directory> Function() _root;
  static final _algorithm = AesGcm.with256bits();
  static const _platform = MethodChannel('rimiam/attachment_staging');
  static final _random = Random.secure();
  static Future<Directory> _deviceRoot() async {
    final path = await _platform.invokeMethod<String>('protectedDirectory');
    if (path == null || !path.startsWith('/'))
      throw const AttachmentProblem('Archivio protetto non disponibile.');
    return Directory(path);
  }

  // The mobile pickers sometimes materialize private temporary copies. Never
  // touch the user's source, a symlink, or a path outside the app's own cache.
  static Future<void> releasePickerCopies(List<XFile> picked) async {
    try {
      final path = await _platform.invokeMethod<String>('temporaryDirectory');
      if (path == null) return;
      final cache = await Directory(path).resolveSymbolicLinks();
      for (final pick in picked) {
        try {
          final candidate = File(pick.path);
          if (await FileSystemEntity.type(candidate.path, followLinks: false) !=
              FileSystemEntityType.file)
            continue;
          final absolute = await candidate.resolveSymbolicLinks();
          if (absolute.startsWith('$cache/')) await candidate.delete();
        } on FileSystemException {
          /* The picker may have already removed its copy. */
        }
      }
    } on PlatformException {
      /* The OS may reclaim its own picker cache. */
    }
  }

  static bool validName(String s) =>
      s.isNotEmpty &&
      s.length <= 180 &&
      !RegExp(r'[\\/\x00-\x1F\x7F]').hasMatch(s);
  static final _types = RegExp(
    r'\.(txt|md|csv|docx|pdf|jpe?g|png|webp|m4a|mp3|ogg|wav|webm)$',
    caseSensitive: false,
  );
  static final _text = RegExp(r'\.(txt|md|csv)$', caseSensitive: false);

  Future<File> _blob(String id) async {
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(id))
      throw const FormatException('Riferimento allegato non valido.');
    final dir = Directory('${(await _root()).path}/$namespace');
    await dir.create(recursive: true);
    return File('${dir.path}/$id');
  }

  List<int> _aad(StagedAttachment f) =>
      utf8.encode(jsonEncode([namespace, f.id, f.filename, f.size, f.digest]));
  static String? _image(List<int> b) {
    bool starts(List<int> bytes, {int at = 0}) =>
        b.length >= bytes.length + at &&
        Iterable<int>.generate(bytes.length)
            .every((i) => b[at + i] == bytes[i]);
    if (starts([255, 216, 255])) return 'jpg';
    if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'png';
    if (starts(ascii.encode('RIFF')) && starts(ascii.encode('WEBP'), at: 8))
      return 'webp';
    return null;
  }

  static void _checkBytes(String name, Uint8List bytes) {
    final ext = name.toLowerCase().split('.').last;
    if (_text.hasMatch(name)) {
      if (bytes.length > 1048576)
        throw const AttachmentProblem(
          'Un file di testo può pesare fino a 1 MiB.',
        );
      try {
        final text = utf8.decode(bytes);
        if (text.contains('\u0000') ||
            text.trim().isEmpty ||
            text.length > 200000)
          throw const FormatException();
      } on FormatException {
        throw const AttachmentProblem(
          'Scegli un file di testo UTF-8 con al massimo 200.000 caratteri.',
        );
      }
      return;
    }
    bool starts(List<int> bytesToMatch, {int at = 0}) =>
        bytes.length >= at + bytesToMatch.length &&
        Iterable<int>.generate(bytesToMatch.length)
            .every((i) => bytes[at + i] == bytesToMatch[i]);
    final ok = switch (ext) {
      'png' ||
      'jpg' ||
      'jpeg' ||
      'webp' => _image(bytes) == (ext == 'jpeg' ? 'jpg' : ext),
      'pdf' => starts(ascii.encode('%PDF-')),
      'docx' => starts([0x50, 0x4b, 3, 4]),
      'm4a' => starts(ascii.encode('ftyp'), at: 4),
      'wav' =>
        starts(ascii.encode('RIFF')) && starts(ascii.encode('WAVE'), at: 8),
      'mp3' =>
        starts(ascii.encode('ID3')) ||
            (bytes.length >= 2 && bytes[0] == 255 && (bytes[1] & 0xe0) == 0xe0),
      'ogg' => starts(ascii.encode('OggS')),
      'webm' => starts([0x1a, 0x45, 0xdf, 0xa3]),
      _ => false,
    };
    if (!ok)
      throw const AttachmentProblem(
        'Il contenuto del file non corrisponde al suo formato.',
      );
  }

  Future<List<StagedAttachment>> stage(
    List<XFile> selected, {
    required List<StagedAttachment> existing,
    bool photo = false,
  }) async {
    if (existing.length + selected.length > attachmentCountLimit)
      throw const AttachmentProblem('Puoi allegare fino a 10 file.');
    var total = existing.fold(0, (sum, f) => sum + f.size);
    final added = <StagedAttachment>[];
    try {
      for (final source in selected) {
        final n = await source.length();
        if (n <= 0 || total + n > attachmentByteLimit)
          throw const AttachmentProblem(
            'Scegli file non vuoti, fino a 8 MiB complessivi.',
          );
        final bytes = await source.readAsBytes();
        if (bytes.length != n)
          throw const AttachmentProblem(
            'Il file è cambiato. Selezionalo di nuovo.',
          );
        var name = source.name;
        if (photo) {
          final ext = _image(bytes);
          if (ext == null)
            throw const AttachmentProblem('Scegli una foto JPEG, PNG o WebP.');
          final base = name.replaceFirst(RegExp(r'\.[^.]*$'), '');
          final current = name.toLowerCase().split('.').last;
          if (current != ext && !(ext == 'jpg' && current == 'jpeg'))
            name = '${base.isEmpty ? 'Foto' : base}.$ext';
        }
        if (!validName(name) || !_types.hasMatch(name))
          throw const AttachmentProblem(
            'Formato non supportato. Scegli una foto, un PDF, un DOCX, un file di testo o audio.',
          );
        _checkBytes(name, bytes);
        final id = List.generate(
          16,
          (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
        ).join();
        final key = await _algorithm.newSecretKey();
        final item = StagedAttachment._(
          id,
          name,
          n,
          base64Encode(await key.extractBytes()),
          sha256.convert(bytes).toString(),
        );
        final file = await _blob(id);
        final sealed = await _algorithm.encrypt(
          bytes,
          secretKey: key,
          aad: _aad(item),
        );
        added.add(item);
        // No metadata is committed to the draft until this immutable blob is flushed.
        await file.writeAsBytes(sealed.concatenation(), flush: true);
        total += n;
      }
      return added;
    } catch (_) {
      await discard(added);
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> payloads(
    List<StagedAttachment> files,
  ) async {
    if (files.length > attachmentCountLimit ||
        files.fold(0, (n, f) => n + f.size) > attachmentByteLimit)
      throw const AttachmentProblem(
        'Gli allegati superano il limite di invio.',
      );
    final wire = <Map<String, dynamic>>[];
    for (final f in files) {
      final file = await _blob(f.id);
      try {
        if (await file.length() != f.size + 12 + 16)
          throw const FormatException();
        final box = SecretBox.fromConcatenation(
          await file.readAsBytes(),
          nonceLength: 12,
          macLength: 16,
        );
        final bytes = await _algorithm.decrypt(
          box,
          secretKey: SecretKey(base64Decode(f._key)),
          aad: _aad(f),
        );
        wire.add({'filename': f.filename, 'bytesBase64': base64Encode(bytes)});
      } on Object {
        throw AttachmentProblem(
          'L’allegato «${f.filename}» non è più leggibile sul dispositivo.',
        );
      }
    }
    return wire;
  }

  Future<void> discard(List<StagedAttachment> files) async {
    for (final f in files) {
      final blob = await _blob(f.id);
      if (await blob.exists()) await blob.delete();
    }
  }
}
