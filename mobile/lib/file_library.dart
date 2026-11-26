import 'ui_language.dart';
import 'studio_theme.dart';
import 'personal_navigation.dart';

import 'protected_thumbnail.dart';

import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'attachment_preview.dart';
import 'attachments.dart';
import 'chat_journal.dart';
import 'library_collection.dart';
import 'library_entries.dart';
import 'library_document_view.dart';
part 'library_forms.dart';

class FileLibrary extends StatefulWidget {
  FileLibrary({
    Key? key,
    required this.api,
    this.vault = const DeviceDraftVault(),
    this.workspaceId,
    this.workspaceName,
    this.openUpload = false,
  }) : super(key: key ?? ValueKey((api, api.actorId, workspaceId)));
  final RimiamApi api;
  final DraftVault vault;
  final String? workspaceId, workspaceName;
  final bool openUpload;
  @override
  State<FileLibrary> createState() => _FileLibraryState();
}

class _FileLibraryState extends State<FileLibrary> with WidgetsBindingObserver {
  late final LibraryCollection model;
  final _search = TextEditingController();
  final _scroll = ScrollController();
  String _tab = 'Recenti',
      _type = 'Tutti',
      _period = 'Tutto il periodo',
      _special = '',
      _error = '',
      _ack = '';
  DateTimeRange? _range;
  bool _active = true, _busy = false, _loading = true;
  int _generation = 0;
  bool _initialUploadHandled = false;
  bool get _current => mounted && _active && widget.api.actorId == model.actor;
  bool get _free =>
      _current &&
      model.ready &&
      !_busy &&
      !_loading &&
      !model.commands.busy &&
      !model.transfers.sending;
  bool get _newCommand =>
      _free &&
      model.commands.pending == null &&
      model.transfers.pending == null;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    model = LibraryCollection(
      widget.api,
      widget.vault,
      workspace: widget.workspaceId,
    );
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _generation++;
      setState(() {
        _active = false;
        model.clear();
      });
    } else if (state == AppLifecycleState.resumed && !_active) {
      setState(() => _active = true);
      _load();
    }
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() => _loading = true);
    try {
      await model.load();
      if (_current && generation == _generation) setState(() => _error = '');
    } catch (_) {
      if (mounted && generation == _generation)
        setState(() {
          model.clear();
          _error = 'Impossibile aprire la raccolta.';
        });
    } finally {
      if (mounted && generation == _generation)
        setState(() => _loading = false);
      if (_current &&
          model.ready &&
          widget.openUpload &&
          !_initialUploadHandled) {
        _initialUploadHandled = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_newCommand &&
              model.canWrite &&
              ModalRoute.of(context)?.isCurrent == true)
            showAttachmentPicker(
              context,
              staging: model.transfers.staging,
              files: model.transfers.files,
              onChanged: _setFiles,
            );
        });
      }
    }
  }

  Future<void> _act(Future<void> Function() run, String success) async {
    if (!_free) return;
    setState(() {
      _busy = true;
      _error = '';
      _ack = '';
    });
    try {
      await run();
      if (!_current) return;
      setState(() => _ack = success);
      await _load();
    } on FormatException catch (e) {
      if (_current) setState(() => _error = e.message);
    } on AttachmentProblem catch (e) {
      if (_current) setState(() => _error = e.message);
    } on ApiError catch (e) {
      if (!_current) return;
      if (e.status == 401 ||
          e.status == 403 ||
          e.status == 404 ||
          e.status == 409)
        await _load();
      if (_current)
        setState(
          () => _error = 'La raccolta o i permessi sono cambiati. Controlla i dati aggiornati.',
        );
    } catch (_) {
      if (_current)
        setState(
          () => _error = 'Salvataggio non confermato. Controlla se ci sono invii in sospeso.',
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _tabTo(String tab) {
    setState(() {
      _tab = tab;
      _special = '';
      _ack = '';
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  void _original(String id) {
    if (!_current || !model.ready) return;
    if (!model.personal) {
      Navigator.pop(context, id);
      return;
    }
    final m = model.index!.messages[id];
    showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(uiText(c, 'Messaggio originale')),
        content: SingleChildScrollView(
          child: Text(
            m == null
                ? uiText(c, 'Il messaggio non è disponibile.')
                : '${m['author_name']}\n\n${m['content']}',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: Text(uiText(c, 'Chiudi')),
          ),
        ],
      ),
    );
  }

  Future<void> _askAboutFile(LibraryJson file) async {
    if (!_current || !model.ready || model.personal || !model.canWrite) return;
    await _load();
    if (!_current || !model.ready || ModalRoute.of(context)?.isCurrent != true)
      return;
    final retained = libraryRows(model.snapshot['sources']).any(
      (s) =>
          s['id'] == file['id'] &&
          s['kind'] == 'document' &&
          s['filename'] == file['filename'] &&
          s['withdrawn'] != true,
    );
    if (!model.canWrite || !retained) {
      setState(
        () => _error = 'Questa versione o il permesso di scrivere non sono più disponibili.',
      );
      return;
    }
    Navigator.pop(context, (
      sourceId: file['id'] as String,
      filename: file['filename'] as String,
    ));
  }

  Future<void> _retryReading(LibraryJson file, bool disclosedMedia) async {
    if (!_newCommand) return;
    await _load();
    if (!_newCommand) return;
    final retained = libraryRows(model.snapshot['sources'])
        .where(
          (s) =>
              s['id'] == file['id'] &&
              s['document_version'] == file['document_version'],
        )
        .firstOrNull;
    final reading = retained == null ? null : libraryReading(retained);
    if (!model.canWrite ||
        reading == null ||
        !reading.canRetry ||
        reading.discloseMedia != disclosedMedia) {
      setState(
        () => _error = 'Questa versione o il permesso di scrivere non sono più disponibili.',
      );
      return;
    }
    await _act(() async {
      await model.send({
        'type': 'document.retry',
        'sourceId': file['id'],
        if (disclosedMedia) 'allowModelProcessing': true,
      }, () => _current && model.canWrite);
    }, 'Lettura richiesta.');
  }

  Future<void> _open(LibraryEntry e) async {
    if (!_current || !model.ready) return;
    if (e.file != null && e.file!['withdrawn'] != true) {
      final file = e.file!, reading = libraryReading(file);
      await showAttachmentPreview(
        context,
        api: widget.api,
        path: model.filePath(e.file!),
        filename: e.title,
        onMessage: e.messageId == null ? null : () => _original(e.messageId!),
        onAsk: model.personal || !model.canWrite
            ? null
            : () => _askAboutFile(e.file!),
        readingStatus: reading.status,
        discloseMedia: reading.discloseMedia,
        onRetryReading: model.canWrite && reading.canRetry
            ? () => _retryReading(file, reading.discloseMedia)
            : null,
      );
    } else if (e.address != null) {
      try {
        if (!await launchUrl(e.address!, mode: LaunchMode.externalApplication))
          throw StateError('browser');
      } catch (_) {
        if (_current)
          setState(() => _error = 'Il browser non ha aperto la pagina.');
      }
    } else if (e.messageId != null) {
      _original(e.messageId!);
    }
  }

  Future<void> _setFiles(List<StagedAttachment> chosen) async {
    if (!_current)
      throw StateError('Riapri la raccolta per confermare il caricamento.');
    // A mobile system picker may resume while the membership read is still running.
    if (!model.ready || _loading) await model.load();
    if (!_current ||
        !model.ready ||
        !model.canWrite ||
        _busy ||
        model.commands.pending != null ||
        model.transfers.pending != null)
      throw StateError('Controlla i permessi e il caricamento in corso.');
    await model.transfers.replaceFiles(chosen);
    if (_current) setState(() {});
  }

  Future<void> _compose({required bool note}) async {
    if (!_newCommand || !model.canWrite) return;
    final ack = await Navigator.push<String>(
      context,
      MaterialPageRoute(
        builder: (_) => _LibraryTextEditor(
          note: note,
          personal: model.personal,
          destination: model.title,
          awaitingConfirmation: () =>
              model.commands.pending != null ||
              model.transfers.pending != null ||
              model.transfers.files.isNotEmpty,
          save: (body) async {
            if (!_newCommand || !model.canWrite)
              throw const FormatException(
                'Verifica prima il salvataggio precedente.',
              );
            if (note) {
              final result = await model.note(body, () => _current);
              return 'Nota salvata in ${result.destination} · ${result.filename}';
            }
            await model.savePage(body, () => _current);
            return 'Collegamento salvato in ${model.title}.';
          },
        ),
      ),
    );
    if (!_current) return;
    if (ack != null) setState(() => _ack = ack);
    await _load();
  }

  Future<void> _manage(LibraryEntry entry, String choice) async {
    if (!_newCommand) return;
    final f = entry.file;
    if (choice == 'message') {
      if (entry.messageId != null) _original(entry.messageId!);
      return;
    }
    if (choice == 'hide') {
      await _act(
        () => model.hide(entry.key, _special != 'hidden'),
        _special == 'hidden'
            ? 'Elemento di nuovo visibile.'
            : 'Nascosto su questo dispositivo.',
      );
      return;
    }
    if (f == null) return;
    if (choice == 'copy') {
      String? id, name;
      if (model.personal) {
        final selection = await showDialog<LibraryJson>(
          context: context,
          builder: (c) => _CopyDestination(
            targets: model.targets,
            preferred: f['origin_workspace_id'] as String?,
          ),
        );
        if (selection == null || !_current) return;
        id = selection['id'] as String;
        name = selection['name'] as String;
      } else {
        final ok = await _confirm(
          uiText(context, 'Salvare una copia di «{0}»?', [entry.title]),
          uiText(
            context,
            'La copia sarà visibile solo a te in Documenti personali.',
          ),
          uiText(context, 'Salva nei miei documenti'),
        );
        if (!ok || !_current) return;
      }
      await _act(() async {
        final target = id ?? await model.personalArchive();
        if (!_current) return;
        await model.copyTo(f, target, () => _current);
      }, 'Copia salvata in ${name ?? 'Documenti personali'}.');
    } else if (choice == 'visibility') {
      final restore = f['withdrawn'] == true;
      final action = restore
          ? 'Ripristina file'
          : model.personal
          ? 'Rimuovi dai miei documenti'
          : 'Rimuovi per tutti';
      final explain = restore
          ? 'Questa versione tornerà disponibile nella raccolta.'
          : 'Il file sarà ritirato dalla raccolta. Il messaggio rimane nella cronologia. Puoi ripristinare questa versione da File ritirati.';
      if (await _confirm('$action · ${entry.title}', explain, action) &&
          _current)
        await _act(
          () => model.visibility(f, () => _current),
          restore ? 'File ripristinato.' : 'File ritirato.',
        );
    }
  }

  Future<bool> _confirm(String title, String text, String button) async =>
      (await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(title),
          content: Text(text),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(uiText(ctx, 'Annulla')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(button),
            ),
          ],
        ),
      )) ==
      true;

  (DateTime?, DateTime?) get _bounds {
    if (_period == 'Intervallo') return (_range?.start, _range?.end);
    final today = DateTime.now();
    final days = _period == 'Ultimi 7 giorni'
        ? 6
        : _period == 'Ultimi 30 giorni'
        ? 29
        : null;
    return (
      days == null ? null : DateTime(today.year, today.month, today.day - days),
      null,
    );
  }

  Future<void> _filter() async {
    final result =
        await showModalBottomSheet<
          ({String type, String period, DateTimeRange? range})
        >(
          context: context,
          isScrollControlled: true,
          showDragHandle: true,
          builder: (c) => _Filters(type: _type, period: _period, range: _range),
        );
    if (result != null && _current)
      setState(() {
        _type = result.type;
        _period = result.period;
        _range = result.range;
      });
  }

  Widget _options(LibraryEntry e) => PopupMenuButton<String>(
    tooltip: uiText(context, 'Azioni per {0}', [e.title]),
    enabled: _newCommand,
    onSelected: (v) => _manage(e, v),
    itemBuilder: (_) => [
      if (e.messageId != null && _special != 'withdrawn')
        PopupMenuItem(
          value: 'message',
          child: Text(uiText(context, 'Vai al messaggio')),
        ),
      if (_special != 'withdrawn')
        PopupMenuItem(
          value: 'hide',
          child: Text(
            _special == 'hidden'
                ? uiText(context, 'Mostra di nuovo')
                : uiText(context, 'Nascondi su questo dispositivo'),
          ),
        ),
      if (e.file != null &&
          e.file!['withdrawn'] != true &&
          (!model.personal || model.targets.isNotEmpty))
        PopupMenuItem(
          value: 'copy',
          child: Text(
            model.personal
                ? uiText(context, 'Condividi in uno spazio…')
                : uiText(context, 'Salva nei miei documenti'),
          ),
        ),
      if (e.file?['can_manage_visibility'] == true && model.canWrite)
        PopupMenuItem(
          value: 'visibility',
          child: Text(
            e.file?['withdrawn'] == true
                ? uiText(context, 'Ripristina file')
                : model.personal
                ? uiText(context, 'Rimuovi dai miei documenti')
                : uiText(context, 'Rimuovi per tutti'),
          ),
        ),
    ],
  );
  Widget _star(LibraryEntry e) => IconButton(
    tooltip: e.favorite
        ? uiText(context, 'Rimuovi dai preferiti')
        : uiText(context, 'Aggiungi ai preferiti'),
    isSelected: e.favorite,
    selectedIcon: Icon(
      Icons.star_rounded,
      color: Theme.of(context).colorScheme.primary,
    ),
    icon: const Icon(Icons.star_border_rounded),
    onPressed: _newCommand
        ? () => _act(
            () => model.changeFavorite(e.file!, () => _current),
            e.favorite ? 'Rimosso dai tuoi preferiti.' : 'Nei tuoi preferiti.',
          )
        : null,
  );
  Widget _entry(LibraryEntry e) {
    final d = MaterialLocalizations.of(context)
        .formatShortDate(e.date.toLocal());
    final controls = [
      if (e.file != null && _special != 'withdrawn') _star(e),
      _options(e),
    ];
    if (_tab == 'Media') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Semantics(
              label: uiText(context, 'Apri {0}', [e.title]),
              button: true,
              container: true,
              onTap: () => _open(e),
              child: InkWell(
                onTap: () => _open(e),
                excludeFromSemantics: true,
                child: SizedBox.expand(
                  child: ProtectedThumbnail(
                    key: ValueKey((model.actor, idFor(e))),
                    api: widget.api,
                    path: model.filePath(e.file!),
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              e.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          Row(
            children: [
              Expanded(
                child: Text(
                  d,
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              ...controls,
            ],
          ),
        ],
      );
    }
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        e.file == null
            ? Icons.link
            : e.photo
            ? Icons.image_outlined
            : Icons.insert_drive_file_outlined,
      ),
      title: Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        [e.type, d, if (e.author != null) e.author!].join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      onTap: _special == 'withdrawn' ? null : () => _open(e),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: controls),
    );
  }

  Future<void> _documents() async {
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => LibraryDocumentsView(
          library: LibraryCollection(
            widget.api,
            widget.vault,
            workspace: widget.workspaceId,
          ),
        ),
      ),
    );
    if (_current) await _load();
  }

  String idFor(LibraryEntry e) => e.file!['id'] as String;

  @override
  Widget build(BuildContext context) {
    final ready = _current && model.ready;
    final personal = widget.workspaceId == null;
    final title = personal ? 'Documenti personali' : 'Condivisi';
    final (from, until) = _bounds;
    final entries = ready
        ? model.index!.filter(
            tab: _tab,
            type: _type,
            search: _search.text,
            from: from,
            until: until,
            hidden: model.hidden,
            onlyHidden: _special == 'hidden',
            withdrawn: _special == 'withdrawn',
          )
        : <LibraryEntry>[];
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (personal)
              PersonalNavTitle(title)
            else
              Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
            if (!personal && ready)
              Text(
                model.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelMedium,
              ),
          ],
        ),
        actions: [
          if (ready)
            PopupMenuButton<String>(
              tooltip: uiText(context, 'Altre opzioni della raccolta'),
              onSelected: (v) async {
                if (v == 'documents') {
                  await _documents();
                  return;
                }
                if (v == 'refresh') {
                  _load();
                  return;
                }
                setState(() {
                  _special = _special == v ? '' : v;
                  _type = 'Tutti';
                  _period = 'Tutto il periodo';
                  _tab = 'Recenti';
                  _search.clear();
                });
              },
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'documents',
                  child: Text(uiText(context, 'Documenti di lavoro')),
                ),
                PopupMenuItem(
                  value: 'refresh',
                  child: Text(uiText(context, 'Aggiorna')),
                ),
                if (model.hidden.isNotEmpty || _special == 'hidden')
                  PopupMenuItem(
                    value: 'hidden',
                    child: Text(
                      _special == 'hidden'
                          ? uiText(context, 'Torna agli elementi visibili')
                          : uiText(context, 'Mostra elementi nascosti'),
                    ),
                  ),
                if (model.index!.withdrawnVersions.isNotEmpty ||
                    _special == 'withdrawn')
                  PopupMenuItem(
                    value: 'withdrawn',
                    child: Text(
                      _special == 'withdrawn'
                          ? uiText(context, 'Torna alla raccolta')
                          : uiText(context, 'File ritirati'),
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: SafeArea(
        child: !_current
            ? const SizedBox()
            : !ready
            ? Center(
                child: _loading
                    ? StudioLoading(
                        label: uiText(context, 'Caricamento della vista…'),
                      )
                    : TextButton(
                        onPressed: _load,
                        child: Text(uiText(context, '{0} Riprova', [_error])),
                      ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: CustomScrollView(
                  controller: _scroll,
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: [
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                      sliver: SliverToBoxAdapter(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (_busy || _loading)
                              const LinearProgressIndicator(),
                            if (_special.isEmpty &&
                                _tab == 'Recenti' &&
                                libraryRows(model.snapshot['artifacts'])
                                    .isNotEmpty)
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: const Icon(Icons.description_outlined),
                                title: Text(
                                  uiText(context, 'Documenti di lavoro'),
                                ),
                                trailing: Text(
                                  '${libraryRows(model.snapshot['artifacts']).length}',
                                ),
                                onTap: _documents,
                              ),
                            if (_special.isNotEmpty)
                              ActionChip(
                                label: Text(
                                  _special == 'withdrawn'
                                      ? uiText(
                                          context,
                                          'File ritirati · Chiudi',
                                        )
                                      : uiText(
                                          context,
                                          'Elementi nascosti · Chiudi',
                                        ),
                                ),
                                onPressed: () => _tabTo('Recenti'),
                              ),
                            if (model.canWrite && _special.isEmpty)
                              Wrap(
                                spacing: 4,
                                children: [
                                  AttachmentPicker(
                                    staging: model.transfers.staging,
                                    files: model.transfers.files,
                                    enabled: _newCommand,
                                    onChanged: _setFiles,
                                  ),
                                  TextButton.icon(
                                    onPressed:
                                        _newCommand &&
                                            model.transfers.files.isEmpty
                                        ? () => _compose(note: true)
                                        : null,
                                    icon: const Icon(Icons.note_add_outlined),
                                    label: Text(uiText(context, 'Nuova nota')),
                                  ),
                                  TextButton.icon(
                                    onPressed: _newCommand
                                        ? () => _compose(note: false)
                                        : null,
                                    icon: const Icon(Icons.add_link),
                                    label: Text(
                                      uiText(context, 'Aggiungi link'),
                                    ),
                                  ),
                                ],
                              ),
                            if (model.transfers.files.isNotEmpty ||
                                model.transfers.pending != null)
                              FilledButton(
                                onPressed: _free
                                    ? () => _act(
                                        () => model.sendFiles(() => _current),
                                        'Allegati salvati in ${model.title}.',
                                      )
                                    : null,
                                child: Text(
                                  model.transfers.pending != null
                                      ? uiText(
                                          context,
                                          'Verifica e riprova il caricamento',
                                        )
                                      : personal
                                      ? uiText(
                                          context,
                                          'Salva nei miei documenti',
                                        )
                                      : uiText(context, 'Condividi in {0}', [
                                          model.title,
                                        ]),
                                ),
                              ),
                            if (model.commands.pending != null)
                              OutlinedButton(
                                onPressed: _free
                                    ? () => _act(
                                        () => model.send(
                                          model.commands.pending!['command']
                                              as LibraryJson,
                                          () => _current,
                                        ),
                                        'Operazione confermata.',
                                      )
                                    : null,
                                child: Text(
                                  uiText(
                                    context,
                                    'Verifica e riprova l’operazione',
                                  ),
                                ),
                              ),
                            if (_error.isNotEmpty)
                              Text(
                                _error,
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            if (_ack.isNotEmpty)
                              Semantics(liveRegion: true, child: Text(_ack)),
                            if (_special.isEmpty)
                              SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: Row(
                                  children: [
                                    for (final t in collectionTabs)
                                      Padding(
                                        padding: const EdgeInsets.only(
                                          right: 6,
                                        ),
                                        child: ChoiceChip(
                                          selected: _tab == t,
                                          showCheckmark: false,
                                          label: Text(t),
                                          onSelected: (_) => _tabTo(t),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: _search,
                                    onChanged: (_) => setState(() {}),
                                    decoration: InputDecoration(
                                      labelText: uiText(
                                        context,
                                        'Cerca nella raccolta',
                                      ),
                                      prefixIcon: Icon(Icons.search),
                                    ),
                                  ),
                                ),
                                IconButton(
                                  tooltip: uiText(context, 'Filtri'),
                                  isSelected:
                                      _type != 'Tutti' ||
                                      _period != 'Tutto il periodo',
                                  onPressed: _filter,
                                  icon: const Icon(Icons.tune),
                                ),
                              ],
                            ),
                            if (_type != 'Tutti' ||
                                _period != 'Tutto il periodo')
                              Wrap(
                                spacing: 4,
                                children: [
                                  if (_type != 'Tutti')
                                    InputChip(
                                      label: Text(_type),
                                      onDeleted: () =>
                                          setState(() => _type = 'Tutti'),
                                    ),
                                  if (_period != 'Tutto il periodo')
                                    InputChip(
                                      label: Text(
                                        _period == 'Intervallo' &&
                                                _range != null
                                            ? '${MaterialLocalizations.of(context).formatShortDate(_range!.start)} – ${MaterialLocalizations.of(context).formatShortDate(_range!.end)}'
                                            : _period,
                                      ),
                                      onDeleted: () => setState(
                                        () => _period = 'Tutto il periodo',
                                      ),
                                    ),
                                ],
                              ),
                            const SizedBox(height: 12),
                          ],
                        ),
                      ),
                    ),
                    if (entries.isEmpty)
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Text(
                            _tab == 'Preferiti'
                                ? uiText(
                                    context,
                                    'Qui ritrovi i file che segni con la stella.',
                                  )
                                : _search.text.isNotEmpty ||
                                      _type != 'Tutti' ||
                                      _period != 'Tutto il periodo'
                                ? uiText(
                                    context,
                                    'Nessun risultato per questi filtri.',
                                  )
                                : _tab == 'Media'
                                ? uiText(context, 'Ancora nessuna foto.')
                                : uiText(
                                    context,
                                    'Nessun elemento da mostrare.',
                                  ),
                          ),
                        ),
                      ),
                    SliverPadding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      sliver: _tab == 'Media'
                          ? SliverGrid.builder(
                              gridDelegate:
                                  const SliverGridDelegateWithMaxCrossAxisExtent(
                                    maxCrossAxisExtent: 240,
                                    mainAxisExtent: 210,
                                    mainAxisSpacing: 10,
                                    crossAxisSpacing: 10,
                                  ),
                              itemCount: entries.length,
                              itemBuilder: (_, i) => _entry(entries[i]),
                            )
                          : SliverList.builder(
                              itemCount: entries.length,
                              itemBuilder: (_, i) => _entry(entries[i]),
                            ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}
