import 'ui_language.dart';

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:file_selector/file_selector.dart' show XFile;
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'attachment_staging.dart';
import 'chat_journal.dart';

// Coordinates, ink and export size share the Web canvas convention.
const _page = Size(640, 440);
const _pens = {
  'Grafite': Color(0xff252823),
  'Blu': Color(0xff245987),
  'Rosso': Color(0xffa43248),
};

class _Stroke {
  _Stroke(this.ink, this.start)
    : path = ui.Path()..moveTo(start.dx, start.dy),
      end = start;
  final Color ink;
  final Offset start;
  Offset end;
  final ui.Path path;
  bool dot = true;
  void extend(Offset point) {
    if (point == end) return;
    end = point;
    dot = false;
    path.lineTo(point.dx, point.dy);
  }
}

void _paintPage(Canvas canvas, Size size, List<_Stroke> strokes) {
  canvas.save();
  canvas.scale(size.width / _page.width, size.height / _page.height);
  canvas.clipRect(Offset.zero & _page);
  canvas.drawRect(Offset.zero & _page, Paint()..color = Colors.white);
  final pen = Paint()
    ..strokeWidth = 4
    ..strokeJoin = StrokeJoin.round
    ..strokeCap = StrokeCap.round;
  for (final stroke in strokes) {
    pen.color = stroke.ink;
    if (stroke.dot) {
      pen.style = PaintingStyle.fill;
      canvas.drawCircle(stroke.start, 2, pen);
    } else {
      pen.style = PaintingStyle.stroke;
      canvas.drawPath(stroke.path, pen);
    }
  }
  canvas.restore();
}

class _PagePainter extends CustomPainter {
  _PagePainter(this.strokes, this.revision);
  final List<_Stroke> strokes;
  final int revision;
  @override
  void paint(Canvas canvas, Size size) => _paintPage(canvas, size, strokes);
  @override
  bool shouldRepaint(_PagePainter old) => revision != old.revision;
}

class ChatSketchPage extends StatefulWidget {
  const ChatSketchPage({
    super.key,
    required this.journal,
    required this.allowed,
  });
  final ChatJournal journal;
  final bool Function() allowed;
  @override
  State<ChatSketchPage> createState() => _SketchState();
}

