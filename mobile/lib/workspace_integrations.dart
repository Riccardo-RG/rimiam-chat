import 'ui_language.dart';

import 'dart:async';

import 'package:crypto/crypto.dart';

import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import 'agenda_commands.dart' show agendaLocalZone;
import 'api.dart';
import 'assistant_instruction_export.dart';
import 'chat_journal.dart';
import 'integration_model.dart';
import 'workspace_governance.dart'
    show
        GroupRecord,
        groupRows,
        groupIds,
        groupDate,
        groupText,
        groupConfirm,
        groupDenied;

part 'workspace_email.dart';
part 'workspace_calendar.dart';

class WorkspaceEmailScreen extends _IntegrationPage {
  const WorkspaceEmailScreen({
    super.key,
    required super.api,
    required super.workspaceId,
    required super.workspaceName,
    super.vault,
    super.openUri,
  }) : super(kind: 'email');
}

class WorkspaceCalendarScreen extends _IntegrationPage {
  const WorkspaceCalendarScreen({
    super.key,
    required super.api,
    required super.workspaceId,
    required super.workspaceName,
    super.vault,
    super.openUri,
    super.personal = false,
  }) : super(kind: 'calendar');
}

abstract class _IntegrationPage extends StatefulWidget {
  const _IntegrationPage({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.workspaceName,
    required this.kind,
    this.vault = const DeviceDraftVault(),
    this.personal = false,
    this.openUri,
  });
  final RimiamApi api;
  final String workspaceId, workspaceName, kind;
  final DraftVault vault;
  final bool personal;
  final Future<bool> Function(Uri)? openUri;
  @override
  State<_IntegrationPage> createState() => _IntegrationState();
}

