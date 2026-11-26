import 'ui_language.dart';
import 'attachment_preview.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'workspace_command_journal.dart';

typedef GroupRecord = Map<String, dynamic>;
List<GroupRecord> groupRows(Object? raw) =>
    raw is List ? raw.cast<GroupRecord>() : const [];
List<String> groupIds(Object? raw) =>
    raw is List ? raw.cast<String>() : const [];
String groupDate(BuildContext context, Object? raw) {
  final date = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (date == null) return '';
  final local = MaterialLocalizations.of(context);
  final time = local.formatTimeOfDay(
    TimeOfDay.fromDateTime(date),
    alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
  );
  return '${local.formatCompactDate(date)} · $time';
}

bool groupDenied(Object e) =>
    e is ApiError &&
    (e.status == 401 || e.status == 403 || e.code == 'AUTH_CONTEXT_CHANGED');
String groupIssue(Object e) {
  if (e is ApiError) {
    if (groupDenied(e))
      return 'Non puoi accedere a questa operazione nello spazio.';
    if (e.code.contains('STALE') ||
        e.code.contains('VERSION') ||
        e.code == 'GOAL_CHANGE_REQUIRES_SEPARATE_TRANSITION')
      return 'Qualcuno ha aggiornato lo spazio. Ricarica i dati e verifica la versione.';
    if (e.code.contains('LIMIT') || e.status == 429)
      return 'Limite di utilizzo raggiunto. Puoi riprovare più tardi.';
    if (e.code == 'AI_PROVIDER_UNAVAILABLE')
      return 'Emme non è disponibile. Puoi riprovare quando il servizio torna attivo.';
    if (e.code == 'CONSULTATION_RUNNING')
      return 'Emme sta ancora preparando la risposta.';
    if (e.status == 404) return 'La versione richiesta non è disponibile.';
  }
  return 'Impossibile completare la richiesta. Controlla la connessione.';
}

class GroupGovernance {
  GroupGovernance(
    this.api,
    this.workspaceId, {
    required this.direction,
    this.referencesOnly = false,
    String? journalName,
    DraftVault vault = const DeviceDraftVault(),
  }) : actor = api.actorId,
       journal = WorkspaceCommandJournal(
         api,
         vault,
         namespace: journalName ?? (direction ? 'direction' : 'context-review'),
         collection: workspaceId,
       );
  final RimiamApi api;
  final String workspaceId, actor;
  final bool direction;
  final bool referencesOnly;
  final WorkspaceCommandJournal journal;
  GroupRecord snapshot = {}, project = {};
  bool admitted = false;
  Future<void>? _loading;
  int _epoch = 0;
  int get epoch => _epoch;
  void suspend() {
    _epoch++;
    admitted = false;
    _loading = null;
    snapshot = {};
    project = {};
  }

  String get path => '/api/v1/workspaces/${Uri.encodeComponent(workspaceId)}';
  void check() {
    if (actor.isEmpty || actor != api.actorId || !admitted)
      throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
  }

  Future<void> load() {
    final epoch = _epoch;
    return _loading ??= _load(epoch).whenComplete(() {
      if (epoch == _epoch) _loading = null;
    });
  }

  Future<void> _load(int epoch) async {
    admitted = false;
    if (actor.isEmpty || actor != api.actorId)
      throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
    final result = await Future.wait([
      api.get('$path/workspace'),
      if (direction) api.get('$path/project'),
    ]);
    if (epoch != _epoch || actor != api.actorId)
      throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
    final snap = result.first;
    if (snap['workspace']?['id'] != workspaceId ||
        !groupRows(snap['members'])
            .any((m) => m['user_id'] == actor && m['active'] == true))
      throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (!referencesOnly) await journal.load();
    if (epoch != _epoch || actor != api.actorId)
      throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
    snapshot = snap;
    if (direction) project = result.last;
    admitted = true;
  }

  bool get canWrite =>
      admitted &&
      api.actorId == actor &&
      groupRows(snapshot['members']).any(
        (m) =>
            m['user_id'] == actor &&
            m['active'] == true &&
            m['contributes'] == true,
      );
  String name(Object? id) =>
      groupRows(snapshot['members'])
              .where((m) => m['user_id'] == id)
              .firstOrNull?['name']
          as String? ??
      'Partecipante storico';
  GroupRecord? get goal =>
      groupRows(project['goals'])
          .where((g) => g['currentPrimary'] == true)
          .firstOrNull;
  List<GroupRecord> get proposed =>
      groupRows(snapshot['candidates']).where((c) {
        final uses = c['uses'] as GroupRecord;
        return [
          'information',
          'proposals',
          'questions',
        ].every((key) => groupRows(uses[key]).isEmpty);
      }).toList();
  Future<void> send(GroupRecord command, {bool fromEditor = false}) async {
    check();
    await journal.send(
      workspaceId,
      command,
      allowed: () => canWrite,
      fromEditor: fromEditor,
    );
  }

