import 'package:material_ui/material_ui.dart';

import 'api.dart';

typedef MentionPerson = ({String id, String name});

final _token = RegExp(
  r'(?:^|[^\p{L}\p{N}_.@-])@([^@\n]{0,100})$',
  unicode: true,
);
final _word = RegExp(r'^[\p{L}\p{M}\p{N}_-]+', unicode: true);
final _at = RegExp(r'(?:^|[^\p{L}\p{N}_.@-])@', unicode: true);

({int start, String query})? mentionQuery(TextEditingValue value) {
  final cursor = value.selection;
  if (!cursor.isValid ||
      !cursor.isCollapsed ||
      cursor.end > value.text.length ||
      (value.composing.isValid && !value.composing.isCollapsed))
    return null;
  final match = _token.firstMatch(value.text.substring(0, cursor.end));
  if (match == null) return null;
  final query = match.group(1)!;
  return (start: cursor.end - query.length - 1, query: query.toLowerCase());
}

TextEditingValue? insertMention(TextEditingValue value, String name) {
  final token = mentionQuery(value);
  if (token == null) return null;
  final prefix = '${value.text.substring(0, token.start)}@$name ';
  final suffix = value.text
      .substring(value.selection.end)
      .replaceFirst(_word, '');
  if (prefix.length + suffix.length > 12000) return null;
  return TextEditingValue(
    text: prefix + suffix,
    selection: TextSelection.collapsed(offset: prefix.length),
  );
}

/// A selected ID travels only while its visible full name still matches. The
/// server resolves ordinary manually typed mentions, including first names.
Map<String, String> retainedMentions(
  String text,
  Map<String, String> selected,
  List<MentionPerson> people,
) {
  if (selected.isEmpty || !text.contains('@')) return {};
  final names =
      {
          for (final person in people) person.name.toLowerCase(),
          ...selected.values.map((s) => s.toLowerCase()),
        }.where((s) => s.isNotEmpty && s != 'emme').toList()
        ..sort((a, b) => b.length.compareTo(a.length));
  final found = <String>{};
  final lower = text.toLowerCase();
  for (final token in _at.allMatches(lower)) {
    final suffix = lower.substring(token.end);
    for (final name in names) {
      if (suffix.startsWith(name) &&
          !_word.hasMatch(suffix.substring(name.length))) {
        found.add(name);
        break;
      }
    }
  }
  return {
    for (final item in selected.entries)
      if (found.contains(item.value.toLowerCase())) item.key: item.value,
  };
}

class MentionSuggestions extends StatelessWidget {
  const MentionSuggestions({
    super.key,
    required this.api,
    required this.workspace,
    required this.people,
    required this.editor,
    required this.focus,
    required this.choose,
  });
  final RimiamApi api;
  final String workspace;
  final List<MentionPerson> people;
  final TextEditingController editor;
  final FocusNode focus;
  final ValueChanged<MentionPerson> choose;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([editor, focus]),
    builder: (context, _) {
      final token = mentionQuery(editor.value);
      if (token == null || !focus.hasFocus) return const SizedBox.shrink();
      final matches = people
          .where((p) => p.name.toLowerCase().startsWith(token.query))
          .take(8)
          .toList();
      if (matches.isEmpty) return const SizedBox.shrink();
      final height =
          MediaQuery.sizeOf(context).height -
          MediaQuery.viewInsetsOf(context).bottom;
      return ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: (height * 0.2).clamp(48, 112).toDouble(),
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final p in matches)
                if (people
                        .where(
                          (other) =>
                              other.name.toLowerCase() == p.name.toLowerCase(),
                        )
                        .length >
                    1)
                  _SameName(
                    key: ValueKey((api, api.actorId, workspace, p.id)),
                    api: api,
                    workspace: workspace,
                    person: p,
                    choose: choose,
                  )
                else
                  TextButton(
                    onPressed: () => choose(p),
                    child: Text('@${p.name}'),
                  ),
            ],
          ),
        ),
      );
    },
  );
}

/// A shared display name alone cannot identify the recipient. Ask the existing
/// workspace-scoped profile endpoint only for these matching suggestions.
class _SameName extends StatefulWidget {
  const _SameName({
    super.key,
    required this.api,
    required this.workspace,
    required this.person,
    required this.choose,
  });
  final RimiamApi api;
  final String workspace;
  final MentionPerson person;
  final ValueChanged<MentionPerson> choose;
  @override
  State<_SameName> createState() => _SameNameState();
}

class _SameNameState extends State<_SameName> {
  late var profile = _load();
  Future<String> _load() async {
    final actor = widget.api.actorId;
    final data = await widget.api.get(
      '/api/v1/workspaces/${Uri.encodeComponent(widget.workspace)}/profiles/${Uri.encodeComponent(widget.person.id)}',
    );
    if (!mounted ||
        widget.api.actorId != actor ||
        data['id'] != widget.person.id ||
        data['email'] is! String) {
      throw const FormatException('Profilo non disponibile');
    }
    return data['email'] as String;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<String>(
    future: profile,
    builder: (_, snapshot) => TextButton(
      onPressed: snapshot.hasData
          ? () => widget.choose(widget.person)
          : snapshot.hasError
          ? () => setState(() => profile = _load())
          : null,
      child: Text(
        '@${widget.person.name} · ${snapshot.data ?? (snapshot.hasError ? 'Riprova' : '…')}',
      ),
    ),
  );
}
