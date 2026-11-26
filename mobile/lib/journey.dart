import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'answer_recipients.dart';
import 'message_sources.dart';
import 'chat_message_layout.dart';
import 'participant_profile.dart' show IdentityAvatar;
import 'workspace_handoff_review.dart';
import 'workspace_governance.dart';
import 'workspace_command_journal.dart';
import 'attachments.dart';
import 'attachment_preview.dart';
import 'studio_theme.dart';
import 'studio_appearance.dart';
import 'native_push.dart';
import 'legacy_mobile_data.dart';
import 'legacy_recovery.dart';
import 'chat_journal.dart';
import 'chat_mentions.dart';
import 'chat_actions.dart';
import 'chat_sketch.dart';
import 'workspace_reading.dart';
import 'workspace_recap.dart';
import 'file_library.dart';
import 'assistant_settings.dart';
import 'assistant_request_feedback.dart';
import 'workspace_tasks.dart';
import 'workspace_chat_action_line.dart';
import 'workspace_people.dart';
import 'workspace_context.dart';
import 'workspace_direction.dart';
import 'workspace_activity.dart';
import 'workspace_integrations.dart';
import 'workspace_call.dart';
import 'workspace_feedback.dart';
import 'workspace_guide.dart';
import 'workspace_work.dart';
import 'workspace_presence.dart';
import 'workspace_tool_host.dart';
import 'workspace_voice.dart';
import 'agenda_commands.dart' show agendaLocalZone;

class WorkspaceJourney extends StatefulWidget {
  WorkspaceJourney({
    Key? key,
    required this.api,
    required this.workspaceId,
    required this.workspaceName,
    this.initialMessageId,
    this.vault = const DeviceDraftVault(),
  }) : super(key: key ?? ValueKey((api, api.actorId, workspaceId)));

  final RimiamApi api;
  final DraftVault vault;
  final String workspaceId;
  final String workspaceName;
  final String? initialMessageId;

  @override
  State<WorkspaceJourney> createState() => _WorkspaceJourneyState();
}

class _Message {
  _Message(Map<String, dynamic> data, this.sources)
    : id = data['id'] as String,
      author = data['author_name'] as String,
      authorId = data['author_id'] as String?,
      fromEmme = data['actor_kind'] == 'miriam',
      human = data['actor_kind'] == 'human',
      quote = data['quoteMessageId'] as String?,
      reference = data['reference'] as GroupRecord?,
      operation = data['operationResult'] as GroupRecord?,
      purpose = data['purpose'] as String?,
      taskOffer = data['taskOffer'] as GroupRecord?,
      reminder = data['reminder'] as GroupRecord?,
      content = data['content'] as String,
      sequence = data['sequence'] as int,
      sentAt = DateTime.parse(data['created_at'] as String).toLocal();

  final String id, author, content;
  final bool fromEmme, human;
  final String? quote;
  final String? authorId;
  final String? purpose;
  final GroupRecord? reference, operation;
  final GroupRecord? taskOffer, reminder;
  final List<GroupRecord> sources;
  final int sequence;
  final DateTime sentAt;
}

