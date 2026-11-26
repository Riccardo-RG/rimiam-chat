import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// Slivers also build rows in an off-screen cache. Only count a row once
/// enough of its actual painted height is inside this particular viewport.
List<({String id, double y})> visibleConversationRows(
  Map<String, BuildContext> built,
  GlobalKey viewportKey,
) {
  final viewport = viewportKey.currentContext?.findRenderObject();
  if (viewport is! RenderBox || !viewport.attached || !viewport.hasSize)
    return [];
  final visible = <({String id, double y})>[];
  built.removeWhere((_, context) => !context.mounted);
  for (final entry in built.entries) {
    final row = entry.value.findRenderObject();
    if (row is! RenderBox || !row.attached || !row.hasSize) continue;
    final y = row.localToGlobal(Offset.zero, ancestor: viewport).dy;
    final overlap =
        math.min(viewport.size.height, y + row.size.height) - math.max(0.0, y);
    if (overlap > 0 && overlap >= math.min(row.size.height / 2, 32.0)) {
      visible.add((id: entry.key, y: y));
    }
  }
  return visible..sort((a, b) => a.y.compareTo(b.y));
}
