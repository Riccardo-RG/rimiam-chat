import 'ui_language.dart';

import 'dart:io';

import 'package:file_selector/file_selector.dart' as files;
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';

import 'local_secure_storage.dart';
import 'attachment_staging.dart';
export 'attachment_staging.dart';

Future<void> showAttachmentPicker(
  BuildContext context, {
  required AttachmentStaging staging,
  required List<StagedAttachment> files,
  required Future<void> Function(List<StagedAttachment>) onChanged,
}) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (_) =>
      _FileSelection(staging: staging, initial: files, change: onChanged),
);

class AttachmentPicker extends StatelessWidget {
  const AttachmentPicker({
    super.key,
    required this.staging,
    required this.files,
    required this.onChanged,
    this.enabled = true,
    this.compact = false,
  });
  final AttachmentStaging staging;
  final List<StagedAttachment> files;
  final Future<void> Function(List<StagedAttachment>) onChanged;
  final bool enabled, compact;

  @override
  Widget build(BuildContext context) {
    void open() => showAttachmentPicker(
      context,
      staging: staging,
      files: files,
      onChanged: onChanged,
    );
    final title = files.isEmpty ? 'Allega file' : 'Allegati · ${files.length}';
    if (compact)
      return Semantics(
        container: true,
        excludeSemantics: true,
        button: true,
        label: title,
        enabled: enabled,
        onTap: enabled ? open : null,
        child: IconButton(
          tooltip: title,
          onPressed: enabled ? open : null,
          constraints: const BoxConstraints.tightFor(width: 44, height: 44),
          padding: EdgeInsets.zero,
          icon: Badge.count(
            count: files.length,
            isLabelVisible: files.isNotEmpty,
            child: const Icon(Icons.attach_file),
          ),
        ),
      );
    return TextButton.icon(
      onPressed: enabled ? open : null,
      icon: const Icon(Icons.attach_file),
      label: Text(title),
    );
  }
}

class _FileSelection extends StatefulWidget {
  const _FileSelection({
    required this.staging,
    required this.initial,
    required this.change,
  });
  final AttachmentStaging staging;
  final List<StagedAttachment> initial;
  final Future<void> Function(List<StagedAttachment>) change;
  @override
  State<_FileSelection> createState() => _FileSelectionState();
}

enum _Source { documents, photos, camera }

class _FileSelectionState extends State<_FileSelection> {
  static const _pendingPicker = 'rimiam.image-picker.pending.v1';
  final _image = ImagePicker();
  late List<StagedAttachment> _files;
  bool _busy = false;
  String _error = '';
  @override
  void initState() {
    super.initState();
    _files = [...widget.initial];
    if (Platform.isAndroid) _recover();
  }

