import 'package:material_ui/material_ui.dart';

import 'ui_language.dart';
import 'workspace_governance.dart';

List<GroupRecord> messageSources(
  GroupRecord message,
  Map<String, GroupRecord> messages,
  Map<String, GroupRecord> files,
) {
  final shared = groupRows(message['consultationReferences']);
  if (shared.isNotEmpty) return shared;
  if (message['actor_kind'] != 'miriam') return const [];
  final entries = <GroupRecord>[];
  for (final id in groupIds(message['citation_source_ids']).toSet()) {
    final file = files[id], source = messages[id];
    // The server scopes the exact reference on open. A citation can be valid
    // even when its title is absent from the current projection.
    if (id.isEmpty) continue;
    final name = file?['filename'] ?? file?['title'] ?? source?['author_name'];
    entries.add({
      'id': id,
      'kind': 'source',
      // The ID identifies this immutable file version or original message.
      'version': 1,
      'label': file?['document_version'] != null
          ? '$name · v${file!['document_version']}'
          : name,
    });
  }
  return entries;
}

class MessageSources extends StatelessWidget {
  const MessageSources({super.key, required this.entries, required this.open});
  final List<GroupRecord> entries;
  final ValueChanged<GroupRecord> open;

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) return const SizedBox.shrink();
    String label(GroupRecord item) =>
        item['label'] as String? ?? uiText(context, 'Fonte citata');
    return TextButton.icon(
      icon: const Icon(Icons.link, size: 17),
      label: Text(
        entries.length == 1
            ? label(entries.single)
            : uiText(context, '{0} fonti', [entries.length]),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      onPressed: () async {
        if (entries.length == 1) {
          open(entries.single);
          return;
        }
        final selected = await showModalBottomSheet<GroupRecord>(
          context: context,
          showDragHandle: true,
          useSafeArea: true,
          builder: (sheet) => ListView(
            shrinkWrap: true,
            children: [
              for (final item in entries)
                ListTile(
                  leading: const Icon(Icons.link),
                  title: Text(label(item)),
                  onTap: () => Navigator.pop(sheet, item),
                ),
            ],
          ),
        );
        if (context.mounted && selected != null) open(selected);
      },
    );
  }
}