class _IntegrationState extends State<_IntegrationPage>
    with WidgetsBindingObserver {
  late final m = WorkspaceIntegration(
    widget.api,
    widget.workspaceId,
    widget.kind,
    widget.vault,
  );
  GroupRecord get view => m.data;
  final List<String?> pages = [null];
  DateTime selectedDay = DateTime.now();
  bool working = false, loading = true, active = true;
  String? error;
  Timer? clock;
  bool editing = false;
  int? editorAdmission;
  OverlayEntry? privacyCover;
  void uncover() {
    privacyCover?.remove();
    privacyCover?.dispose();
    privacyCover = null;
  }

  Future<GroupRecord?> showEditor(Widget editor) async {
    if (editing || !writable) return null;
    editing = true;
    editorAdmission = m.admission;
    try {
      final value = await Navigator.push<GroupRecord>(
        context,
        MaterialPageRoute(builder: (_) => editor),
      );
      return mounted && writable && m.admission == editorAdmission
          ? value
          : null;
    } finally {
      editing = false;
      editorAdmission = null;
    }
  }

  void problem(String value) => setState(() => error = value);
  void closePrivateDialogs() {
    final route = ModalRoute.of(context);
    if (route != null)
      Navigator.of(context).popUntil((r) => r == route || r.isFirst);
  }

  int refreshId = 0;
  bool get ready => m.admitted && active && !loading;
  bool get writable =>
      ready && m.canWrite && !working && m.journal.pending == null;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    clock?.cancel();
    uncover();
    m.invalidate();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (active &&
        {AppLifecycleState.hidden, AppLifecycleState.paused}.contains(state)) {
      active = false;
      refreshId++;
      clock?.cancel();
      FocusManager.instance.primaryFocus?.unfocus();
      if (editing && editorAdmission != null) {
        // Cover the editor while its owner and membership are revalidated.
        // Returning from another app must not discard an unsaved message.
        final color = Theme.of(context).colorScheme.surface;
        privacyCover = OverlayEntry(
          builder: (_) => ModalBarrier(color: color, dismissible: false),
        );
        Overlay.of(context, rootOverlay: true).insert(privacyCover!);
      } else {
        closePrivateDialogs();
      }
      m.invalidate();
      setState(() => loading = true);
    } else if (!active && state == AppLifecycleState.resumed) {
      active = true;
      load();
    }
  }

  Future<void> load({bool background = false}) async {
    if (!mounted || !active) return;
    final id = ++refreshId;
    clock?.cancel();
    if (!background)
      setState(() {
        loading = true;
        error = null;
      });
    try {
      await m.load(selectedDay, pages.last, poll: background);
      if (mounted &&
          active &&
          id == refreshId &&
          editing &&
          (!m.admitted || !m.canWrite || m.admission != editorAdmission)) {
        closePrivateDialogs();
      }
    } catch (e) {
      if (mounted && active && id == refreshId) {
        m.invalidate();
        closePrivateDialogs();
        problem(integrationIssue(e));
      }
    } finally {
      if (mounted && active && id == refreshId) {
        uncover();
        setState(() => loading = false);
        if (m.admitted && m.pendingWork)
          clock = Timer(const Duration(seconds: 4), () {
            if (!working) load(background: true);
          });
      }
    }
  }

  Future<void> operation(
    Future<void> Function() fn, {
    bool reload = false,
  }) async {
    if (working || !ready) return;
    final epoch = m.epoch;
    setState(() {
      working = true;
      error = null;
    });
    try {
      await fn();
      if (mounted && epoch == m.epoch && reload) await load();
    } catch (e) {
      if (mounted && epoch == m.epoch)
        setState(() {
          error = integrationIssue(e);
          if (groupDenied(e)) m.invalidate();
        });
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> send(GroupRecord command) =>
      operation(() => m.send(command), reload: true);
  Future<void> confirmCommand(
    String title,
    String description,
    String action,
    GroupRecord command,
  ) async {
    if (!writable) return;
    final epoch = m.epoch;
    if (await groupConfirm(context, title, description, action) &&
        mounted &&
        m.epoch == epoch &&
        writable)
      await send(command);
  }

  Future<void> openUri(Uri uri) async {
    if (!await (widget.openUri?.call(uri) ??
        launchUrl(uri, mode: LaunchMode.externalApplication)))
      throw const FormatException(
        'Il browser non è riuscito ad aprire il collegamento.',
      );
  }

  Future<void> history(String path, String title) async {
    await operation(() async {
      final epoch = m.epoch, data = await widget.api.get(path);
      m.guard(epoch);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          scrollable: true,
          title: Text(title),
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final v in groupRows(data['versions'])) ...[
                Text(
                  uiText(ctx, 'Versione {0} · {1}', [
                    v['version'],
                    groupDate(ctx, v['created_at']),
                  ]),
                  style: Theme.of(ctx).textTheme.titleSmall,
                ),
                if (v['envelope'] != null)
                  SelectableText(envelopeSummary(v['envelope']))
                else
                  SelectableText(
                    [
                      v['payload']?['title'] ?? v['title'],
                      if (v['payload'] != null) _period(ctx, v['payload']),
                      if (v['starts_at'] != null && v['ends_at'] != null)
                        _period(ctx, {
                          'start': v['starts_at'],
                          'end': v['ends_at'],
                          'timeZone': v['time_zone'],
                        }),
                      v['target_label'],
                      v['reason'],
                    ].whereType<String>().join('\n'),
                  ),
                const Divider(),
              ],
              for (final r in groupRows(data['transitions']))
                Text(
                  '${externalState(r['status'])} · ${groupDate(ctx, r['created_at'])}',
                ),
              for (final r in groupRows(data['approvals']))
                Text(
                  uiText(ctx, 'Autorizzazione v{0} · {1}', [
                    r['action_version'],
                    groupDate(ctx, r['created_at']),
                  ]),
                ),
              for (final r in groupRows(data['compositions']))
                Text(
                  uiText(ctx, 'Suggerimento v{0} · {1}', [
                    r['draft_version'],
                    groupDate(ctx, r['created_at']),
                  ]),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(uiText(ctx, 'Chiudi')),
            ),
          ],
        ),
      );
    });
  }

  List<Widget> effects(GroupRecord a, String content) {
    final result = <Widget>[];
    const labels = {
      'authorize': 'Autorizza',
      'reject': 'Rifiuta proposta',
      'retry': 'Riprova questa versione',
      'reconcile': 'Verifica esito',
    };
    const flags = {
      'authorize': 'canAuthorize',
      'reject': 'canReject',
      'retry': 'canRetry',
      'reconcile': 'canReconcile',
    };
    if (a['status'] == 'OUTCOME_UNKNOWN')
      result.add(
        Text(
          uiText(
            context,
            'Il servizio potrebbe aver già eseguito la richiesta. Puoi verificarne l’esito.',
          ),
        ),
      );
    for (final op in labels.keys) {
      if (a[flags[op]] != true ||
          (a['status'] == 'OUTCOME_UNKNOWN' && op != 'reconcile') ||
          !m.canWrite)
        continue;
      final cmd = integrationEffect(m, a, op);
      final action = op == 'authorize'
          ? (widget.kind == 'email'
                ? 'Autorizza invio'
                : 'Autorizza pubblicazione')
          : labels[op]!;
      result.add(
        TextButton(
          onPressed: writable
              ? () => confirmCommand(
                  '$action?',
                  content + '\n\nVersione ${a['version']}',
                  action,
                  cmd,
                )
              : null,
          child: Text(uiText(context, action)),
        ),
      );
    }
    return result;
  }

  Widget connections() {
    final mail = widget.kind == 'email';
    return ExpansionTile(
      key: const PageStorageKey('connections'),
      title: Text(
        mail
            ? uiText(context, 'Caselle collegate')
            : uiText(context, 'Calendari collegati'),
      ),
      children: [
        Text(
          uiText(
            context,
            'Collega l’indirizzo verificato del tuo account RIMIAM. Le letture sono personali.',
          ),
        ),
        for (final name in ['google', 'microsoft'])
          Builder(
            builder: (_) {
              final provider = name == 'google'
                      ? (mail ? 'google-gmail' : 'google-calendar')
                      : (mail ? 'microsoft-outlook' : 'microsoft-calendar'),
                  title = name == 'google'
                      ? (mail ? 'Gmail' : 'Google Calendar')
                      : (mail ? 'Outlook' : 'Calendario Outlook'),
                  status = m.providers[name];
              final linked = groupRows(view['connections'])
                  .where(
                    (r) => r['provider'] == provider && r['active'] == true,
                  )
                  .toList();
              if (linked.isNotEmpty)
                return Column(
                  children: [
                    for (final r in linked)
                      ListTile(
                        title: Text(title),
                        subtitle: Text(r['sender'] ?? r['label']),
                        trailing: m.canWrite
                            ? IconButton(
                                tooltip: uiText(context, 'Scollega {0}', [
                                  title,
                                ]),
                                icon: const Icon(Icons.link_off),
                                onPressed: writable
                                    ? () => confirmCommand(
                                        'Scollegare $title?',
                                        r['sender'] ?? r['label'],
                                        'Scollega',
                                        {
                                          'type': '${m.kind}.disconnect',
                                          'connectionId': r['id'],
                                          'expectedVersion': r['version'],
                                        },
                                      )
                                    : null,
                              )
                            : null,
                      ),
                  ],
                );
              final configured =
                  status?['configured'] == true &&
                  (status?['capabilities'] as List?)?.contains(m.kind) == true;
              return ListTile(
                title: Text(title),
                subtitle: Text(
                  !m.canWrite
                      ? uiText(context, 'Richiede il permesso di contribuire')
                      : status == null
                      ? uiText(context, 'Stato non disponibile')
                      : !configured
                      ? uiText(
                          context,
                          'Non configurato su questa installazione',
                        )
                      : uiText(context, 'Disponibile'),
                ),
                trailing: configured && m.canWrite
                    ? TextButton(
                        onPressed: writable
                            ? () => operation(
                                () async => openUri(await m.connect(name)),
                              )
                            : null,
                        child: Text(uiText(context, 'Collega')),
                      )
                    : null,
              );
            },
          ),
        TextButton(
          onPressed: working
              ? null
              : () => operation(
                  () => openUri(
                    widget.api.origin.resolve(
                      '/connessioni-e-dati${mail ? '#posta' : ''}',
                    ),
                  ),
                ),
          child: Text(uiText(context, 'Dati e permessi')),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final mail = widget.kind == 'email',
        next = view[mail ? 'nextDrafts' : 'nextActions'];
    return Scaffold(
      appBar: AppBar(
        title: Text(
          mail
              ? uiText(context, 'Posta')
              : widget.personal
              ? uiText(context, 'Calendari personali')
              : uiText(context, 'Calendario'),
        ),
        actions: [
          IconButton(
            tooltip: uiText(context, 'Aggiorna'),
            onPressed: working || loading ? null : load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          key: ValueKey('${widget.kind}-${m.space}'),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            Text(
              widget.workspaceName,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (error != null)
              Semantics(liveRegion: true, child: Text(uiText(context, error!))),
            if (loading || working) const LinearProgressIndicator(),
            if (!ready && !loading)
              TextButton(
                onPressed: load,
                child: Text(uiText(context, 'Ricarica')),
              ),
            if (ready) ...[
              if (m.journal.pending != null) ...[
                Text(
                  uiText(
                    context,
                    'La conferma dell’ultima operazione non è arrivata.',
                  ),
                ),
                TextButton(
                  onPressed: working
                      ? null
                      : () =>
                            send(m.journal.pending!['command'] as GroupRecord),
                  child: Text(uiText(context, 'Verifica operazione')),
                ),
              ],
              if (mail) ...mailContent() else ...calendarContent(),
              connections(),
              for (final r in groupRows(
                view['reads'],
              ).where((r) => r['status'] != 'COMPLETED'))
                Text(
                  uiText(context, 'Lettura personale · {0}', [
                    externalState(r['status']),
                  ]),
                ),
              if (next != null || pages.length > 1)
                Wrap(
                  children: [
                    if (pages.length > 1)
                      TextButton(
                        onPressed: working
                            ? null
                            : () {
                                pages.removeLast();
                                load();
                              },
                        child: Text(uiText(context, 'Pagina precedente')),
                      ),
                    if (next != null)
                      TextButton(
                        onPressed: working
                            ? null
                            : () {
                                pages.add(next as String);
                                load();
                              },
                        child: Text(uiText(context, 'Altri risultati')),
                      ),
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }
}

String _period(BuildContext ctx, GroupRecord p) =>
    '${groupDate(ctx, p['start'])} – ${groupDate(ctx, p['end'])} (${p['timeZone']})';
