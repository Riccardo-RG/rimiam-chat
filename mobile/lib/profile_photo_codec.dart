import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;

const _maxPixels = 4096 * 4096;
Uint8List _encode(img.Image source) {
  final scale = 512 / math.max(source.width, source.height);
  final small = scale < 1
      ? img.copyResize(
          source,
          width: math.max(1, (source.width * scale).round()),
          height: math.max(1, (source.height * scale).round()),
          interpolation: img.Interpolation.average,
        )
      : source;
  // A new RGB canvas flattens transparent pixels and omits EXIF/GPS metadata.
  final out = img.Image(
    width: small.width,
    height: small.height,
    numChannels: 3,
  );
  img.fill(out, color: img.ColorRgb8(255, 255, 255));
  img.compositeImage(out, small);
  final result = img.encodeJpg(out, quality: 83);
  if (result.length > 360000)
    throw const FormatException('La foto supera il limite.');
  return result;
}

Uint8List? _standardPhoto(Uint8List bytes) {
  final decoder = img.findDecoderForData(bytes);
  if (decoder == null) return null;
  final info = decoder.startDecode(bytes);
  if (info == null ||
      info.width * info.height > _maxPixels ||
      info.numFrames != 1)
    throw const FormatException(
      'Scegli una foto statica di dimensioni inferiori.',
    );
  final first = decoder.decodeFrame(0);
  if (first == null) throw const FormatException('Foto non leggibile.');
  return _encode(img.bakeOrientation(first));
}

Future<Uint8List> profilePhotoJpeg(Uint8List bytes) async {
  if (bytes.isEmpty || bytes.length > 8 * 1024 * 1024)
    throw const FormatException('La foto è troppo grande.');
  final direct = await compute(_standardPhoto, bytes);
  if (direct != null) return direct;
  // Ask the platform codec about formats specific to the device, such as HEIC.
  final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
  try {
    final descriptor = await ui.ImageDescriptor.encoded(buffer);
    try {
      if (descriptor.width * descriptor.height > _maxPixels)
        throw const FormatException('La foto è troppo grande.');
      final scale = math.min(
        1.0,
        512 / math.max(descriptor.width, descriptor.height),
      );
      final codec = await descriptor.instantiateCodec(
        targetWidth: math.max(1, (descriptor.width * scale).round()),
        targetHeight: math.max(1, (descriptor.height * scale).round()),
      );
      try {
        if (codec.frameCount != 1)
          throw const FormatException('Scegli una foto statica.');
        final frame = await codec.getNextFrame();
        try {
          final raw = await frame.image.toByteData(
            format: ui.ImageByteFormat.rawStraightRgba,
          );
          if (raw == null) throw const FormatException('Foto non leggibile.');
          return _encode(
            img.Image.fromBytes(
              width: frame.image.width,
              height: frame.image.height,
              bytes: raw.buffer,
              bytesOffset: raw.offsetInBytes,
              numChannels: 4,
              order: img.ChannelOrder.rgba,
            ),
          );
        } finally {
          frame.image.dispose();
        }
      } finally {
        codec.dispose();
      }
    } finally {
      descriptor.dispose();
    }
  } finally {
    buffer.dispose();
  }
}
