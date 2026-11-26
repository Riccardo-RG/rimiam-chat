import 'ui_language.dart';

import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

class ComposerAction {
  ComposerAction(Map<String, dynamic> json)
    : id = json['id'],
      label = json['label'],
      englishLabel = json['englishLabel'] ?? json['label'],
      englishShortcuts = List<String>.from(json['english']),
      needs = json['needs'],
      shortcuts = List<String>.from(json['shortcuts']),
      aliases = {
        ...List<String>.from(json['shortcuts']),
        ...List<String>.from(json['english']),
      },
      keywords = json['keywords'];
  final String id, label, englishLabel, keywords;
  final List<String> englishShortcuts;
  bool _english(BuildContext c) =>
      Localizations.of<UiMessages>(c, UiMessages)?.locale.languageCode == 'en';
  String displayLabel(BuildContext c) => _english(c) ? englishLabel : label;
  List<String> displayShortcuts(BuildContext c) =>
      _english(c) ? englishShortcuts : shortcuts;
  final String? needs;
  final List<String> shortcuts;
  final Set<String> aliases;
}

String _normalize(String text) {
  const accents = {'à': 'a', 'è': 'e', 'é': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u'};
  return text
      .trim()
      .replaceFirst(RegExp(r'^/'), '')
      .toLowerCase()
      .replaceAllMapped(RegExp('[àèéìòù]'), (m) => accents[m[0]]!);
}

final Future<List<ComposerAction>> composerCatalog = rootBundle
    .loadString('assets/workspace_actions.json')
    .then(
      (raw) => (jsonDecode(raw) as List)
          .cast<Map<String, dynamic>>()
          .map(ComposerAction.new)
          .toList(),
    );

typedef ActionChoice = ({String? action, String? literal});

Future<ActionChoice?> showComposerActions(
  BuildContext context, {
  required List<ComposerAction> actions,
  required String assistant,
  String? typed,
}) => showModalBottomSheet<ActionChoice>(
  context: context,
  isScrollControlled: true,
  showDragHandle: false,
  builder: (_) =>
      _ActionSheet(actions: actions, assistant: assistant, typed: typed),
);

class _ActionSheet extends StatefulWidget {
  const _ActionSheet({
    required this.actions,
    required this.assistant,
    required this.typed,
  });
  final List<ComposerAction> actions;
  final String assistant;
  final String? typed;
  @override
  State<_ActionSheet> createState() => _ActionSheetState();
}

class _ActionSheetState extends State<_ActionSheet> {
  late final search = TextEditingController(text: widget.typed);
  @override
  void initState() {
    super.initState();
    search.selection = TextSelection.collapsed(offset: search.text.length);
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _normalize(search.text);
    bool exact(ComposerAction a) =>
        a.aliases.any((alias) => _normalize(alias) == query);
    final matches = widget.actions.where((a) {
      final searchable = _normalize(
        '${a.aliases.join(' ')} ${a.label} ${a.keywords}',
      );
      return query.split(RegExp(r'\s+')).every(searchable.contains);
    }).toList();
    final ordered = [
      ...matches.where(exact),
      ...matches.where((a) => !exact(a)),
    ];
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final available =
        MediaQuery.sizeOf(context).height -
        keyboard -
        MediaQuery.viewPaddingOf(context).top;
    final small = available < 310;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboard),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: available.clamp(0, 500).toDouble(),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: search,
                        autofocus: true,
                        autocorrect: false,
                        decoration: InputDecoration(
                          hintText: uiText(context, 'Cerca un comando'),
                          prefixIcon: Icon(Icons.search),
                        ),
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) {
                          if (ordered.isNotEmpty)
                            Navigator.pop(context, (
                              action: ordered.first.id,
                              literal: null,
                            ));
                        },
                      ),
                    ),
                    IconButton(
                      tooltip: uiText(context, 'Chiudi'),
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ordered.isEmpty
                    ? Center(
                        child: Text(uiText(context, 'Nessun comando trovato.')),
                      )
                    : ListView(
                        children: [
                          for (final a in ordered)
                            ListTile(
                              dense: small,
                              title: Text(
                                a
                                    .displayLabel(context)
                                    .replaceAll('Emme', widget.assistant),
                              ),
                              subtitle: Text(
                                a.displayShortcuts(context).join(' · '),
                              ),
                              onTap: () => Navigator.pop(context, (
                                action: a.id,
                                literal: null,
                              )),
                            ),
                        ],
                      ),
              ),
              if (widget.typed != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: () => Navigator.pop(context, (
                      action: null,
                      literal: '/${search.text}',
                    )),
                    child: Text(
                      uiText(context, 'Usa come testo del messaggio'),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
