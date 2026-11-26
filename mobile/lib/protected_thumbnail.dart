import 'package:material_ui/material_ui.dart';

import 'api.dart';

class ProtectedThumbnail extends StatefulWidget {
  const ProtectedThumbnail({super.key, required this.api, required this.path});
  final RimiamApi api;
  final String path;
  @override
  State<ProtectedThumbnail> createState() => _ThumbnailState();
}

class _ThumbnailState extends State<ProtectedThumbnail>
    with WidgetsBindingObserver {
  ImageProvider? image;
  bool failed = false, active = true;
  int revision = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void didUpdateWidget(ProtectedThumbnail old) {
    super.didUpdateWidget(old);
    if (old.api != widget.api || old.path != widget.path) {
      clear();
      if (active) load();
    }
  }

  void clear() {
    revision++;
    image?.evict();
    image = null;
    failed = false;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    clear();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (active &&
        (state == AppLifecycleState.hidden ||
            state == AppLifecycleState.paused)) {
      active = false;
      setState(clear);
    } else if (!active && state == AppLifecycleState.resumed) {
      active = true;
      load();
    }
  }

  Future<void> load() async {
    final tick = ++revision, actor = widget.api.actorId;
    if (actor.isEmpty) return;
    try {
      final bytes = await widget.api.getBytes(widget.path);
      if (mounted && tick == revision && actor == widget.api.actorId)
        setState(
          () =>
              image = ResizeImage.resizeIfNeeded(300, null, MemoryImage(bytes)),
        );
    } catch (_) {
      if (mounted && tick == revision) setState(() => failed = true);
    }
  }

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(8),
    child: ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: image != null
          ? Image(
              image: image!,
              fit: BoxFit.cover,
              excludeFromSemantics: true,
              errorBuilder: (_, _, _) =>
                  const Icon(Icons.broken_image_outlined),
            )
          : Icon(failed ? Icons.broken_image_outlined : Icons.image_outlined),
    ),
  );
}
