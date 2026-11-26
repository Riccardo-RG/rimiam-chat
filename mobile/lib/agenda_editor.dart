import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'agenda_commands.dart';
import 'api.dart';

String agendaTime(BuildContext context, DateTime d) => MaterialLocalizations.of(
  context,
).formatTimeOfDay(TimeOfDay.fromDateTime(d), alwaysUse24HourFormat: true);
Future<DateTime?> agendaPickTime(BuildContext context, DateTime current) async {
  final t = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.fromDateTime(current),
  );
  if (t == null || !context.mounted) return null;
  final value = DateTime(
    current.year,
    current.month,
    current.day,
    t.hour,
    t.minute,
  );
  if (value.hour != t.hour || value.minute != t.minute) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          uiText(context, 'Questo orario non esiste nel fuso del dispositivo.'),
        ),
      ),
    );
    return null;
  }
  return value;
}

class AgendaEditor extends StatefulWidget {
  const AgendaEditor({
    super.key,
    required this.form,
    required this.api,
    required this.rooms,
    required this.zone,
    required this.changed,
    required this.save,
    required this.busy,
    required this.now,
  });
  final AgendaForm form;
  final RimiamApi api;
  final List<AgendaJson> rooms;
  final String zone;
  final VoidCallback changed;
  final Future<void> Function(AgendaForm, int) save;
  final bool busy;
  final DateTime Function() now;
  @override
  State<AgendaEditor> createState() => _AgendaEditorState();
}

class _AgendaEditorState extends State<AgendaEditor> {
  late final _text = TextEditingController(text: widget.form.title);
  AgendaJson? _directory;
  String? _error;
  int _generation = 0;
  AgendaForm get f => widget.form;
  @override
  void initState() {
    super.initState();
    unawaited(_directoryFor());
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _directoryFor() async {
    final generation = ++_generation;
    setState(() {
      _directory = null;
      _error = null;
    });
    try {
      final w = f.target.isEmpty
          ? (await widget.api.post('/api/v1/personal-space', {
                  'expectedActorId': widget.api.actorId,
                }))['id']
                as String
          : f.target;
      final d = await widget.api.get(
        '/api/v1/agenda/destination?workspace=${Uri.encodeQueryComponent(w)}',
      );
      if (mounted && generation == _generation) setState(() => _directory = d);
    } catch (_) {
      if (mounted && generation == _generation)
        setState(() => _error = 'Impossibile aprire questa destinazione.');
    }
  }

  void edit(VoidCallback change) {
    setState(change);
    widget.changed();
  }

  Future<void> changeDate(
    DateTime current,
    ValueChanged<DateTime> change,
  ) async {
    final chosen = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(1900),
      lastDate: DateTime(2200),
    );
    if (chosen == null || !mounted) return;
    final d = DateTime(
      chosen.year,
      chosen.month,
      chosen.day,
      current.hour,
      current.minute,
    );
    if (d.hour != current.hour) {
      setState(
        () => _error = 'L’orario selezionato non esiste in questo giorno.',
      );
      return;
    }
    edit(() => change(d));
  }

