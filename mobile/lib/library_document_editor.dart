import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'library_collection.dart';
import 'library_documents.dart';
import 'library_entries.dart';

class LibraryDocumentEditor extends StatefulWidget {
  const LibraryDocumentEditor({
    super.key,
    required this.library,
    this.initialTitle,
    this.initialPurpose,
    this.initialText,
    this.sourceIds = const [],
    this.send,
  });
  final String? initialTitle, initialPurpose, initialText;
  final List<String> sourceIds;
  final Future<LibraryJson> Function(LibraryJson)? send;
  final LibraryCollection library;
  @override
  State<LibraryDocumentEditor> createState() => _EditorState();
}

class _EditorState extends State<LibraryDocumentEditor>
    with WidgetsBindingObserver {
  late final title = TextEditingController(text: widget.initialTitle),
      purpose = TextEditingController(text: widget.initialPurpose),
      content = TextEditingController(text: widget.initialText);
  final blocks = <LibraryJson>[];
  String type = 'paragraph', error = '';
  String? source;
  bool busy = false, closing = false, active = true;
  bool get dirty =>
      title.text.isNotEmpty ||
      purpose.text.isNotEmpty ||
      content.text.isNotEmpty ||
      blocks.isNotEmpty;
  bool get writable =>
      active &&
      widget.library.ready &&
      widget.library.canWrite &&
      widget.library.api.actorId == widget.library.actor;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    title.dispose();
    purpose.dispose();
    content.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.hidden ||
        state == AppLifecycleState.paused) {
      setState(() => active = false);
    } else if (state == AppLifecycleState.resumed && !active) {
      _recheck();
    }
  }

  Future<void> _recheck() async {
    try {
      await widget.library.load();
      if (mounted) setState(() => active = true);
    } catch (_) {
      if (mounted)
        setState(() => error = 'Accesso al documento non disponibile.');
    }
  }

  LibraryJson? block() {
    if (content.text.trim().isEmpty) return null;
    return documentBlock(type, content.text, source: source);
  }

  void add() {
    try {
      final draft = block();
      if (draft == null) return;
      if (blocks.length >= 100)
        throw const FormatException('Puoi aggiungere fino a 100 blocchi.');
      setState(() {
        blocks.add(draft);
        content.clear();
        source = null;
        type = 'paragraph';
        error = '';
      });
    } on FormatException catch (e) {
      setState(() => error = e.message);
    }
  }

  Future<void> close() async {
    if (busy || closing) return;
    final leave =
        !dirty ||
        await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: Text(uiText(c, 'Scartare la bozza?')),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(c, false),
                    child: Text(uiText(c, 'Continua a scrivere')),
                  ),
                  TextButton(
                    onPressed: () => Navigator.pop(c, true),
                    child: Text(uiText(c, 'Scarta bozza')),
                  ),
                ],
              ),
            ) ==
            true;
    if (leave && mounted) {
      setState(() => closing = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.pop(context);
      });
    }
  }

  Future<void> save() async {
    if (busy ||
        !writable ||
        widget.library.commands.pending != null ||
        title.text.trim().isEmpty)
      return;
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final draft = block();
      final items = [...blocks, ?draft];
      if (items.isEmpty || items.length > 100)
        throw const FormatException('Inserisci da 1 a 100 blocchi.');
      final result = await composeDocument(
        widget.library,
        title.text,
        purpose.text,
        items,
        () => mounted && writable,
        sourceIds: widget.sourceIds,
        send: widget.send,
      );
      if (mounted) {
        setState(() => closing = true);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) Navigator.pop(context, result);
        });
      }
    } catch (e) {
      if (mounted)
        setState(
          () => error = e is FormatException
              ? e.message
              : widget.library.commands.pending != null
              ? 'Conferma in sospeso. Torna alla raccolta e verifica il salvataggio.'
              : e is ApiError
              ? 'Salvataggio rifiutato. Controlla contenuto e permessi.'
              : 'Impossibile salvare il documento.',
        );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final images =
        widget.library.index?.filter(tab: 'Media') ?? <LibraryEntry>[];
    final edit = writable && !busy && widget.library.commands.pending == null;
    return PopScope(
      canPop: closing || (!dirty && !busy),
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) close();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: BackButton(onPressed: close),
          title: Text(uiText(context, 'Nuovo documento')),
        ),
        body: SafeArea(
          child: !active
              ? Center(
                  child: TextButton(
                    onPressed: _recheck,
                    child: Text(uiText(context, 'Verifica accesso')),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(
                      uiText(
                        context,
                        'Destinazione · {0} › Documenti di lavoro',
                        [widget.library.title],
                      ),
                    ),
                    TextField(
                      controller: title,
                      enabled: edit,
                      maxLength: 160,
                      decoration: InputDecoration(
                        labelText: uiText(context, 'Titolo'),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    TextField(
                      controller: purpose,
                      enabled: edit,
                      maxLength: 2000,
                      decoration: InputDecoration(
                        labelText: uiText(context, 'Scopo (facoltativo)'),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    for (var i = 0; i < blocks.length; i++)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(documentBlockLabels[blocks[i]['type']]!),
                        subtitle: Text(
                          documentBlockText(blocks[i]),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: IconButton(
                          tooltip: uiText(context, 'Rimuovi blocco {0}', [
                            i + 1,
                          ]),
                          icon: const Icon(Icons.remove_circle_outline),
                          onPressed: edit
                              ? () => setState(() => blocks.removeAt(i))
                              : null,
                        ),
                      ),
                    DropdownButtonFormField<String>(
                      initialValue: type,
                      decoration: InputDecoration(
                        labelText: uiText(context, 'Tipo di blocco'),
                      ),
                      items: [
                        for (final e in documentBlockLabels.entries)
                          DropdownMenuItem(value: e.key, child: Text(e.value)),
                      ],
                      onChanged: edit
                          ? (t) => setState(() {
                              type = t!;
                              source = null;
                              error = '';
                            })
                          : null,
                    ),
                    if (type == 'image')
                      DropdownButtonFormField<String>(
                        initialValue: images.any((f) => f.file?['id'] == source)
                            ? source
                            : null,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: uiText(context, 'Foto della raccolta'),
                        ),
                        items: [
                          for (final entry in images)
                            DropdownMenuItem(
                              value: entry.file!['id'] as String,
                              child: Text(
                                entry.title,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: edit
                            ? (v) => setState(() => source = v)
                            : null,
                      ),
                    TextField(
                      controller: content,
                      enabled: edit,
                      minLines: 3,
                      maxLines: 12,
                      maxLength: 24000,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        labelText: switch (type) {
                          'checklist' => 'Una voce per riga',
                          'image' => 'Descrizione della foto',
                          'table' => 'Righe con colonne separate da |',
                          _ => 'Testo del blocco',
                        },
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: edit && content.text.trim().isNotEmpty
                            ? add
                            : null,
                        icon: const Icon(Icons.add),
                        label: Text(uiText(context, 'Aggiungi altro blocco')),
                      ),
                    ),
                    if (error.isNotEmpty)
                      Text(
                        error,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    FilledButton(
                      onPressed:
                          edit &&
                              title.text.trim().isNotEmpty &&
                              (blocks.isNotEmpty ||
                                  content.text.trim().isNotEmpty)
                          ? save
                          : null,
                      child: Text(
                        uiText(context, 'Salva in {0}', [widget.library.title]),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
