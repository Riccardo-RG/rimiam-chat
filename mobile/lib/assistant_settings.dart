import 'ui_language.dart';
import 'personal_navigation.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'assistant_instruction_export.dart';
import 'assistant_rhythm.dart';
import 'assistant_settings_model.dart';

class AssistantSettingsScreen extends StatefulWidget {
  const AssistantSettingsScreen({
    super.key,
    required this.api,
    this.workspaceId,
    this.workspaceName,
    this.exportInstructions = shareSavedInstructions,
  });
  final RimiamApi api;
  final String? workspaceId, workspaceName;
  final Future<void> Function(String, Rect) exportInstructions;
  @override
  State<AssistantSettingsScreen> createState() => _AssistantSettingsState();
}

class _AssistantSettingsState extends State<AssistantSettingsScreen>
    with WidgetsBindingObserver {
  late final repo = AssistantSettingsRepository(widget.api);
  final name = TextEditingController(), instructions = TextEditingController();
  final exportKey = GlobalKey();
  late String? scope = widget.workspaceId;
  late String title =
      widget.workspaceName ??
      (scope == null ? 'Tu ed Emme' : 'Spazio corrente');
  AssistantConfiguration? saved;
  List<SettingsJson> spaces = [];
  List<AssistantConnection> catalog = [];
  String? selected, issue, notice;
  bool busy = true, verify = false, allowPop = false;
  bool get dirty =>
      saved != null &&
      (name.text.trim() != saved!.name ||
          instructions.text.trim() != saved!.instructions ||
          selected != saved!.connectionId);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !busy && saved != null) {
      _revalidate();
    }
  }

  Future<void> _revalidate() async {
    final original = saved!;
    setState(() => busy = true);
    try {
      final fresh = await repo.read(scope);
      if (!mounted) return;
      setState(() {
        final changed =
            fresh.revision != original.revision ||
            fresh.connection(selected ?? '')?.revision !=
                original.connection(selected ?? '')?.revision;
        if (!fresh.canManage || !dirty && !verify) {
          _apply(fresh);
        } else if (changed) {
          verify = true;
          issue =
              'Le impostazioni sono cambiate. Controlla la versione salvata.';
        }
      });
    } catch (e) {
      if (mounted)
        setState(() {
          issue = assistantProblem(e);
          if (assistantAccessEnded(e)) {
            saved = null;
            name.clear();
            instructions.clear();
          }
        });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    name.dispose();
    instructions.dispose();
    super.dispose();
  }

  void _apply(AssistantConfiguration config) {
    saved = config;
    selected = config.connectionId;
    name.text = config.name;
    instructions.text = config.instructions;
    verify = false;
    if (scope == null) {
      spaces = config.spaces;
      catalog = config.connections;
    } else if (config.canManage) {
      spaces = [
        for (final space in spaces)
          if (space['workspaceId'] == scope)
            {
              ...space,
              'displayName': config.name,
              'connectionId': config.connectionId,
            }
          else
            space,
      ];
    }
  }

  Future<void> _load() async {
    setState(() {
      busy = true;
      issue = notice = null;
      saved = null;
      verify = false;
    });
    try {
      final wanted = scope;
      if (wanted != null) {
        // The optional personal directory must never gate a member's access to
        // the currently open space's configuration.
        repo.read(null).then((personal) {
          if (mounted && repo.actor == widget.api.actorId && scope == wanted)
            setState(() {
              spaces = personal.spaces;
              catalog = personal.connections;
            });
        }, onError: (Object _, StackTrace __) {});
      }
      final current = await repo.read(wanted);
      if (mounted && scope == wanted) setState(() => _apply(current));
    } catch (e) {
      if (mounted) setState(() => issue = assistantProblem(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<bool> _confirm(String title, String description, String action) async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(title),
            content: Text(description),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: Text(uiText(context, 'Annulla')),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: Text(action),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<bool> _discard() async =>
      !dirty ||
      await _confirm(
        uiText(context, 'Uscire senza salvare?'),
        uiText(context, 'Le modifiche a questa conversazione andranno perse.'),
        uiText(context, 'Esci senza salvare'),
      );

  Future<void> _scopePicker() async {
    if (busy) return;
    final options = <String, (String, String)>{
      '': ('Tu ed Emme', 'Chat personale'),
      if (widget.workspaceId != null)
        widget.workspaceId!: (
          widget.workspaceName ?? 'Spazio corrente',
          'Spazio',
        ),
      for (final item in spaces)
        item['workspaceId'] as String: (
          item['workspaceName'] as String,
          '${item['displayName']} · ${_connectionLabel(item['connectionId'] as String)}',
        ),
    };
    final choice = await _choose(
      context,
      'Conversazione da configurare',
      options,
      scope ?? '',
    );
    if (choice == null ||
        choice == (scope ?? '') ||
        !mounted ||
        !await _discard() ||
        !mounted)
      return;
    scope = choice.isEmpty ? null : choice;
    title = options[choice]!.$1;
    await _load();
  }

  String _connectionLabel(String id) {
    final label =
        catalog.where((item) => item.id == id).firstOrNull?.label ??
        saved?.connection(id)?.label;
    return label ?? (id == 'default' ? 'Predefinito' : id);
  }

  Future<void> _connectionPicker() async {
    final base = saved;
    if (busy || base == null || !base.canManage) return;
    final choice = await _choose(
      context,
      'Modello o agente',
      {
        for (final entry in base.connections)
          entry.id: (
            entry.label,
            "${entry.agent ? 'Agente' : 'Modello'} · ${entry.configured ? entry.destination : 'Inattivo'}",
          ),
      },
      selected,
      disabled: {
        for (final c in base.connections)
          if (!c.selectable) c.id,
      },
    );
    if (choice != null && mounted)
      setState(() {
        selected = choice;
        notice = null;
      });
  }

  Future<void> _save() async {
    final base = saved, id = selected;
    if (base == null || id == null || busy || verify || !base.canManage) return;
    final c = base.connection(id);
    if (c == null || !c.selectable) return;
    if (id != base.connectionId || base.reconfirm) {
      if (!await _confirm(
            uiText(context, 'Conferma la connessione'),
            uiText(
              context,
              'Per rispondere in «{0}», il servizio riceverà il contesto necessario.\n\n{1}\n{2}\n\n{3}',
              [title, c.label, c.destination, c.usage],
            ),
            uiText(context, 'Conferma'),
          ) ||
          !mounted)
        return;
    }
    setState(() {
      busy = true;
      issue = notice = null;
    });
    try {
      final result = await repo.save(
        workspace: scope,
        base: base,
        connectionId: id,
        name: name.text,
        instructions: instructions.text,
      );
      if (!mounted) return;
      setState(() {
        _apply(result);
        notice = 'Impostazioni salvate in «$title».';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        issue = assistantProblem(e);
        if (assistantAccessEnded(e)) {
          saved = null;
          name.clear();
          instructions.clear();
        } else if (e is! FormatException) {
          verify = true;
          if (e is! ApiError || e.status >= 500) issue = 'Esito del salvataggio sconosciuto. Verifica la versione salvata.';
        }
      });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _verify() async {
    final base = saved;
    if (busy || base == null) return;
    setState(() {
      busy = true;
      issue = null;
    });
    try {
      final current = await repo.read(scope);
      if (!mounted) return;
      final exact =
          current.connectionId == selected &&
          current.name == name.text.trim() &&
          current.instructions == instructions.text.trim() &&
          !current.reconfirm &&
          current.connection(current.connectionId)?.revision ==
              base.connection(selected ?? '')?.revision;
      if (exact || !current.canManage) {
        setState(() {
          _apply(current);
          if (exact) notice = 'Impostazioni verificate in «$title».';
        });
      } else if (current.revision == base.revision &&
          current.connection(selected ?? '')?.selectable == true &&
          current.connection(selected ?? '')?.revision ==
              base.connection(selected ?? '')?.revision) {
        setState(() {
          saved = current;
          verify = false;
          notice = 'Le modifiche sono ancora da salvare.';
        });
      } else {
        final replace = await _confirm(
          uiText(context, 'Caricare la versione aggiornata?'),
          uiText(
            context,
            'Sul server è salvata la versione {0} di «{1}». Caricandola sostituisci le modifiche nel modulo.',
            [current.revision, title],
          ),
          uiText(context, 'Carica versione salvata'),
        );
        if (mounted)
          setState(() {
            if (replace) {
              _apply(current);
              notice = 'Versione salvata caricata.';
            } else {
              issue = 'Le modifiche nel modulo sono ancora disponibili per la consultazione.';
            }
          });
      }
    } catch (e) {
      if (mounted)
        setState(() {
          issue = assistantProblem(e);
          if (assistantAccessEnded(e)) {
            saved = null;
            name.clear();
            instructions.clear();
          }
        });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _export() async {
    if (busy || saved == null) return;
    final box = exportKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final anchor = box.localToGlobal(Offset.zero) & box.size;
    setState(() {
      busy = true;
      notice = issue = null;
    });
    try {
      final current = await repo.read(scope);
      if (mounted) await widget.exportInstructions(current.effective, anchor);
    } catch (e) {
      if (mounted)
        setState(() {
          issue = assistantAccessEnded(e)
              ? assistantProblem(e)
              : 'Esportazione non riuscita. Riprova.';
          if (assistantAccessEnded(e)) {
            saved = null;
            name.clear();
            instructions.clear();
          }
        });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = saved, c = s?.connection(selected ?? '');
    final canEdit = s?.canManage == true && !busy && !verify;
    return PopScope(
      canPop: allowPop || !dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || busy || !await _discard() || !context.mounted) return;
        setState(() => allowPop = true);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted) Navigator.of(context).pop();
        });
      },
      child: Scaffold(
        appBar: AppBar(
          title: PersonalNavTitle(uiText(context, 'Configura Emme')),
        ),
        body: SafeArea(
          child: ListView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(title),
                subtitle: Text(uiText(context, 'Conversazione da configurare')),
                trailing: const Icon(Icons.unfold_more),
                onTap: busy ? null : _scopePicker,
              ),
              if (busy && s == null) const LinearProgressIndicator(),
              if (s != null) ...[
                const Divider(),
                const SizedBox(height: 8),
                if (!s.canManage)
                  Text(
                    uiText(
                      context,
                      'Solo chi ha creato lo spazio può cambiare nome, istruzioni e connessione.',
                    ),
                  ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    c?.label ?? uiText(context, 'Connessione non disponibile'),
                  ),
                  subtitle: Text(
                    c == null
                        ? uiText(context, 'Modello o agente')
                        : "${c.agent ? 'Agente' : 'Modello'} · ${c.destination}",
                  ),
                  trailing: s.canManage ? const Icon(Icons.expand_more) : null,
                  onTap: canEdit ? _connectionPicker : null,
                ),
                if (c != null) Text(c.usage),
                if (s.reconfirm)
                  Text(
                    uiText(
                      context,
                      'La destinazione del servizio è cambiata. Per usarla serve una nuova conferma.',
                    ),
                  ),
                const SizedBox(height: 20),
                TextField(
                  controller: name,
                  readOnly: !canEdit,
                  maxLength: 48,
                  decoration: InputDecoration(
                    labelText: uiText(context, 'Nome dell’assistente'),
                  ),
                  onChanged: (_) => setState(() => notice = null),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: instructions,
                  readOnly: !canEdit,
                  maxLength: 5000,
                  minLines: 3,
                  maxLines: 8,
                  decoration: InputDecoration(
                    labelText: scope == null
                        ? uiText(context, 'Istruzioni personali')
                        : uiText(context, 'Istruzioni dello spazio'),
                    alignLabelWithHint: true,
                    hintText: uiText(
                      context,
                      'Scrivi le indicazioni in inglese',
                    ),
                  ),
                  onChanged: (_) => setState(() => notice = null),
                ),
                Text(
                  scope == null
                      ? uiText(
                          context,
                          'Valgono per «Tu ed Emme». Se lasci vuoto, si applicano le istruzioni predefinite di RIMIAM.',
                        )
                      : uiText(
                          context,
                          'Valgono per questo spazio. Se lasci vuoto, si applicano le istruzioni predefinite di RIMIAM.',
                        ),
                ),
                if (s.canManage && instructions.text.trim().isNotEmpty)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: canEdit
                          ? () => setState(() {
                              instructions.clear();
                              notice = null;
                            })
                          : null,
                      child: Text(
                        uiText(context, 'Usa le istruzioni predefinite'),
                      ),
                    ),
                  ),
                if (s.canManage)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: FilledButton(
                      onPressed:
                          canEdit &&
                              (dirty || s.reconfirm) &&
                              name.text.trim().isNotEmpty &&
                              c?.selectable == true
                          ? _save
                          : null,
                      child: Text(uiText(context, 'Salva impostazioni')),
                    ),
                  ),
                if (verify)
                  OutlinedButton(
                    onPressed: busy ? null : _verify,
                    child: Text(uiText(context, 'Verifica versione salvata')),
                  ),
                if (notice != null)
                  Semantics(
                    liveRegion: true,
                    child: Text(uiText(context, notice!)),
                  ),
              ],
              if (issue != null)
                Semantics(liveRegion: true, child: Text(issue!)),
              if (s == null && !busy)
                TextButton(
                  onPressed: _load,
                  child: Text(uiText(context, 'Ricarica')),
                ),
              if (s != null) ...[
                const Divider(),
                for (final section in [
                  ('Istruzioni predefinite di RIMIAM', s.defaults),
                  ('Regole fisse di RIMIAM', s.rules),
                ])
                  ExpansionTile(
                    key: ValueKey((scope, section.$1)),
                    tilePadding: EdgeInsets.zero,
                    title: Text(section.$1),
                    children: [SelectableText(section.$2)],
                  ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: exportKey,
                    onPressed: busy ? null : _export,
                    icon: const Icon(Icons.ios_share_outlined),
                    label: Text(
                      uiText(context, 'Esporta istruzioni salvate (.md)'),
                    ),
                  ),
                ),
                if (scope != null)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.tune),
                    title: Text(uiText(context, 'Ritmo di Emme')),
                    subtitle: Text(
                      uiText(context, 'Quando può intervenire nel gruppo'),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: busy
                        ? null
                        : () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => AssistantRhythmScreen(
                                api: widget.api,
                                workspaceId: scope!,
                                workspaceName: title,
                              ),
                            ),
                          ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

Future<String?> _choose(
  BuildContext context,
  String title,
  Map<String, (String, String)> options,
  String? selected, {
  Set<String> disabled = const {},
}) => showModalBottomSheet<String>(
  context: context,
  useSafeArea: true,
  builder: (sheet) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      ListTile(
        title: Text(title, style: Theme.of(context).textTheme.titleMedium),
        trailing: IconButton(
          tooltip: uiText(sheet, 'Chiudi'),
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.pop(sheet),
        ),
      ),
      Flexible(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final item in options.entries)
              ListTile(
                title: Text(item.value.$1),
                subtitle: Text(item.value.$2),
                selected: item.key == selected,
                enabled: !disabled.contains(item.key),
                trailing: item.key == selected ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(sheet, item.key),
              ),
          ],
        ),
      ),
    ],
  ),
);
