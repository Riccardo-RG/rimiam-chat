import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'assistant_settings_model.dart';
import 'chat_journal.dart';
import 'workspace_command_journal.dart';

const _modes = {
  'discreet': (
    'Solo quando chiamata',
    'Risponde a una menzione o a «Chiedi a Emme».',
  ),
  'collaborative': (
    'Collaborativa',
    'Può rispondere anche a una domanda aperta al gruppo.',
  ),
  'proactive': (
    'Propositiva',
    'Può anche segnalare un rischio concreto indicando la fonte.',
  ),
};

class AssistantRhythmScreen extends StatefulWidget {
  const AssistantRhythmScreen({
    super.key,
    required this.api,
    required this.workspaceId,
    required this.workspaceName,
    this.vault = const DeviceDraftVault(),
  });
  final RimiamApi api;
  final String workspaceId, workspaceName;
  final DraftVault vault;
  @override
  State<AssistantRhythmScreen> createState() => _AssistantRhythmScreenState();
}

class _AssistantRhythmScreenState extends State<AssistantRhythmScreen> {
  late final journal = WorkspaceCommandJournal(
    widget.api,
    widget.vault,
    namespace: 'rhythm',
    collection: widget.workspaceId,
  );
  String get path =>
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspaceId)}';
  String? current, selected, error;
  int version = 0;
  bool busy = true, canWrite = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      busy = true;
      error = null;
      current = selected = null;
      canWrite = false;
    });
    try {
      if (widget.api.actorId != journal.actor)
        throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
      final result = await Future.wait([
        widget.api.get('$path/attention'),
        widget.api.get('$path/workspace'),
      ]);
      if (!mounted || widget.api.actorId != journal.actor) return;
      final member = (result[1]['members'] as List)
          .cast<SettingsJson>()
          .where((m) => m['user_id'] == journal.actor && m['active'] == true)
          .firstOrNull;
      if (member == null) throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
      final pref = result[0]['preference'] as SettingsJson;
      final mode = pref['mode'] as String;
      if (!_modes.containsKey(mode))
        throw const FormatException('Preferenza non riconosciuta.');
      await journal.load();
      if (!mounted || widget.api.actorId != journal.actor) return;
      setState(() {
        canWrite = member['contributes'] == true;
        current = mode;
        selected = (journal.pending?['command']?['mode'] as String?) ?? mode;
        version = pref['version'] as int;
      });
    } catch (e) {
      if (mounted) setState(() => error = assistantProblem(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _save() async {
    if (busy ||
        !canWrite ||
        selected == null ||
        widget.api.actorId != journal.actor)
      return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await journal.send(
        widget.workspaceId,
        (journal.pending?['command'] as SettingsJson?) ??
            {
              'type': 'attention.preference',
              'mode': selected,
              'expectedVersion': version,
            },
        allowed: () => mounted && canWrite,
      );
      if (!mounted) return;
      await _load();
      if (mounted && current != null && error == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(uiText(context, 'Ritmo salvato per lo spazio.')),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = journal.pending == null
            ? assistantProblem(e)
            : 'Salvataggio da verificare. Puoi riprendere la stessa richiesta.';
        if (assistantAccessEnded(e) ||
            (e is ApiError && e.code == 'STATE_STALE')) {
          current = selected = null;
          canWrite = false;
          error = assistantProblem(e);
        }
        busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = journal.pending != null;
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Ritmo di Emme'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              widget.workspaceName,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              uiText(
                context,
                'Scegli quando Emme può intervenire nella chat del gruppo.',
              ),
            ),
            if (busy) const LinearProgressIndicator(),
            if (current != null) ...[
              const SizedBox(height: 16),
              ..._modes.entries.map(
                (mode) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    selected == mode.key
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked,
                  ),
                  selected: selected == mode.key,
                  enabled: canWrite && !busy && !pending,
                  title: Text(uiText(context, mode.value.$1)),
                  subtitle: Text(uiText(context, mode.value.$2)),
                  onTap: () => setState(() => selected = mode.key),
                ),
              ),
              if (canWrite)
                FilledButton(
                  onPressed: !busy && (pending || selected != current)
                      ? _save
                      : null,
                  child: Text(
                    pending
                        ? uiText(context, 'Verifica salvataggio')
                        : uiText(context, 'Salva ritmo'),
                  ),
                )
              else
                Text(
                  uiText(
                    context,
                    'Può cambiare il ritmo chi può scrivere nello spazio.',
                  ),
                ),
            ],
            if (error != null)
              Semantics(liveRegion: true, child: Text(uiText(context, error!))),
            if (error != null && current == null)
              TextButton(
                onPressed: busy ? null : _load,
                child: Text(uiText(context, 'Ricarica')),
              ),
          ],
        ),
      ),
    );
  }
}