class _WorkspaceJourneyState extends State<WorkspaceJourney>
    with WidgetsBindingObserver {
  static final _journals = Expando<Map<String, ChatJournal>>();
  late final String _actor;
  ChatJournal? _journal;
  late final _answerJournal = WorkspaceCommandJournal(
    widget.api,
    widget.vault,
    namespace: 'message-answer',
    collection: widget.workspaceId,
  );
  bool _answerBusy = false;
  Future<void>? _answerRecovery;
  final _editor = TextEditingController();
  final _focus = FocusNode();
  final _timeline = GlobalKey<WorkspaceReadingTimelineState>();
  final _tools = GlobalKey<WorkspaceToolHostState>();
  Map<String, dynamic>? _attention;
  List<String> _messageIds = const [];
  late final Timer _poll;
  List<_Message> _messages = const [];
  Map<String, _Message> _byId = {};
  List<MentionPerson> _people = const [];
  List<MentionPerson> _recipients = const [];
  Map<String, List<Map<String, dynamic>>> _filesByMessage = {};
  Set<String> _availableSources = {};
  Map<String, AssistantFailure> _failedRequests = {};
  Set<String> _voiceMessages = {};
  Map<String, List<GroupRecord>> _milestones = {};
  Map<String, List<GroupRecord>> _handoffs = {};
  String? _expandedStepsMessage;
  bool _milestonesFailed = false;
  int _milestoneRequest = 0;
  int? _revision;
  int _accessEpoch = 0;
  bool _canPost = false, _reading = false, _queued = false;
  bool _active = true;
  bool _canInvite = false, _openingActions = false;
  bool get _sending => _journal?.sending == true;
  String _loadProblem = '';
  String _assistantName = 'Emme';
  bool _assistantUnconfigured = false;
  Set<String> _readingStates = {};
  String? _timeZone;
  late String _name;
  String? _requestedMessage;
  String get _path =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspaceId)}';

  @override
  void initState() {
    super.initState();
    _actor = widget.api.actorId;
    _name = widget.workspaceName;
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_active &&
          (ModalRoute.of(context)?.isCurrent == true ||
              _tools.currentState?.isShowing == true))
        unawaited(_refresh());
    });
    unawaited(_refresh(force: true));
    unawaited(_readAssistantName());
    unawaited(_readTimeZone());
  }

  Future<void> _readTimeZone() async {
    try {
      final zone = await agendaLocalZone();
      if (mounted) _timeZone = zone;
    } catch (_) {
      // The backend accepts ordinary messages without a known device zone.
    }
  }

  Future<void> _readAssistantName() async {
    try {
      final settings = await widget.api.get(
        '/api/v1/assistant-settings?workspaceId=${Uri.encodeQueryComponent(widget.workspaceId)}',
      );
      final name = settings['displayName'];
      if (mounted &&
          widget.api.actorId == _actor &&
          name is String &&
          name.trim().isNotEmpty) {
        final connections = (settings['connections'] as List?)
            ?.whereType<Map>();
        final selected = connections
            ?.where((c) => c['id'] == settings['connectionId'])
            .firstOrNull;
        setState(() {
          _assistantName = name;
          _assistantUnconfigured =
              settings['needsReconfirmation'] == true ||
              (connections != null && selected?['configured'] != true);
        });
      }
    } on Object {
      // Chat is still usable if the separate settings read is unavailable.
    }
  }

  void _prepareReply(_Message message, bool ask) {
    if (!_canPost || _journal?.ready != true || widget.api.actorId != _actor)
      return;
    _journal!.quote(message.id, ask: ask, source: message.human);
    _focus.requestFocus();
  }

  Future<void> _restoreAnswer() async {
    try {
      await _answerJournal.load();
      if (mounted && _answerJournal.pending != null) setState(() {});
    } catch (_) {
      _answerRecovery = null;
      rethrow;
    }
  }

  Future<void> _answer({String? messageId, bool acknowledge = false}) async {
    if (_answerBusy || _revision == null || !_active) return;
    final epoch = _accessEpoch;
    bool allowed() =>
        mounted &&
        _active &&
        _revision != null &&
        epoch == _accessEpoch &&
        widget.api.actorId == _actor;
    setState(() => _answerBusy = true);
    try {
      await (_answerRecovery ??= _restoreAnswer());
      if (!allowed()) return;
      final pending =
          _answerJournal.pending?['command'] as Map<String, dynamic>?;
      Map<String, dynamic> command;
      if (pending != null) {
        // A new selection never silently submits a different unfinished request.
        if (messageId != null) return;
        command = pending;
      } else if (messageId != null && _byId.containsKey(messageId)) {
        if (acknowledge) {
          if (!(_attention?['requestIds'] as List? ?? []).contains(messageId))
            return;
          command = {'type': 'conversation.answered', 'messageId': messageId};
        } else {
          if (!_canPost) return;
          final recipients = await chooseAnswerRecipients(context, _recipients);
          if (recipients == null || !allowed() || !_canPost) return;
          command = {
            'type': 'conversation.requestAnswer',
            'messageId': messageId,
            'recipients': recipients,
          };
        }
      } else {
        return;
      }
      await _answerJournal.send(
        widget.workspaceId,
        command,
        allowed: () =>
            allowed() &&
            (_canPost || command['type'] == 'conversation.answered'),
      );
      if (!allowed()) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(uiText(context, 'Registrato'))));
      await _refresh(force: true);
    } catch (_) {
      if (allowed()) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              uiText(context, 'Verifica la richiesta prima di riprovare.'),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _answerBusy = false);
    }
  }

  void _editText(String next) {
    final journal = _journal!;
    final previous = journal.text;
    journal.edit(
      next,
      selected: retainedMentions(next, journal.mentions, _people),
    );
    if (previous.isEmpty &&
        next.startsWith('/') &&
        !RegExp(r'\s').hasMatch(next)) {
      unawaited(_openActions(typed: next));
    }
  }

  void _writeDraft(String text) {
    final j = _journal!;
    _editor.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    j.edit(text, selected: retainedMentions(text, j.mentions, _people));
  }

  bool _permittedAction(ComposerAction a) =>
      (a.needs != 'canInvite' || _canInvite) &&
      (a.needs != 'canContribute' || _canPost);

  Future<void> _openActions({String? typed}) async {
    final journal = _journal;
    bool allowed() =>
        mounted &&
        widget.api.actorId == _actor &&
        _canPost &&
        journal != null &&
        identical(journal, _journal) &&
        journal.pending == null;
    if (_openingActions || !allowed()) return;
    _openingActions = true;
    try {
      final all = await composerCatalog;
      if (!allowed()) return;
      final actions = all.where(_permittedAction).toList();
      final invocation = typed == null ? null : _editor.text;
      if (invocation != null &&
          (invocation != '/' &&
              !actions.any(
                (a) => a.aliases.contains(invocation.toLowerCase()),
              )))
        return;
      _focus.unfocus();
      final selected = await showComposerActions(
        context,
        actions: actions,
        assistant: _assistantName,
        typed: invocation?.substring(1),
      );
      if (selected == null || !allowed()) return;
      if (selected.literal case final text?) {
        _writeDraft(text);
        _focus.requestFocus();
        return;
      }
      if (invocation != null && _editor.text == invocation) _writeDraft('');
      final id = selected.action!;
      if (id == 'ask-emme' || id == 'analyze') {
        if (journal!.fileReference == null)
          journal.quote(
            journal.quoteId,
            ask: true,
            source: journal.quoteSource,
          );
        if (id == 'analyze' &&
            !RegExp(
              r'^@Emme\b[\s,:]*(?:analizza|analyze)\s*:',
              caseSensitive: false,
            ).hasMatch(_editor.text)) {
          final prompt = _editor.text.replaceFirst(
            RegExp(r'^@Emme(?:\s*[:,]\s*|\s+|$)', caseSensitive: false),
            '',
          );
          _writeDraft('@Emme analizza: $prompt');
        }
        _focus.requestFocus();
      } else if (id == 'sketch') {
        await Navigator.push<bool>(
          context,
          MaterialPageRoute(
            builder: (_) => ChatSketchPage(journal: journal!, allowed: allowed),
          ),
        );
      } else {
        await _openTool(id == 'work' ? 'tasks' : id);
      }
    } catch (_) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              uiText(context, 'Impossibile aprire questa azione. Riprova.'),
            ),
          ),
        );
    } finally {
      _openingActions = false;
    }
  }

  void _chooseMention(MentionPerson person) {
    final journal = _journal;
    final current = _editor.value;
    final token = mentionQuery(current);
    final next = insertMention(current, person.name);
    if (!_canPost ||
        journal == null ||
        journal.pending != null ||
        next == null ||
        token == null)
      return;
    final otherText = current.text.replaceRange(
      token.start,
      current.selection.end,
      ' ',
    );
    final selected = retainedMentions(otherText, journal.mentions, _people)
      ..[person.id] = person.name;
    if (selected.length > 40) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            uiText(context, 'Puoi scegliere fino a 40 persone per messaggio.'),
          ),
        ),
      );
      return;
    }
    _editor.value = next;
    journal.edit(next.text, selected: selected);
    _focus.requestFocus();
  }

  Future<void> _openCollection() => _openTool('documents');

  bool _sameVisit(int epoch) =>
      mounted &&
      _active &&
      epoch == _accessEpoch &&
      _revision != null &&
      _actor == widget.api.actorId;

  Future<void> _readMessageHandoffs(String messageId) async {
    final epoch = _accessEpoch, revision = _revision;
    try {
      final response = await widget.api.get(
        '$_path/handoffs?sourceId=${Uri.encodeQueryComponent(messageId)}',
      );
      if (!_sameVisit(epoch) || revision != _revision) return;
      final items = groupRows(response['handoffs'])
          .where((row) => row['sourceMessageId'] == messageId)
          .toList();
      setState(() {
        _handoffs[messageId] = items;
        if (items.length > 1) _expandedStepsMessage = messageId;
      });
      if (items.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              uiText(context, 'Nessun passo proposto per questo messaggio.'),
            ),
          ),
        );
      } else if (items.length == 1) {
        await _reviewHandoff(items.single);
      } else {
        _timeline.currentState?.showMessage(messageId);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              uiText(context, 'Passi disponibili sotto il messaggio.'),
            ),
          ),
        );
      }
    } catch (error) {
      if (!_sameVisit(epoch)) return;
      if (groupDenied(error)) {
        await _refresh(force: true);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              uiText(
                context,
                'Impossibile caricare i passi proposti. Riprova.',
              ),
            ),
          ),
        );
      }
    }
  }

  Future<void> _reviewHandoff(GroupRecord handoff) async {
    final epoch = _accessEpoch;
    if (!_sameVisit(epoch)) return;
    _focus.unfocus();
    final next = await Navigator.push<GroupRecord>(
      context,
      MaterialPageRoute(
        builder: (_) => WorkspaceHandoffReview(
          api: widget.api,
          vault: widget.vault,
          workspaceId: widget.workspaceId,
          workspaceName: _name,
          handoff: handoff,
        ),
      ),
    );
    if (!_sameVisit(epoch)) return;
    if (next?['kind'] is String && next?['id'] is String) {
      await _showReference(next!);
    } else if (next?['destination'] case final String target) {
      await _openTool(
        target == 'direction' ? 'goal' : target,
        proposalId: next?['preparedId'] as String?,
        taskId: next?['taskId'] as String?,
      );
    } else {
      await _refresh(force: true);
    }
  }

  Future<void> _showReference(GroupRecord ref) async {
    if (!_active || _revision == null || widget.api.actorId != _actor) return;
    if (ref['kind'] == 'source' && _byId.containsKey(ref['id'])) {
      _timeline.currentState?.showMessage(ref['id'] as String);
      return;
    }
    final group = GroupGovernance(
      widget.api,
      widget.workspaceId,
      direction: false,
      referencesOnly: true,
    );
    _focus.unfocus();
    final target = await openGroupReference(context, group, ref);
    if (!mounted || !_active || widget.api.actorId != _actor) return;
    if (target != null) _requestedMessage = target;
    await _refresh(force: true);
  }

  Future<void> _openTool(
    String name, {
    String? messageId,
    String? workId,
    int? completion,
    String? proposalId,
    String? taskId,
    String? topicId,
  }) async {
    _focus.unfocus();
    final api = widget.api,
        workspace = widget.workspaceId,
        vault = widget.vault;
    final guide = name == 'guide'
        ? (await composerCatalog).where(_permittedAction).toList()
        : null;
    if (!mounted || api.actorId != _actor) return;
    final page = switch (name) {
      'research' => ResearchScreen(
        api: api,
        workspaceId: workspace,
        workspaceName: _name,
        vault: vault,
      ),
      'analyses' => WorkspaceWorkScreen(
        api: api,
        workspaceId: workspace,
        workspaceName: _name,
        vault: vault,
        initialWorkId: workId,
        completion: completion,
      ),
      'recap' => WorkspaceRecapScreen(
        api: api,
        vault: vault,
        workspaceId: workspace,
        anchorId: messageId!,
      ),
      'feedback' => WorkspaceFeedbackPage(
        api: api,
        workspaceId: workspace,
        vault: vault,
        messageId: messageId,
      ),
      'guide' => WorkspaceGuide(actions: guide!, assistant: _assistantName),
      'documents' || 'upload' => FileLibrary(
        api: api,
        vault: vault,
        workspaceId: workspace,
        workspaceName: _name,
        openUpload: name == 'upload',
      ),
      'context' => WorkspaceContextScreen(
        api: api,
        vault: vault,
        workspaceId: workspace,
        workspaceName: _name,
      ),
      'goal' => WorkspaceDirectionScreen(
        api: api,
        vault: vault,
        workspaceId: workspace,
        workspaceName: _name,
        proposalId: proposalId,
      ),
      'people' || 'invite' => WorkspacePeoplePage(
        api: api,
        vault: vault,
        workspace: workspace,
        inviteOnOpen: name == 'invite',
      ),
      'tasks' || 'new-task' => WorkspaceTasksPage(
        api: api,
        vault: vault,
        workspace: workspace,
        canWrite: _canPost,
        createOnOpen: name == 'new-task',
        initialTaskId: taskId,
        proposalId: proposalId,
      ),
      'assistant' => AssistantSettingsScreen(
        api: api,
        workspaceId: workspace,
        workspaceName: _name,
      ),
      'notifications' => NativePushSettings(api: api, workspaceId: workspace),
      'voice' => WorkspaceVoicePage(
        api: api,
        workspace: workspace,
        vault: vault,
        canWrite: _canPost,
        messageId: messageId,
      ),
      'call' => WorkspaceCallPage(
        api: api,
        workspace: workspace,
        vault: vault,
        canWrite: _canPost,
      ),
      'activity' || 'questions' => WorkspaceActivityScreen(
        api: api,
        vault: vault,
        workspaceId: workspace,
        workspaceName: _name,
        questions: name == 'questions',
        initialQuestionSourceId: name == 'questions' ? messageId : null,
        initialTopicId: name == 'activity' ? topicId : null,
      ),
      'calendar' => WorkspaceCalendarScreen(
        api: api,
        workspaceId: workspace,
        workspaceName: _name,
        vault: vault,
      ),
      'email' => WorkspaceEmailScreen(
        api: api,
        workspaceId: workspace,
        workspaceName: _name,
        vault: vault,
      ),
      _ => throw ArgumentError.value(name),
    };
    final result = await _tools.currentState?.open(page);
    if (!mounted || api.actorId != _actor) return;
    if ((name == 'people' || name == 'invite') && result == true) {
      Navigator.pop(context);
      return;
    }
    if (name == 'assistant') await _readAssistantName();
    if (result is String) {
      if (_byId.containsKey(result)) {
        _timeline.currentState?.showMessage(result);
      } else {
        _requestedMessage = result;
      }
    }
    await _refresh(force: true);
    if (result case (
      sourceId: final String sourceId,
      filename: final String filename,
    )) {
      _prepareFileQuestion(sourceId, filename);
    }
  }

  void _prepareFileQuestion(String sourceId, String filename) {
    if (!_sameVisit(_accessEpoch) || !_canPost || _journal?.ready != true)
      return;
    final journal = _journal!;
    if (!_availableSources.contains(sourceId) || journal.pending != null) {
      final reason = journal.pending != null
          ? 'Verifica prima l’invio precedente.'
          : 'Questo file non è più disponibile.';
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(uiText(context, reason))));
      return;
    }
    journal.askAboutFile((sourceId: sourceId, filename: filename));
    _focus.requestFocus();
  }

  Future<void> _openMember(String id) async {
    _focus.unfocus();
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => MemberProfilePage(
          api: widget.api,
          workspace: widget.workspaceId,
          member: id,
        ),
      ),
    );
    if (mounted && widget.api.actorId == _actor) await _refresh(force: true);
  }

  void _unobserveJournal() {
    _journal?.removeListener(_journalChanged);
    _journal = null;
    _editor.clear();
    _people = const [];
    _recipients = const [];
  }

  Future<void> _openJournal() async {
    if (!mounted || !_canPost || widget.api.actorId != _actor) return;
    final cache = _journals[widget.api] ??= {};
    if (_journal == null) {
      final scope = '$_actor/${widget.workspaceId}';
      _journal = cache.putIfAbsent(
        scope,
        () => ChatJournal(
          vault: widget.vault,
          origin: widget.api.origin,
          actor: _actor,
          workspace: widget.workspaceId,
        ),
      );
      _journal!.addListener(_journalChanged);
    }
    try {
      await _journal!.open();
    } catch (_) {
      /* The secure storage alert offers a retry. */
    }
    _journalChanged();
  }

  void _journalChanged() {
    final journal = _journal;
    if (!mounted ||
        !_canPost ||
        widget.api.actorId != _actor ||
        journal == null)
      return;
    if (journal.ready && _editor.text != journal.text) {
      _editor.value = TextEditingValue(
        text: journal.text,
        selection: TextSelection.collapsed(offset: journal.text.length),
      );
    }
    setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active) {
      unawaited(_readTimeZone());
      unawaited(_refresh(force: true));
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _accessEpoch++;
      setState(() {
        _canPost = false;
        _revision = null;
        _messages = const [];
        _byId = {};
        _unobserveJournal();
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll.cancel();
    _journal?.removeListener(_journalChanged);
    _editor.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _refresh({bool force = false}) async {
    if (!_active) return;
    if (_reading) {
      if (force) _queued = true;
      return;
    }
    _reading = true;
    final epoch = _accessEpoch;
    try {
      if (widget.api.actorId != _actor)
        throw const ApiError(401, 'SESSION_CHANGED');
      if (!force && _revision != null) {
        final change = await widget.api.get(
          '$_path/changes?after=$_revision&limit=1',
        );
        if (!mounted) return;
        if (change['headRevision'] == _revision) {
          if (_loadProblem.isNotEmpty) setState(() => _loadProblem = '');
          return;
        }
      }
      final state = await widget.api.get('$_path/workspace');
      if (!mounted || epoch != _accessEpoch) return;
      final workspace = state['workspace'] as Map<String, dynamic>;
      if (workspace['id'] != widget.workspaceId)
        throw const FormatException('Spazio inatteso');
      final members = (state['members'] as List).cast<Map<String, dynamic>>();
      if (widget.api.actorId != _actor ||
          !members.any((m) => m['user_id'] == _actor && m['active'] == true))
        throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
      final rawMessages = (state['messages'] as List)
          .cast<Map<String, dynamic>>();
      final fileRows = <String, List<Map<String, dynamic>>>{};
      final availableSources = <String>{};
      final sources = (state['sources'] as List? ?? const [])
          .cast<Map<String, dynamic>>();
      final sourceIndex = {for (final f in sources) f['id'] as String: f};
      final messageIndex = {for (final m in rawMessages) m['id'] as String: m};
      final messages = [
        for (final m in rawMessages)
          _Message(m, messageSources(m, messageIndex, sourceIndex)),
      ]..sort((a, b) => a.sequence.compareTo(b.sequence));
      final voiceMessages = <String>{};
      for (final f in sources) {
        final id = f['shared_message_id'];
        final voiceId = f['voice_message_id'];
        if (f['withdrawn'] != true && voiceId is String) {
          voiceMessages.add(voiceId);
        }
        if (f['withdrawn'] != true && f['id'] is String)
          availableSources.add(f['id'] as String);
        if (id is String) (fileRows[id] ??= []).add(f);
      }
      for (final entries in fileRows.values) {
        entries.sort(
          (a, b) => (a['attachment_position'] as int).compareTo(
            b['attachment_position'] as int,
          ),
        );
      }
      final milestonesChanged = _revision != workspace['revision'];
      final handoffs = <String, List<GroupRecord>>{};
      for (final item in groupRows(state['handoffs'])) {
        final anchor = item['sourceMessageId'];
        if (anchor is String) (handoffs[anchor] ??= []).add(item);
      }
      setState(() {
        _handoffs = handoffs;
        _filesByMessage = fileRows;
        _availableSources = availableSources;
        _voiceMessages = voiceMessages;
        _canInvite = (state['access'] as List? ?? []).any(
          (r) =>
              r['active'] == true &&
              r['holder_id'] == _actor &&
              r['invitations'] == true,
        );
        final interpretations = (state['interpretations'] as List? ?? const [])
            .cast<Map<String, dynamic>>();
        _readingStates = interpretations
            .map((r) => r['status'])
            .whereType<String>()
            .toSet();
        _failedRequests = explicitFailures(rawMessages, interpretations);
        _recipients = [
          for (final m in members)
            if (m['active'] == true &&
                m['user_id'] != _actor &&
                m['name'] is String &&
                (m['name'] as String).trim().isNotEmpty)
              (id: m['user_id'] as String, name: (m['name'] as String).trim()),
        ];
        _people = _recipients
            .where((p) => p.name.toLowerCase() != 'emme')
            .toList();
        _name = workspace['name'] as String;
        _revision = workspace['revision'] as int;
        _canPost = members.any(
          (m) =>
              m['user_id'] == widget.api.actorId &&
              m['active'] == true &&
              m['contributes'] == true,
        );
        _messages = messages;
        _byId = {for (final m in messages) m.id: m};
        _messageIds = messages.map((m) => m.id).toList();
        _attention = state['reading'] as Map<String, dynamic>?;
        _loadProblem = '';
      });
      if (milestonesChanged) unawaited(_readMilestones());
      // Older installations only expose voice associations in the dedicated view.
      if (sources.isNotEmpty &&
          !sources.first.containsKey('voice_message_id') &&
          rawMessages.any(
            (m) =>
                m['content'] == 'Messaggio vocale' ||
                m['content'] == 'Messaggio vocale a Emme',
          )) {
        unawaited(_readVoiceMessages(epoch, workspace['revision'] as int));
      }
      if (_answerRecovery == null &&
          (_canPost || (_attention?['requestIds'] as List? ?? []).isNotEmpty)) {
        final recovery = _answerRecovery = _restoreAnswer();
        unawaited(recovery.catchError((Object _) {}));
      }
      final target = _requestedMessage;
      if (target != null) {
        _requestedMessage = null;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted || widget.api.actorId != _actor) return;
          if (_byId.containsKey(target)) {
            _timeline.currentState?.showMessage(target);
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  uiText(context, 'Il messaggio originale non è disponibile.'),
                ),
              ),
            );
          }
        });
      }
      if (_canPost) {
        await _openJournal();
      } else {
        _unobserveJournal();
      }
    } catch (error) {
      if (!mounted) return;
      final denied =
          error is ApiError && (error.status == 401 || error.status == 403);
      setState(() {
        _loadProblem = denied
            ? 'Accedi di nuovo o verifica l’accesso allo spazio.'
            : 'Impossibile aggiornare la conversazione.';
        if (denied) {
          _unobserveJournal();
          _messages = const [];
          _byId = {};
          _name = widget.workspaceName;
          _canPost = false;
          _revision = null;
        }
      });
    } finally {
      _reading = false;
      if (mounted && _queued) {
        _queued = false;
        unawaited(_refresh(force: true));
      }
    }
  }

  Future<void> _updateAttachments(List<StagedAttachment> next) async {
    final api = widget.api;
    final fresh = await api.get('$_path/workspace');
    if (!mounted ||
        api.actorId != _actor ||
        fresh['workspace']['id'] != widget.workspaceId ||
        !(fresh['members'] as List).any(
          (m) =>
              m['user_id'] == _actor &&
              m['active'] == true &&
              m['contributes'] == true,
        ))
      throw const AttachmentProblem('Accesso allo spazio da verificare.');
    final j = _journal ?? _journals[api]?['$_actor/${widget.workspaceId}'];
    if (j == null)
      throw const AttachmentProblem('Riapri lo spazio per allegare.');
    await j.replaceFiles(next);
  }

  Future<void> _send() async {
    final journal = _journal;
    if (!_canPost || journal == null || journal.sending) return;
    try {
      final feedback = RegExp(
        r'^/feedback(?:\s+|$)',
        caseSensitive: false,
      ).firstMatch(journal.text.trimLeft());
      if (feedback != null &&
          !journal.askAssistant &&
          journal.fileReference == null &&
          journal.files.isEmpty &&
          journal.pending == null) {
        final original = journal.text;
        final quote = journal.quoteId;
        final initial = original.trimLeft().substring(feedback.end).trim();
        if (initial.length > 6000) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                uiText(
                  context,
                  'Il feedback può contenere fino a 6000 caratteri.',
                ),
              ),
            ),
          );
          return;
        }
        final result = await Navigator.push<Object?>(
          context,
          MaterialPageRoute(
            builder: (_) => WorkspaceFeedbackPage(
              api: widget.api,
              workspaceId: widget.workspaceId,
              vault: widget.vault,
              initialText: initial,
              messageId: quote,
              fromComposer: true,
            ),
          ),
        );
        if (mounted &&
            widget.api.actorId == _actor &&
            identical(_journal, journal) &&
            result == true &&
            journal.text == original &&
            journal.quoteId == quote) {
          _writeDraft('');
          journal.quote(null);
        }
        if (result is String && mounted && widget.api.actorId == _actor) {
          if (_byId.containsKey(result)) {
            _timeline.currentState?.showMessage(result);
          } else {
            _requestedMessage = result;
            await _refresh(force: true);
          }
        }
        return;
      }
      await journal.submit(
        widget.api,
        timeZone: _timeZone,
        mayPost: () =>
            mounted &&
            _canPost &&
            widget.api.actorId == _actor &&
            identical(_journal, journal),
      );
      if (!mounted || !_canPost || journal.pending != null) return;
      await _refresh(force: true);
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _timeline.currentState?.showLatest(),
      );
    } catch (error) {
      if (!mounted) return;
      if (error is ApiError && (error.status == 401 || error.status == 403)) {
        setState(() {
          _canPost = false;
          _revision = null;
          _messages = const [];
          _loadProblem = 'Accedi di nuovo o verifica l’accesso allo spazio.';
          _unobserveJournal();
        });
        unawaited(_refresh(force: true));
      }
      // The durable command remains available through the explicit retry action.
    }
  }

  Future<void> _readMilestones() async {
    final request = ++_milestoneRequest,
        epoch = _accessEpoch,
        revision = _revision;
    bool current() =>
        mounted &&
        _active &&
        _accessEpoch == epoch &&
        _revision == revision &&
        widget.api.actorId == _actor &&
        request == _milestoneRequest;
    if (revision == null || _messages.isEmpty) {
      if (current())
        setState(() {
          _milestones = {};
          _milestonesFailed = false;
        });
      return;
    }
    final bounds = Uri(
      queryParameters: {'first': _messages.first.id, 'last': _messages.last.id},
    );
    try {
      final response = await widget.api.get(
        '$_path/milestones?${bounds.query}',
      );
      if (!current()) return;
      final items = <String, List<GroupRecord>>{};
      for (final item in groupRows(response['items'])) {
        final anchor = item['anchor'];
        if (anchor is String && _byId.containsKey(anchor)) {
          (items[anchor] ??= []).add(item);
        }
      }
      setState(() {
        _milestones = items;
        _milestonesFailed = false;
      });
    } catch (_) {
      if (current())
        setState(() {
          _milestones = {};
          _milestonesFailed = true;
        });
    }
  }

  Widget _signature(_Message item, bool compact, Map<String, dynamic> photos) {
    final colors = Theme.of(context).colorScheme;
    final authorId = item.authorId;
    final onProfile = item.human && authorId != null
        ? () => _openMember(authorId)
        : null;
    return Row(
      children: [
        if (item.fromEmme)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 6),
            child: ImageIcon(emmeIcon, size: 16, color: colors.secondary),
          ),
        Expanded(
          child: ChatAuthor(
            name: item.author,
            color: item.fromEmme ? colors.secondary : colors.onSurface,
            onProfile: onProfile,
            avatar: !compact && onProfile != null
                ? IdentityAvatar(
                    api: widget.api,
                    workspace: widget.workspaceId,
                    person: authorId,
                    name: item.author,
                    photo: photos[authorId] as GroupRecord?,
                    radius: 14,
                  )
                : null,
          ),
        ),
        if (!compact)
          Text(
            MaterialLocalizations.of(context)
                .formatTimeOfDay(TimeOfDay.fromDateTime(item.sentAt)),
            style: Theme.of(context).textTheme.labelSmall
                ?.copyWith(color: colors.onSurfaceVariant),
          ),
      ],
    );
  }

  Widget _messageMenu(_Message item) => PopupMenuButton<String>(
    tooltip: uiText(context, 'Azioni sul messaggio di {0}', [item.author]),
    onSelected: (action) {
      if (action == 'question') {
        _openTool('questions', messageId: item.id);
      } else if (action == 'handoffs') {
        _readMessageHandoffs(item.id);
      } else if (action == 'feedback') {
        _openTool('feedback', messageId: item.id);
      } else if (action == 'ask' || action == 'reply') {
        _prepareReply(item, action == 'ask');
      } else {
        _answer(messageId: item.id, acknowledge: action == 'answered');
      }
    },
    itemBuilder: (_) => [
      if (_canPost)
        PopupMenuItem(value: 'reply', child: Text(uiText(context, 'Rispondi'))),
      if (_canPost)
        PopupMenuItem(
          value: 'ask',
          child: Text(uiText(context, 'Chiedi a {0}', [_assistantName])),
        ),
      if (_canPost && _recipients.isNotEmpty)
        PopupMenuItem(
          enabled: !_answerBusy && _answerJournal.pending == null,
          value: 'request',
          child: Text(uiText(context, 'Richiedi una risposta')),
        ),
      if ((_attention?['requestIds'] as List? ?? []).contains(item.id))
        PopupMenuItem(
          enabled: !_answerBusy && _answerJournal.pending == null,
          value: 'answered',
          child: Text(uiText(context, 'Già risposto')),
        ),
      if (_canPost)
        PopupMenuItem(
          value: 'question',
          child: Text(uiText(context, 'Apri una domanda')),
        ),
      PopupMenuItem(
        value: 'handoffs',
        child: Text(uiText(context, 'Passi proposti')),
      ),
      if (_canPost)
        PopupMenuItem(
          value: 'feedback',
          child: Text(uiText(context, 'Feedback')),
        ),
    ],
    icon: const Icon(Icons.more_horiz, size: 20),
  );

  void _openMilestone(GroupRecord item) {
    final id = item['objectId'] as String;
    if (item['kind'] == 'decision') {
      _showReference({'kind': 'commitment', 'id': id, 'version': 1});
    } else if (item['kind'] == 'completed') {
      _openTool(
        'analyses',
        workId: id,
        completion: item['completionRevision'] as int?,
      );
    }
  }

  Future<void> _readVoiceMessages(int epoch, int revision) async {
    try {
      final index = await widget.api.get('$_path/voice');
      if (!mounted ||
          _accessEpoch != epoch ||
          _revision != revision ||
          widget.api.actorId != _actor)
        return;
      final ids = {
        for (final voice in index['messages'] as List)
          if (voice['messageId'] is String) voice['messageId'] as String,
      };
      setState(() => _voiceMessages = ids);
    } catch (_) {
      if (mounted &&
          _accessEpoch == epoch &&
          _revision == revision &&
          _voiceMessages.isNotEmpty) {
        setState(() => _voiceMessages = {});
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final availableHeight =
        MediaQuery.sizeOf(context).height -
        MediaQuery.viewInsetsOf(context).bottom;
    final short = availableHeight < 300;
    final quotedId = _journal?.quoteId;
    final quoted = _byId[quotedId];
    final fileReference = _journal?.fileReference;
    final missingSource =
        fileReference != null &&
        !_availableSources.contains(fileReference.sourceId);
    final asking = _journal?.askAssistant == true;
    final chat = Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        title: Text(
          _name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w600,
            color: workspaceTitleAccent(context),
          ),
        ),
        actions: [
          if (_active && _revision != null && widget.api.actorId == _actor)
            WorkspacePresence(
              api: widget.api,
              workspace: widget.workspaceId,
              revision: _revision!,
              assistant: _assistantName,
              openWork: (id) => _openTool('analyses', workId: id),
              readingStates: _readingStates,
              unconfigured: _assistantUnconfigured,
              openContext: () => _openTool('context'),
            ),
          if (short)
            IconButton(
              onPressed: _openCollection,
              tooltip: uiText(context, 'Condivisi'),
              icon: const Icon(Icons.folder_outlined),
            ),
          PopupMenuButton<String>(
            tooltip: uiText(context, 'Strumenti dello spazio'),
            icon: const Icon(Icons.tune),
            onSelected: (name) => name == 'reload-milestones'
                ? _readMilestones()
                : _openTool(name),
            itemBuilder: (_) => [
              if (_milestonesFailed)
                PopupMenuItem(
                  value: 'reload-milestones',
                  child: Text(uiText(context, 'Ricarica attività')),
                ),
              PopupMenuItem(
                value: 'tasks',
                child: Text(uiText(context, 'In programma')),
              ),
              PopupMenuItem(
                value: 'context',
                child: Text(uiText(context, 'Contesto condiviso')),
              ),
              PopupMenuItem(
                value: 'goal',
                child: Text(uiText(context, 'Direzione')),
              ),
              PopupMenuItem(
                value: 'questions',
                child: Text(uiText(context, 'Domande aperte')),
              ),
              PopupMenuItem(
                value: 'activity',
                child: Text(uiText(context, 'Attività e argomenti')),
              ),
              PopupMenuItem(
                value: 'analyses',
                child: Text(uiText(context, 'Analisi di Emme')),
              ),
              PopupMenuItem(
                value: 'research',
                child: Text(uiText(context, 'Ricerca sul web')),
              ),
              PopupMenuItem(
                value: 'calendar',
                child: Text(uiText(context, 'Calendario')),
              ),
              PopupMenuItem(
                value: 'email',
                child: Text(uiText(context, 'Posta')),
              ),
              PopupMenuItem(
                value: 'people',
                child: Text(uiText(context, 'Persone e accesso')),
              ),
              PopupMenuItem(
                value: 'assistant',
                child: Text(uiText(context, 'Configura Emme')),
              ),
              PopupMenuItem(
                value: 'notifications',
                child: Text(uiText(context, 'Notifiche')),
              ),
              PopupMenuItem(
                value: 'voice',
                child: Text(uiText(context, 'Messaggi vocali')),
              ),
              PopupMenuItem(
                value: 'call',
                child: Text(uiText(context, 'Chiamata audio')),
              ),
              PopupMenuItem(
                value: 'guide',
                child: Text(uiText(context, 'Guida dello spazio')),
              ),
              PopupMenuItem(
                value: 'feedback',
                child: Text(uiText(context, 'Feedback beta')),
              ),
            ],
          ),
        ],
        bottom: short
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(44),
                child: Row(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Semantics(
                        selected: true,
                        child: Text(
                          uiText(context, 'Chat'),
                          style: theme.textTheme.titleSmall,
                        ),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: _openCollection,
                      icon: const Icon(Icons.folder_outlined, size: 18),
                      label: Text(uiText(context, 'Condivisi')),
                    ),
                  ],
                ),
              ),
      ),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: ChatTimelineLayout.wideWidth,
            ),
            child: Column(
              children: [
                if (_revision != null && _answerJournal.pending != null)
                  _Notice(
                    text: 'La conferma dell’operazione non è arrivata.',
                    action: 'Verifica richiesta',
                    onTap: _answerBusy ? null : () => _answer(),
                  ),
                if (_loadProblem.isNotEmpty)
                  _Notice(
                    text: _loadProblem,
                    action: 'Aggiorna',
                    onTap: () => _refresh(force: true),
                  ),
                Expanded(
                  child: _revision == null && _loadProblem.isEmpty
                      ? Center(
                          child: StudioLoading(
                            label: uiText(context, 'Caricamento conversazione'),
                          ),
                        )
                      : _messages.isEmpty
                      ? Center(
                          child: Text(
                            _loadProblem.isEmpty
                                ? uiText(
                                    context,
                                    'Nessun messaggio nello spazio.',
                                  )
                                : uiText(
                                    context,
                                    'Conversazione non disponibile.',
                                  ),
                          ),
                        )
                      : ChatTimelineLayout(
                          api: widget.api,
                          workspace: widget.workspaceId,
                          revision: _revision,
                          builder: (compact, photos) => WorkspaceReadingTimeline(
                            key: _timeline,
                            api: widget.api,
                            actor: _actor,
                            workspaceId: widget.workspaceId,
                            ids: _messageIds,
                            reading: _attention,
                            onRecap: (anchor) =>
                                _openTool('recap', messageId: anchor),
                            initialMessageId: widget.initialMessageId,
                            onRefresh: () => _refresh(force: true),
                            row: (context, index) {
                              final item = _messages[index];
                              final files =
                                  _filesByMessage[item.id] ?? const [];
                              final filenamesOnly =
                                  files.isNotEmpty &&
                                  files.every(
                                    (file) => file['filename'] is String,
                                  ) &&
                                  item.content ==
                                      files
                                          .map((file) => file['filename'])
                                          .join(', ');
                              final steps =
                                  _handoffs[item.id] ?? const <GroupRecord>[];
                              final stepsExpanded =
                                  _expandedStepsMessage == item.id;
                              final prev = index == 0
                                  ? null
                                  : _messages[index - 1];
                              final startOfDay =
                                  prev == null ||
                                  !DateUtils.isSameDay(
                                    item.sentAt,
                                    prev.sentAt,
                                  );
                              final interval =
                                  prev != null &&
                                  !startOfDay &&
                                  item.sentAt.difference(prev.sentAt) >=
                                      const Duration(hours: 2);
                              final continuation =
                                  prev != null &&
                                  !startOfDay &&
                                  !interval &&
                                  item.purpose != 'followup_reminder' &&
                                  prev.purpose != 'followup_reminder' &&
                                  (item.fromEmme &&
                                          prev.fromEmme &&
                                          prev.author == item.author ||
                                      item.human &&
                                          prev.human &&
                                          item.authorId != null &&
                                          prev.authorId == item.authorId);
                              final local = MaterialLocalizations.of(context);
                              return Padding(
                                padding: EdgeInsetsDirectional.fromSTEB(
                                  16,
                                  continuation ? 2 : 8,
                                  16,
                                  2,
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    if (startOfDay || compact && interval)
                                      Padding(
                                        padding: const EdgeInsets.only(
                                          bottom: 6,
                                          top: 6,
                                        ),
                                        child: Text(
                                          compact
                                              ? [
                                                  if (startOfDay)
                                                    chatDayLabel(
                                                      context,
                                                      item.sentAt,
                                                      DateTime.now(),
                                                    ),
                                                  local.formatTimeOfDay(
                                                    TimeOfDay.fromDateTime(
                                                      item.sentAt,
                                                    ),
                                                  ),
                                                ].join(' · ')
                                              : local.formatMediumDate(
                                                  item.sentAt,
                                                ),
                                          style: theme.textTheme.labelMedium
                                              ?.copyWith(
                                                color: colors.onSurfaceVariant,
                                              ),
                                        ),
                                      ),
                                    Stack(
                                      children: [
                                        ConstrainedBox(
                                          constraints: const BoxConstraints(
                                            minHeight: 44,
                                          ),
                                          child: Padding(
                                            padding:
                                                const EdgeInsetsDirectional.only(
                                                  end: 44,
                                                ),
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.stretch,
                                              children: [
                                                if (!continuation)
                                                  _signature(
                                                    item,
                                                    compact,
                                                    photos,
                                                  ),
                                                if (_byId[item.quote]
                                                    case final original?)
                                                  TextButton.icon(
                                                    onPressed: () => _timeline
                                                        .currentState
                                                        ?.showMessage(
                                                          original.id,
                                                        ),
                                                    icon: const Icon(
                                                      Icons.reply,
                                                      size: 16,
                                                    ),
                                                    label: Text(
                                                      '${original.author} · ${original.content}',
                                                      maxLines: 1,
                                                      overflow:
                                                          TextOverflow.ellipsis,
                                                    ),
                                                  ),
                                                const SizedBox(height: 2),
                                                if (item.reference != null &&
                                                    (item.purpose ==
                                                            'goal_event' ||
                                                        item.purpose ==
                                                            'workstream_event'))
                                                  TextButton.icon(
                                                    icon: Icon(
                                                      item.purpose ==
                                                              'goal_event'
                                                          ? Icons.flag_outlined
                                                          : Icons.tag,
                                                    ),
                                                    onPressed: () =>
                                                        _showReference(
                                                          item.reference!,
                                                        ),
                                                    label: Text(item.content),
                                                  )
                                                else if (item
                                                        .content
                                                        .isNotEmpty &&
                                                    !filenamesOnly &&
                                                    item.taskOffer == null)
                                                  Text(
                                                    item.content,
                                                    style: theme
                                                        .textTheme
                                                        .bodyLarge
                                                        ?.copyWith(
                                                          color: item.fromEmme
                                                              ? colors.secondary
                                                              : colors
                                                                    .onSurface,
                                                        ),
                                                  ),
                                              ],
                                            ),
                                          ),
                                        ),
                                        PositionedDirectional(
                                          top: 0,
                                          end: 0,
                                          child: SizedBox.square(
                                            dimension: 44,
                                            child: _messageMenu(item),
                                          ),
                                        ),
                                      ],
                                    ),
                                    if (item.taskOffer != null ||
                                        item.reminder != null)
                                      WorkspaceChatActionLine(
                                        api: widget.api,
                                        workspace: widget.workspaceId,
                                        messageId: item.id,
                                        authorId: item.authorId,
                                        canWrite: _canPost,
                                        taskOffer: item.taskOffer,
                                        reminder: item.reminder,
                                        vault: widget.vault,
                                        refresh: () => _refresh(force: true),
                                      ),
                                    if (item.reference != null &&
                                        item.purpose != 'goal_event' &&
                                        item.purpose != 'workstream_event')
                                      Align(
                                        alignment:
                                            AlignmentDirectional.centerStart,
                                        child: TextButton.icon(
                                          onPressed: () =>
                                              _showReference(item.reference!),
                                          icon: const Icon(
                                            Icons.link,
                                            size: 17,
                                          ),
                                          label: Text(
                                            uiText(context, 'Vedi riferimento'),
                                          ),
                                        ),
                                      ),
                                    if (item.operation?['workstreamId']
                                        case final String id)
                                      Align(
                                        alignment:
                                            AlignmentDirectional.centerStart,
                                        child: TextButton.icon(
                                          onPressed: () => _openTool(
                                            'activity',
                                            topicId: id,
                                          ),
                                          icon: const Icon(Icons.tag, size: 17),
                                          label: Text(
                                            uiText(
                                              context,
                                              'Apri argomento · {0}',
                                              [item.operation!['title']],
                                            ),
                                          ),
                                        ),
                                      ),
                                    if (item.sources.isNotEmpty)
                                      MessageSources(
                                        entries: item.sources,
                                        open: _showReference,
                                      ),
                                    if (steps.length > 1)
                                      TextButton.icon(
                                        icon: Icon(
                                          stepsExpanded
                                              ? Icons.expand_less
                                              : Icons.expand_more,
                                          size: 18,
                                        ),
                                        label: Text(
                                          '${uiText(context, 'Passi proposti')} · ${steps.length}',
                                        ),
                                        onPressed: () => setState(
                                          () => _expandedStepsMessage =
                                              stepsExpanded ? null : item.id,
                                        ),
                                      ),
                                    if (steps.length == 1 || stepsExpanded)
                                      for (final handoff in steps)
                                        TextButton.icon(
                                          icon: const Icon(
                                            Icons.arrow_forward,
                                            size: 16,
                                          ),
                                          label: Text(
                                            handoff['summary'] as String,
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                          onPressed: () =>
                                              _reviewHandoff(handoff),
                                        ),
                                    for (final event
                                        in _milestones[item.id] ??
                                            const <GroupRecord>[])
                                      TextButton.icon(
                                        icon: Icon(
                                          event['kind'] == 'decision'
                                              ? Icons.check
                                              : Icons.fact_check_outlined,
                                          size: 17,
                                        ),
                                        label: Text(
                                          "${uiText(context, event['kind'] == 'decision' ? 'Decisione adottata' : 'Leggi il confronto completo')} · ${event['conclusion'] ?? event['label']}",
                                          maxLines: 3,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                        onPressed: () => _openMilestone(event),
                                      ),
                                    if (_voiceMessages.contains(item.id))
                                      TextButton.icon(
                                        icon: const Icon(
                                          Icons.headphones_outlined,
                                        ),
                                        label: Text(
                                          uiText(context, 'Apri il vocale'),
                                        ),
                                        onPressed: () => _openTool(
                                          'voice',
                                          messageId: item.id,
                                        ),
                                      ),
                                    if (_failedRequests[item.id]
                                        case final failure?)
                                      AssistantRequestFeedback(
                                        key: ValueKey((
                                          _actor,
                                          widget.workspaceId,
                                          failure.id,
                                        )),
                                        api: widget.api,
                                        workspace: widget.workspaceId,
                                        vault: widget.vault,
                                        failure: failure,
                                        canWrite: _canPost,
                                        refresh: () => _refresh(force: true),
                                      ),
                                    for (final f in files)
                                      ReceivedAttachment(
                                        api: widget.api,
                                        mediaType: f['media_type'] as String?,
                                        path:
                                            '$_path/source-file?id=${Uri.encodeQueryComponent(f['id'] as String)}',
                                        filename:
                                            f['filename'] as String? ??
                                            uiText(context, 'Allegato'),
                                        onAsk:
                                            !_canPost || f['withdrawn'] == true
                                            ? null
                                            : () => _prepareFileQuestion(
                                                f['id'] as String,
                                                f['filename'] as String? ??
                                                    uiText(context, 'Allegato'),
                                              ),
                                        onMessage: () => _timeline.currentState
                                            ?.showMessage(item.id),
                                        withdrawn: f['withdrawn'] == true,
                                      ),
                                  ],
                                ),
                              );
                            },
                          ),
                        ),
                ),
                if (_revision != null &&
                    _canPost &&
                    _journal?.ready == true &&
                    MediaQuery.viewInsetsOf(context).bottom == 0)
                  LegacyRecoveryPanel(
                    api: widget.api,
                    scope: LegacyScope.workspace(widget.workspaceId),
                    vault: widget.vault,
                    journal: _journal,
                    allowed: () =>
                        mounted && _canPost && _actor == widget.api.actorId,
                  ),
                if (_revision != null && !_canPost)
                  Padding(
                    padding: EdgeInsets.all(12),
                    child: Text(
                      uiText(context, 'Puoi leggere questa conversazione.'),
                    ),
                  ),
                if (_canPost && _journal?.storageError == true)
                  _Notice(
                    text: 'Salvataggio protetto della bozza non disponibile.',
                    action: 'Riprova salvataggio',
                    onTap: () async {
                      try {
                        await _journal?.saveAgain();
                      } catch (_) {}
                    },
                  ),
                if (_canPost && _journal?.ready == true)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (fileReference != null)
                          Row(
                            children: [
                              const Icon(Icons.attach_file, size: 16),
                              Expanded(
                                child: Text(
                                  missingSource
                                      ? uiText(
                                          context,
                                          'File non disponibile · {0}',
                                          [fileReference.filename],
                                        )
                                      : fileReference.filename,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              IconButton(
                                tooltip: uiText(
                                  context,
                                  'Rimuovi riferimento al file',
                                ),
                                onPressed: () =>
                                    _journal!.quote(null, ask: true),
                                icon: const Icon(Icons.close, size: 18),
                              ),
                            ],
                          ),
                        if (quotedId != null)
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  quoted == null
                                      ? uiText(
                                          context,
                                          'Messaggio citato non disponibile',
                                        )
                                      : '${quoted.author} · ${quoted.content}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              IconButton(
                                tooltip: uiText(context, 'Rimuovi citazione'),
                                icon: const Icon(Icons.close, size: 18),
                                onPressed: () =>
                                    _journal!.quote(null, ask: asking),
                              ),
                            ],
                          ),
                        if (_journal?.attachmentProblem != null)
                          Text(uiText(context, _journal!.attachmentProblem!)),
                        if (_journal?.mentionProblem != null)
                          Semantics(
                            liveRegion: true,
                            child: Text(
                              uiText(context, _journal!.mentionProblem!),
                            ),
                          ),
                        if (!_sending && _journal!.pending == null)
                          MentionSuggestions(
                            api: widget.api,
                            workspace: widget.workspaceId,
                            people: _people,
                            editor: _editor,
                            focus: _focus,
                            choose: _chooseMention,
                          ),
                        if (_journal?.pending != null && !_sending)
                          _Notice(
                            text: 'Invio non confermato.',
                            action: 'Verifica e riprova',
                            onTap: _sending ? null : _send,
                          ),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: colors.surfaceContainer,
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: LayoutBuilder(
                            builder: (context, constraints) {
                              final field = TextField(
                                key: const Key('workspace-composer'),
                                controller: _editor,
                                focusNode: _focus,
                                onChanged: _editText,
                                minLines: 1,
                                maxLines: short ? 2 : 4,
                                maxLength: 12000,
                                keyboardType: TextInputType.multiline,
                                textInputAction: TextInputAction.newline,
                                decoration: InputDecoration(
                                  hintText: asking
                                      ? uiText(context, 'Chiedi a {0}…', [
                                          _assistantName,
                                        ])
                                      : uiText(context, 'Scrivi un messaggio'),
                                  counterText: '',
                                  border: InputBorder.none,
                                  contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 14,
                                    vertical: 12,
                                  ),
                                ),
                              );
                              final actions = [
                                AttachmentPicker(
                                  compact: true,
                                  staging: _journal!.staging,
                                  files: _journal!.files,
                                  enabled:
                                      !_sending && _journal!.pending == null,
                                  onChanged: _updateAttachments,
                                ),
                                IconButton(
                                  tooltip: uiText(context, 'Messaggio vocale'),
                                  icon: const Icon(Icons.mic_none),
                                  onPressed:
                                      _sending || _journal!.pending != null
                                      ? null
                                      : () => _openTool('voice'),
                                ),
                                IconButton(
                                  tooltip: uiText(
                                    context,
                                    'Azioni dello spazio',
                                  ),
                                  icon: const Text(
                                    '/',
                                    style: TextStyle(
                                      fontSize: 21,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  onPressed:
                                      _sending || _journal!.pending != null
                                      ? null
                                      : () => _openActions(),
                                ),
                                IconButton(
                                  tooltip: asking
                                      ? uiText(context, 'Torna al gruppo')
                                      : uiText(context, 'Chiedi a {0}', [
                                          _assistantName,
                                        ]),
                                  isSelected: asking,
                                  icon: const ImageIcon(emmeIcon, size: 21),
                                  selectedIcon: ImageIcon(
                                    emmeIcon,
                                    size: 21,
                                    color: colors.secondary,
                                  ),
                                  onPressed:
                                      _sending || _journal!.pending != null
                                      ? null
                                      : () {
                                          _journal!.quote(
                                            quotedId,
                                            ask: !asking,
                                            source: _journal!.quoteSource,
                                          );
                                          _focus.requestFocus();
                                        },
                                ),
                                ValueListenableBuilder<TextEditingValue>(
                                  valueListenable: _editor,
                                  builder: (context, value, child) =>
                                      IconButton(
                                        key: const Key('workspace-send'),
                                        tooltip: asking
                                            ? uiText(context, 'Invia a {0}', [
                                                _assistantName,
                                              ])
                                            : uiText(context, 'Invia'),
                                        onPressed:
                                            _sending ||
                                                missingSource ||
                                                _journal!.mentionProblem !=
                                                    null ||
                                                _journal?.pending != null ||
                                                (quotedId != null &&
                                                    quoted == null) ||
                                                (value.text.trim().isEmpty &&
                                                    (_journal!.files.isEmpty ||
                                                        asking)) ||
                                                (asking &&
                                                    _journal!
                                                            .outgoingContent(
                                                              value.text,
                                                            )
                                                            .length >
                                                        12000)
                                            ? null
                                            : _send,
                                        icon: _sending
                                            ? const SizedBox.square(
                                                dimension: 18,
                                                child:
                                                    CircularProgressIndicator(
                                                      strokeWidth: 2,
                                                    ),
                                              )
                                            : const Icon(Icons.arrow_upward),
                                      ),
                                ),
                              ];
                              if (short && constraints.maxWidth >= 740) {
                                return Row(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Expanded(child: field),
                                    ...actions,
                                  ],
                                );
                              }
                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  field,
                                  Row(
                                    children: [
                                      actions.first,
                                      const Spacer(),
                                      ...actions.skip(1),
                                    ],
                                  ),
                                ],
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
    return WorkspaceToolHost(
      key: _tools,
      authorized: _active && _revision != null && widget.api.actorId == _actor,
      revoked:
          widget.api.actorId != _actor ||
          (_revision == null &&
              _loadProblem ==
                  'Accedi di nuovo o verifica l’accesso allo spazio.'),
      child: chat,
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.text,
    required this.action,
    required this.onTap,
  });
  final String text, action;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    child: Row(
      children: [
        Expanded(
          child: Semantics(
            liveRegion: true,
            child: Text(uiText(context, text)),
          ),
        ),
        TextButton(onPressed: onTap, child: Text(uiText(context, action))),
      ],
    ),
  );
}
