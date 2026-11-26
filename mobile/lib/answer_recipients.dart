import 'package:material_ui/material_ui.dart';

import 'chat_mentions.dart';
import 'ui_language.dart';

Future<List<String>?> chooseAnswerRecipients(
  BuildContext context,
  List<MentionPerson> members,
) {
  final selected = <String>{};
  return showDialog<List<String>>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => AlertDialog(
        title: Text(uiText(context, 'Da chi aspetti una risposta?')),
        content: SizedBox(
          width: 320,
          child: ListView(
            shrinkWrap: true,
            children: [
              for (final person in members)
                CheckboxListTile(
                  title: Text(person.name),
                  value: selected.contains(person.id),
                  onChanged:
                      !selected.contains(person.id) && selected.length >= 40
                      ? null
                      : (checked) => update(() {
                          if (checked == true) {
                            selected.add(person.id);
                          } else {
                            selected.remove(person.id);
                          }
                        }),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(uiText(context, 'Annulla')),
          ),
          FilledButton(
            onPressed: selected.isEmpty
                ? null
                : () => Navigator.pop(context, selected.toList()),
            child: Text(uiText(context, 'Richiedi risposta')),
          ),
        ],
      ),
    ),
  );
}