  Future<void> verify() async {
    final p = journal.pending;
    if (p == null) return;
    await send(
      p['command'] as GroupRecord,
      fromEditor: p['fromEditor'] == true,
    );
  }
}

Future<bool> groupConfirm(
  BuildContext context,
  String title,
  String text,
  String action,
) async =>
    await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        scrollable: true,
        title: Text(title),
        content: SelectableText(text),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(uiText(dialog, 'Annulla')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(action),
          ),
        ],
      ),
    ) ??
    false;

Future<String?> groupText(
  BuildContext context, {
  required String title,
  required String label,
  required String action,
  String initial = '',
  int max = 2000,
  String? detail,
}) async {
  return await showDialog<String>(
    context: context,
    builder: (_) => _TextEditor(
      title: title,
      label: label,
      action: action,
      initial: initial,
      max: max,
      detail: detail,
    ),
  );
}

class _TextEditor extends StatefulWidget {
  const _TextEditor({
    required this.title,
    required this.label,
    required this.action,
    required this.initial,
    required this.max,
    this.detail,
  });
  final String title, label, action, initial;
  final int max;
  final String? detail;
  @override
  State<_TextEditor> createState() => _TextEditorState();
}

class _TextEditorState extends State<_TextEditor> {
  late final controller = TextEditingController(text: widget.initial);
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    scrollable: true,
    title: Text(widget.title),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.detail != null) SelectableText(widget.detail!),
        TextField(
          controller: controller,
          minLines: 2,
          maxLines: 5,
          maxLength: widget.max,
          decoration: InputDecoration(labelText: widget.label),
          onChanged: (_) => setState(() {}),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(uiText(context, 'Annulla')),
      ),
      FilledButton(
        onPressed: controller.text.trim().isEmpty
            ? null
            : () => Navigator.pop(context, controller.text.trim()),
        child: Text(widget.action),
      ),
    ],
  );
}

Future<Set<String>?> groupPeople(
  BuildContext context,
  GroupGovernance group, {
  required String title,
  required bool includeSelf,
}) {
  final ids = <String>{if (includeSelf) group.actor};
  final eligible = groupRows(group.snapshot['members'])
      .where(
        (m) =>
            m['active'] == true &&
            (!group.direction ||
                groupRows(
                  group.project['members'],
                ).any((p) => p['id'] == m['user_id'] && p['eligible'] == true)),
      )
      .toList();
  return showDialog<Set<String>>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => AlertDialog(
        title: Text(title),
        scrollable: true,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final m in eligible)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(m['name'] as String),
                value: ids.contains(m['user_id']),
                onChanged:
                    (includeSelf && group.actor == m['user_id']) ||
                        ids.length >= 20 && !ids.contains(m['user_id'])
                    ? null
                    : (v) => update(() {
                        if (v == true) {
                          ids.add(m['user_id'] as String);
                        } else {
                          ids.remove(m['user_id']);
                        }
                      }),
              ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(uiText(context, 'Annulla')),
          ),
          FilledButton(
            onPressed: ids.isEmpty ? null : () => Navigator.pop(context, ids),
            child: Text(uiText(context, 'Continua')),
          ),
        ],
      ),
    ),
  );
}

class GroupReferencePage extends StatefulWidget {
  const GroupReferencePage({
    super.key,
    required this.group,
    required this.reference,
  });
  final GroupGovernance group;
  final GroupRecord reference;
  @override
  State<GroupReferencePage> createState() => _ReferenceState();
}

