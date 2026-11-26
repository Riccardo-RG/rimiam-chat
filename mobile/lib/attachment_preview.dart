import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'protected_thumbnail.dart';
import 'assistant_instruction_export.dart';
import 'ui_language.dart';
import 'voice_device.dart';

enum _PreviewAction { message, ask, retryReading }

Future<void> showAttachmentPreview(
  BuildContext context, {
  required RimiamApi api,
  required String path,
  required String filename,
  VoidCallback? onMessage,
  VoidCallback? onAsk,
  String? readingStatus,
  VoidCallback? onRetryReading,
  bool discloseMedia = false,
}) async {
  final action = await Navigator.of(context).push<_PreviewAction>(
    MaterialPageRoute(
      builder: (_) => _Preview(
        api: api,
        path: path,
        filename: filename,
        linkedMessage: onMessage != null,
        ask: onAsk != null,
        readingStatus: readingStatus,
        canRetryReading: onRetryReading != null,
        discloseMedia: discloseMedia,
      ),
    ),
  );
  if (!context.mounted) return;
  if (action == _PreviewAction.message) onMessage?.call();
  if (action == _PreviewAction.ask) onAsk?.call();
  if (action == _PreviewAction.retryReading) onRetryReading?.call();
}

class ReceivedAttachment extends StatelessWidget {
  const ReceivedAttachment({
    super.key,
    required this.api,
    required this.path,
    required this.filename,
    this.withdrawn = false,
    this.onAsk,
    this.onMessage,
    this.mediaType,
  });
  final RimiamApi api;
  final String path, filename;
  final VoidCallback? onAsk, onMessage;
  final String? mediaType;
  final bool withdrawn;
  @override
  Widget build(BuildContext context) {
    if (withdrawn) return Text(uiText(context, 'Allegato rimosso.'));
    void open() => showAttachmentPreview(
      context,
      api: api,
      path: path,
      filename: filename,
      onAsk: onAsk,
      onMessage: onMessage,
    );
    if (const {'image/jpeg', 'image/png', 'image/webp'}.contains(mediaType)) {
      return TextButton(
        onPressed: open,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 160,
              height: 105,
              child: ProtectedThumbnail(
                key: ValueKey((api, api.actorId, path)),
                api: api,
                path: path,
              ),
            ),
            Text(filename, maxLines: 2, overflow: TextOverflow.ellipsis),
          ],
        ),
      );
    }
    return TextButton.icon(
      onPressed: open,
      icon: const Icon(Icons.attach_file, size: 18),
      label: Text(filename, maxLines: 2, overflow: TextOverflow.ellipsis),
    );
  }
}

class _Preview extends StatefulWidget {
  final bool linkedMessage, ask;
  final bool canRetryReading, discloseMedia;
  final String? readingStatus;
  const _Preview({
    required this.api,
    required this.path,
    required this.filename,
    required this.linkedMessage,
    required this.ask,
    required this.readingStatus,
    required this.canRetryReading,
    required this.discloseMedia,
  });
  final RimiamApi api;
  final String path, filename;
  @override
  State<_Preview> createState() => _PreviewState();
}

