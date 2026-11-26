import 'dart:convert';

import 'api.dart';
import 'library_collection.dart';
import 'library_entries.dart';

const documentBlockLabels = {
  'paragraph': 'Testo',
  'heading': 'Sezione',
  'checklist': 'Checklist',
  'table': 'Tabella',
  'image': 'Immagine',
};

LibraryJson documentBlock(String type, String input, {String? source}) {
  final text = input.trim();
  if (text.isEmpty)
    throw const FormatException('Scrivi il contenuto del blocco.');
  switch (type) {
    case 'paragraph':
    case 'heading':
      if (text.length > (type == 'heading' ? 240 : 24000))
        throw const FormatException('Questo blocco è troppo lungo.');
      return {'type': type, 'text': text};
    case 'checklist':
      final items = text.split('\n').where((l) => l.trim().isNotEmpty).map((l) {
        final line = l.trim(),
            prefix = RegExp(r'^\[([ xX])\]\s*').firstMatch(line);
        final item = line.substring(prefix?.end ?? 0).trim();
        if (item.isEmpty || item.length > 2000)
          throw const FormatException('Verifica il testo delle voci.');
        return {
          'text': item,
          'checked': prefix?.group(1)?.toLowerCase() == 'x',
        };
      }).toList();
      if (items.length > 100)
        throw const FormatException('Usa al massimo 100 voci.');
      return {'type': type, 'items': items};
    case 'table':
      final lines = text
          .split('\n')
          .map((l) => l.split('|').map((s) => s.trim()).toList())
          .toList();
      final cols = lines.first, rows = lines.skip(1).toList();
      if (cols.length > 12 ||
          cols.every((s) => s.isEmpty) ||
          cols.any((s) => s.length > 160) ||
          rows.length > 100 ||
          rows.any(
            (r) => r.length != cols.length || r.any((s) => s.length > 2000),
          )) {
        throw const FormatException(
          'Usa le stesse colonne per ogni riga, fino a 12 colonne e 100 righe.',
        );
      }
      return {'type': type, 'columns': cols, 'rows': rows};
    case 'image':
      if (source == null || text.length > 500)
        throw const FormatException(
          'Scegli una foto della raccolta e aggiungi una breve descrizione.',
        );
      return {'type': type, 'sourceId': source, 'alt': text, 'caption': ''};
    default:
      throw const FormatException('Blocco non riconosciuto.');
  }
}

String documentBlockText(LibraryJson b) {
  switch (b['type']) {
    case 'paragraph':
      return b['text'] as String;
    case 'heading':
      return '## ${b['text']}';
    case 'checklist':
      return libraryRows(b['items'])
          .map((i) => '- [${i['checked'] == true ? 'x' : ' '}] ${i['text']}')
          .join('\n');
    case 'table':
      final cols = (b['columns'] as List).cast<String>();
      final rows = <List>[
        cols,
        List.filled(cols.length, '---'),
        ...(b['rows'] as List).cast<List>(),
      ];
      return rows
          .map(
            (r) =>
                '| ${r.map((s) => (s as String).replaceAll('|', r'\|').replaceAll('\n', ' ')).join(' | ')} |',
          )
          .join('\n');
    case 'image':
      return [
        b['alt'],
        b['caption'],
      ].whereType<String>().where((s) => s.isNotEmpty).join(' — ');
    default:
      return '';
  }
}

String documentMarkdown(LibraryJson v) {
  final blocks = libraryRows(v['blocks']);
  return '# ${v['title']}\n\n${blocks.isEmpty ? v['body'] ?? '' : blocks.map(documentBlockText).join('\n\n')}\n';
}

List<LibraryJson> currentLibraryDocuments(LibraryJson snapshot) {
  final versions = libraryRows(snapshot['artifactVersions']);
  return [
    for (final doc in libraryRows(snapshot['artifacts']))
      for (final v in versions)
        if (v['artifact_id'] == doc['id'] &&
            v['version'] == doc['current_draft_version'])
          v,
  ]..sort(
    (a, b) => (b['created_at'] as String? ?? '').compareTo(
      a['created_at'] as String? ?? '',
    ),
  );
}

