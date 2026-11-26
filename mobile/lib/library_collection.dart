import 'dart:convert';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' show XFile;

import 'api.dart';
import 'attachment_staging.dart';
import 'chat_journal.dart';
import 'library_entries.dart';
import 'workspace_command_journal.dart';

// The group's chat draft and the collection's upload are independent composers.
class _CollectionVault implements DraftVault {
  const _CollectionVault(this.store);
  final DraftVault store;
  @override
  Future<String?> read(String key) => store.read('library.$key');
  @override
  Future<void> replace(String key, String? value) =>
      store.replace('library.$key', value);
}

class _LibraryJournals {
  _LibraryJournals(this.commands, this.transfers);
  final WorkspaceCommandJournal commands;
  final ChatJournal transfers;
  bool opened = false, preparingNote = false;
  Future<void>? _opening;
  Future<void> open() => opened
      ? Future.value()
      : _opening ??= _read().whenComplete(() => _opening = null);
  Future<void> _read() async {
    await commands.load();
    await transfers.open();
    if (!transfers.ready) throw const FormatException('Bozza non disponibile.');
    opened = true;
  }
}

class LibraryCollection {
  // Multiple routes for this authenticated installation must share the
  // outstanding receipt. Each route still fetches its own authorized snapshot.
  static final _journals =
      Expando<Map<(DraftVault, String, String), _LibraryJournals>>();
  late _LibraryJournals _journal;
  LibraryCollection(
    this.api,
    this.vault, {
    this.workspace,
    this.personalThread,
    AttachmentStaging Function(String)? staging,
  }) : assert(workspace == null || personalThread == null),
       actor = api.actorId,
       _staging = staging ?? ((scope) => AttachmentStaging(scope: scope));
  final RimiamApi api;
  final DraftVault vault;
  final String actor;
  final String? workspace, personalThread;
  final AttachmentStaging Function(String) _staging;
  bool get personal => workspace == null;
  String? id;
  String title = '';
  bool canWrite = false, ready = false;
  Set<String> hidden = {};
  LibraryIndex? index;
  List<LibraryJson> targets = [];
  LibraryJson snapshot = {};
  late WorkspaceCommandJournal commands;
  late ChatJournal transfers;
  bool _initialized = false, _editingLocal = false;
  int _generation = 0;
  Future<void>? _loading;
  String get _hiddenKey => '${commands.scope}.hidden';
  void _guard() {
    if (actor.isEmpty || api.actorId != actor)
      throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
  }

  String get path => '/api/v1/workspaces/${Uri.encodeComponent(id!)}';
  String filePath(LibraryJson file) =>
      '$path/source-file?id=${Uri.encodeQueryComponent(file['id'] as String)}';

  Future<String> personalArchive() async {
    _guard();
    final target = await api.post('/api/v1/personal-space', {
      'expectedActorId': actor,
    });
    _guard();
    return target['id'] as String;
  }

  Future<void> load() {
    final previous = _loading;
    if (previous != null) return previous;
    final generation = ++_generation;
    final task = _read(generation).whenComplete(() {
      if (generation == _generation) _loading = null;
    });
    _loading = task;
    return task;
  }

  Future<void> _read(int generation) async {
    _guard();
    if (personalThread != null) {
      await api.get(
        '/api/v1/personal-chats?thread=${Uri.encodeQueryComponent(personalThread!)}',
      );
      _guard();
    }
    final target = id ?? workspace ?? personalThread ?? await personalArchive();
    final data = await api.get(
      '/api/v1/workspaces/${Uri.encodeComponent(target)}/workspace',
    );
    _guard();
    if (generation != _generation) return;
    final w = data['workspace'] as LibraryJson;
    final member = libraryRows(data['members'])
        .where((m) => m['active'] == true && m['user_id'] == actor)
        .firstOrNull;
    if (w['id'] != target ||
        (w['personal'] == true) != personal ||
        (personalThread == null && w['personal_archive_id'] != null) ||
        member == null)
      throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
    id = target;
    if (!_initialized) {
      final routes = _journals[api] ??= {};
      _journal = routes.putIfAbsent(
        (vault, actor, target),
        () => _LibraryJournals(
          WorkspaceCommandJournal(
            api,
            vault,
            namespace: 'library',
            collection: target,
          ),
          ChatJournal(
            vault: _CollectionVault(vault),
            origin: api.origin,
            actor: actor,
            workspace: target,
            staging: _staging(
              jsonEncode([api.origin.origin, actor, 'library', target]),
            ),
          ),
        ),
      );
      commands = _journal.commands;
      transfers = _journal.transfers;
      await _journal.open();
      final value = await vault.read(_hiddenKey);
      hidden = value == null
          ? {}
          : (jsonDecode(value) as List).cast<String>().toSet();
      _initialized = true;
    }
    _guard();
    if (generation != _generation) return;
    title = personalThread != null
        ? 'Tu ed Emme'
        : personal
        ? 'Documenti personali'
        : w['name'] as String;
    canWrite = member['contributes'] == true;
    targets = libraryRows(data['libraryDestinations']);
    snapshot = data;
    index = LibraryIndex(data);
    ready = true;
  }

