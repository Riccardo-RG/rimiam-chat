import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'studio_theme.dart';
import 'ui_language.dart';

/// Reads the shared work projection when the open workspace revision changes.
class WorkspacePresence extends StatefulWidget {
  const WorkspacePresence({
    super.key,
    required this.api,
    required this.workspace,
    required this.revision,
    required this.assistant,
    required this.openWork,
    this.readingStates = const {},
    this.unconfigured = false,
    this.openContext,
  });

  final RimiamApi api;
  final String workspace, assistant;
  final int revision;
  final ValueChanged<String?> openWork;
  final Set<String> readingStates;
  final bool unconfigured;
  final VoidCallback? openContext;

  @override
  State<WorkspacePresence> createState() => _WorkspacePresenceState();
}

typedef _WorkSignal = ({String id, String objective, String status});

class _WorkspacePresenceState extends State<WorkspacePresence> {
  final _menu = MenuController();
  late String _actor;
  int _request = 0;
  bool _loading = true, _failed = false;
  List<_WorkSignal> _ongoing = [], _results = [];

  @override
  void initState() {
    super.initState();
    _read();
  }

  @override
  void didUpdateWidget(WorkspacePresence old) {
    super.didUpdateWidget(old);
    final changedScope =
        old.workspace != widget.workspace ||
        old.api != widget.api ||
        _actor != widget.api.actorId;
    if (changedScope || old.revision != widget.revision) {
      _read(keepVisible: !changedScope && !_failed);
    }
  }

  Future<void> _read({bool keepVisible = false}) async {
    final request = ++_request;
    final actor = _actor = widget.api.actorId;
    if (!keepVisible) {
      setState(() {
        _ongoing = [];
        _results = [];
        _loading = true;
        _failed = false;
      });
    }
    try {
      final view = await widget.api.get(
        '/api/v1/workspaces/${Uri.encodeComponent(widget.workspace)}/active-work-presence',
      );
      final ongoing = [
        for (final item in view['ongoing'] as List)
          (
            id: item['id'] as String,
            objective: item['objective'] as String,
            status: switch (item['phase']) {
              'queued' => 'In attesa',
              'working' => 'In corso',
              'paused' => 'In pausa',
              'needs_input' when item['blocked'] == true =>
                'Lavoro da verificare',
              'needs_input' => 'Serve un chiarimento',
              _ => throw const FormatException(),
            },
          ),
      ];
      final results = [
        for (final item in view['results'] as List)
          (
            id: item['id'] as String,
            objective: item['objective'] as String,
            status: item['validity'] == 'potentially_outdated'
                ? 'Risultato da ricontrollare'
                : 'Risultato pronto',
          ),
      ];
      if (!mounted || _request != request || widget.api.actorId != actor)
        return;
      setState(() {
        _ongoing = ongoing;
        _results = results;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || _request != request || widget.api.actorId != actor)
        return;
      setState(() {
        _ongoing = [];
        _results = [];
        _loading = false;
        _failed = true;
      });
    }
  }

  void _open(String? id) {
    _menu.close();
    if (mounted && widget.api.actorId == _actor) widget.openWork(id);
  }

  @override
  Widget build(BuildContext context) {
    if (_actor != widget.api.actorId) return const SizedBox.shrink();
    final t = Theme.of(context);
    final width = math.min(320.0, MediaQuery.sizeOf(context).width - 32);
    final title = uiText(context, 'Attività di {0}', [widget.assistant]);
    final signal = _ongoing
        .where((item) => item.status != 'In pausa')
        .firstOrNull;
    final reading = widget.unconfigured
        ? null
        : widget.readingStates.contains('running')
        ? '{0} sta leggendo…'
        : widget.readingStates.contains('queued')
        ? 'Lettura di {0} in attesa.'
        : null;
    final review =
        widget.readingStates.contains('failed') ||
        widget.readingStates.contains('stale');
    final status = widget.unconfigured
        ? '{0} non disponibile.'
        : _failed
        ? 'Attività non disponibile.'
        : signal?.status ??
              reading ??
              (review ? 'Verifica lettura di {0}' : null);
    final label = status == null
        ? title
        : '$title · ${uiText(context, status, [widget.assistant])}';

    Widget note(String text, [List<Object?> args = const []]) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(uiText(context, text, args), style: t.textTheme.bodySmall),
    );
    Widget entry(_WorkSignal item) => MenuItemButton(
      onPressed: () => _open(item.id),
      child: SizedBox(
        width: width - 48,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(item.objective, maxLines: 2, overflow: TextOverflow.ellipsis),
            Text(uiText(context, item.status), style: t.textTheme.bodySmall),
          ],
        ),
      ),
    );
    return MenuAnchor(
      controller: _menu,
      style: MenuStyle(
        maximumSize: WidgetStatePropertyAll(Size(width, double.infinity)),
      ),
      menuChildren: [
        SizedBox(
          width: width - 16,
          child: Row(
            children: [
              const SizedBox(width: 12),
              Expanded(child: Text(title, style: t.textTheme.titleSmall)),
              IconButton(
                tooltip: uiText(context, 'Chiudi attività'),
                icon: const Icon(Icons.close),
                onPressed: _menu.close,
              ),
            ],
          ),
        ),
        if (widget.unconfigured)
          note(
            'Il servizio AI non è configurato. Puoi continuare a scrivere al gruppo.',
          ),
        if (reading != null) note(reading, [widget.assistant]),
        if (review && widget.openContext != null)
          MenuItemButton(
            onPressed: () {
              _menu.close();
              if (widget.api.actorId == _actor) widget.openContext?.call();
            },
            child: Text(
              uiText(context, 'Verifica lettura di {0}', [widget.assistant]),
            ),
          ),
        if (_loading) note('Caricamento…'),
        if (_failed) ...[
          note('Attività non disponibile.'),
          MenuItemButton(
            closeOnActivate: false,
            onPressed: () => _read(),
            child: Text(uiText(context, 'Riprova')),
          ),
        ],
        if (!_loading && !_failed) ...[
          if (_ongoing.isEmpty) note('Nessun lavoro in corso.'),
          for (final item in _ongoing) entry(item),
          if (_results.isNotEmpty) note('Ultimi risultati'),
          for (final item in _results) entry(item),
          MenuItemButton(
            onPressed: () => _open(null),
            child: Text(uiText(context, 'Tutti i lavori')),
          ),
        ],
      ],
      builder: (context, controller, child) => IconButton(
        tooltip: label,
        icon: Badge(
          isLabelVisible: status != null,
          backgroundColor: _failed || widget.unconfigured
              ? t.colorScheme.error
              : t.colorScheme.secondary,
          child: const ImageIcon(emmeIcon, size: 22),
        ),
        onPressed: () =>
            controller.isOpen ? controller.close() : controller.open(),
      ),
    );
  }
}