class _PreviewState extends State<_Preview> with WidgetsBindingObserver {
  late final String _actor;
  int _gen = 0;
  int _playGeneration = 0;
  final _player = ManualAudioPlayer();
  bool _playing = false;
  bool _active = true, _exporting = false;
  String _mime = 'application/octet-stream';
  int? _bytes;
  ({String? text, Uint8List? image, String? audio, bool page, bool busy})?
  _view;
  String? _error;
  @override
  void initState() {
    super.initState();
    _actor = widget.api.actorId;
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s != AppLifecycleState.resumed && _playing) {
      setState(_stopAudio);
    }
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
      _gen++;
      setState(() {
        _active = false;
        _view = null;
        _error = null;
      });
    } else if (s == AppLifecycleState.resumed && !_active) {
      setState(() => _active = true);
      _load();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopAudio();
    super.dispose();
  }

  void _stopAudio() {
    _playing = false;
    _playGeneration++;
    unawaited(_player.stop());
  }

  Future<void> _listen(String extension) async {
    if (_playing) {
      setState(_stopAudio);
      return;
    }
    if (!_active || widget.api.actorId != _actor) return;
    final epoch = ++_playGeneration;
    bool current() =>
        mounted &&
        _active &&
        _playGeneration == epoch &&
        widget.api.actorId == _actor;
    setState(() => _playing = true);
    try {
      final path = widget.path;
      final bytes = await widget.api.getBytes(
        '$path${path.contains('?') ? '&' : '?'}view=audio',
      );
      if (!current()) return;
      await _player.playFile(extension, (file, valid) async {
        if (valid() && current()) await file.writeAsBytes(bytes, flush: true);
      });
    } catch (_) {
      if (current())
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(uiText(context, 'Impossibile riprodurre l’audio.')),
          ),
        );
    } finally {
      if (current()) setState(() => _playing = false);
    }
  }

  Future<void> _retryReading() async {
    final epoch = _gen;
    if (widget.discloseMedia) {
      final yes = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(widget.filename),
          content: Text(
            uiText(
              c,
              'Inviare questo file al servizio AI configurato per leggerne il contenuto?',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: Text(uiText(c, 'Annulla')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: Text(uiText(c, 'Consenti lettura')),
            ),
          ],
        ),
      );
      if (yes != true) return;
    }
    if (mounted && _gen == epoch && _active && widget.api.actorId == _actor)
      Navigator.pop(context, _PreviewAction.retryReading);
  }

  Future<void> _load() async {
    final g = ++_gen;
    setState(() {
      _view = null;
      _error = null;
    });
    try {
      if (widget.api.actorId != _actor)
        throw const ApiError(401, 'SESSION_CHANGED');
      final path = widget.path,
          source = await widget.api.get(
            '$path${path.contains('?') ? '&' : '?'}view=preview',
          );
      if (g != _gen || !mounted || !_active) return;
      if (source['filename'] != widget.filename || widget.api.actorId != _actor)
        throw const FormatException();
      final p = source['preview'];
      final mime = source['mediaType'] as String? ?? 'application/octet-stream';
      Uint8List? image;
      String? text, audio;
      switch (p['kind']) {
        case 'image':
          image = await widget.api.getBytes(path);
        case 'page':
          image = base64Decode(p['jpeg'] as String);
        case 'text':
          text = p['text'] as String;
          if (p['truncated'] == true) text += '\n\nFine dell’anteprima.';
        case 'audio':
          final ext = p['extension'];
          if (!const {'mp3', 'm4a', 'wav', 'webm', 'ogg'}.contains(ext))
            throw const FormatException();
          audio = ext;
        default:
          text = p['reason'] == 'busy'
              ? 'L’anteprima è in preparazione. Riapri il file tra poco.'
              : 'Anteprima non disponibile per questo file.';
      }
      if (mounted && g == _gen && widget.api.actorId == _actor)
        setState(() {
          _view = (
            text: text,
            image: image,
            audio: audio,
            page: p['kind'] == 'page',
            busy: p['reason'] == 'busy',
          );
          _mime = mime;
          _bytes = source['bytes'] as int?;
        });
    } catch (_) {
      if (mounted && g == _gen)
        setState(() => _error = 'Impossibile aprire questo allegato.');
    }
  }

  Future<void> _export(BuildContext button) async {
    if (_exporting || !_active || _view == null || widget.api.actorId != _actor)
      return;
    final epoch = _gen;
    final box = button.findRenderObject() as RenderBox;
    final anchor = box.localToGlobal(Offset.zero) & box.size;
    setState(() => _exporting = true);
    try {
      final bytes = await widget.api.getBytes(widget.path);
      if (!mounted || !_active || epoch != _gen || widget.api.actorId != _actor)
        return;
      await sharePrivateBytes(
        bytes,
        name: widget.filename,
        mimeType: _mime,
        anchor: anchor,
      );
    } catch (_) {
      if (mounted && _active)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(uiText(button, 'Impossibile esportare il file.')),
          ),
        );
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final view = _view;
    final ext = RegExp(r'\.([\w]{1,9})$')
        .firstMatch(widget.filename)
        ?.group(1)
        ?.toUpperCase();
    final size = _bytes;
    final shortType = ext ?? _mime.split(';').first;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _active ? widget.filename : uiText(context, 'Allegato'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (_active && _error == null && view != null)
            Builder(
              builder: (c) => IconButton(
                tooltip: uiText(c, 'Esporta originale'),
                icon: const Icon(Icons.ios_share),
                onPressed: _exporting ? null : () => _export(c),
              ),
            ),
        ],
      ),
      bottomNavigationBar:
          (widget.linkedMessage || widget.ask) &&
              _active &&
              _error == null &&
              view != null
          ? SafeArea(
              child: Wrap(
                alignment: WrapAlignment.center,
                children: [
                  if (widget.linkedMessage)
                    TextButton.icon(
                      onPressed: () =>
                          Navigator.pop(context, _PreviewAction.message),
                      icon: const Icon(Icons.chat_bubble_outline),
                      label: Text(uiText(context, 'Vai al messaggio')),
                    ),
                  if (widget.ask)
                    TextButton.icon(
                      onPressed: () =>
                          Navigator.pop(context, _PreviewAction.ask),
                      icon: const Icon(Icons.edit_note),
                      label: Text(
                        uiText(context, 'Chiedi a Emme su questo file'),
                      ),
                    ),
                ],
              ),
            )
          : null,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_active &&
                _error == null &&
                view != null &&
                widget.readingStatus != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  children: [
                    Text(
                      uiText(context, widget.readingStatus!),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (widget.canRetryReading)
                      TextButton(
                        onPressed: _retryReading,
                        child: Text(
                          uiText(
                            context,
                            widget.discloseMedia
                                ? 'Consenti lettura con AI…'
                                : 'Riprova lettura',
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            if (_active && _error == null && view != null && size != null)
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 4,
                ),
                child: Tooltip(
                  message: _mime,
                  child: Text(
                    '$shortType · ${_fileSize(context, size)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ),
            Expanded(
              child: !_active
                  ? const SizedBox()
                  : _error != null
                  ? Center(
                      child: TextButton(
                        onPressed: _load,
                        child: Text(uiText(context, '{0} Riprova', [_error])),
                      ),
                    )
                  : view == null
                  ? const Center(child: CircularProgressIndicator())
                  : view.audio != null
                  ? Center(
                      child: FilledButton.tonalIcon(
                        icon: Icon(_playing ? Icons.stop : Icons.play_arrow),
                        label: Text(
                          uiText(
                            context,
                            _playing ? 'Interrompi ascolto' : 'Ascolta audio',
                          ),
                        ),
                        onPressed: () => _listen(view.audio!),
                      ),
                    )
                  : view.image != null
                  ? Column(
                      children: [
                        if (view.page) Text(uiText(context, 'Prima pagina')),
                        Expanded(
                          child: Center(
                            child: InteractiveViewer(
                              child: Image.memory(
                                view.image!,
                                cacheWidth: 1600,
                                fit: BoxFit.contain,
                                errorBuilder: (_, __, ___) => Text(
                                  uiText(context, 'Immagine non leggibile.'),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        SelectableText(view.text ?? ''),
                        if (view.busy)
                          TextButton(
                            onPressed: _load,
                            child: Text(uiText(context, 'Riprova anteprima')),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

String _fileSize(BuildContext context, int bytes) {
  if (bytes < 1024) return '$bytes B';
  final mib = bytes >= 1024 * 1024;
  final n = (bytes / (mib ? 1024 * 1024 : 1024))
      .toStringAsFixed(1)
      .replaceFirst(RegExp(r'\.0$'), '');
  final number = Localizations.localeOf(context).languageCode == 'it'
      ? n.replaceFirst('.', ',')
      : n;
  return '$number ${mib ? 'MiB' : 'KiB'}';
}
