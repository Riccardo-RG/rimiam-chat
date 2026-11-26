import 'ui_language.dart';
import 'studio_theme.dart';

import 'dart:convert';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'assistant_instruction_export.dart';
import 'attachment_preview.dart';
import 'library_collection.dart';
import 'library_documents.dart';
import 'library_entries.dart';
import 'library_document_editor.dart';

class LibraryDocumentsView extends StatefulWidget {
  const LibraryDocumentsView({
    super.key,
    required this.library,
    this.privateSelection,
    this.checkSelection,
    this.openArchive,
  });
  final LibraryCollection library;
  final String? privateSelection;
  final Future<String> Function()? checkSelection;
  final VoidCallback? openArchive;
  @override
  State<LibraryDocumentsView> createState() => _DocumentsState();
}

class _DocumentsState extends State<LibraryDocumentsView>
    with WidgetsBindingObserver {
  LibraryCollection get library => widget.library;
  late final PrivateDocumentRequest request;
  final question = TextEditingController();
  bool busy = false, active = true, ready = false, shared = false;
  String mode = 'list', error = '';
  String? selected;
  int? version;
  int generation = 0;
  LibraryJson? generated;
  bool get current => mounted && active && library.api.actorId == library.actor;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.privateSelection != null) mode = 'generate';
    request = PrivateDocumentRequest(
      library,
      privateSelection: widget.privateSelection,
    );
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    question.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      generation++;
      setState(() {
        library.clear();
        active = false;
        ready = false;
        generated = null;
      });
    } else if (state == AppLifecycleState.resumed && !active) {
      setState(() => active = true);
      _load();
    }
  }

  Future<void> _load() async {
    final epoch = ++generation;
    try {
      await widget.checkSelection?.call();
      await library.load();
      if (!current || epoch != generation) return;
      await request.load();
      if (!current || epoch != generation) return;
      if (request.pending != null)
        question.text = request.pending!['question'] as String;
      setState(() {
        ready = true;
        error = '';
      });
    } catch (_) {
      if (current && epoch == generation)
        setState(() {
          ready = false;
          error = 'Impossibile leggere i documenti.';
        });
    }
  }

  Future<void> run(Future<void> Function() action) async {
    if (!current || !ready || busy || !library.ready) return;
    setState(() {
      busy = true;
      error = '';
    });
    try {
      await action();
    } on ApiError catch (e) {
      if (current)
        setState(
          () => error = e.status == 429
              ? 'Limite di utilizzo raggiunto. Puoi riprovare più tardi.'
              : e.code == 'CONSULTATION_RUNNING'
              ? 'Emme sta ancora preparando il documento. Verifica tra poco.'
              : e.code == 'CONSULTATION_SELECTION_CHANGED'
              ? 'Lo spazio consultato è cambiato. Controlla la destinazione prima di inviare.'
              : e.status == 401 || e.status == 403
              ? 'Accesso al documento non disponibile.'
              : 'Operazione non riuscita. Puoi riprovare.',
        );
    } catch (e) {
      if (current)
        setState(
          () => error = e is FormatException
              ? e.message
              : 'Operazione non confermata. Puoi verificarla dalla raccolta.',
        );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void choose(LibraryJson v) {
    setState(() {
      selected = v['artifact_id'] as String;
      version = v['version'] as int;
      mode = 'preview';
      error = '';
    });
  }

  Future<void> generate() async {
    final archive = await widget.checkSelection?.call();
    if (!current) return;
    final data = await request.generate(question.text, () => current);
    if (archive != null &&
        (data['documentWorkspaceId'] != archive ||
            await widget.checkSelection?.call() != archive)) {
      throw const ApiError(409, 'CONSULTATION_SELECTION_CHANGED');
    }
    if (!current) return;
    question.clear();
    setState(() {
      generated = data;
      shared = false;
    });
  }

  Future<void> shareGenerated() async {
    final d = generated;
    if (d == null || library.personal || !library.canWrite || shared) return;
    final personal = LibraryCollection(library.api, library.vault);
    await personal.load();
    if (!current || personal.id != d['documentWorkspaceId'] || d != generated)
      return;
    final source = personal.index!.files
        .where(
          (f) => f['id'] == d['documentSourceId'] && f['withdrawn'] != true,
        )
        .firstOrNull;
    if (source == null)
      throw const FormatException('Il file non è più disponibile.');
    await personal.copyTo(
      source,
      library.id!,
      () => current && d == generated && library.canWrite,
    );
    if (current) setState(() => shared = true);
  }

  Future<void> export(
    String title,
    String markdown,
    BuildContext button,
  ) async {
    final render = button.findRenderObject() as RenderBox;
    final anchor = render.localToGlobal(Offset.zero) & render.size;
    await sharePrivateBytes(
      utf8.encode(markdown),
      name: title,
      mimeType: 'text/markdown',
      anchor: anchor,
    );
  }

  void back() {
    if (busy) return;
    if (mode == 'list' || widget.privateSelection != null) {
      Navigator.pop(context);
      return;
    }
    setState(() {
      mode = 'list';
      generated = null;
      error = '';
    });
  }

  Future<void> compose() async {
    if (!library.canWrite || busy || library.commands.pending != null) return;
    final receipt = await Navigator.push<({String id, int version})>(
      context,
      MaterialPageRoute(
        builder: (_) => LibraryDocumentEditor(library: library),
      ),
    );
    if (!current) return;
    await _load();
    if (receipt != null && current) {
      setState(() {
        selected = receipt.id;
        version = receipt.version;
        mode = 'preview';
      });
    }
  }

  Widget list() {
    final docs = currentLibraryDocuments(library.snapshot);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (library.canWrite)
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: busy || library.commands.pending != null
                    ? null
                    : compose,
                icon: const Icon(Icons.post_add_outlined),
                label: Text(uiText(context, 'Nuovo documento')),
              ),
              TextButton.icon(
                onPressed: busy
                    ? null
                    : () => setState(() {
                        mode = 'generate';
                        error = '';
                      }),
                icon: const Icon(Icons.edit_note),
                label: Text(
                  request.pending == null
                      ? uiText(context, 'Chiedi un documento a Emme')
                      : uiText(context, 'Riprendi la richiesta a Emme'),
                ),
              ),
            ],
          ),
        if (docs.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Text(uiText(context, 'Nessun documento di lavoro.')),
          ),
        for (final v in docs)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(v['title'] as String),
            subtitle: Text(
              uiText(context, 'v{0} · {1}', [
                v['version'],
                versionStatus(v, library.snapshot),
              ]),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => choose(v),
          ),
      ],
    );
  }

  Widget preview() {
    final versions =
        libraryRows(library.snapshot['artifactVersions'])
            .where((v) => v['artifact_id'] == selected)
            .toList()
          ..sort(
            (a, b) => (b['version'] as int).compareTo(a['version'] as int),
          );
    final doc = versions.where((v) => v['version'] == version).firstOrNull;
    if (doc == null)
      return Text(uiText(context, 'Questa versione non è disponibile.'));
    final markdown = documentMarkdown(doc);
    final member = libraryRows(library.snapshot['members'])
        .where((m) => m['user_id'] == doc['authored_by'])
        .firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          doc['title'] as String,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        Text(
          [
            'v$version',
            versionStatus(doc, library.snapshot),
            if (member != null) member['name'],
          ].join(' · '),
        ),
        const SizedBox(height: 12),
        if (doc['purpose'] is String && doc['purpose'] != 'Documento di lavoro')
          Text(doc['purpose'] as String),
        SelectableText(markdown.split('\n').skip(2).join('\n').trim()),
        for (final block in libraryRows(
          doc['blocks'],
        ).where((b) => b['type'] == 'image'))
          if (library.index!.files.any(
            (f) => f['id'] == block['sourceId'] && f['withdrawn'] != true,
          ))
            TextButton.icon(
              icon: const Icon(Icons.image_outlined),
              label: Text(uiText(context, 'Apri {0}', [block['alt']])),
              onPressed: () {
                final image = library.index!.files.firstWhere(
                  (f) => f['id'] == block['sourceId'],
                );
                showAttachmentPreview(
                  context,
                  api: library.api,
                  path: library.filePath(image),
                  filename: image['filename'] as String,
                );
              },
            ),
        const SizedBox(height: 12),
        Builder(
          builder: (c) => OutlinedButton.icon(
            onPressed: busy
                ? null
                : () => run(
                    () => export('${doc['title']}-v$version.md', markdown, c),
                  ),
            icon: const Icon(Icons.ios_share),
            label: Text(uiText(c, 'Esporta copia modificabile')),
          ),
        ),
        if (versions.length > 1)
          ExpansionTile(
            title: Text(uiText(context, 'Versioni')),
            children: [
              for (final v in versions)
                ListTile(
                  title: Text(
                    uiText(context, 'v{0} · {1}', [v['version'], v['title']]),
                  ),
                  selected: v['version'] == version,
                  onTap: () => choose(v),
                ),
            ],
          ),
      ],
    );
  }

  Widget generationForm() {
    final result = generated;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (result == null) ...[
          TextField(
            controller: question,
            readOnly: busy || request.pending != null,
            maxLength: 2000,
            minLines: 3,
            maxLines: 7,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: uiText(context, 'Che documento ti serve?'),
            ),
          ),
          Text(
            uiText(
              context,
              'Emme prepara un file Markdown nei tuoi Documenti personali. Puoi condividerlo dopo averlo letto.',
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: busy || !request.allowed || question.text.trim().isEmpty
                ? null
                : () => run(generate),
            child: Text(
              busy
                  ? uiText(context, 'Emme sta scrivendo…')
                  : request.pending == null
                  ? uiText(context, 'Prepara anteprima')
                  : uiText(context, 'Verifica e riprova'),
            ),
          ),
          if (request.pending != null)
            TextButton(
              onPressed: busy
                  ? null
                  : () => run(() async {
                      await request.forget();
                      if (current)
                        setState(() {
                          question.clear();
                        });
                    }),
              child: Text(uiText(context, 'Scrivi un’altra richiesta')),
            ),
        ] else ...[
          Text(uiText(context, 'Salvato in Documenti personali · Solo tu')),
          const SizedBox(height: 12),
          SelectableText(result['answer'] as String),
          if (widget.openArchive != null)
            TextButton.icon(
              onPressed: busy ? null : widget.openArchive,
              icon: const Icon(Icons.folder_open),
              label: Text(uiText(context, 'Apri Documenti personali')),
            ),
          Builder(
            builder: (c) => TextButton.icon(
              onPressed: busy
                  ? null
                  : () => run(
                      () =>
                          export('Documento.md', result['answer'] as String, c),
                    ),
              icon: const Icon(Icons.ios_share),
              label: Text(uiText(c, 'Esporta Markdown')),
            ),
          ),
          if (widget.privateSelection == null &&
              !library.personal &&
              library.canWrite)
            FilledButton(
              onPressed: busy || shared ? null : () => run(shareGenerated),
              child: Text(
                uiText(context, '{0} in {1}', [
                  shared ? 'Condiviso' : 'Condividi',
                  library.title,
                ]),
              ),
            ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: (mode == 'list' || widget.privateSelection != null) && !busy,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop && mode != 'list') back();
    },
    child: Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: busy ? null : back),
        title: Text(
          mode == 'generate'
              ? uiText(context, 'Documento con Emme')
              : mode == 'preview'
              ? uiText(context, 'Anteprima')
              : uiText(context, 'Documenti di lavoro'),
        ),
      ),
      body: SafeArea(
        child: !active
            ? const SizedBox()
            : !ready
            ? Center(
                child: error.isEmpty
                    ? StudioLoading(
                        label: uiText(context, 'Caricamento della fonte…'),
                      )
                    : TextButton(
                        onPressed: _load,
                        child: Text(uiText(context, '{0} Riprova', [error])),
                      ),
              )
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    library.title,
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                  const SizedBox(height: 12),
                  if (error.isNotEmpty)
                    Text(
                      error,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (mode == 'generate')
                    generationForm()
                  else if (mode == 'preview')
                    preview()
                  else
                    list(),
                ],
              ),
      ),
    ),
  );
}
