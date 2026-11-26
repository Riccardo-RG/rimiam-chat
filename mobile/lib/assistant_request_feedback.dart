import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'workspace_command_journal.dart';

enum AssistantFailureReason {
  usage,
  configuration,
  temporary,
  invalid,
  rejected,
  other,
}

AssistantFailureReason assistantFailureReason(Object? code) => switch (code) {
  'AI_USAGE_LIMIT_REACHED' => AssistantFailureReason.usage,
  'AI_CONFIGURATION_REQUIRED' ||
  'AI_LIMIT_CONFIGURATION_INVALID' ||
  'ASSISTANT_CONNECTION_CHANGED' => AssistantFailureReason.configuration,
  'AI_TIMEOUT' ||
  'AI_RATE_LIMITED' ||
  'AI_PROVIDER_UNAVAILABLE' => AssistantFailureReason.temporary,
  'AI_OUTPUT_PARSE_ERROR' ||
  'INVALID_RESPONSE_MODE' ||
  'INVALID_SOURCE_REFERENCE' ||
  'SOURCE_NOT_PROVIDED' ||
  'TRIGGER_SOURCE_REQUIRED' => AssistantFailureReason.invalid,
  'INTERPRETATION_FAILED' ||
  'AI_REQUEST_REJECTED' => AssistantFailureReason.rejected,
  _ => AssistantFailureReason.other,
};

typedef AssistantFailure = ({
  String id,
  String name,
  AssistantFailureReason reason,
});

Map<String, AssistantFailure> explicitFailures(
  List<Map<String, dynamic>> messages,
  List<Map<String, dynamic>> readings,
) {
  final byId = {for (final m in messages) m['id']: m};
  final replies = {
    for (final m in messages)
      if (m['actor_kind'] == 'miriam') m['reply_to_source_id'],
  };
  final result = <String, AssistantFailure>{};
  for (final reading in readings) {
    if (reading['status'] != 'failed' ||
        reading['explicitRequest'] == false ||
        reading['otherMemberTarget'] == true ||
        reading['hasPublishedReply'] == true ||
        replies.contains(reading['source_id']))
      continue;
    final id = reading['requestMessageId'] ?? reading['source_id'];
    final message = byId[id];
    if (message == null ||
        message['actor_kind'] != 'human' ||
        message['purpose'] != 'conversation')
      continue;
    final name = reading['requestDisplayName'] as String? ?? 'Emme';
    if (reading['explicitRequest'] != true &&
        reading['requestMessageId'] == null &&
        message['assistanceContext'] == null) {
      // Old records can lack a bound addressee. The canonical address is
      // unambiguous; other names can belong to a person in this group.
      final names = <String>{
        'Emme',
        if (reading['otherMemberTarget'] == false) ...[
          'Miriam',
          'Rimiam',
          name.trim(),
        ],
      };
      final aliases = names
          .where((n) => n.isNotEmpty)
          .map(RegExp.escape)
          .join('|');
      final addressed = RegExp(
        r'^\s*(?:(?:ciao|ehi|hey|hello|hi)[\s,]+)?@?(?:' +
            aliases +
            r')(?![\p{L}\p{M}\p{N}_])',
        unicode: true,
        caseSensitive: false,
      );
      if (!addressed.hasMatch(message['content'] as String)) continue;
    }
    result[id as String] = (
      id: reading['id'] as String,
      name: name,
      reason: assistantFailureReason(reading['error_code']),
    );
  }
  return result;
}

class AssistantRequestFeedback extends StatefulWidget {
  const AssistantRequestFeedback({
    required super.key,
    required this.api,
    required this.workspace,
    required this.failure,
    required this.canWrite,
    required this.vault,
    required this.refresh,
  });
  final RimiamApi api;
  final DraftVault vault;
  final String workspace;
  final AssistantFailure failure;
  final bool canWrite;
  final Future<void> Function() refresh;
  @override
  State<AssistantRequestFeedback> createState() => _FeedbackState();
}

class _FeedbackState extends State<AssistantRequestFeedback> {
  late final journal = WorkspaceCommandJournal(
    widget.api,
    widget.vault,
    namespace: 'assistant-retry',
    collection: '${widget.workspace}/${widget.failure.id}',
  );
  bool busy = false;
  String? problem;
  Future<void> _retry() async {
    bool allowed() =>
        mounted && widget.canWrite && widget.api.actorId == journal.actor;
    if (busy || !allowed()) return;
    setState(() {
      busy = true;
      problem = null;
    });
    try {
      await journal.load();
      await journal.send(widget.workspace, {
        'type': 'interpretation.retry',
        'interpretationId': widget.failure.id,
      }, allowed: allowed);
      if (allowed()) await widget.refresh();
    } catch (e) {
      if (mounted)
        setState(
          () => problem = e is ApiError && e.status == 403
              ? 'Non hai più accesso a questa azione.'
              : 'Richiesta non confermata. Puoi verificarla con Riprova.',
        );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.failure.name;
    final label = switch (widget.failure.reason) {
      AssistantFailureReason.usage => uiText(
        context,
        '{0} ha raggiunto il limite di utilizzo. Il messaggio è salvo.',
        [name],
      ),
      AssistantFailureReason.configuration => uiText(
        context,
        'La connessione di {0} richiede una verifica. Il messaggio è salvo.',
        [name],
      ),
      AssistantFailureReason.temporary => uiText(
        context,
        '{0} è temporaneamente indisponibile. Il messaggio è salvo.',
        [name],
      ),
      AssistantFailureReason.invalid => uiText(
        context,
        '{0} non ha restituito una risposta utilizzabile. Il messaggio è salvo.',
        [name],
      ),
      _ => uiText(
        context,
        '{0} non ha potuto completare la richiesta. Il messaggio è salvo.',
        [name],
      ),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(label, style: Theme.of(context).textTheme.bodySmall),
        ),
        if (problem != null) Text(uiText(context, problem!)),
        if (widget.canWrite &&
            widget.failure.reason != AssistantFailureReason.other)
          TextButton(
            onPressed: busy ? null : _retry,
            child: Text(uiText(context, 'Riprova questa richiesta')),
          ),
      ],
    );
  }
}
