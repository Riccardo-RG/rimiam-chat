part of 'file_library.dart';

class _LibraryTextEditor extends StatefulWidget {
  const _LibraryTextEditor({
    required this.note,
    required this.personal,
    required this.destination,
    required this.save,
    required this.awaitingConfirmation,
  });
  final bool note, personal;
  final String destination;
  final Future<String> Function(String body) save;
  final bool Function() awaitingConfirmation;
  @override
  State<_LibraryTextEditor> createState() => _LibraryTextEditorState();
}

class _LibraryTextEditorState extends State<_LibraryTextEditor> {
  final editor = TextEditingController();
  bool busy = false;
  String error = '';
  Future<void> _save() async {
    if (busy || widget.awaitingConfirmation()) return;
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final result = await widget.save(editor.text);
      if (mounted) Navigator.pop(context, result);
    } catch (e) {
      if (mounted)
        setState(
          () => error = widget.awaitingConfirmation()
              ? 'Il contenuto è conservato. Torna alla raccolta per verificare l’invio.'
              : e is FormatException
              ? e.message
              : e is AttachmentProblem
              ? e.message
              : 'Il salvataggio non è riuscito. Il testo è ancora qui.',
        );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    editor.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final body = editor.text;
    final valid = widget.note
        ? body.trim().isNotEmpty &&
              body.length <= 200000 &&
              !body.contains('\u0000')
        : publicLibraryPage(body.trim()) != null &&
              body.trim().length + 20 <= 12000;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.note
              ? uiText(context, 'Nuova nota')
              : uiText(context, 'Aggiungi link'),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextField(
              controller: editor,
              autofocus: true,
              readOnly: busy || widget.awaitingConfirmation(),
              keyboardType: widget.note
                  ? TextInputType.multiline
                  : TextInputType.url,
              minLines: widget.note ? 4 : 1,
              maxLines: widget.note ? 12 : 3,
              maxLength: widget.note ? 200000 : 12000,
              decoration: InputDecoration(
                labelText: widget.note
                    ? uiText(context, 'Testo della nota')
                    : uiText(context, 'Indirizzo della pagina'),
                helperText: !widget.note && body.trim().isNotEmpty && !valid
                    ? uiText(
                        context,
                        'Inserisci un link pubblico senza credenziali o inviti.',
                      )
                    : null,
                helperMaxLines: 3,
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            Text(
              widget.personal
                  ? uiText(context, 'Visibile solo a te.')
                  : uiText(
                      context,
                      'Visibile nella chat ai membri attuali e futuri di {0}.',
                      [widget.destination],
                    ),
            ),
            const SizedBox(height: 12),
            if (error.isNotEmpty) Text(uiText(context, error)),
            FilledButton(
              onPressed: valid && !busy && !widget.awaitingConfirmation()
                  ? _save
                  : null,
              child: Text(
                widget.personal
                    ? uiText(context, 'Salva in Documenti personali')
                    : uiText(context, 'Condividi in {0}', [widget.destination]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CopyDestination extends StatefulWidget {
  const _CopyDestination({required this.targets, this.preferred});
  final List<LibraryJson> targets;
  final String? preferred;
  @override
  State<_CopyDestination> createState() => _CopyDestinationState();
}

class _CopyDestinationState extends State<_CopyDestination> {
  late LibraryJson? selection;
  @override
  void initState() {
    super.initState();
    selection = widget.targets
        .where((t) => t['id'] == widget.preferred)
        .firstOrNull;
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(uiText(context, 'Condividi una copia')),
    content: SingleChildScrollView(
      child: DropdownButton<String>(
        isExpanded: true,
        hint: Text(uiText(context, 'Scegli lo spazio')),
        value: selection?['id'] as String?,
        items: [
          for (final target in widget.targets)
            DropdownMenuItem(
              value: target['id'] as String,
              child: Text(
                target['name'] as String,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
        onChanged: (id) => setState(
          () => selection = widget.targets.firstWhere((t) => t['id'] == id),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(uiText(context, 'Annulla')),
      ),
      FilledButton(
        onPressed: selection == null
            ? null
            : () => Navigator.pop(context, selection),
        child: Text(
          selection == null
              ? uiText(context, 'Condividi')
              : uiText(context, 'Condividi in {0}', [selection!['name']]),
        ),
      ),
    ],
  );
}

class _Filters extends StatefulWidget {
  const _Filters({required this.type, required this.period, this.range});
  final String type, period;
  final DateTimeRange? range;
  @override
  State<_Filters> createState() => _FiltersState();
}

class _FiltersState extends State<_Filters> {
  late String type, period;
  DateTimeRange? range;
  @override
  void initState() {
    super.initState();
    type = widget.type;
    period = widget.period;
    range = widget.range;
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            uiText(context, 'Filtri'),
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: type,
            isExpanded: true,
            decoration: InputDecoration(labelText: uiText(context, 'Tipo')),
            items: [
              for (final t in collectionTypes)
                DropdownMenuItem(value: t, child: Text(t)),
            ],
            onChanged: (v) => setState(() => type = v!),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: period,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: uiText(context, 'Data di condivisione'),
            ),
            items: [
              for (final p in [
                'Tutto il periodo',
                'Ultimi 7 giorni',
                'Ultimi 30 giorni',
                'Intervallo',
              ])
                DropdownMenuItem(value: p, child: Text(p)),
            ],
            onChanged: (v) => setState(() => period = v!),
          ),
          if (period == 'Intervallo')
            TextButton.icon(
              icon: const Icon(Icons.date_range),
              label: Text(
                range == null
                    ? uiText(context, 'Scegli le date')
                    : '${MaterialLocalizations.of(context).formatShortDate(range!.start)} – ${MaterialLocalizations.of(context).formatShortDate(range!.end)}',
              ),
              onPressed: () async {
                final value = await showDateRangePicker(
                  context: context,
                  firstDate: DateTime(1970),
                  lastDate: DateTime(DateTime.now().year + 1, 12, 31),
                  initialDateRange: range,
                );
                if (mounted && value != null) setState(() => range = value);
              },
            ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: period == 'Intervallo' && range == null
                ? null
                : () => Navigator.pop(context, (
                    type: type,
                    period: period,
                    range: range,
                  )),
            child: Text(uiText(context, 'Applica filtri')),
          ),
        ],
      ),
    ),
  );
}
