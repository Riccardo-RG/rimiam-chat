import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

import 'api.dart';
import 'attachment_staging.dart';
import 'local_secure_storage.dart';

abstract interface class DraftVault {
  Future<String?> read(String key);
  Future<void> replace(String key, String? value);
}

class DeviceDraftVault implements DraftVault {
  const DeviceDraftVault();

  @override
  Future<String?> read(String key) => deviceSecureStorage.read(key: key);
  @override
  Future<void> replace(String key, String? value) => value == null
      ? deviceSecureStorage.delete(key: key)
      : deviceSecureStorage.write(key: key, value: value);
}

class PendingChatMessage {
  PendingChatMessage(
    this.id,
    this.content,
    this.draftRevision, [
    this.quoteId,
    this.files = const [],
    this.quoteSource = false,
    this.mentionIds = const [],
    this.timeZone,
    this.fileSourceId,
  ]);
  final List<StagedAttachment> files;
  final List<String> mentionIds;
  final String? timeZone;
  final String? fileSourceId;
  final bool quoteSource;
  final String? quoteId;
  final String id, content;
  final int draftRevision;

  Map<String, dynamic> toJson() => {
    'id': id,
    'content': content,
    'draftRevision': draftRevision,
    if (quoteId != null) 'quoteId': quoteId,
    if (quoteSource) 'quoteSource': true,
    if (mentionIds.isNotEmpty) 'mentionIds': mentionIds,
    if (timeZone != null) 'timeZone': timeZone,
    if (fileSourceId != null) 'fileSourceId': fileSourceId,
    if (files.isNotEmpty) 'files': files.map((f) => f.toJson()).toList(),
  };

  factory PendingChatMessage.fromJson(Map<String, dynamic> json) {
    final message = PendingChatMessage(
      json['id'] as String,
      json['content'] as String,
      json['draftRevision'] as int,
      json['quoteId'] as String?,
      _restoreFiles(json['files']),
      json['quoteSource'] == true,
      List<String>.from(json['mentionIds'] as List? ?? const []),
      json['timeZone'] as String?,
      json['fileSourceId'] as String?,
    );
    if (message.id.isEmpty ||
        (message.content.isEmpty && message.files.isEmpty) ||
        message.draftRevision < 0)
      throw const FormatException('Invio salvato non valido');
    return message;
  }
}

List<StagedAttachment> _restoreFiles(dynamic value) => value == null
    ? const []
    : (value as List)
          .cast<Map<String, dynamic>>()
          .map(StagedAttachment.fromJson)
          .toList(growable: false);

/// One encrypted value binds the editable draft and the exact unresolved command.
class ChatJournal extends ChangeNotifier {
  ChatJournal({
    required this.vault,
    required Uri origin,
    required this.actor,
    required this.workspace,
    this.direct = false,
    AttachmentStaging? staging,
  }) : staging =
           staging ??
           AttachmentStaging(
             scope: jsonEncode([
               origin.origin,
               actor,
               direct ? 'direct' : 'workspace',
               workspace,
             ]),
           ),
       key =
           'rimiam.${direct ? 'direct' : 'chat'}.v1.${sha256.convert(utf8.encode(jsonEncode([origin.origin, actor, workspace])))}';

  final DraftVault vault;
  final bool direct;
  final AttachmentStaging staging;
  List<StagedAttachment> files = const [];
  String? attachmentProblem;
  String? mentionProblem;
  Map<String, String> mentions = const {};
  String? quoteId;
  ({String sourceId, String filename})? fileReference;
  bool askAssistant = false, quoteSource = false;
  final String actor, workspace, key;
  Future<void> _writes = Future.value();
  int _ticket = 0, _revision = 0;
  bool ready = false, sending = false, storageError = false;
  String text = '';
  String? importedLegacyId;
  PendingChatMessage? pending;
  Future<void>? _opening;

  Future<void> open() => ready
      ? Future.value()
      : (_opening ??= _restore().whenComplete(() => _opening = null));

