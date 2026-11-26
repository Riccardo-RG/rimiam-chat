import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'legacy_mobile_data.dart';
import 'ui_language.dart';

/// Metadata probing does not decrypt the old draft. Opening the panel verifies
/// the current server account and space before reading the scoped archive.
class LegacyRecoveryPanel extends StatefulWidget {
  LegacyRecoveryPanel({
    required this.api,
    required this.scope,
    required this.vault,
    this.journal,
    this.onPersonalDraft,
    required this.allowed,
    super.key,
  });
  final RimiamApi api;
  final LegacyScope scope;
  final DraftVault vault;
  final ChatJournal? journal;
  final Future<void> Function(String id, String text)? onPersonalDraft;
  final bool Function() allowed;
  @override
  State<LegacyRecoveryPanel> createState() => _Panel();
}

class _Panel extends State<LegacyRecoveryPanel> {
  late LegacyMobileData data;
  bool show = false;
  @override
  void initState() {
    super.initState();
    probe();
  }

  @override
  void didUpdateWidget(LegacyRecoveryPanel old) {
    super.didUpdateWidget(old);
    if (widget.api != old.api ||
        widget.api.actorId != data.actor ||
        widget.scope.id != old.scope.id ||
        widget.scope.kind != old.scope.kind)
      probe();
  }

  void probe() {
    final next = LegacyMobileData(widget.api, widget.scope, widget.vault);
    data = next;
    show = false;
    unawaited(
      next
          .available()
          .then((found) {
            if (mounted && identical(data, next) && found && widget.allowed())
              setState(() => show = true);
          })
          .catchError((Object _) {
            /* Retain unreadable originals for a later unlock. */
          }),
    );
  }

  @override
  Widget build(BuildContext context) => !show || !widget.allowed()
      ? const SizedBox.shrink()
      : Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            icon: const Icon(Icons.restore, size: 18),
            label: Text(uiText(context, 'Recupera dalla versione precedente')),
            onPressed: () {
              final dataAtOpen = data;
              Navigator.of(context).push<void>(
                MaterialPageRoute(
                  builder: (_) => _Recovery(
                    data: dataAtOpen,
                    journal: widget.journal,
                    onPersonalDraft: widget.onPersonalDraft,
                    allowed: () =>
                        mounted &&
                        identical(dataAtOpen, data) &&
                        widget.allowed() &&
                        widget.api.actorId == data.actor,
                  ),
                ),
              );
            },
          ),
        );
}

class _Recovery extends StatefulWidget {
  const _Recovery({
    required this.data,
    required this.journal,
    required this.onPersonalDraft,
    required this.allowed,
  });
  final LegacyMobileData data;
  final ChatJournal? journal;
  final Future<void> Function(String, String)? onPersonalDraft;
  final bool Function() allowed;
  @override
  State<_Recovery> createState() => _RecoveryState();
}

