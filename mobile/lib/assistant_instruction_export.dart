import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:share_plus/share_plus.dart';

/// The recipient and destination are chosen in the system sheet. The only
/// local plaintext copy is in the application cache while that sheet is open.
Future<void> sharePrivateBytes(
  Uint8List bytes, {
  required String name,
  required String mimeType,
  required Rect anchor,
  Future<void> Function(File file, String type, Rect bounds)? present,
}) async {
  final dir = await Directory.systemTemp.createTemp('rimiam-export-');
  try {
    final clean = name
        .replaceAll(RegExp(r"[^\p{L}\p{N} ._-]", unicode: true), '_')
        .replaceFirst(RegExp(r'^\.+'), '')
        .trim();
    final file = File(
      '${dir.path}/${clean.isEmpty ? 'Documento' : String.fromCharCodes(clean.runes.take(100))}',
    );
    await file.writeAsBytes(bytes, flush: true);
    if (present != null) {
      await present(file, mimeType, anchor);
    } else {
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path, mimeType: mimeType)],
          sharePositionOrigin: anchor,
        ),
      );
    }
  } finally {
    await dir.delete(recursive: true);
  }
}

Future<void> shareSavedInstructions(String instructions, Rect anchor) =>
    sharePrivateBytes(
      utf8.encode(instructions),
      name: 'assistant-instructions.md',
      mimeType: 'text/markdown',
      anchor: anchor,
    );
