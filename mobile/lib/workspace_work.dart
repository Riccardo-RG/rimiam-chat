import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'workspace_governance.dart';

part 'work_panel.dart';
part 'research_panel.dart';

class WorkspaceWorkScreen extends _WorkPage {
  const WorkspaceWorkScreen({
    super.key,
    required super.api,
    required super.workspaceId,
    required super.workspaceName,
    super.vault,
    super.onMessage,
    super.initialWorkId,
    super.completion,
  }) : super(research: false);
}

class ResearchScreen extends _WorkPage {
  const ResearchScreen({
    super.key,
    required super.api,
    required super.workspaceId,
    required super.workspaceName,
    super.vault,
    super.onMessage,
    super.personal,
    super.initialWorkId,
  }) : super(research: true);
}

abstract class _WorkPage extends StatefulWidget {
  const _WorkPage({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.workspaceName,
    required this.research,
    this.vault = const DeviceDraftVault(),
    this.onMessage,
    this.personal = false,
    this.initialWorkId,
    this.completion,
  });
  final RimiamApi api;
  final String workspaceId, workspaceName;
  final DraftVault vault;
  final ValueChanged<String>? onMessage;
  final bool research, personal;
  final String? initialWorkId;
  final int? completion;
  @override
  State<_WorkPage> createState() => _WorkState();
}

class _WorkState extends State<_WorkPage> with WidgetsBindingObserver {
  late final group = GroupGovernance(
    widget.api,
    widget.workspaceId,
    direction: false,
    journalName: widget.research ? 'research' : 'analysis',
    vault: widget.vault,
  );
  GroupRecord view = {};
  final pages = <String?>[null];
  final initialResearchTitle = GlobalKey();
  final confirmedReads = <String>{}, failedReads = <String>{};
  bool initialResearchClosed = false;
  String? error;
  Timer? poll;
  bool loading = true, acting = false, foreground = true;
  int version = 0;
  bool get write =>
      group.canWrite &&
      foreground &&
      !loading &&
      !acting &&
      group.journal.pending == null;
  String get title => widget.research
      ? (widget.personal ? 'Ricerca privata' : 'Ricerca sul web')
      : 'Analisi di Emme';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    poll?.cancel();
    group.suspend();
    super.dispose();
  }

  void closeDetails() {
    final page = ModalRoute.of(context);
    if (page != null)
      Navigator.of(context).popUntil((r) => r == page || r.isFirst);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (foreground &&
        (s == AppLifecycleState.hidden || s == AppLifecycleState.paused)) {
      foreground = false;
      version++;
      poll?.cancel();
      group.suspend();
      closeDetails();
      setState(() {
        view = {};
        loading = true;
      });
    } else if (!foreground && s == AppLifecycleState.resumed) {
      foreground = true;
      refresh();
    }
  }

  Future<void> refresh({bool background = false}) async {
    if (!mounted || !foreground) return;
    final epoch = ++version;
    poll?.cancel();
    if (!background)
      setState(() {
        loading = true;
        error = null;
      });
    try {
      if (!background ||
          !group.admitted ||
          (widget.research && !widget.personal))
        await group.load();
      group.check();
      if ((group.snapshot['workspace']['personal'] == true) != widget.personal)
        throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
      final GroupRecord next;
      if (widget.personal) {
        next = await widget.api.get(
          '/api/v1/personal-chats?thread=${Uri.encodeQueryComponent(widget.workspaceId)}',
        );
      } else if (widget.research) {
        next = group.snapshot;
      } else {
        final q = Uri(
          queryParameters: {
            if (widget.initialWorkId != null) 'workId': widget.initialWorkId!,
            if (widget.initialWorkId != null && widget.completion != null)
              'completion': '${widget.completion}',
            if (pages.last != null) 'before': pages.last!,
          },
        ).query;
        next = await widget.api.get(
          '${group.path}/active-work${q.isEmpty ? '' : '?$q'}',
        );
      }
      group.check();
      if (!mounted || version != epoch) return;
      setState(() {
        view = next;
        loading = false;
      });
      if (widget.personal && widget.initialWorkId != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && version == epoch) readInitialResearch();
        });
      }
      final busy = widget.research
          ? groupRows(next['research']).any(
              (r) => {'queued', 'running', 'analyzing'}.contains(r['status']),
            )
          : groupRows(next['works'])
                .any((r) => {'queued', 'working'}.contains(r['phase']));
      if (busy)
        poll = Timer(const Duration(seconds: 7), () {
          if (!acting) refresh(background: true);
        });
    } catch (e) {
      if (mounted && version == epoch) {
        group.suspend();
        closeDetails();
        setState(() {
          error = groupIssue(e);
          view = {};
          loading = false;
        });
      }
    }
  }

  Future<void> run(
    Future<void> Function() operation, {
    bool reload = true,
  }) async {
    if (acting || !group.admitted || !foreground) return;
    final epoch = group.epoch;
    setState(() {
      acting = true;
      error = null;
    });
    try {
      await operation();
      if (mounted && group.epoch == epoch && reload) await refresh();
    } catch (e) {
      if (mounted && epoch == group.epoch) {
        if (groupDenied(e)) {
          group.suspend();
          view = {};
          closeDetails();
        }
        setState(
          () => error = e is FormatException ? e.message : groupIssue(e),
        );
      }
    } finally {
      if (mounted) setState(() => acting = false);
    }
  }

  Future<void> approve(
    String title,
    String detail,
    String action,
    GroupRecord cmd,
  ) async {
    if (!write) return;
    final epoch = group.epoch;
    if (await groupConfirm(context, title, detail, action) &&
        mounted &&
        write &&
        epoch == group.epoch) {
      await run(() => group.send(cmd));
    }
  }

  Future<void> showRef(GroupRecord ref) async {
    if (!group.admitted || acting) return;
    final result = await Navigator.push<String>(
      context,
      MaterialPageRoute(
        builder: (_) => GroupReferencePage(group: group, reference: ref),
      ),
    );
    if (result != null && mounted && group.admitted) {
      if (widget.onMessage != null) {
        widget.onMessage!(result);
      } else {
        Navigator.pop(context, result);
      }
    }
  }

  Widget act(String text, VoidCallback? on) =>
      TextButton(onPressed: on, child: Text(text));
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(uiText(context, title)),
        actions: [
          IconButton(
            tooltip: uiText(context, 'Aggiorna'),
            onPressed: loading || acting ? null : refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(
              widget.workspaceName,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (error != null)
              Semantics(liveRegion: true, child: Text(uiText(context, error!))),
            if (loading || acting) const LinearProgressIndicator(),
            if (!group.admitted && !loading)
              act(uiText(context, 'Ricarica'), refresh),
            if (group.admitted && !loading) ...[
              if (group.journal.pending != null) ...[
                Text(
                  uiText(
                    context,
                    'La conferma dell’operazione non è arrivata.',
                  ),
                ),
                act(
                  uiText(context, 'Verifica operazione'),
                  acting ? null : () => run(group.verify),
                ),
              ],
              if (widget.research) ...researchItems() else ...workItems(),
            ],
          ],
        ),
      ),
    );
  }
}