  void clear() {
    _generation++;
    _loading = null;
    ready = false;
    index = null;
    snapshot = {};
    canWrite = false;
    targets = [];
  }

  Future<void> hide(String key, bool hide) async {
    _guard();
    if (!ready || _editingLocal) throw StateError('Attendi il salvataggio.');
    _editingLocal = true;
    final next = {...hidden};
    if (hide) {
      next.add(key);
    } else {
      next.remove(key);
    }
    try {
      await vault.replace(
        _hiddenKey,
        next.isEmpty ? null : jsonEncode(next.toList()),
      );
      _guard();
      hidden = next;
    } finally {
      _editingLocal = false;
    }
  }

  Future<LibraryJson> send(LibraryJson command, bool Function() active) async {
    _guard();
    if (!ready || !active())
      throw const ApiError(403, 'WORKSPACE_ACCESS_REQUIRED');
    return commands.send(
      id!,
      command,
      allowed: () => ready && active() && actor == api.actorId,
    );
  }

  Future<void> changeFavorite(LibraryJson f, bool Function() active) => send({
    'type': 'library.favorite',
    'sourceId': f['id'],
    'starred': f['favorite'] != true,
  }, active);
  Future<void> visibility(LibraryJson f, bool Function() active) {
    if (f['can_manage_visibility'] != true || !canWrite)
      throw const ApiError(403, 'PERMISSION_DENIED');
    return send({
      'type': f['withdrawn'] == true ? 'document.restore' : 'document.withdraw',
      'sourceId': f['id'],
      'documentVersion': f['document_version'],
      'expectedVisibilityVersion': f['visibility_version'],
    }, active);
  }

  Future<void> copyTo(
    LibraryJson f,
    String destination,
    bool Function() active,
  ) {
    if (personal && !targets.any((t) => t['id'] == destination))
      throw const ApiError(403, 'COPY_DESTINATION_INVALID');
    return send({
      'type': 'library.copy',
      'sourceId': f['id'],
      'destinationId': destination,
    }, active);
  }

  Future<void> savePage(String address, bool Function() active) {
    final url = publicLibraryPage(address.trim());
    final prefix = personal ? 'Pagina salvata: ' : 'Pagina condivisa: ';
    if (url == null || prefix.length + url.toString().length > 12000)
      throw const FormatException(
        'Inserisci un collegamento pubblico a una pagina, senza credenziali o inviti.',
      );
    return send({'type': 'message.send', 'content': '$prefix$url'}, active);
  }

  Future<void> sendFiles(bool Function() active) async {
    _guard();
    if (!canWrite || !ready || !active())
      throw const ApiError(403, 'PERMISSION_DENIED');
    if (transfers.files.isEmpty && transfers.pending == null)
      throw const FormatException('Scegli almeno un file.');
    await transfers.submit(api, mayPost: () => ready && canWrite && active());
    if (transfers.pending != null || transfers.files.isNotEmpty)
      throw const FormatException('Verifica il caricamento in sospeso.');
  }

  Future<({String destinationId, String destination, String filename})> note(
    String body,
    bool Function() active,
  ) async {
    _guard();
    if (!ready || !canWrite || !active())
      throw const ApiError(403, 'PERMISSION_DENIED');
    if (body.trim().isEmpty || body.length > 200000 || body.contains('\u0000'))
      throw const FormatException('Scrivi una nota entro 200.000 caratteri.');
    if (transfers.files.isNotEmpty || transfers.pending != null)
      throw const FormatException('Completa prima il caricamento in sospeso.');
    if (_journal.preparingNote)
      throw const FormatException('Attendi il salvataggio della nota.');
    _journal.preparingNote = true;
    try {
      final filename = libraryNoteFilename(body);
      final files = await transfers.staging.stage([
        XFile.fromData(Uint8List.fromList(utf8.encode(body)), path: filename),
      ], existing: []);
      try {
        _guard();
        if (!active()) throw const ApiError(403, 'PERMISSION_DENIED');
        await transfers.replaceFiles(files);
      } catch (_) {
        await transfers.staging.discard(files);
        rethrow;
      }
      await sendFiles(active);
      return (destinationId: id!, destination: title, filename: filename);
    } finally {
      _journal.preparingNote = false;
    }
  }
}
