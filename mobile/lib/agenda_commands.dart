import 'package:flutter_timezone/flutter_timezone.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'workspace_command_journal.dart';

typedef AgendaJson = Map<String, dynamic>;

enum AgendaAction { reminder, appointment }

Future<String> agendaLocalZone() async =>
    (await FlutterTimezone.getLocalTimezone()).identifier;
String agendaPath(DateTime day, String zone) =>
    '/api/v1/agenda?day=${agendaDay(day)}&zone=${Uri.encodeQueryComponent(zone)}';

String agendaDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
List<AgendaJson> agendaRows(dynamic raw) => (raw as List).cast<AgendaJson>();

class AgendaCommands extends WorkspaceCommandJournal {
  AgendaCommands(RimiamApi api, DraftVault vault)
    : super(api, vault, namespace: 'agenda');
  Future<void> saveDraft(AgendaForm? form) {
    draft = form?.toJson();
    return store();
  }
}

class AgendaForm {
  AgendaForm({
    required this.kind,
    required this.start,
    required this.end,
    this.item,
    this.target = '',
    this.title = '',
    this.audience = 'calendar',
    this.repeat = 'once',
    this.following = false,
    this.audienceEdited = false,
    Set<int>? weekdays,
    Set<String>? people,
    this.until,
  }) : weekdays = weekdays ?? {},
       people = people ?? {};
  final AgendaAction kind;
  final AgendaJson? item;
  String target, title, audience, repeat;
  bool following, audienceEdited;
  Set<int> weekdays;
  Set<String> people;
  DateTime start, end;
  DateTime? until;
  AgendaJson toJson() => {
    'kind': kind.name,
    'start': start.toUtc().toIso8601String(),
    'end': end.toUtc().toIso8601String(),
    'item': item,
    'target': target,
    'title': title,
    'audience': audience,
    'repeat': repeat,
    'following': following,
    'audienceEdited': audienceEdited,
    'weekdays': weekdays.toList(),
    'people': people.toList(),
    'until': until == null ? null : agendaDay(until!),
  };
  factory AgendaForm.fromJson(AgendaJson j) => AgendaForm(
    kind: AgendaAction.values.byName(j['kind'] as String),
    start: DateTime.parse(j['start'] as String).toLocal(),
    end: DateTime.parse(j['end'] as String).toLocal(),
    item: j['item'] as AgendaJson?,
    target: j['target'] as String,
    title: j['title'] as String,
    audience: j['audience'] as String,
    repeat: j['repeat'] as String,
    following: j['following'] == true,
    audienceEdited: j['audienceEdited'] == true,
    weekdays: (j['weekdays'] as List).cast<int>().toSet(),
    people: (j['people'] as List).cast<String>().toSet(),
    until: j['until'] == null ? null : DateTime.parse(j['until'] as String),
  );
  AgendaJson command({
    required String zone,
    required int revision,
    required DateTime now,
  }) {
    final label = title.trim();
    if (label.isEmpty) throw const FormatException('Inserisci un titolo.');
    final at = start.toUtc().toIso8601String();
    if (kind == AgendaAction.reminder) {
      if (label.length > 2000)
        throw const FormatException(
          'Il promemoria può contenere fino a 2.000 caratteri.',
        );
      if (!start.isAfter(now))
        throw const FormatException(
          'Scegli un orario futuro per il promemoria.',
        );
      if (item != null)
        return {
          'type': 'followup.occurrence',
          'followupId': item!['id'],
          'expectedVersion': item!['version'],
          'scheduledAt': item!['at'],
          'action': following && item!['recurring'] == true
              ? 'replace_following'
              : 'replace',
          'replacement': {'content': label, 'remindAt': at, 'timeZone': zone},
        };
      final days = repeat == 'daily'
          ? [1, 2, 3, 4, 5, 6, 7]
          : (weekdays.toList()..sort());
      if (repeat != 'once' && days.isEmpty)
        throw const FormatException('Scegli almeno un giorno.');
      if (repeat != 'once' &&
          until != null &&
          agendaDay(until!).compareTo(agendaDay(start)) < 0)
        throw const FormatException(
          'La fine della ripetizione precede la prima scadenza.',
        );
      return {
        'type': 'followup.create',
        'kind': 'remember',
        'content': label,
        'remindAt': at,
        'timeZone': zone,
        'reference': null,
        'recurrence': repeat == 'once'
            ? null
            : {'weekdays': days, if (until != null) 'until': agendaDay(until!)},
      };
    }
    if (label.length > 12000)
      throw const FormatException('Il titolo supera il limite di caratteri.');
    if (!end.isAfter(start))
      throw const FormatException('La fine deve seguire l’inizio.');
    if ((item == null || audienceEdited) &&
        target.isNotEmpty &&
        audience == 'people' &&
        people.isEmpty)
      throw const FormatException('Scegli almeno una persona.');
    return {
      'type': item == null ? 'temporal.create' : 'temporal.revise',
      if (item != null) 'eventId': item!['id'],
      if (item != null) 'expectedVersion': item!['version'],
      'representSelf': true,
      'reason': item == null
          ? 'Appuntamento creato dall’agenda'
          : 'Appuntamento modificato dall’agenda',
      'expectedContextRevision': revision,
      'payload': {
        'title': label,
        'start': at,
        'end': end.toUtc().toIso8601String(),
        'timeZone':
            item?['eventZone'] != null &&
                DateTime.parse(item!['at'] as String).isAtSameMomentAs(start) &&
                DateTime.parse(item!['until'] as String).isAtSameMomentAs(end)
            ? item!['eventZone']
            : zone,
      },
      if (item == null || audienceEdited)
        'audience': {
          'kind': target.isEmpty ? 'calendar' : audience,
          if (target.isNotEmpty && audience == 'people')
            'people': people.toList(),
        },
    };
  }
}
