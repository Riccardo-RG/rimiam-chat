import 'dart:convert';
import 'dart:io';

import 'package:image/image.dart' as img;

/// Generate each platform's launcher images from the same square RIMIAM mark.
Future<void> writeHostIcons(Directory host, File logo) async {
  final image = img.decodePng(await logo.readAsBytes());
  if (image == null || image.width != 1024 || image.height != 1024) {
    throw FormatException(
      'Il logo dell’app deve essere un PNG quadrato da 1024 px.',
    );
  }
  final cache = <int, List<int>>{};
  Future<void> write(File output, int size) async {
    final bytes = cache.putIfAbsent(
      size,
      () => img.encodePng(
        img.copyResize(
          image,
          width: size,
          height: size,
          interpolation: img.Interpolation.average,
        ),
      ),
    );
    await output.writeAsBytes(bytes);
  }

  final apple = Directory(
    '${host.path}/ios/Runner/Assets.xcassets/AppIcon.appiconset',
  );
  final spec = jsonDecode(
    await File('${apple.path}/Contents.json').readAsString(),
  );
  for (final entry in spec['images']) {
    final width = double.parse((entry['size'] as String).split('x').first);
    final scale = double.parse((entry['scale'] as String).split('x').first);
    await write(
      File('${apple.path}/${entry['filename']}'),
      (width * scale).round(),
    );
  }
  for (final entry in {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
  }.entries) {
    await write(
      File(
        '${host.path}/android/app/src/main/res/mipmap-${entry.key}/ic_launcher.png',
      ),
      entry.value,
    );
  }
}
