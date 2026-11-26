import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'agenda_commands.dart' show agendaLocalZone;
import 'api.dart';
import 'chat_journal.dart';
import 'workspace_governance.dart';

class TopicConversationPage extends StatefulWidget {
  const TopicConversationPage({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.topicId,
    required this.vault,
  });
  final RimiamApi api;
  final String workspaceId, topicId;
  final DraftVault vault;
  @override
  State<TopicConversationPage> createState() => _TopicState();
}

class _TopicState extends State<TopicConversationPage>
    with WidgetsBindingObserver {
  late final group = GroupGovernance(
    widget.api,
    widget.workspaceId,
    direction: false,
    vault: widget.vault,
    journalName: 'topic-chat-${widget.topicId}',
  );
  final editor = TextEditingController();
  List<GroupRecord> messages = [];
  GroupRecord? topic;
  int? older, through, draftVersion;
  int generation = 0;
  bool busy = false, paused = false;
  String? error, timeZone;
  bool get current =>
      mounted && !paused && group.admitted && group.actor == widget.api.actorId;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(readTimeZone());
    load();
  }

  Future<void> readTimeZone() async {
    try {
      final zone = await agendaLocalZone();
      if (mounted) timeZone = zone;
    } catch (_) {
      // Sending a conversation message does not require a device time zone.
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    editor.dispose();
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
        messages = [];
        topic = null;
        editor.clear();
      });
    } else if (paused && state == AppLifecycleState.resumed) {
      paused = false;
      load();
    }
  }

  Future<void> load({bool previous = false}) async {
    final gen = ++generation;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await group.load();
      if (!current || gen != generation) return;
      final view = await widget.api.get('${group.path}/attention?limit=30');
      if (!current || gen != generation) return;
      final nextTopic = groupRows(view['workstreams'])
          .where((s) => s['id'] == widget.topicId)
          .firstOrNull;
      if (nextTopic == null) throw const ApiError(404, 'WORKSTREAM_NOT_FOUND');
      final tail = groupRows(group.snapshot['messages']).fold<int>(
        0,
        (n, s) => n > (s['sequence'] as int) ? n : s['sequence'] as int,
      );
      final query = Uri(
        queryParameters: {
          'limit': '30',
          'workstreamId': widget.topicId,
          'through': (previous ? through ?? tail : tail).toString(),
          if (previous && older != null) 'before': older.toString(),
        },
      );
      final page = await widget.api.get('${group.path}/history?${query.query}');
      if (!current || gen != generation) return;
      final items = groupRows(page['messages']);
      final merged =
          {
            for (final m in [...items, if (previous) ...messages]) m['id']: m,
          }.values.toList()..sort(
            (a, b) => (a['sequence'] as int).compareTo(b['sequence'] as int),
          );
      final stored = group.journal.draft;
      setState(() {
        topic = nextTopic;
        messages = merged;
        through = page['through'] as int;
        older = page['hasMore'] == true ? page['nextBefore'] as int : null;
        draftVersion = stored?['version'] as int?;
        final text = stored?['text'] as String? ?? '';
        if (editor.text != text)
          editor.value = TextEditingValue(
            text: text,
            selection: TextSelection.collapsed(offset: text.length),
          );
      });
    } catch (e) {
      if (mounted && gen == generation)
        setState(() {
          error = groupIssue(e);
          if (groupDenied(e)) {
            group.suspend();
            messages = [];
            topic = null;
            editor.clear();
          }
        });
    } finally {
      if (mounted && gen == generation) setState(() => busy = false);
    }
  }

  Future<void> edit(String text, {bool renew = false}) async {
    if (!current || group.journal.pending != null || topic == null) return;
    final gen = generation;
    setState(
      () => draftVersion = text.isEmpty
          ? null
          : renew
          ? topic!['version'] as int
          : draftVersion ?? topic!['version'] as int,
    );
    group.journal.draft = text.isEmpty
        ? null
        : {'text': text, 'version': draftVersion};
    try {
      await group.journal.store();
    } catch (e) {
      if (current && gen == generation)
        setState(() => error = 'Bozza non salvata sul dispositivo.');
    }
  }

  Future<void> submit({bool ask = false}) async {
    if (!current || busy || !group.canWrite || topic == null) return;
    final pending = group.journal.pending, gen = generation;
    final text = editor.text.trim();
    if (pending == null &&
        (topic!['state'] != 'active' ||
            text.isEmpty ||
            draftVersion != topic!['version']))
      return;
    final addressed =
        ask && !RegExp(r'^@Emme\b', caseSensitive: false).hasMatch(text)
        ? '@Emme $text'
        : text;
    if (pending == null && addressed.length > 12000) {
      setState(() => error = 'Il messaggio supera i 12.000 caratteri.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final command =
          pending?['command'] as GroupRecord? ??
          {
            'type': 'message.send',
            'content': addressed,
            'workstreamFocus': {
              'workstreamId': widget.topicId,
              'version': draftVersion,
            },
            if (timeZone != null) 'clientTimeZone': timeZone,
          };
      if (!current || gen != generation) return;
      await group.send(command, fromEditor: true);
      if (current && gen == generation) {
        editor.clear();
        draftVersion = null;
        await load();
      }
    } catch (e) {
      if (current && gen == generation) {
        setState(() => error = groupIssue(e));
      }
    } finally {
      if (mounted && gen == generation) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = group.journal.pending != null;
    final stale = draftVersion != null && draftVersion != topic?['version'];
    return Scaffold(
      appBar: AppBar(
        title: Text(
          topic?['title'] as String? ??
              uiText(context, 'Conversazione sull’argomento'),
        ),
        actions: [
          IconButton(
            tooltip: uiText(context, 'Aggiorna'),
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (busy) const LinearProgressIndicator(),
            if (error != null)
              ListTile(
                title: Text(uiText(context, error!)),
                trailing: TextButton(
                  onPressed: busy ? null : load,
                  child: Text(uiText(context, 'Ricarica')),
                ),
              ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  if (current && older != null)
                    TextButton(
                      onPressed: busy ? null : () => load(previous: true),
                      child: Text(uiText(context, 'Messaggi precedenti')),
                    ),
                  if (current && topic != null && messages.isEmpty)
                    ListTile(
                      title: Text(
                        uiText(
                          context,
                          'Nessun messaggio in questo argomento.',
                        ),
                      ),
                    ),
                  if (current)
                    for (final m in messages)
                      ListTile(
                        title: Text(m['authorName'] as String),
                        subtitle: Text(m['content'] as String),
                        trailing: IconButton(
                          icon: const Icon(Icons.arrow_outward),
                          tooltip: uiText(context, 'Vai al messaggio'),
                          onPressed: () => Navigator.pop(context, m['id']),
                        ),
                      ),
                ],
              ),
            ),
            if (current &&
                topic != null &&
                group.canWrite &&
                (topic!['state'] == 'active' ||
                    pending ||
                    editor.text.isNotEmpty))
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: editor,
                      readOnly: busy || pending || topic!['state'] != 'active',
                      onChanged: edit,
                      maxLength: 12000,
                      maxLines: 2,
                      minLines: 1,
                      decoration: InputDecoration(
                        labelText: uiText(context, 'Scrivi nell’argomento'),
                        counterText: '',
                      ),
                    ),
                    if (stale && !pending && topic!['state'] == 'active')
                      TextButton(
                        onPressed: busy
                            ? null
                            : () => edit(editor.text, renew: true),
                        child: Text(
                          uiText(
                            context,
                            'Usa la versione {0} dell’argomento',
                            [topic!['version']],
                          ),
                        ),
                      ),
                    if (pending)
                      TextButton(
                        onPressed: busy ? null : submit,
                        child: Text(uiText(context, 'Verifica invio')),
                      )
                    else if (topic!['state'] == 'active')
                      Wrap(
                        alignment: WrapAlignment.end,
                        children: [
                          TextButton(
                            onPressed:
                                busy || stale || editor.text.trim().isEmpty
                                ? null
                                : () => submit(ask: true),
                            child: Text(uiText(context, 'Chiedi a Emme')),
                          ),
                          FilledButton(
                            onPressed:
                                busy || stale || editor.text.trim().isEmpty
                                ? null
                                : submit,
                            child: Text(uiText(context, 'Invia')),
                          ),
                        ],
                      )
                    else
                      Text(
                        uiText(
                          context,
                          'Questo argomento è chiuso. La tua bozza resta sul dispositivo.',
                        ),
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