  Future<void> _recover() async {
    _busy = true;
    try {
      final own = await deviceSecureStorage.read(key: _pendingPicker);
      if (own != widget.staging.namespace || !mounted) return;
      final lost = await _image.retrieveLostData();
      if (lost.exception != null) throw lost.exception!;
      if (lost.files?.isNotEmpty == true && mounted)
        await _add(lost.files!, photo: true);
      await deviceSecureStorage.delete(key: _pendingPicker);
    } catch (e) {
      if (mounted) _error = _describe(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _describe(Object e) {
    if (e is AttachmentProblem) return e.message;
    if (e is PlatformException) {
      if (e.code.contains('denied') || e.code.contains('restricted'))
        return 'Accesso non consentito. Puoi cambiare il permesso nelle impostazioni del telefono.';
      if (e.code.contains('camera') || e.code.contains('source'))
        return 'La fotocamera non è disponibile su questo dispositivo.';
    }
    return 'Impossibile preparare gli allegati. Riprova.';
  }

  Future<void> _add(List<XFile> chosen, {required bool photo}) async {
    if (chosen.isEmpty) return;
    final List<StagedAttachment> added;
    try {
      added = await widget.staging.stage(
        chosen,
        existing: _files,
        photo: photo,
      );
    } finally {
      await AttachmentStaging.releasePickerCopies(chosen);
    }
    if (!mounted) {
      await widget.staging.discard(added);
      return;
    }
    final next = [..._files, ...added];
    try {
      await widget.change(next);
    } catch (_) {
      await widget.staging.discard(added);
      rethrow;
    }
    if (mounted) setState(() => _files = next);
  }

  Future<void> _choose(_Source source) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      if (source == _Source.documents) {
        final chosen = await files.openFiles();
        if (mounted) await _add(chosen, photo: false);
      } else {
        // Android can recreate the activity while the system camera/library is open.
        // Never accept the global picker result into a different identity or draft.
        if (Platform.isAndroid) {
          final previous = await deviceSecureStorage.read(key: _pendingPicker);
          if (previous != null && previous != widget.staging.namespace)
            await _image.retrieveLostData();
          await deviceSecureStorage.write(
            key: _pendingPicker,
            value: widget.staging.namespace,
          );
        }
        if (!mounted) return;
        final remaining = attachmentCountLimit - _files.length;
        List<XFile> chosen;
        if (source == _Source.camera || remaining == 1) {
          final item = await _image.pickImage(
            source: source == _Source.camera
                ? ImageSource.camera
                : ImageSource.gallery,
            requestFullMetadata: false,
            imageQuality: 88,
          );
          chosen = [if (item != null) item];
        } else {
          chosen = await _image.pickMultiImage(
            requestFullMetadata: false,
            imageQuality: 88,
            limit: remaining,
          );
        }
        if (mounted) await _add(chosen, photo: true);
        if (Platform.isAndroid)
          await deviceSecureStorage.delete(key: _pendingPicker);
      }
    } catch (e) {
      if (mounted) _error = _describe(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _update(List<StagedAttachment> next) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.change(next);
      if (mounted) _files = next;
    } catch (e) {
      if (mounted) _error = _describe(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final choose = !_busy && _files.length < attachmentCountLimit;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .82,
        ),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    uiText(context, 'Allegati'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                TextButton(
                  onPressed: _busy ? null : () => Navigator.pop(context),
                  child: Text(uiText(context, 'Chiudi')),
                ),
              ],
            ),
            if (_error.isNotEmpty)
              Semantics(liveRegion: true, child: Text(uiText(context, _error))),
            if (_busy) const LinearProgressIndicator(),
            ListTile(
              leading: const Icon(Icons.description_outlined),
              title: Text(uiText(context, 'Scegli file')),
              onTap: choose ? () => _choose(_Source.documents) : null,
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(uiText(context, 'Scegli foto')),
              onTap: choose ? () => _choose(_Source.photos) : null,
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(uiText(context, 'Scatta foto')),
              onTap: choose ? () => _choose(_Source.camera) : null,
            ),
            if (_files.isNotEmpty) const Divider(),
            for (int i = 0; i < _files.length; i++)
              Row(
                children: [
                  SizedBox(width: 24, child: Text('${i + 1}')),
                  Expanded(
                    child: Text(
                      _files[i].filename,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (i > 0)
                    IconButton(
                      tooltip: uiText(context, 'Sposta prima {0}', [
                        _files[i].filename,
                      ]),
                      icon: const Icon(Icons.arrow_upward, size: 18),
                      onPressed: _busy
                          ? null
                          : () {
                              final next = [..._files];
                              final f = next.removeAt(i);
                              next.insert(i - 1, f);
                              _update(next);
                            },
                    ),
                  IconButton(
                    tooltip: uiText(context, 'Rimuovi {0}', [
                      _files[i].filename,
                    ]),
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: _busy
                        ? null
                        : () => _update([..._files]..removeAt(i)),
                  ),
                ],
              ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                uiText(context, 'Fino a 10 allegati, 8 MiB in totale.'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