class _RecoveryState extends State<_Recovery> with WidgetsBindingObserver {
  LegacyJson? archive;
  final receipts = <String, bool>{};
  String error = '';
  bool busy = false;
  int epoch = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      load();
    } else {
      epoch++;
      if (mounted)
        setState(() {
          archive = null;
          receipts.clear();
          busy = false;
        });
    }
  }

  Future<void> load() async {
    final ticket = ++epoch;
    if (mounted)
      setState(() {
        archive = null;
        error = '';
        busy = false;
      });
    try {
      if (!widget.allowed()) throw const ApiError(403, 'ACCESS_CHANGED');
      final found = await widget.data.recover();
      if (mounted && ticket == epoch && widget.allowed())
        setState(() => archive = found);
    } catch (_) {
      if (mounted && ticket == epoch)
        setState(
          () => error =
              'Recupero non disponibile. Verifica accesso e connessione.',
        );
    }
  }

  Future<void> action(Future<void> Function(int) run) async {
    final ticket = epoch;
    if (busy || !widget.allowed()) return;
    setState(() {
      busy = true;
      error = '';
    });
    try {
      await run(ticket);
    } on FormatException catch (e) {
      if (mounted && ticket == epoch) setState(() => error = e.message);
    } catch (_) {
      if (mounted && ticket == epoch) {
        setState(() {
          archive = null;
          error = 'Recupero non disponibile. Verifica accesso e connessione.';
        });
      }
    } finally {
      if (mounted && ticket == epoch) setState(() => busy = false);
    }
  }

  bool valid(int ticket) => mounted && ticket == epoch && widget.allowed();
  Future<void> restore(
    LegacyJson data,
    bool stripContext, {
    bool skipMissing = false,
  }) => action((ticket) async {
    if (widget.journal case final journal?) {
      await widget.data.restoreChat(
        data,
        journal,
        allowed: () => valid(ticket),
        stripContext: stripContext,
        skipMissing: skipMissing,
      );
    } else {
      await widget.data.authorize(forWriting: true);
      if (!valid(ticket) || LegacyMobileData.tiedToSend(data)) return;
      final entry = data['draft'];
      await widget.onPersonalDraft!(
        entry['id'] as String,
        entry['intent']['text'] as String,
      );
    }
    if (valid(ticket)) Navigator.pop(context);
  });
  Iterable<Widget> files(LegacyJson data, LegacyJson intent) sync* {
    for (final f in LegacyMobileData.attachmentRefs(intent)) {
      final key = LegacyMobileData.fileKey(f),
          available = data['files']?[key] != null;
      yield ListTile(
        leading: Icon(available ? Icons.attachment : Icons.link_off),
        title: Text(f['filename'] as String),
        subtitle: !available
            ? Text(
                uiText(
                  context,
                  (data['missing']?[key] as String?) ??
                      'File originale non disponibile',
                ),
              )
            : null,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.allowed() ? archive : null;
    final draft = data?['draft']?['intent'] as LegacyJson?;
    final missing =
        draft != null &&
        LegacyMobileData.attachmentRefs(draft)
            .any((f) => data?['files']?[LegacyMobileData.fileKey(f)] == null);
    final label = Theme.of(context).textTheme.titleMedium;
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Recupero dal dispositivo'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (data == null && error.isEmpty) const LinearProgressIndicator(),
            if (error.isNotEmpty) ...[
              Text(uiText(context, error)),
              if (data == null)
                TextButton(
                  onPressed: load,
                  child: Text(uiText(context, 'Riprova')),
                ),
            ],
            if (draft != null && data != null) ...[
              Text(uiText(context, 'Bozza precedente'), style: label),
              if (draft['text'] is String)
                SelectableText(draft['text'] as String),
              ...files(data, draft),
              if (draft['topic']?['title'] is String)
                Text(
                  uiText(context, 'Argomento · {0}', [draft['topic']['title']]),
                ),
              if (draft['fileReference']?['name'] is String)
                Text(
                  uiText(context, 'File citato · {0}', [
                    draft['fileReference']['name'],
                  ]),
                ),
              if (draft['quoteId'] != null)
                Text(uiText(context, 'Contiene una citazione')),
              if ((draft['mentionIds'] as List? ?? []).isNotEmpty)
                Text(uiText(context, 'Contiene menzioni')),
              if (draft['ask'] == true) Text(uiText(context, 'Domanda a Emme')),
              if (LegacyMobileData.tiedToSend(data))
                Text(
                  uiText(
                    context,
                    'Bozza collegata a un invio. Verifica la ricevuta qui sotto.',
                  ),
                )
              else if (widget.journal?.importedLegacyId == data['draft']['id'])
                Text(uiText(context, 'Bozza già ripresa'))
              else if (widget.journal != null &&
                  !widget.journal!.acceptsLegacyDraft)
                Text(
                  uiText(context, 'Hai già una bozza nel campo di scrittura.'),
                )
              else if (widget.journal != null &&
                  missing &&
                  draft['topic'] == null)
                FilledButton(
                  onPressed: busy
                      ? null
                      : () => restore(data, false, skipMissing: true),
                  child: Text(
                    uiText(context, 'Riprendi senza i file mancanti'),
                  ),
                )
              else if (widget.journal != null && draft['topic'] == null ||
                  widget.onPersonalDraft != null &&
                      LegacyMobileData.attachmentRefs(draft).isEmpty)
                FilledButton(
                  onPressed: busy ? null : () => restore(data, false),
                  child: Text(
                    uiText(context, 'Riprendi nel campo di scrittura'),
                  ),
                ),
              if (!LegacyMobileData.tiedToSend(data) &&
                  widget.journal?.acceptsLegacyDraft == true &&
                  widget.journal?.importedLegacyId != data['draft']['id'] &&
                  (draft['topic'] != null ||
                      error.isNotEmpty &&
                          (draft['fileReference'] != null ||
                              draft['quoteId'] != null ||
                              (draft['mentionIds'] as List? ?? []).isNotEmpty)))
                OutlinedButton(
                  onPressed: busy
                      ? null
                      : () => restore(data, true, skipMissing: missing),
                  child: Text(
                    uiText(
                      context,
                      missing
                          ? 'Riprendi testo e file disponibili'
                          : 'Riprendi solo testo e allegati',
                    ),
                  ),
                ),
            ],
            if (data != null)
              for (final key in ['pending', 'callExit'])
                if (data[key] case final LegacyJson record) ...[
                  const Divider(),
                  Text(uiText(context, 'Invio precedente'), style: label),
                  Text(
                    record['intent']['label'] as String? ??
                        uiText(context, 'Operazione da verificare'),
                  ),
                  if (record['intent']['command']?['content'] ??
                          record['intent']['text'] ??
                          record['intent']['question'] ??
                          record['intent']['creation']?['name']
                      case final String text)
                    SelectableText(text),
                  ...files(data, record['intent'] as LegacyJson),
                  if (receipts[record['id']] case final bool found)
                    Text(
                      uiText(
                        context,
                        found
                            ? 'Invio confermato'
                            : 'Conferma non trovata. Nessun invio ripetuto.',
                      ),
                    ),
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => action((ticket) async {
                            final found = await widget.data.committed(record);
                            if (valid(ticket))
                              setState(
                                () => receipts[record['id'] as String] = found,
                              );
                          }),
                    child: Text(uiText(context, 'Verifica ricevuta')),
                  ),
                ],
            if (data != null &&
                data['draft'] == null &&
                data['pending'] == null &&
                data['callExit'] == null)
              Text(uiText(context, 'Nessun elemento da recuperare.')),
          ],
        ),
      ),
    );
  }
}
