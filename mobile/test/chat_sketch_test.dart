import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;
import 'package:material_ui/material_ui.dart';

import '../lib/chat_sketch.dart';
import '../lib/chat_journal.dart';
import '../lib/attachment_staging.dart';

class _Memory implements DraftVault {
  final values = <String, String>{};
  @override
  Future<String?> read(String k) async => values[k];
  @override
  Future<void> replace(String k, String? v) async {
    if (v == null) {
      values.remove(k);
    } else {
      values[k] = v;
    }
  }
}

void main() {
  testWidgets(
    'disegno e annulla, rotazione, allegato PNG cifrato nella bozza riapribile',
    (t) async {
      final dir = Directory.systemTemp.createTempSync('rimiam-sketch-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final staging = AttachmentStaging(
        scope: 'synthetic-test',
        root: () async => dir,
      );
      final vault = _Memory();
      ChatJournal journal() => ChatJournal(
        vault: vault,
        origin: Uri.parse('https://example.test'),
        actor: 'a',
        workspace: 'w',
        staging: staging,
      );
      final j = (await t.runAsync(() async {
        final ready = journal();
        await ready.open();
        ready.edit('Annotazione');
        await Future<void>.delayed(Duration.zero);
        return ready;
      }))!;
      await t.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (c) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.push(
                  c,
                  MaterialPageRoute(
                    builder: (_) =>
                        ChatSketchPage(journal: j, allowed: () => true),
                  ),
                ),
                child: const Text('Apri'),
              ),
            ),
          ),
        ),
      );
      await t.tap(find.text('Apri'));
      await t.pumpAndSettle();
      final attach = find.widgetWithText(FilledButton, 'Aggiungi alla bozza');
      final sheet = find.bySemanticsLabel('Tela di disegno');
      expect(t.widget<FilledButton>(attach).onPressed, isNull);
      await t.tap(sheet);
      await t.pump();
      await t.tap(find.byTooltip('Annulla tratto'));
      await t.pump();
      expect(t.widget<FilledButton>(attach).onPressed, isNull);
      await t.tap(find.byTooltip('Penna Blu'));
      await t.pump();
      await t.dragFrom(
        t.getCenter(sheet) - const Offset(60, 0),
        const Offset(120, 0),
      );
      await t.pump();
      t.view.physicalSize = const Size(400, 800);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      await t.pump();
      await t.runAsync(() async {
        final button = t.widget<FilledButton>(attach);
        await (button.onPressed! as Future<void> Function())().timeout(
          const Duration(seconds: 8),
        );
      });
      await t.pumpAndSettle();
      expect(
        j.files.length,
        1,
        reason: t
            .widgetList<Text>(find.byType(Text))
            .map((text) => text.data)
            .join(' / '),
      );
      expect(find.text('Apri'), findsOneWidget);
      expect(j.files.single.filename, 'Schizzo.png');
      expect(j.text, 'Annotazione');
      expect(j.pending, isNull);
      await t.runAsync(() async {
        final restored = journal();
        await restored.open();
        expect(restored.files.single.digest, j.files.single.digest);
        final payloads = await staging.payloads(restored.files);
        final bytes = base64Decode(payloads.single['bytesBase64']);
        final png = image.decodePng(bytes)!;
        expect([png.width, png.height], [640, 440]);
        final middle = png.getPixel(320, 220);
        expect(middle.b, greaterThan(middle.r));
        expect(png.getPixel(0, 0).r, 255);
      });
    },
  );
  testWidgets('chiusura ed accesso revocato non aggiungono allegati', (
    t,
  ) async {
    final j = ChatJournal(
      vault: _Memory(),
      origin: Uri.parse('https://example.test'),
      actor: 'a',
      workspace: 'w',
    );
    await j.open();
    await t.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (c) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.push(
                c,
                MaterialPageRoute(
                  builder: (_) =>
                      ChatSketchPage(journal: j, allowed: () => false),
                ),
              ),
              child: const Text('Apri'),
            ),
          ),
        ),
      ),
    );
    await t.tap(find.text('Apri'));
    await t.pumpAndSettle();
    await t.tap(find.bySemanticsLabel('Tela di disegno'));
    await t.pump();
    await t.tap(find.text('Aggiungi alla bozza'));
    await t.pump();
    expect(
      find.text('La bozza non è disponibile. Torna alla chat.'),
      findsOneWidget,
    );
    await t.tap(find.byTooltip('Chiudi disegno'));
    await t.pumpAndSettle();
    expect(j.files, isEmpty);
    expect(j.pending, isNull);
  });
}