class _ReferenceState extends State<GroupReferencePage>
    with WidgetsBindingObserver {
  GroupRecord? detail;
  String? error;
  int generation = 0;
  bool paused = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      if (paused) return;
      paused = true;
      generation++;
      setState(() {
        detail = null;
        error = null;
      });
    } else if (paused && state == AppLifecycleState.resumed) {
      paused = false;
      _load(refreshAccess: true);
    }
  }

  Future<void> _load({bool refreshAccess = false}) async {
    final epoch = ++generation;
    final g = widget.group, r = widget.reference;
    setState(() {
      detail = null;
      error = null;
    });
    try {
      if (refreshAccess || !g.admitted) await g.load();
      if (!mounted || epoch != generation) return;
      g.check();
      GroupRecord result;
      if (r['kind'] == 'candidate') {
        final data = await g.api.get('${g.path}/workspace');
        final c = groupRows(data['candidates'])
            .where((c) => c['id'] == r['id'] && r['version'] == 1)
            .firstOrNull;
        if (c == null) throw const ApiError(404, 'REFERENCE_NOT_FOUND');
        result = {
          'title': c['subject'],
          'content': c['content'],
          'qualification': c['qualification'],
          'sourceIds': {
            c['source_id'],
            ...groupIds(c['source_ids']),
          }.whereType<String>().toList(),
        };
      } else if (r['kind'] == 'temporal_commitment') {
        final history = await g.api.get(
          '${g.path}/calendar-history?kind=commitment&id=${Uri.encodeQueryComponent(r['id'] as String)}',
        );
        final v = groupRows(history['versions'])
            .where((e) => e['version'] == r['version'])
            .firstOrNull;
        if (v == null) throw const ApiError(404, 'REFERENCE_NOT_FOUND');
        if (!mounted || epoch != generation) return;
        result = {
          'title': r['label'],
          'content':
              '${groupDate(context, v['starts_at'])} – ${groupDate(context, v['ends_at'])}\n${v['reason']}',
          'sourceIds': [
            if (v['source_message_id'] != null) v['source_message_id'],
          ],
        };
      } else {
        final uri = Uri(
          queryParameters: {
            for (final key in ['kind', 'id', 'version', 'eventId'])
              if (r[key] != null) key: r[key].toString(),
          },
        );
        result = await g.api.get('${g.path}/reference?${uri.query}');
        final ref = result['reference'];
        if (ref?['id'] != r['id'] ||
            ref?['version'] != r['version'] ||
            ref?['kind'] != r['kind'])
          throw const ApiError(404, 'REFERENCE_NOT_FOUND');
      }
      g.check();
      if (mounted && epoch == generation) setState(() => detail = result);
    } catch (e) {
      if (mounted && epoch == generation) setState(() => error = groupIssue(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.group, r = widget.reference, d = detail;
    final doc = groupRows(g.snapshot['sources'])
        .where((s) => s['id'] == r['id'])
        .firstOrNull;
    final String? message = r['kind'] == 'source' && d != null
        ? (d['provenance']?['sourceKind'] == 'message'
              ? r['id'] as String
              : (doc?['shared_message_id'] ?? doc?['voice_message_id'])
                    as String?)
        : null;
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Fonte'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (error != null) ...[
              Text(uiText(context, error!)),
              TextButton(
                onPressed: () => _load(refreshAccess: true),
                child: Text(uiText(context, 'Riprova')),
              ),
            ] else if (d == null)
              const LinearProgressIndicator()
            else ...[
              Text(
                d['title'] as String? ?? uiText(context, 'Fonte'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(
                uiText(context, 'Versione {0}{1}', [
                  r['version'],
                  d['current'] == false ? ' · storica' : '',
                ]),
              ),
              if (d['content'] != d['title'])
                SelectableText(d['content'] as String? ?? ''),
              if ((d['qualification'] as String? ?? '').isNotEmpty)
                Text(d['qualification'] as String),
              if (r['kind'] == 'source' &&
                  doc?['kind'] == 'document' &&
                  doc?['filename'] is String &&
                  doc?['withdrawn'] != true &&
                  d['provenance']?['withdrawn'] != true)
                TextButton.icon(
                  icon: const Icon(Icons.attach_file),
                  label: Text(uiText(context, 'Apri originale')),
                  onPressed: () => showAttachmentPreview(
                    context,
                    api: g.api,
                    path:
                        '${g.path}/source-file?id=${Uri.encodeQueryComponent(r['id'] as String)}',
                    filename: doc!['filename'] as String,
                    onMessage: message == null
                        ? null
                        : () => Navigator.pop(context, message),
                  ),
                ),
              if (message != null)
                FilledButton.tonal(
                  onPressed: () => Navigator.pop(context, message),
                  child: Text(uiText(context, 'Vai al messaggio')),
                ),
              for (final id in groupIds(
                d['sourceIds'],
              ).where((id) => r['kind'] != 'source' || id != r['id']))
                TextButton.icon(
                  icon: const Icon(Icons.link),
                  label: Text(
                    uiText(context, 'Fonte {0}', [
                      groupIds(d['sourceIds']).indexOf(id) + 1,
                    ]),
                  ),
                  onPressed: () async {
                    final target = await openGroupReference(context, g, {
                      'kind': 'source',
                      'id': id,
                      'version': 1,
                    });
                    if (target != null && context.mounted)
                      Navigator.pop(context, target);
                  },
                ),
            ],
          ],
        ),
      ),
    );
  }
}

Future<String?> openGroupReference(
  BuildContext context,
  GroupGovernance group,
  GroupRecord ref,
) => Navigator.push<String>(
  context,
  MaterialPageRoute(
    builder: (_) => GroupReferencePage(group: group, reference: ref),
  ),
);
