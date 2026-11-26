import 'ui_language.dart';

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'agenda_commands.dart';
import 'agenda_editor.dart';

class HomeAgendaPreview extends StatefulWidget {
  HomeAgendaPreview({
    Key? key,
    required this.api,
    required this.open,
    this.vault = const DeviceDraftVault(),
    this.timeZone = agendaLocalZone,
    this.now = DateTime.now,
  }) : super(key: key ?? ValueKey((api, api.actorId)));
  final RimiamApi api;
  final Future<void> Function(AgendaAction?) open;
  final DraftVault vault;
  final Future<String> Function() timeZone;
  final DateTime Function() now;
  @override
  State<HomeAgendaPreview> createState() => _HomeAgendaPreviewState();
}

class _HomeAgendaPreviewState extends State<HomeAgendaPreview>
    with WidgetsBindingObserver {
  late final _actor = widget.api.actorId,
      _key =
          'rimiam.home.agenda.${sha256.convert(utf8.encode(jsonEncode([widget.api.origin.origin, _actor])))}';
  bool _visible = true, _started = false, _active = true, _loading = false;
  List<AgendaJson> _items = [];
  String? _error;
  int _generation = 0;
  late final Timer _timer;
  Future<void> _preferenceWrites = Future.value();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_active && _visible && ModalRoute.of(context)?.isCurrent != false)
        unawaited(_refresh());
    });
    unawaited(_start());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    String? pref;
    try {
      pref = await widget.vault.read(_key);
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _visible = pref != 'hidden';
      _started = true;
    });
    if (_visible) await _refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
      _active = false;
      _generation++;
      if (mounted) setState(() => _items = []);
    } else if (s == AppLifecycleState.resumed) {
      _active = true;
      if (_visible) unawaited(_refresh());
    }
  }

  Future<void> _refresh() async {
    if (!_started || !_visible || !_active || widget.api.actorId != _actor)
      return;
    final g = ++_generation;
    setState(() => _loading = true);
    try {
      final z = await widget.timeZone();
      final result = await widget.api.get(agendaPath(widget.now(), z));
      if (mounted && g == _generation && widget.api.actorId == _actor)
        setState(() {
          _items = agendaRows(result['items']);
          _error = null;
        });
    } catch (_) {
      if (mounted && g == _generation)
        setState(() {
          _error = 'Impossibile aggiornare gli impegni.';
          _items = [];
        });
    } finally {
      if (mounted && g == _generation) setState(() => _loading = false);
    }
  }

  void _toggle() {
    final value = !_visible;
    _generation++;
    setState(() {
      _visible = value;
      _items = [];
      _error = null;
      _loading = false;
    });
    _preferenceWrites = _preferenceWrites
        .then((_) => widget.vault.replace(_key, value ? null : 'hidden'))
        .catchError((Object _) {
          if (mounted)
            setState(
              () =>
                  _error = 'Impossibile salvare la preferenza sul dispositivo.',
            );
        });
    if (value) unawaited(_refresh());
  }

  Future<void> _open(AgendaAction? action) async {
    await widget.open(action);
    if (mounted && _visible) await _refresh();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          Expanded(
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => _open(null),
                child: Text(
                  uiText(context, 'Oggi'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: _visible
                ? uiText(context, 'Nascondi Oggi')
                : uiText(context, 'Mostra Oggi'),
            onPressed: _started ? _toggle : null,
            icon: Icon(_visible ? Icons.expand_less : Icons.expand_more),
          ),
        ],
      ),
      if (_visible && _started) ...[
        Wrap(
          spacing: 4,
          children: [
            TextButton.icon(
              onPressed: () => _open(null),
              icon: const Icon(Icons.calendar_month_outlined, size: 18),
              label: Text(uiText(context, 'Calendario')),
            ),
            TextButton.icon(
              onPressed: () => _open(AgendaAction.reminder),
              icon: const Icon(Icons.add_alert_outlined, size: 18),
              label: Text(uiText(context, 'Nuovo promemoria')),
            ),
            TextButton.icon(
              onPressed: () => _open(AgendaAction.appointment),
              icon: const Icon(Icons.event_available_outlined, size: 18),
              label: Text(uiText(context, 'Nuovo appuntamento')),
            ),
          ],
        ),
        if (_error != null)
          TextButton(
            onPressed: _refresh,
            child: Text(uiText(context, '{0} Riprova', [_error])),
          )
        else if (_items.isEmpty && _loading)
          const LinearProgressIndicator()
        else if (_items.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 6),
            child: Text(uiText(context, 'Nessun impegno oggi.')),
          )
        else ...[
          for (final i in _items.take(3))
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: Text(
                agendaTime(
                  context,
                  DateTime.parse(i['at'] as String).toLocal(),
                ),
              ),
              title: Text(
                i['title'] as String,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                [
                  if (i['personal'] == true)
                    uiText(context, 'Solo io')
                  else
                    i['workspaceName'] as String,
                  if (i['rsvp'] == 'pending') uiText(context, 'Da confermare'),
                ].join(' · '),
              ),
              onTap: () => _open(null),
            ),
          if (_items.length > 3)
            TextButton(
              onPressed: () => _open(null),
              child: Text(
                uiText(context, 'Tutti gli impegni ({0})', [_items.length]),
              ),
            ),
        ],
      ],
    ],
  );
}