  Widget instant(String label, DateTime d, ValueChanged<DateTime> change) =>
      Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 4,
        children: [
          Text(label),
          TextButton.icon(
            icon: const Icon(Icons.event_outlined, size: 18),
            label: Text(agendaDay(d)),
            onPressed: () => changeDate(d, change),
          ),
          TextButton.icon(
            icon: const Icon(Icons.schedule, size: 18),
            label: Text(agendaTime(context, d)),
            onPressed: () async {
              final value = await agendaPickTime(context, d);
              if (value != null && mounted) edit(() => change(value));
            },
          ),
        ],
      );
  Future<void> submit() async {
    final revision = _directory?['contextRevision'] as int?;
    if (revision == null) return;
    try {
      f.command(zone: widget.zone, revision: revision, now: widget.now());
      if ((f.item == null || f.audienceEdited) &&
          f.audience == 'people' &&
          f.people
              .difference(
                agendaRows(_directory!['members'])
                    .map((m) => m['id'] as String)
                    .toSet(),
              )
              .isNotEmpty)
        throw const FormatException(
          'Una delle persone scelte non è più disponibile. Controlla i destinatari.',
        );
      setState(() => _error = null);
      await widget.save(f, revision);
    } on FormatException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final event = f.kind == AgendaAction.appointment;
    final recipients = _directory == null
        ? <AgendaJson>[]
        : agendaRows(_directory!['members']);
    return AbsorbPointer(
      absorbing: widget.busy,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _text,
            decoration: InputDecoration(
              labelText: event
                  ? uiText(context, 'Titolo appuntamento')
                  : uiText(context, 'Cosa vuoi ricordare?'),
            ),
            maxLines: event ? 1 : 3,
            minLines: 1,
            onChanged: (s) {
              f.title = s;
              widget.changed();
            },
          ),
          const SizedBox(height: 12),
          if (f.item == null)
            DropdownButtonFormField<String>(
              initialValue: f.target,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: uiText(context, 'Destinazione'),
              ),
              items: [
                DropdownMenuItem(
                  value: '',
                  child: Text(uiText(context, 'Solo io')),
                ),
                for (final w in widget.rooms)
                  DropdownMenuItem(
                    value: w['id'] as String,
                    child: Text(
                      w['name'] as String,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (v) {
                if (v == null || v == f.target) return;
                edit(() {
                  f.target = v;
                  f.audience = 'calendar';
                  f.people.clear();
                });
                unawaited(_directoryFor());
              },
            )
          else
            Text(
              f.item!['personal'] == true
                  ? uiText(context, 'Solo io')
                  : f.item!['workspaceName'] as String,
            ),
          if (!event && f.target.isNotEmpty)
            Text(
              uiText(
                context,
                'Visibile a tutto lo spazio, anche a chi entra successivamente.',
              ),
            ),
          if (event && f.target.isNotEmpty) ...[
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              key: ValueKey(f.target),
              initialValue: f.audience,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: uiText(context, 'Invitati'),
              ),
              items: [
                DropdownMenuItem(
                  value: 'calendar',
                  child: Text(uiText(context, 'Solo nel calendario')),
                ),
                DropdownMenuItem(
                  value: 'all',
                  child: Text(uiText(context, 'Tutto lo spazio')),
                ),
                DropdownMenuItem(
                  value: 'people',
                  child: Text(uiText(context, 'Scegli persone')),
                ),
              ],
              onChanged: (v) => edit(() {
                f.audience = v!;
                f.audienceEdited = true;
              }),
            ),
            if (f.audience == 'people')
              Wrap(
                spacing: 5,
                children: [
                  for (final m in recipients)
                    FilterChip(
                      label: Text(m['name'] as String),
                      selected: f.people.contains(m['id']),
                      onSelected: (on) => edit(() {
                        f.audienceEdited = true;
                        if (on) {
                          f.people.add(m['id'] as String);
                        } else {
                          f.people.remove(m['id']);
                        }
                      }),
                    ),
                ],
              ),
          ],
          const SizedBox(height: 8),
          instant(event ? 'Inizio' : 'Scadenza', f.start, (d) {
            final duration = f.end.difference(f.start);
            f.start = d;
            if (!f.end.isAfter(d)) f.end = d.add(duration);
          }),
          if (event) instant('Fine', f.end, (d) => f.end = d),
          Text(
            uiText(context, 'Fuso orario · {0}', [widget.zone]),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (!event && f.item == null) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: f.repeat,
              decoration: InputDecoration(
                labelText: uiText(context, 'Ripetizione'),
              ),
              items: [
                DropdownMenuItem(
                  value: 'once',
                  child: Text(uiText(context, 'Una volta')),
                ),
                DropdownMenuItem(
                  value: 'daily',
                  child: Text(uiText(context, 'Ogni giorno')),
                ),
                DropdownMenuItem(
                  value: 'weekly',
                  child: Text(uiText(context, 'Giorni della settimana')),
                ),
              ],
              onChanged: (v) => edit(() => f.repeat = v!),
            ),
            if (f.repeat == 'weekly')
              Wrap(
                spacing: 4,
                children: [
                  for (int index = 1; index <= 7; index++)
                    FilterChip(
                      label: Text(
                        const [
                          'Lun',
                          'Mar',
                          'Mer',
                          'Gio',
                          'Ven',
                          'Sab',
                          'Dom',
                        ][index - 1],
                      ),
                      selected: f.weekdays.contains(index),
                      onSelected: (yes) => edit(() {
                        if (yes) {
                          f.weekdays.add(index);
                        } else {
                          f.weekdays.remove(index);
                        }
                      }),
                    ),
                ],
              ),
            if (f.repeat != 'once')
              Wrap(
                children: [
                  TextButton(
                    onPressed: () =>
                        changeDate(f.until ?? f.start, (d) => f.until = d),
                    child: Text(
                      f.until == null
                          ? uiText(context, 'Aggiungi data di fine')
                          : uiText(context, 'Fino al {0}', [
                              agendaDay(f.until!),
                            ]),
                    ),
                  ),
                  if (f.until != null)
                    TextButton(
                      onPressed: () => edit(() => f.until = null),
                      child: Text(uiText(context, 'Senza data di fine')),
                    ),
                ],
              ),
          ],
          if (!event && f.item?['recurring'] == true)
            DropdownButtonFormField<bool>(
              initialValue: f.following,
              decoration: InputDecoration(
                labelText: uiText(context, 'Applica la modifica'),
              ),
              items: [
                DropdownMenuItem(
                  value: false,
                  child: Text(uiText(context, 'Solo questa scadenza')),
                ),
                DropdownMenuItem(
                  value: true,
                  child: Text(uiText(context, 'Da questa scadenza in poi')),
                ),
              ],
              onChanged: (v) => edit(() => f.following = v!),
            ),
          if (_error != null) Text(uiText(context, _error!)),
          if (_directory == null && _error != null)
            TextButton(
              onPressed: _directoryFor,
              child: Text(uiText(context, 'Ricarica destinazione')),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: widget.busy || _directory == null ? null : submit,
            child: Text(
              f.item != null
                  ? uiText(context, 'Salva modifica')
                  : event
                  ? uiText(context, 'Crea appuntamento')
                  : uiText(context, 'Crea promemoria'),
            ),
          ),
        ],
      ),
    );
  }
}
