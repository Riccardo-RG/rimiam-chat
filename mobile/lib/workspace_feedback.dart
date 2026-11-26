import 'ui_language.dart';

import 'dart:convert';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'assistant_instruction_export.dart';
import 'chat_journal.dart';
import 'workspace_governance.dart';

class WorkspaceFeedbackPage extends StatefulWidget {
  const WorkspaceFeedbackPage({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.vault,
    this.initialText = '',
    this.messageId,
    this.fromComposer = false,
  });
  final RimiamApi api;
  final String workspaceId, initialText;
  final String? messageId;
  final bool fromComposer;
  final DraftVault vault;
  @override
  State<WorkspaceFeedbackPage> createState() => _FeedbackState();
}

class _FeedbackState extends State<WorkspaceFeedbackPage>
    with WidgetsBindingObserver {
  late final group = GroupGovernance(
    widget.api,
    widget.workspaceId,
    direction: false,
    vault: widget.vault,
    journalName: 'beta-feedback',
  );
  late final draft = TextEditingController(text: widget.initialText);
  GroupRecord? notes, usage;
  String? error;
  int? days;
  bool busy = false, paused = false;
  int generation = 0;
  final exportKey = GlobalKey();
  bool get current =>
      mounted && !paused && group.admitted && widget.api.actorId == group.actor;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    draft.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!paused &&
        (state == AppLifecycleState.paused ||
            state == AppLifecycleState.hidden)) {
      setState(() {
        paused = true;
        generation++;
        group.suspend();
        notes = null;
        usage = null;
        error = null;
      });
    } else if (paused && state == AppLifecycleState.resumed) {
      paused = false;
      load();
    }
  }

  Future<void> load() async {
    final gen = ++generation;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await group.load();
      if (!current || gen != generation) return;
      final results = await read();
      if (current && gen == generation)
        setState(() {
          notes = results.notes;
          usage = results.usage;
        });
    } catch (e) {
      if (mounted && gen == generation)
        setState(() {
          notes = null;
          usage = null;
          error = groupIssue(e);
        });
    } finally {
      if (mounted && gen == generation) setState(() => busy = false);
    }
  }

  Future<({GroupRecord notes, GroupRecord? usage})> read() async {
    final period = days;
    final reports = await Future.wait([
      widget.api.get('${group.path}/beta-feedback'),
      if (period != null) widget.api.get('${group.path}/ai-usage?days=$period'),
    ]);
    if (reports.any((r) => r['workspaceId'] != group.workspaceId))
      throw const FormatException('Spazio inatteso');
    group.check();
    return (notes: reports.first, usage: period == null ? null : reports.last);
  }

  Future<void> submit() async {
    if (busy || !current || !group.canWrite) return;
    final gen = generation;
    final pending = group.journal.pending;
    final submitted = draft.text.trim();
    if (submitted.isEmpty && pending == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await group.send(
        pending == null
            ? {
                'type': 'beta.feedback.add',
                'content': submitted,
                if (widget.messageId != null) 'messageId': widget.messageId,
              }
            : pending['command'] as GroupRecord,
      );
      if (!current || gen != generation) return;
      if (draft.text.trim() == (pending?['command']?['content'] ?? submitted))
        draft.clear();
      if (widget.fromComposer) {
        Navigator.pop(context, true);
        return;
      }
      await load();
    } catch (e) {
      if (mounted && gen == generation) setState(() => error = groupIssue(e));
    } finally {
      if (mounted && gen == generation) setState(() => busy = false);
    }
  }

  Future<void> export() async {
    if (busy || !current || notes == null) return;
    final gen = generation;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final results = await read();
      if (!current || gen != generation) return;
      final box = exportKey.currentContext?.findRenderObject() as RenderBox?;
      if (box == null || !box.hasSize) return;
      final report =
          StringBuffer('# ${uiText(context, 'Feedback beta RIMIAM')}\n\n')
            ..writeln(
              uiText(
                context,
                'Osservazioni dei partecipanti. Il report include solo i messaggi citati esplicitamente.',
              ),
            )
            ..writeln();
      void section(String title, Object data) {
        final text = const JsonEncoder.withIndent('  ').convert(data);
        var length = 3;
        for (final run in RegExp(r'`+').allMatches(text)) {
          if (run.end - run.start >= length) length = run.end - run.start + 1;
        }
        final fence = List.filled(length, '`').join();
        report
          ..writeln('## $title')
          ..writeln()
          ..writeln('${fence}json')
          ..writeln(text)
          ..writeln(fence)
          ..writeln();
      }

      section(
        uiText(context, 'Note e configurazione al momento della segnalazione'),
        results.notes,
      );
      if (results.usage != null) {
        report.writeln(
          uiText(
            context,
            'La stima in USD riguarda soltanto i tentativi AI misurati con tariffa disponibile. I valori mancanti restano sconosciuti.',
          ),
        );
        section(uiText(context, 'Consumi stimati'), results.usage!);
      }
      await sharePrivateBytes(
        utf8.encode(report.toString()),
        name:
            'RIMIAM-feedback-${(results.notes['generatedAt'] as String).split('T').first}.md',
        mimeType: 'text/markdown',
        anchor: box.localToGlobal(Offset.zero) & box.size,
      );
    } catch (e) {
      if (mounted && gen == generation) setState(() => error = groupIssue(e));
    } finally {
      if (mounted && gen == generation) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final entries = groupRows(notes?['entries']),
        pending = group.journal.pending;
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Feedback beta'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (busy) const LinearProgressIndicator(),
            if (error != null)
              ListTile(
                title: Text(uiText(context, error!)),
                trailing: TextButton(
                  onPressed: busy ? null : load,
                  child: Text(uiText(context, 'Riprova')),
                ),
              ),
            if (current && notes != null) ...[
              if (group.canWrite) ...[
                TextField(
                  controller: draft,
                  minLines: 2,
                  maxLines: 5,
                  maxLength: 6000,
                  enabled: !busy && pending == null,
                  decoration: InputDecoration(
                    labelText: uiText(context, 'Cosa hai notato?'),
                  ),
                ),
                if (widget.messageId != null)
                  Text(
                    uiText(
                      context,
                      'Il feedback includerà il messaggio citato.',
                    ),
                  ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton.tonal(
                    onPressed: busy ? null : submit,
                    child: Text(
                      pending != null
                          ? uiText(context, 'Verifica salvataggio')
                          : uiText(context, 'Salva feedback nello spazio'),
                    ),
                  ),
                ),
              ],
              if (entries.isEmpty)
                ListTile(
                  title: Text(uiText(context, 'Ancora nessun feedback.')),
                ),
              for (final entry in entries.reversed)
                ExpansionTile(
                  title: Text(entry['content'] as String),
                  subtitle: Text(
                    "${entry['authorName']} · ${groupDate(context, entry['createdAt'])}",
                  ),
                  children: [
                    if (entry['message'] != null)
                      ListTile(
                        title: Text(entry['message']['content'] as String),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () =>
                            Navigator.pop(context, entry['message']['id']),
                      ),
                    ListTile(
                      title: Text(
                        uiText(context, 'Modello al momento del feedback'),
                      ),
                      subtitle: Text(
                        entry['configurationAtCapture']['model'] as String? ??
                            uiText(context, 'Non configurato'),
                      ),
                    ),
                  ],
                ),
              const Divider(),
              SwitchListTile(
                title: Text(uiText(context, 'Includi consumi AI stimati')),
                value: days != null,
                onChanged: busy
                    ? null
                    : (v) {
                        days = v ? 30 : null;
                        load();
                      },
              ),
              if (days != null) ...[
                Wrap(
                  spacing: 8,
                  children: [
                    for (final period in [7, 30])
                      ChoiceChip(
                        label: Text(uiText(context, '{0} giorni', [period])),
                        selected: days == period,
                        onSelected: busy
                            ? null
                            : (_) {
                                days = period;
                                load();
                              },
                      ),
                  ],
                ),
                if (groupRows(usage?['groups']).isEmpty)
                  ListTile(
                    title: Text(
                      uiText(context, 'Nessun consumo misurato nel periodo.'),
                    ),
                  ),
                for (final item in groupRows(usage?['groups']))
                  ListTile(
                    title: Text(
                      uiText(context, '{0} · {1} tentativi', [
                        item['model'],
                        item['attempts'],
                      ]),
                    ),
                    subtitle: Text(
                      item['estimatedSubtotalUsd'] == null
                          ? uiText(context, 'Stima non disponibile')
                          : uiText(context, 'Subtotale stimato · USD {0}', [
                              item['estimatedSubtotalUsd'],
                            ]),
                    ),
                  ),
              ],
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: exportKey,
                  icon: const Icon(Icons.ios_share),
                  onPressed: busy ? null : export,
                  label: Text(uiText(context, 'Esporta report (.md)')),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