  Future<void> _restore() async {
    try {
      final raw = await vault.read(key);
      if (raw != null) {
        final data = jsonDecode(raw) as Map<String, dynamic>;
        if (data['v'] != 1)
          throw const FormatException('Formato bozza sconosciuto');
        final draft = data['text'] as String;
        final revision = data['revision'] as int;
        final request = data['pending'];
        final restored = request == null
            ? null
            : PendingChatMessage.fromJson(request as Map<String, dynamic>);
        if (revision < 0 ||
            (restored != null && restored.draftRevision > revision))
          throw const FormatException('Revisione non valida');
        quoteId = data['quoteId'] as String?;
        final source = data['fileReference'] as Map?;
        fileReference = direct || source == null
            ? null
            : (
                sourceId: source['id'] as String,
                filename: source['name'] as String,
              );
        askAssistant = !direct && data['askAssistant'] == true;
        quoteSource = !direct && quoteId != null && data['quoteSource'] == true;
        files = _restoreFiles(data['files']);
        mentions = direct
            ? const {}
            : Map<String, String>.from(data['mentions'] as Map? ?? const {});
        importedLegacyId = data['importedLegacyId'] as String?;
        text = draft;
        _revision = revision;
        pending = restored;
      }
      ready = true;
      storageError = false;
    } catch (_) {
      storageError = true;
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> _persist() {
    final value =
        text.isEmpty &&
            pending == null &&
            quoteId == null &&
            fileReference == null &&
            !askAssistant &&
            files.isEmpty && importedLegacyId == null
        ? null
        : jsonEncode({
            'v': 1,
            'revision': _revision,
            if (importedLegacyId != null) 'importedLegacyId': importedLegacyId,
            'text': text,
            if (quoteId != null) 'quoteId': quoteId,
            if (fileReference case final file?)
              'fileReference': {'id': file.sourceId, 'name': file.filename},
            if (askAssistant) 'askAssistant': true,
            if (quoteSource) 'quoteSource': true,
            if (mentions.isNotEmpty) 'mentions': mentions,
            if (files.isNotEmpty)
              'files': files.map((f) => f.toJson()).toList(),
            'pending': pending?.toJson(),
          });
    final ticket = ++_ticket;
    final write = _writes.then((_) => vault.replace(key, value));
    _writes = write.then(
      (_) => _storageStatus(ticket, false),
      onError: (Object _, StackTrace _) => _storageStatus(ticket, true),
    );
    return write;
  }

  void _storageStatus(int ticket, bool failed) {
    if (ticket != _ticket || storageError == failed) return;
    storageError = failed;
    notifyListeners();
  }

  void edit(String next, {Map<String, String>? selected}) {
    if (!ready ||
        (next == text && (selected == null || mapEquals(mentions, selected))))
      return;
    if (!direct && selected != null) mentions = Map.unmodifiable(selected);
    text = next;
    if (mentionProblem != null) {
      mentionProblem = null;
      notifyListeners();
    }
    _revision++;
    // Keep updates in order even when typing outruns platform storage.
    unawaited(_persist().catchError((Object _) {}));
  }

  void quote(String? id, {bool ask = false, bool source = false}) {
    if (!ready) return;
    final nextAsk = !direct && ask;
    final nextSource = !direct && id != null && source;
    if (fileReference == null &&
        quoteId == id &&
        askAssistant == nextAsk &&
        quoteSource == nextSource)
      return;
    fileReference = null;
    quoteId = id;
    askAssistant = nextAsk;
    quoteSource = nextSource;
    _revision++;
    notifyListeners();
    unawaited(_persist().catchError((Object _) {}));
  }

  void askAboutFile(({String sourceId, String filename}) file) {
    if (!ready || direct || sending || pending != null) return;
    quoteId = null;
    quoteSource = false;
    fileReference = file;
    askAssistant = true;
    _revision++;
    notifyListeners();
    unawaited(_persist().catchError((Object _) {}));
  }

  bool get acceptsLegacyDraft =>
      ready && !sending && !storageError && pending == null && text.isEmpty &&
      files.isEmpty && quoteId == null && fileReference == null && !askAssistant;

  // The one vault write binds the recovered content to its old ID, including
  // after the user sends or clears it. Never create an outgoing operation here.
  Future<void> importLegacyDraft({
    required String id, required String content, required List<StagedAttachment> attachments,
    required bool Function() stillAllowed, String? quote, bool ask = false, bool humanQuote = false,
    ({String sourceId,String filename})? source, Map<String,String> people = const {},
  }) async {
    if (!acceptsLegacyDraft || importedLegacyId == id || !stillAllowed()) {
      await _disposeFiles(attachments);
      throw const FormatException('Il campo contiene già una bozza o il recupero è già avvenuto.');
    }
    final previousImport = importedLegacyId;
    final revision = ++_revision;
    text = content;
    importedLegacyId = id;
    files = List.unmodifiable(attachments);
    quoteId = quote;
    askAssistant = !direct && ask;
    quoteSource = !direct && humanQuote && quote != null;
    fileReference = direct ? null : source;
    mentions = direct ? const {} : Map.unmodifiable(people);
    try {
      await _persist();
    } catch (_) {
      if (_revision == revision) {
        text = ''; importedLegacyId = previousImport; files = const [];
        quoteId = null; askAssistant = false; quoteSource = false;
        fileReference = null; mentions = const {};
        _revision++;
        await _disposeFiles(attachments);
      }
      rethrow;
    } finally { notifyListeners(); }
  }

  Future<void> replaceFiles(List<StagedAttachment> next) async {
    if (!ready || sending || pending != null)
      throw const AttachmentProblem('Attendi la conferma del messaggio.');
    final previous = files;
    files = List.unmodifiable(next);
    _revision++;
    attachmentProblem = null;
    try {
      await _persist();
    } catch (_) {
      files = previous;
      _revision++;
      notifyListeners();
      rethrow;
    }
    notifyListeners();
    final keep = next.map((f) => f.id).toSet();
    await _disposeFiles(previous.where((f) => !keep.contains(f.id)).toList());
  }

  Future<void> _disposeFiles(List<StagedAttachment> old) async {
    try {
      await staging.discard(old);
    } on Object {
      // The protected journal no longer holds these per-file encryption keys.
    }
  }

  Future<void> saveAgain() => ready ? _persist() : open();

  String outgoingContent(String draft) {
    final raw = draft.trim();
    if (!askAssistant || raw.isEmpty) return raw;
    final addressed = RegExp(
      r'^\s*(?:(?:ciao|ehi|hey|hello|hi)[\s,]+)?@?emme(?![\p{L}\p{M}\p{N}_])',
      caseSensitive: false,
      unicode: true,
    ).hasMatch(raw);
    return addressed ? raw : '@Emme $raw';
  }

  Future<void> submit(
    RimiamApi api, {
    required bool Function() mayPost,
    String? timeZone,
  }) async {
    if (sending || !ready || !mayPost() || api.actorId != actor) return;
    final previous = pending;
    final raw = text.trim();
    if (previous == null && askAssistant && raw.isEmpty) return;
    final content = outgoingContent(raw);
    if (previous == null &&
        ((content.isEmpty && files.isEmpty) || content.length > 12000))
      return;
    final request =
        previous ??
        PendingChatMessage(
          api.newId(),
          content,
          _revision,
          quoteId,
          List.unmodifiable(files),
          quoteSource,
          List.unmodifiable(mentions.keys),
          direct ? null : timeZone,
          fileReference?.sourceId,
        );
    attachmentProblem = null;
    sending = true;
    pending = request;
    notifyListeners();
    try {
      // A process exit anywhere beyond this await can recover the original ID.
      await _persist();
      if (!mayPost() || api.actorId != actor) return;
      if (direct) {
        final path = '/api/v1/direct-chats/${Uri.encodeComponent(workspace)}';
        var found = false;
        if (previous != null) {
          final view = await api.get(path);
          if (view['id'] != workspace || view['me'] != actor)
            throw const FormatException('Conversazione privata inattesa');
          for (final message
              in (view['messages'] as List).cast<Map<String, dynamic>>()) {
            if (message['id'] != request.id) continue;
            if (message['authorId'] != actor ||
                message['text'] != request.content ||
                message['quoteId'] != request.quoteId)
              throw const FormatException('Ricevuta privata inattesa');
            final linked = (message['files'] as List? ?? const [])
                .cast<Map<String, dynamic>>();
            if (linked.length != request.files.length)
              throw const FormatException('Allegati della ricevuta inattesi.');
            for (int i = 0; i < linked.length; i++) {
              final expected = request.files[i], actual = linked[i];
              if (actual['filename'] != expected.filename ||
                  actual['id'] is! String)
                throw const FormatException('Allegato inatteso.');
              final bytes = await api.getBytes(
                '$path/files/${Uri.encodeComponent(actual['id'] as String)}',
              );
              if (bytes.length != expected.size ||
                  sha256.convert(bytes).toString() != expected.digest)
                throw const FormatException('Contenuto ricevuto inatteso.');
            }
            found = true;
            break;
          }
        }
        if (!found) {
          if (!mayPost() || api.actorId != actor) return;
          final attachments = await staging.payloads(request.files);
          if (!mayPost() || api.actorId != actor) return;
          final response = await api.post(path, {
            'type': 'send',
            'expectedActorId': actor,
            'id': request.id,
            'text': request.content,
            if (request.quoteId != null) 'quoteId': request.quoteId,
            if (attachments.isNotEmpty) 'attachments': attachments,
          });
          if (response['messageId'] != request.id)
            throw const FormatException('Ricevuta privata inattesa');
        }
      } else {
        final path = '/api/v1/workspaces/${Uri.encodeComponent(workspace)}';
        bool confirmed(Map<String, dynamic> receipt) =>
            receipt['commandId'] == request.id &&
            receipt['status'] == 'committed';
        var committed = false;
        if (previous != null) {
          try {
            committed = confirmed(
              await api.get(
                '$path/receipts/${Uri.encodeComponent(request.id)}',
              ),
            );
            if (!committed) throw const FormatException('Ricevuta inattesa');
          } on ApiError catch (error) {
            if (error.status != 404 || error.code != 'RECEIPT_NOT_FOUND')
              rethrow;
          }
        }
        if (!committed) {
          if (!mayPost() || api.actorId != actor) return;
          final attachments = await staging.payloads(request.files);
          if (!mayPost() || api.actorId != actor) return;
          final receipt = await api.post('$path/commands', {
            'commandId': request.id,
            'expectedActorId': actor,
            'command': {
              'type': 'message.send',
              'content': request.content,
              if (request.mentionIds.isNotEmpty)
                'mentionIds': request.mentionIds,
              if (request.timeZone != null) 'clientTimeZone': request.timeZone,
              if (request.quoteId != null) 'quoteMessageId': request.quoteId,
              if (request.fileSourceId != null)
                'reference': {
                  'kind': 'source',
                  'id': request.fileSourceId,
                  'version': 1,
                }
              else if (request.quoteSource && request.quoteId != null)
                'reference': {
                  'kind': 'source',
                  'id': request.quoteId,
                  'version': 1,
                },
              if (attachments.isNotEmpty) 'attachments': attachments,
            },
          });
          if (!confirmed(receipt))
            throw const FormatException('Ricevuta inattesa');
        }
      }
      final submittedText = text;
      final submittedQuote = quoteId;
      final submittedReference = fileReference;
      final submittedAsk = askAssistant, submittedSource = quoteSource;
      final submittedFiles = files;
      final submittedMentions = mentions;
      final delivered = request.files.map((f) => f.id).toSet();
      files = files.where((f) => !delivered.contains(f.id)).toList();
      final clearDraft = request.draftRevision == _revision;
      pending = null;
      if (clearDraft) {
        text = '';
        quoteId = null;
        fileReference = null;
        askAssistant = false;
        quoteSource = false;
        mentions = const {};
      }
      notifyListeners();
      try {
        await _persist();
      } catch (_) {
        // The server receipt remains valid. Preserve its ID for reconciliation.
        pending = request;
        files = submittedFiles;
        if (clearDraft && request.draftRevision == _revision) {
          text = submittedText;
          quoteId = submittedQuote;
          fileReference = submittedReference;
          askAssistant = submittedAsk;
          quoteSource = submittedSource;
          mentions = submittedMentions;
        }
        rethrow;
      }
      await _disposeFiles(request.files);
    } on AttachmentProblem catch (e) {
      attachmentProblem = e.message;
      // Nothing was transmitted yet on a first attempt with unreadable local data.
      if (previous == null) {
        pending = null;
        await _persist();
      }
      rethrow;
    } on ApiError catch (e) {
      if (request.fileSourceId != null && e.code == 'REFERENCE_NOT_FOUND') {
        pending = null;
        attachmentProblem = 'Questo file non è più disponibile. Rimuovi il riferimento o scegli un altro file.';
        await _persist();
      }
      if (!direct && e.code == 'MENTION_NOT_AVAILABLE') {
        pending = null;
        mentionProblem = 'La menzione è cambiata. Correggi il destinatario prima di inviare.';
        await _persist();
      }
      if (request.files.isNotEmpty &&
          [
            'DOCUMENT_TOO_LARGE',
            'INVALID_DOCUMENT_ENCODING',
            'DOCUMENT_FORMAT_UNSUPPORTED',
            'DOCUMENT_FORMAT_INVALID',
            'INVALID_DOCUMENT_TEXT',
          ].contains(e.code)) {
        pending = null;
        attachmentProblem =
            'Controlla il formato e le dimensioni degli allegati.';
        await _persist();
      }
      rethrow;
    } finally {
      sending = false;
      notifyListeners();
    }
  }
}
