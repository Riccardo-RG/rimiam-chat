import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'assistant_rhythm.dart';
import 'chat_journal.dart';
import 'workspace_governance.dart';
import 'topic_conversation.dart';

part 'workspace_questions.dart';
part 'workspace_topics.dart';

class WorkspaceActivityScreen extends StatefulWidget {
  const WorkspaceActivityScreen({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.workspaceName,
    required this.questions,
    this.initialQuestionSourceId,
    this.initialTopicId,
    this.vault = const DeviceDraftVault(),
  });
  final RimiamApi api;
  final String workspaceId, workspaceName;
  final bool questions;
  final String? initialQuestionSourceId, initialTopicId;
  final DraftVault vault;
  @override
  State<WorkspaceActivityScreen> createState() => _ActivityState();
}

class _ActivityState extends State<WorkspaceActivityScreen>
    with WidgetsBindingObserver {
  late final group = GroupGovernance(
    widget.api,
    widget.workspaceId,
    direction: false,
    vault: widget.vault,
    journalName: widget.questions ? 'questions' : 'activity',
  );
  bool loading = true, busy = false, paused = false, historical = false;
  bool ready = false, attemptedQuestion = false;
  late String? chosenTopic = widget.initialTopicId;
  int generation = 0;
  String? problem, before;
  GroupRecord attention = {}, register = {};
  bool get current =>
      mounted && !paused && group.admitted && widget.api.actorId == group.actor;
  bool get canEdit =>
      current &&
      ready &&
      group.canWrite &&
      !busy &&
      !loading &&
      group.journal.pending == null;
  void switchHistory(bool show) => setState(() => historical = show);
  void showAllTopics() => setState(() => chosenTopic = null);
  void missingQuestionSource() =>
      setState(() => problem = 'La fonte selezionata non è più disponibile.');
  void viewPage(String? cursor) {
    before = cursor;
    load();
  }

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
    if ((state == AppLifecycleState.hidden ||
            state == AppLifecycleState.paused) &&
        !paused) {
      generation++;
      setState(() {
        paused = true;
        ready = false;
        attention = {};
        register = {};
        group.suspend();
      });
    } else if (state == AppLifecycleState.resumed && paused) {
      paused = false;
      load();
    }
  }

  Future<void> load() async {
    final ticket = ++generation;
    setState(() {
      loading = true;
      problem = null;
      ready = false;
    });
    try {
      await group.load();
      if (!current || ticket != generation) return;
      if (!widget.questions) {
        final page = Uri(
          queryParameters: {
            'limit': '12',
            if (before != null) 'before': before!,
          },
        );
        final views = await Future.wait([
          widget.api.get('${group.path}/activity?${page.query}'),
          widget.api.get('${group.path}/attention?limit=30'),
        ]);
        if (!current || ticket != generation) return;
        register = views[0];
        attention = views[1];
      }
      ready = true;
    } catch (e) {
      if (!mounted || ticket != generation) return;
      if (groupDenied(e)) group.suspend();
      problem = groupIssue(e);
    } finally {
      if (mounted && ticket == generation) {
        setState(() => loading = false);
        final source = widget.initialQuestionSourceId;
        if (source != null &&
            widget.questions &&
            canEdit &&
            !attemptedQuestion) {
          attemptedQuestion = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (canEdit) newQuestion(source);
          });
        }
      }
    }
  }

  Future<void> save(GroupRecord command, {bool verify = false}) async {
    if (!current || !group.canWrite || busy || !ready) return;
    if (!verify && !canEdit) return;
    final epoch = group.epoch;
    setState(() {
      busy = true;
      problem = null;
    });
    try {
      await group.send(command);
      if (current && group.epoch == epoch) await load();
    } catch (e) {
      if (mounted && epoch == group.epoch) {
        if (groupDenied(e)) {
          group.suspend();
          ready = false;
        }
        setState(() => problem = groupIssue(e));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> reference(GroupRecord ref) async {
    final message = await openGroupReference(context, group, ref);
    if (message != null && current) Navigator.pop(context, message);
  }

  List<GroupRecord> get sources {
    final choices = [
      for (final m in groupRows(group.snapshot['messages']))
        {
          'id': m['id'],
          'label': "${m['author_name']} · ${m['content']}",
          'created': m['created_at'],
        },
      for (final s in groupRows(
        group.snapshot['sources'],
      ).where((s) => s['withdrawn'] != true))
        {'id': s['id'], 'label': s['title'], 'created': s['created_at']},
    ];
    choices.sort(
      (a, b) => (b['created'] as String).compareTo(a['created'] as String),
    );
    return choices;
  }

  Future<GroupRecord?> pick(String title, List<GroupRecord> choices) =>
      showModalBottomSheet<GroupRecord>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (_) => _ChoiceList(title: title, choices: choices),
      );
  @override
  Widget build(BuildContext context) {
    final pending = group.journal.pending;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.questions
              ? uiText(context, 'Domande aperte')
              : uiText(context, 'Attività e argomenti'),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          children: [
            if (loading) const LinearProgressIndicator(),
            if (problem != null) ...[
              Semantics(
                liveRegion: true,
                child: Text(uiText(context, problem!)),
              ),
              TextButton(
                onPressed: loading || busy ? null : load,
                child: Text(uiText(context, 'Ricarica')),
              ),
            ],
            if (current && ready && pending != null)
              ListTile(
                title: Text(uiText(context, 'Salvataggio da verificare')),
                trailing: TextButton(
                  onPressed: busy
                      ? null
                      : () => save(
                          pending['command'] as GroupRecord,
                          verify: true,
                        ),
                  child: Text(uiText(context, 'Verifica')),
                ),
              ),
            if (current && ready)
              ...(widget.questions ? questionsView() : activityView()),
          ],
        ),
      ),
    );
  }
}

class _ChoiceList extends StatefulWidget {
  const _ChoiceList({required this.title, required this.choices});
  final String title;
  final List<GroupRecord> choices;
  @override
  State<_ChoiceList> createState() => _ChoiceListState();
}

class _ChoiceListState extends State<_ChoiceList> {
  String search = '';
  @override
  Widget build(BuildContext context) {
    final items = widget.choices
        .where((s) => (s['label'] as String).toLowerCase().contains(search))
        .toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(
        heightFactor: .76,
        child: Column(
          children: [
            ListTile(
              title: Text(widget.title),
              trailing: IconButton(
                tooltip: uiText(context, 'Chiudi'),
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                decoration: InputDecoration(
                  labelText: uiText(context, 'Cerca'),
                ),
                onChanged: (v) =>
                    setState(() => search = v.trim().toLowerCase()),
              ),
            ),
            if (items.isEmpty)
              Padding(
                padding: EdgeInsets.all(16),
                child: Text(uiText(context, 'Nessun risultato.')),
              ),
            Expanded(
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (_, i) => ListTile(
                  title: Text(
                    items[i]['label'] as String,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  onTap: () => Navigator.pop(context, items[i]),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
