import 'ui_language.dart';
import 'personal_navigation.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'agenda_commands.dart';
import 'agenda_editor.dart';
export 'agenda_commands.dart' show AgendaAction;
export 'agenda_preview.dart' show HomeAgendaPreview;

class AgendaPage extends StatefulWidget {
  AgendaPage({
    Key? key,
    required this.api,
    this.vault = const DeviceDraftVault(),
    this.initialAction,
    this.timeZone = agendaLocalZone,
    this.now = DateTime.now,
  }) : super(key: key ?? ValueKey((api, api.actorId)));
  final RimiamApi api;
  final DraftVault vault;
  final AgendaAction? initialAction;
  final Future<String> Function() timeZone;
  final DateTime Function() now;
  @override
  State<AgendaPage> createState() => _AgendaPageState();
}

class _AgendaPageState extends State<AgendaPage> with WidgetsBindingObserver {
  late final _actor = widget.api.actorId,
      _commands = AgendaCommands(widget.api, widget.vault);
  late DateTime _day = widget.now();
  String? _zone, _error, _calendar;
  String _filter = 'all';
  bool _active = true,
      _loaded = false,
      _saving = false,
      _initial = true,
      _previous = false,
      _busyLoading = false;
  bool _followToday = true;
  int _epoch = 0;
  AgendaJson? _view;
  List<AgendaJson> _rooms = [], _calendarEvents = [];
  AgendaForm? _form;
  late final Timer _timer;
  bool get _same => mounted && _active && widget.api.actorId == _actor;
  bool get _editable =>
      _same && _loaded && !_saving && _commands.pending == null;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_same && _form == null && !_saving && !_busyLoading)
        unawaited(_load());
    });
    unawaited(_load(restore: true));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.hidden ||
        state == AppLifecycleState.paused) {
      _active = false;
      _epoch++;
      setState(() {
        _view = null;
        _rooms = [];
        _calendarEvents = [];
        _loaded = false;
        _error = null;
      });
    } else if (state == AppLifecycleState.resumed && !_active) {
      _active = true;
      unawaited(_load(restore: true));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer.cancel();
    super.dispose();
  }

  String _dayTitle(DateTime date) =>
      MaterialLocalizations.of(context).formatMediumDate(date);
  Future<List<AgendaJson>> _events(String workspace, DateTime d) async {
    final start = DateTime(d.year, d.month, d.day).toUtc().toIso8601String(),
        end = DateTime(d.year, d.month, d.day + 1).toUtc().toIso8601String();
    final view = await widget.api.get(
      '/api/v1/workspaces/${Uri.encodeComponent(workspace)}/calendar?start=${Uri.encodeQueryComponent(start)}&end=${Uri.encodeQueryComponent(end)}',
    );
    if (view['workspaceId'] != workspace)
      throw const FormatException('Calendario inatteso');
    return agendaRows(view['temporal'])
        .where(
          (i) =>
              i['kind'] == 'scheduled_event' &&
              DateTime.parse(i['payload']['end'] as String)
                  .isAfter(DateTime.parse(start)) &&
              DateTime.parse(i['payload']['start'] as String)
                  .isBefore(DateTime.parse(end)),
        )
        .toList()
      ..sort(
        (a, b) =>
            DateTime.parse(a['payload']['start'] as String)
                .compareTo(DateTime.parse(b['payload']['start'] as String)),
      );
  }

  Future<void> _load({bool restore = false}) async {
    final epoch = ++_epoch;
    if (_followToday) _day = widget.now();
    _busyLoading = true;
    try {
      final zone = await widget.timeZone();
      if (zone.isEmpty)
        throw const FormatException('Fuso del dispositivo non disponibile.');
      final result = await Future.wait([
        widget.api.get(agendaPath(_day, zone)),
        widget.api.get('/api/v1/workspaces'),
      ]);
      if (!_same || epoch != _epoch) return;
      final rooms = agendaRows(result[1]['workspaces']);
      final selected = _calendar;
      final hasCalendar =
          selected != null && rooms.any((w) => w['id'] == selected);
      final events = hasCalendar
          ? await _events(selected, _day)
          : <AgendaJson>[];
      if (restore && !_commands.busy) await _commands.load();
      if (!_same || epoch != _epoch) return;
      setState(() {
        _zone = zone;
        _view = result[0];
        _rooms = rooms;
        _calendar = hasCalendar ? selected : null;
        _calendarEvents = events;
        _loaded = true;
        _error = null;
        if (_form != null &&
            (!_visibleDraft(_form!.toJson()) ||
                (restore && !_commands.busy && _commands.draft == null)))
          _form = null;
      });
      if (_initial) {
        _initial = false;
        if (widget.initialAction != null && _commands.pending == null)
          await _new(widget.initialAction!);
      }
    } catch (e) {
      if (_same && epoch == _epoch)
        setState(() {
          _error = e is FormatException
              ? e.message
              : 'Impossibile aggiornare l’agenda.';
          if (e is ApiError && {401, 403, 404}.contains(e.status)) {
            _loaded = false;
            _view = null;
            _form = null;
            _rooms = [];
            _calendar = null;
            _calendarEvents = [];
          }
        });
    } finally {
      if (epoch == _epoch) _busyLoading = false;
    }
  }

  bool _visibleDraft(AgendaJson draft) {
    final target = draft['target'];
    return target == '' || _rooms.any((r) => r['id'] == target);
  }

  Future<void> _saveDraft() async {
    try {
      await _commands.saveDraft(_form);
    } catch (_) {
      if (_same)
        setState(
          () => _error = 'Impossibile salvare la bozza sul dispositivo.',
        );
    }
  }

  Future<bool> _confirm(String text, String action) async =>
      (await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          content: Text(text),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: Text(uiText(c, 'Annulla')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: Text(action),
            ),
          ],
        ),
      )) ??
      false;
  Future<void> _new(AgendaAction kind) async {
    if (!_editable) return;
    if (_commands.draft != null &&
        !await _confirm(
          uiText(
            context,
            'Hai una bozza di agenda. Vuoi sostituirla con una nuova?',
          ),
          uiText(context, 'Sostituisci bozza'),
        ))
      return;
    if (!_editable) return;
    final now = widget.now(),
        initial = DateTime(_day.year, _day.month, _day.day, now.hour + 1);
    setState(
      () => _form = AgendaForm(
        kind: kind,
        start: initial,
        end: initial.add(const Duration(hours: 1)),
      ),
    );
    await _saveDraft();
  }

  Future<void> _edit(AgendaJson item, {AgendaJson? calendarEntry}) async {
    if (!_editable || item['owner'] != _actor) return;
    if (_commands.draft != null &&
        !await _confirm(
          uiText(context, 'Sostituire la bozza di agenda con questa modifica?'),
          uiText(context, 'Sostituisci bozza'),
        ))
      return;
    final w = item['workspaceId'] as String;
    final event = item['kind'] == 'event';
    final at = DateTime.parse(item['at'] as String).toLocal();
    try {
      final row = event
          ? calendarEntry ??
                (await _events(w, at))
                    .where(
                      (e) =>
                          e['id'] == item['id'] &&
                          e['version'] == item['version'],
                    )
                    .firstOrNull
          : null;
      if (event && row == null)
        throw const FormatException(
          'L’appuntamento è cambiato. Riapri la versione aggiornata.',
        );
      if (!_editable) return;
      final audience = row?['audience'] as AgendaJson?;
      setState(
        () => _form = AgendaForm(
          kind: event ? AgendaAction.appointment : AgendaAction.reminder,
          item: {...item, if (event) 'eventZone': row!['payload']['timeZone']},
          target: item['personal'] == true ? '' : w,
          title: item['title'] as String,
          start: at,
          end: event
              ? DateTime.parse(item['until'] as String).toLocal()
              : at.add(const Duration(hours: 1)),
          audience: audience?['kind'] as String? ?? 'calendar',
          people: (audience?['people'] as List? ?? []).cast<String>().toSet(),
        ),
      );
      await _saveDraft();
    } catch (_) {
      if (_same)
        setState(
          () => _error =
              'Impossibile aprire la versione corrente. Aggiorna l’agenda.',
        );
    }
  }

  Future<void> _send(
    String w,
    AgendaJson command, {
    bool fromEditor = false,
  }) async {
    if (!_same || !_loaded || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _commands.send(
        w,
        command,
        allowed: () => _same && _loaded,
        fromEditor: fromEditor,
      );
      if (!_same) return;
      if (fromEditor) setState(() => _form = null);
      await _load();
      if (_same) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(uiText(context, 'Modifica salvata.'))),
        );
      }
    } catch (e) {
      if (_same) {
        if (_commands.pending == null && e is ApiError) {
          await _load();
        }
        if (_same)
          setState(
            () => _error = _commands.pending != null
                ? 'Verifica il salvataggio prima di riprovare.'
                : e is ApiError && e.status == 409
                ? 'La versione è cambiata. Riapri l’elemento aggiornato.'
                : 'Impossibile salvare la modifica.',
          );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _stopVerification() async {
    if (!_same || _saving || _commands.pending == null) return;
    if (!await _confirm(
          uiText(
            context,
            'La modifica potrebbe essere già stata salvata. Interrompere la verifica su questo dispositivo?',
          ),
          uiText(context, 'Interrompi verifica'),
        ) ||
        !_same ||
        _saving)
      return;
    final fromEditor = _commands.pending?['fromEditor'] == true;
    setState(() => _saving = true);
    try {
      await _commands.stopVerification();
      if (!_same) return;
      setState(() {
        if (fromEditor) _form = null;
        _error = null;
      });
      await _load();
    } catch (_) {
      if (_same)
        setState(() => _error = 'Impossibile interrompere la verifica.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _submit(AgendaForm f, int revision) async {
    if (!_editable) return;
    final command = f.command(
      zone: _zone!,
      revision: revision,
      now: widget.now(),
    );
    try {
      final workspace = f.target.isEmpty
          ? (await widget.api.post('/api/v1/personal-space', {
                  'expectedActorId': _actor,
                }))['id']
                as String
          : f.target;
      if (!_editable || !identical(f, _form)) return;
      await _send(workspace, command, fromEditor: true);
    } catch (_) {
      if (_same)
        setState(
          () => _error =
              'Impossibile aprire la destinazione. La bozza è salvata.',
        );
    }
  }

  void _date(DateTime value) {
    setState(() {
      _day = value;
      _followToday = agendaDay(value) == agendaDay(widget.now());
      _view = null;
      _calendarEvents = [];
      _previous = false;
    });
    unawaited(_load());
  }

  Future<void> _pickDay() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _day,
      firstDate: DateTime(1900),
      lastDate: DateTime(2200),
    );
    if (d != null && _same) _date(d);
  }

  AgendaJson _occurrence(AgendaJson i, String action) => {
    'type': 'followup.occurrence',
    'followupId': i['id'],
    'expectedVersion': i['version'],
    'scheduledAt': i['at'],
    'action': action,
  };
  Widget _item(AgendaJson i, {AgendaJson? entry}) {
    final reminder = i['kind'] == 'reminder',
        personal = i['personal'] == true,
        at = DateTime.parse(i['at'] as String).toLocal(),
        owner = i['owner'] == _actor,
        w = i['workspaceId'] as String;
    return ExpansionTile(
      key: ValueKey((w, i['id'], i['at'], i['version'])),
      leading: Icon(reminder ? Icons.notifications_none : Icons.event_outlined),
      title: Text(i['title'] as String),
      subtitle: Text(
        [
          agendaTime(context, at),
          if (!reminder && i['until'] != null)
            '– ${agendaTime(context, DateTime.parse(i['until'] as String).toLocal())}',
          personal ? 'Solo io' : i['workspaceName'] as String,
          if (i['recurring'] == true) 'Ricorrente',
          if (i['rsvp'] == 'pending') 'Da confermare',
        ].join(' · '),
      ),
      children: [
        Wrap(
          spacing: 8,
          children: [
            if (!reminder && i['rsvp'] == 'pending')
              for (final answer in ['accepted', 'declined'])
                TextButton(
                  onPressed: _editable
                      ? () => _send(w, {
                          'type': 'temporal.respond',
                          'eventId': i['id'],
                          'expectedVersion': i['version'],
                          'response': answer,
                        })
                      : null,
                  child: Text(
                    answer == 'accepted'
                        ? uiText(context, 'Accetta')
                        : uiText(context, 'Rifiuta'),
                  ),
                ),
            if (owner)
              TextButton(
                onPressed: _editable
                    ? () => _edit(i, calendarEntry: entry)
                    : null,
                child: Text(uiText(context, 'Modifica')),
              ),
            if (reminder && !personal)
              TextButton(
                onPressed: _editable
                    ? () => _send(w, _occurrence(i, 'hide'))
                    : null,
                child: Text(uiText(context, 'Nascondi per me')),
              ),
            if (reminder && owner)
              TextButton(
                onPressed: _editable
                    ? () async {
                        if (personal ||
                            await _confirm(
                              uiText(
                                context,
                                'Chiudere questa scadenza per tutto lo spazio?',
                              ),
                              uiText(context, 'Chiudi per tutti'),
                            ))
                          await _send(w, _occurrence(i, 'close'));
                      }
                    : null,
                child: Text(
                  personal
                      ? uiText(context, 'Archivia questa scadenza')
                      : uiText(context, 'Chiudi per tutti'),
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _old(AgendaJson p) {
    final base = {
      'type': 'followup.previous',
      'followupId': p['id'],
      'before': _view!['before'],
      'timeZone': _zone,
    };
    return ListTile(
      title: Text(p['title'] as String),
      subtitle: Wrap(
        children: [
          Text(uiText(context, '{0} scadenze', [p['count']])),
          TextButton(
            onPressed: _editable
                ? () => _send(p['workspaceId'] as String, {
                    ...base,
                    'action': 'archive',
                  })
                : null,
            child: Text(uiText(context, 'Archivia precedenti')),
          ),
          TextButton(
            onPressed: _editable
                ? () async {
                    final now = widget.now();
                    final t = await agendaPickTime(context, now);
                    if (t == null || !_editable) return;
                    if (!t.isAfter(widget.now())) {
                      setState(
                        () => _error = 'Scegli un orario futuro di oggi.',
                      );
                      return;
                    }
                    await _send(p['workspaceId'] as String, {
                      ...base,
                      'action': 'remind_today',
                      'remindAt': t.toUtc().toIso8601String(),
                    });
                  }
                : null,
            child: Text(uiText(context, 'Ricordamelo oggi')),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final view = _view, form = _form, pending = _commands.pending;
    final items = view == null
        ? <AgendaJson>[]
        : agendaRows(view['items'])
              .where(
                (i) =>
                    _filter == 'all' ||
                    (_filter == 'personal') == (i['personal'] == true),
              )
              .toList();
    final previous = view == null || _calendar != null || _filter == 'space'
        ? <AgendaJson>[]
        : agendaRows(view['previous'])
              .where((p) => p['personal'] == true)
              .toList();
    final offers = view == null || _calendar != null
        ? <AgendaJson>[]
        : agendaRows(view['offers'])
              .where(
                (i) =>
                    _filter == 'all' ||
                    (_filter == 'personal') == (i['personal'] == true),
              )
              .toList();
    return PopScope(
      canPop: form == null,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && _same && form != null && !_saving)
          setState(() => _form = null);
      },
      child: Scaffold(
        appBar: AppBar(
          title: PersonalNavTitle(
            form != null
                ? (form.item != null
                      ? uiText(context, 'Modifica')
                      : form.kind == AgendaAction.reminder
                      ? uiText(context, 'Nuovo promemoria')
                      : uiText(context, 'Nuovo appuntamento'))
                : uiText(context, 'Oggi'),
          ),
          actions: [
            if (form != null && pending == null)
              IconButton(
                tooltip: uiText(context, 'Scarta bozza'),
                icon: const Icon(Icons.delete_outline),
                onPressed: _saving
                    ? null
                    : () async {
                        if (await _confirm(
                              uiText(
                                context,
                                'Scartare la bozza dal dispositivo?',
                              ),
                              uiText(context, 'Scarta'),
                            ) &&
                            _same) {
                          await _commands.saveDraft(null);
                          if (_same) setState(() => _form = null);
                        }
                      },
              ),
            if (form != null)
              TextButton(
                onPressed: _saving ? null : () => setState(() => _form = null),
                child: Text(uiText(context, 'Chiudi')),
              )
            else if (_loaded)
              IconButton(
                tooltip: uiText(context, 'Aggiorna agenda'),
                onPressed: () => _load(),
                icon: const Icon(Icons.refresh),
              ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              if (_error != null)
                ListTile(
                  title: Text(uiText(context, _error!)),
                  trailing: TextButton(
                    onPressed: _saving ? null : () => _load(restore: !_loaded),
                    child: Text(uiText(context, 'Aggiorna')),
                  ),
                ),
              if (_loaded && pending != null)
                ListTile(
                  title: Text(uiText(context, 'Salvataggio da verificare')),
                  subtitle: Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: _saving ? null : _stopVerification,
                      child: Text(uiText(context, 'Interrompi verifica')),
                    ),
                  ),
                  trailing: TextButton(
                    onPressed: _saving
                        ? null
                        : () => _send(
                            pending['space'] as String,
                            pending['command'] as AgendaJson,
                            fromEditor: pending['fromEditor'] == true,
                          ),
                    child: Text(uiText(context, 'Verifica')),
                  ),
                ),
              if (_saving || !_loaded && _error == null)
                const LinearProgressIndicator(),
              if (_loaded && form != null)
                Expanded(
                  child: AgendaEditor(
                    key: ObjectKey(form),
                    form: form,
                    api: widget.api,
                    rooms: _rooms,
                    zone: _zone!,
                    changed: () => unawaited(_saveDraft()),
                    save: _submit,
                    busy: _saving || pending != null,
                    now: widget.now,
                  ),
                )
              else if (_loaded)
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    children: [
                      Wrap(
                        spacing: 6,
                        children: [
                          TextButton.icon(
                            onPressed: _editable
                                ? () => _new(AgendaAction.reminder)
                                : null,
                            icon: const Icon(Icons.add_alert_outlined),
                            label: Text(uiText(context, 'Nuovo promemoria')),
                          ),
                          TextButton.icon(
                            onPressed: _editable
                                ? () => _new(AgendaAction.appointment)
                                : null,
                            icon: const Icon(Icons.event_available_outlined),
                            label: Text(uiText(context, 'Nuovo appuntamento')),
                          ),
                        ],
                      ),
                      if (_commands.draft != null &&
                          _visibleDraft(_commands.draft!))
                        TextButton.icon(
                          onPressed: _editable
                              ? () => setState(
                                  () => _form = AgendaForm.fromJson(
                                    _commands.draft!,
                                  ),
                                )
                              : null,
                          icon: const Icon(Icons.edit_note),
                          label: Text(uiText(context, 'Riprendi bozza')),
                        ),
                      Row(
                        children: [
                          IconButton(
                            tooltip: uiText(context, 'Giorno precedente'),
                            onPressed: () => _date(
                              DateTime(_day.year, _day.month, _day.day - 1),
                            ),
                            icon: const Icon(Icons.chevron_left),
                          ),
                          Expanded(
                            child: TextButton(
                              onPressed: _pickDay,
                              child: Text(_dayTitle(_day)),
                            ),
                          ),
                          IconButton(
                            tooltip: uiText(context, 'Giorno successivo'),
                            onPressed: () => _date(
                              DateTime(_day.year, _day.month, _day.day + 1),
                            ),
                            icon: const Icon(Icons.chevron_right),
                          ),
                          if (agendaDay(_day) != agendaDay(widget.now()))
                            TextButton(
                              onPressed: () => _date(widget.now()),
                              child: Text(uiText(context, 'Oggi')),
                            ),
                        ],
                      ),
                      DropdownButton<String>(
                        value: _calendar ?? _filter,
                        isExpanded: true,
                        items: [
                          DropdownMenuItem(
                            value: 'all',
                            child: Text(
                              uiText(context, 'Tutti i miei impegni'),
                            ),
                          ),
                          DropdownMenuItem(
                            value: 'personal',
                            child: Text(uiText(context, 'Solo io')),
                          ),
                          DropdownMenuItem(
                            value: 'space',
                            child: Text(uiText(context, 'Dai miei spazi')),
                          ),
                          for (final w in _rooms)
                            DropdownMenuItem(
                              value: w['id'] as String,
                              child: Text(
                                uiText(context, 'Calendario · {0}', [
                                  w['name'],
                                ]),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: (v) {
                          if (v == null) return;
                          setState(() {
                            if ({'all', 'personal', 'space'}.contains(v)) {
                              _filter = v;
                              _calendar = null;
                            } else {
                              _calendar = v;
                            }
                            _view = null;
                            _calendarEvents = [];
                          });
                          unawaited(_load());
                        },
                      ),
                      if (view == null)
                        const LinearProgressIndicator()
                      else if (_calendar == null) ...[
                        if (items.isEmpty)
                          ListTile(
                            title: Text(
                              uiText(
                                context,
                                'Nessun impegno per questa giornata.',
                              ),
                            ),
                          ),
                        for (final i in items) _item(i),
                      ] else ...[
                        if (_calendarEvents.isEmpty)
                          ListTile(
                            title: Text(
                              uiText(
                                context,
                                'Nessun appuntamento nel calendario dello spazio.',
                              ),
                            ),
                          ),
                        for (final e in _calendarEvents)
                          _item({
                            'id': e['id'],
                            'workspaceId': _calendar,
                            'workspaceName': _rooms.firstWhere(
                              (w) => w['id'] == _calendar,
                            )['name'],
                            'personal': false,
                            'owner': e['personId'],
                            'title': e['payload']['title'],
                            'kind': 'event',
                            'version': e['version'],
                            'at': e['payload']['start'],
                            'until': e['payload']['end'],
                            'rsvp': agendaRows(view['items'])
                                .where((i) => i['id'] == e['id'])
                                .firstOrNull?['rsvp'],
                          }, entry: e),
                      ],
                      if (previous.isNotEmpty) ...[
                        TextButton(
                          onPressed: () =>
                              setState(() => _previous = !_previous),
                          child: Text(uiText(context, 'Promemoria precedenti')),
                        ),
                        if (_previous)
                          for (final p in previous) _old(p),
                      ],
                      if (offers.isNotEmpty) ...[
                        ListTile(
                          title: Text(uiText(context, 'In attesa di te')),
                        ),
                        for (final offer in offers)
                          ExpansionTile(
                            title: Text(offer['title'] as String),
                            subtitle: Text(offer['workspaceName'] as String),
                            children: [
                              if ((offer['description'] as String).isNotEmpty)
                                Text(offer['description'] as String),
                              Wrap(
                                children: [
                                  for (final yes in [true, false])
                                    TextButton(
                                      onPressed: _editable
                                          ? () => _send(
                                              offer['workspaceId'] as String,
                                              {
                                                'type': yes
                                                    ? 'task.accept'
                                                    : 'task.decline',
                                                'taskId': offer['id'],
                                                'expectedVersion':
                                                    offer['version'],
                                                'reason': yes
                                                    ? 'Accettazione personale dall’agenda'
                                                    : 'Proposta rifiutata dall’agenda',
                                                if (yes) 'representSelf': true,
                                              },
                                            )
                                          : null,
                                      child: Text(
                                        yes
                                            ? uiText(
                                                context,
                                                'Accetta incarico',
                                              )
                                            : uiText(
                                                context,
                                                'Rifiuta incarico',
                                              ),
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