String versionStatus(LibraryJson v, LibraryJson snapshot) {
  final doc = libraryRows(snapshot['artifacts'])
      .where((d) => d['id'] == v['artifact_id'])
      .firstOrNull;
  final adoption = libraryRows(snapshot['artifactAdoptions'])
      .where((a) => a['id'] == doc?['current_adoption_id'])
      .firstOrNull;
  final adopted =
      adoption != null &&
      libraryRows(snapshot['artifactReviews']).any(
        (r) =>
            r['id'] == adoption['review_id'] &&
            r['artifact_version'] == v['version'] &&
            r['artifact_id'] == v['artifact_id'],
      );
  return [
    adopted ? 'Adottato' : 'Bozza',
    if ((v['outdated_reasons'] as List? ?? []).isNotEmpty) 'Da rivalutare',
  ].join(' · ');
}

Future<({String id, int version})> composeDocument(
  LibraryCollection model,
  String title,
  String purpose,
  List<LibraryJson> blocks,
  bool Function() active, {
  List<String> sourceIds = const [],
  Future<LibraryJson> Function(LibraryJson)? send,
}) async {
  if (!model.canWrite) throw const ApiError(403, 'PERMISSION_DENIED');
  final command = <String, dynamic>{
    'type': 'artifact.compose',
    'title': title.trim(),
    'purpose': purpose.trim().isEmpty ? 'Documento di lavoro' : purpose.trim(),
    'blocks': blocks,
    'information': [],
    'sourceIds': {
      ...sourceIds,
      ...blocks
          .where((b) => b['type'] == 'image')
          .map((b) => b['sourceId'] as String),
    }.toList(),
    'reason': model.personal
        ? 'Creazione del documento personale'
        : 'Creazione del documento condiviso',
    'nonOperative': true,
  };
  final result = send == null
      ? await model.send(command, active)
      : await send(command);
  return (
    id: result['artifactId'] as String,
    version: result['version'] as int,
  );
}

/// Persist only the question and its original request id until the server
/// confirms its private Markdown file. A user retry reuses the same id.
class PrivateDocumentRequest {
  PrivateDocumentRequest(this.library, {this.privateSelection});
  final LibraryCollection library;
  final String? privateSelection;
  bool busy = false;
  LibraryJson? pending;
  String get key =>
      '${library.commands.scope}.private-document${privateSelection == null ? '' : '.$privateSelection'}';
  bool get allowed =>
      library.ready &&
      (library.canWrite || privateSelection != null) &&
      library.api.actorId == library.actor;
  Future<void> load() async {
    final stored = await library.vault.read(key);
    pending = stored == null ? null : jsonDecode(stored) as LibraryJson;
  }

  Future<void> forget() async {
    if (busy) throw StateError('Richiesta in corso');
    await library.vault.replace(key, null);
    pending = null;
  }

  Future<LibraryJson> generate(String input, bool Function() active) async {
    final question = input.trim();
    if (!allowed || !active())
      throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
    if (busy || (pending != null && pending!['question'] != question))
      throw StateError('Verifica la richiesta precedente.');
    if (question.isEmpty || question.length > 2000)
      throw const FormatException(
        'Scrivi una richiesta entro 2.000 caratteri.',
      );
    busy = true;
    try {
      pending ??= {
        'action': 'document',
        'id': library.api.newId(),
        'expectedActorId': library.actor,
        'kind': 'document',
        'question': question,
      };
      await library.vault.replace(key, jsonEncode(pending));
      if (!allowed || !active())
        throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
      final data = await library.api.post(
        '${library.path}/consultation',
        pending!,
      );
      if (!allowed || !active())
        throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
      if (data['id'] != pending!['id'] ||
          data['kind'] != 'document' ||
          data['documentWorkspaceId'] is! String ||
          data['documentSourceId'] is! String ||
          data['answer'] is! String) {
        throw const FormatException('Documento non confermato.');
      }
      await library.vault.replace(key, null);
      pending = null;
      return data;
    } finally {
      busy = false;
    }
  }
}