class _SketchState extends State<ChatSketchPage> {
  final strokes = <_Stroke>[];
  Color ink = _pens['Grafite']!;
  int revision = 0;
  int? pointer;
  bool saving = false;
  String? issue;
  Offset point(Offset position, Size size) => Offset(
    (position.dx / size.width * _page.width)
        .clamp(0.0, _page.width)
        .roundToDouble(),
    (position.dy / size.height * _page.height)
        .clamp(0.0, _page.height)
        .roundToDouble(),
  );
  bool get canAttach => !saving && pointer == null && strokes.isNotEmpty;
  Future<void> attach() async {
    if (!canAttach) return;
    final journal = widget.journal;
    bool allowed() =>
        mounted &&
        widget.allowed() &&
        journal.ready &&
        journal.pending == null &&
        !journal.sending;
    if (!allowed()) {
      setState(() => issue = 'La bozza non è disponibile. Torna alla chat.');
      return;
    }
    setState(() {
      saving = true;
      issue = null;
    });
    try {
      final recorder = ui.PictureRecorder();
      _paintPage(Canvas(recorder), _page, strokes);
      final picture = recorder.endRecording();
      late final Uint8List png;
      try {
        final img = await picture.toImage(
          _page.width.toInt(),
          _page.height.toInt(),
        );
        try {
          final data = await img.toByteData(format: ui.ImageByteFormat.png);
          if (data == null) throw const FormatException();
          png = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
        } finally {
          img.dispose();
        }
      } finally {
        picture.dispose();
      }
      if (!allowed())
        throw const AttachmentProblem(
          'La bozza non è disponibile. Torna alla chat.',
        );
      final original = journal.files;
      final added = await journal.staging.stage(
        [
          XFile.fromData(
            png,
            mimeType: 'image/png',
            name: 'Schizzo.png',
            path: 'Schizzo.png',
          ),
        ],
        existing: original,
        photo: true,
      );
      try {
        if (!allowed() || !identical(original, journal.files))
          throw const AttachmentProblem(
            'La bozza è cambiata. Controlla gli allegati e riprova.',
          );
        await journal.replaceFiles([...original, ...added]);
      } catch (_) {
        await journal.staging.discard(added);
        rethrow;
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted)
        setState(
          () => issue = e is AttachmentProblem
              ? e.message
              : 'Impossibile allegare il disegno. Riprova.',
        );
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext c) {
    final colors = Theme.of(c).colorScheme;
    return PopScope(
      canPop: !saving,
      child: Scaffold(
        appBar: AppBar(
          title: Text(uiText(c, 'Disegna')),
          leading: IconButton(
            icon: const Icon(Icons.close),
            tooltip: uiText(c, 'Chiudi disegno'),
            onPressed: saving ? null : () => Navigator.pop(c),
          ),
        ),
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Wrap(
                  spacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final p in _pens.entries)
                      Semantics(
                        selected: ink == p.value,
                        child: IconButton(
                          tooltip: uiText(c, 'Penna {0}', [p.key]),
                          onPressed: saving || pointer != null
                              ? null
                              : () => setState(() => ink = p.value),
                          icon: Container(
                            width: 25,
                            height: 25,
                            decoration: BoxDecoration(
                              color: p.value,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: ink == p.value
                                    ? colors.primary
                                    : colors.outlineVariant,
                                width: 2,
                              ),
                            ),
                            child: ink == p.value
                                ? const Icon(
                                    Icons.check,
                                    size: 16,
                                    color: Colors.white,
                                  )
                                : null,
                          ),
                        ),
                      ),
                    IconButton(
                      tooltip: uiText(c, 'Annulla tratto'),
                      icon: const Icon(Icons.undo),
                      onPressed: !canAttach
                          ? null
                          : () => setState(() {
                              strokes.removeLast();
                              revision++;
                              issue = null;
                            }),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 4,
                  ),
                  child: LayoutBuilder(
                    builder: (c, constraints) {
                      final w = math.min(
                        constraints.maxWidth,
                        constraints.maxHeight * _page.aspectRatio,
                      );
                      final size = Size(w, w / _page.aspectRatio);
                      if (w <= 0) return const SizedBox.shrink();
                      return Center(
                        child: Semantics(
                          label: uiText(c, 'Tela di disegno'),
                          image: true,
                          child: SizedBox.fromSize(
                            size: size,
                            child: Listener(
                              behavior: HitTestBehavior.opaque,
                              onPointerDown: (e) {
                                if (saving || pointer != null || e.buttons != 1)
                                  return;
                                setState(() {
                                  pointer = e.pointer;
                                  strokes.add(
                                    _Stroke(ink, point(e.localPosition, size)),
                                  );
                                  issue = null;
                                  revision++;
                                });
                              },
                              onPointerMove: (e) {
                                if (pointer == e.pointer) {
                                  strokes.last.extend(
                                    point(e.localPosition, size),
                                  );
                                  setState(() => revision++);
                                }
                              },
                              onPointerUp: (e) {
                                if (pointer == e.pointer) {
                                  strokes.last.extend(
                                    point(e.localPosition, size),
                                  );
                                  setState(() {
                                    pointer = null;
                                    revision++;
                                  });
                                }
                              },
                              onPointerCancel: (e) {
                                if (pointer == e.pointer)
                                  setState(() => pointer = null);
                              },
                              child: CustomPaint(
                                painter: _PagePainter(strokes, revision),
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
              if (issue != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(uiText(c, issue!)),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.all(8),
                child: FilledButton.icon(
                  icon: const Icon(Icons.attach_file),
                  label: Text(
                    saving
                        ? uiText(c, 'Salvataggio…')
                        : uiText(c, 'Aggiungi alla bozza'),
                  ),
                  onPressed: canAttach ? attach : null,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
