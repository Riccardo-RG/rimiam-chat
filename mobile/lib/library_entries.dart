// A shared note is a text attachment. The list projects existing source versions
// and messages without copying them or changing their authorship.
typedef LibraryJson = Map<String, dynamic>;
List<LibraryJson> libraryRows(dynamic value) =>
    (value as List? ?? const []).cast<LibraryJson>();

({String? status, bool canRetry, bool discloseMedia}) libraryReading(
  LibraryJson file,
) {
  final state = file['processing_status'];
  final type = file['media_type'] as String? ?? '';
  final withheld = file['processing_error'] == 'MEDIA_DISCLOSURE_REQUIRED';
  return (
    status: withheld
        ? 'Lettura con AI non autorizzata.'
        : switch (state) {
            'queued' => 'Lettura in attesa',
            'processing' => 'Lettura in corso',
            'needs_configuration' => 'Servizio di lettura da collegare',
            'needs_input' => 'Serve un chiarimento o un formato leggibile',
            'failed' => 'Lettura non riuscita',
            _ => null,
          },
    canRetry:
        file['withdrawn'] != true &&
        const {'failed', 'needs_input', 'needs_configuration'}.contains(state),
    discloseMedia: type.startsWith('image/') || type.startsWith('audio/'),
  );
}

const collectionTabs = [
  'Recenti',
  'File',
  'Media',
  'Collegamenti',
  'Preferiti',
];
const collectionTypes = [
  'Tutti',
  'Immagine',
  'Audio',
  'PDF',
  'Word',
  'Tabella',
  'Markdown',
  'Testo',
  'File',
  'Collegamento',
];

class LibraryEntry {
  LibraryEntry({
    required this.title,
    required this.date,
    required this.type,
    required this.key,
    this.file,
    this.messageId,
    this.address,
    this.author,
  });
  final String title, type, key;
  final DateTime date;
  final LibraryJson? file;
  final String? messageId, author;
  final Uri? address;
  bool get photo => const {
    'image/jpeg',
    'image/png',
    'image/webp',
  }.contains(file?['media_type']);
  bool get favorite => file?['favorite'] == true;
}

DateTime libraryDay(DateTime time) {
  final d = time.toLocal();
  return DateTime(d.year, d.month, d.day);
}

String fileType(String? mime, String name) {
  final ext = name.split('.').last.toLowerCase();
  if (mime?.startsWith('image/') == true ||
      ['jpeg', 'jpg', 'png', 'webp'].contains(ext))
    return 'Immagine';
  if (mime?.startsWith('audio/') == true ||
      ['mp3', 'm4a', 'wav', 'webm', 'ogg'].contains(ext))
    return 'Audio';
  if (mime == 'application/pdf' || ext == 'pdf') return 'PDF';
  return switch (ext) {
    'docx' => 'Word',
    'csv' => 'Tabella',
    'md' => 'Markdown',
    'txt' => 'Testo',
    _ => mime?.startsWith('text/') == true ? 'Testo' : 'File',
  };
}

final _unsafeTarget = RegExp(
  r'(?:^|[^a-z])(?:invite|invitation|join|reset|verify|verification|oauth|auth|session|token|secret|sig|signature|credential|password|code|email|phone|key|apikey|jwt|nonce)(?:[^a-z]|$)',
  caseSensitive: false,
);
Uri? publicLibraryPage(String input) {
  if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(input) ||
      RegExp(r'[\s\\<>"`]').hasMatch(input))
    return null;
  final u = Uri.tryParse(input);
  if (u == null || u.userInfo.isNotEmpty || u.authority.contains('@'))
    return null;
  final host = u.host.toLowerCase().replaceFirst(RegExp(r'\.$'), '');
  if (!RegExp(r'^[a-z0-9.-]+\.[a-z]{2,}$').hasMatch(host) ||
      RegExp(r'(?:^|\.)(localhost|local|internal|lan|onion)$').hasMatch(host) ||
      [
        'chat.whatsapp.com',
        'wa.me',
        'discord.gg',
        'join.slack.com',
      ].contains(host))
    return null;
  try {
    final target = Uri.decodeComponent('${u.path}?${u.query}#${u.fragment}');
    if (RegExp(r'@|(?:^|[^\d])\+?\d[\d ().-]{6,}\d(?:[^\d]|$)')
            .hasMatch(target) ||
        _unsafeTarget.hasMatch(target))
      return null;
    return u;
  } on FormatException {
    return null;
  } on ArgumentError {
    return null;
  }
}

String shortLibraryPage(Uri uri) {
  final parts = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (parts.isEmpty) return uri.host;
  final letters = parts.last
      .replaceAll(RegExp(r'[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]'), '')
      .runes
      .toList();
  final last = letters.length > 36
      ? '${String.fromCharCodes(letters.take(35))}…'
      : String.fromCharCodes(letters);
  return '${uri.host}${parts.length > 1 ? "/…/" : "/"}$last';
}

String libraryNoteFilename(String value) {
  final first =
      value
          .split(RegExp(r'\r\n?|\n'))
          .where((s) => s.trim().isNotEmpty)
          .firstOrNull ??
      '';
  final clean = first
      .replaceAll(RegExp(r'[^\p{L}\p{N}\p{M} _-]+', unicode: true), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  final name = String.fromCharCodes(clean.runes.take(56)).trim();
  return '${name.isEmpty ? 'Nota' : name}.txt';
}

class LibraryIndex {
  LibraryIndex(LibraryJson snapshot)
    : messages = {
        for (final message in libraryRows(snapshot['messages']))
          message['id'] as String: message,
      },
      files = _currentFiles(libraryRows(snapshot['sources'])),
      withdrawnVersions = libraryRows(snapshot['sources'])
          .where(
            (s) =>
                s['kind'] == 'document' &&
                s['withdrawn'] == true &&
                s['can_manage_visibility'] == true,
          )
          .toList();
  final Map<String, LibraryJson> messages;
  final List<LibraryJson> files, withdrawnVersions;
  static List<LibraryJson> _currentFiles(List<LibraryJson> rows) {
    final last = <String, LibraryJson>{};
    for (final s in rows.where((s) => s['kind'] == 'document')) {
      final key = (s['document_id'] ?? s['id']) as String, previous = last[key];
      if (previous == null ||
          (s['document_version'] ?? 1) > (previous['document_version'] ?? 1))
        last[key] = s;
    }
    return last.values.toList();
  }

  List<LibraryEntry> filter({
    String tab = 'Recenti',
    String type = 'Tutti',
    String search = '',
    DateTime? from,
    DateTime? until,
    Set<String> hidden = const {},
    bool onlyHidden = false,
    bool withdrawn = false,
  }) {
    final term = search.trim().toLowerCase();
    bool within(DateTime time) {
      final date = libraryDay(time);
      return (from == null || !date.isBefore(libraryDay(from))) &&
          (until == null || !date.isAfter(libraryDay(until)));
    }

    bool matches(LibraryEntry e) =>
        within(e.date) &&
        (type == 'Tutti' || type == e.type) &&
        (term.isEmpty ||
            e.title.toLowerCase().contains(term) ||
            (e.address?.toString().toLowerCase().contains(term) ?? false)) &&
        (withdrawn || hidden.contains(e.key) == onlyHidden);
    final list = <LibraryEntry>[];
    if (tab != 'Collegamenti') {
      for (final f in withdrawn ? withdrawnVersions : files) {
        if ((f['withdrawn'] == true) != withdrawn ||
            (withdrawn && f['can_manage_visibility'] != true))
          continue;
        final title = (f['filename'] ?? f['title']) as String,
            id = f['shared_message_id'] as String?;
        final e = LibraryEntry(
          file: f,
          title: title,
          type: fileType(f['media_type'] as String?, title),
          key: 'file:${f['document_id'] ?? f['id']}',
          date: DateTime.parse(f['created_at'] as String),
          messageId: id,
          author: messages[id]?['author_name'] as String?,
        );
        if ((tab != 'Media' || e.photo) &&
            (tab != 'Preferiti' || e.favorite) &&
            matches(e))
          list.add(e);
      }
    }
    if (!withdrawn &&
        (tab == 'Recenti' || tab == 'Collegamenti') &&
        (type == 'Tutti' || type == 'Collegamento')) {
      final links = <String, LibraryEntry>{};
      // Deduplicate after the date filter; one link may occur again on another day.
      final ordered = messages.values.toList()
        ..sort(
          (a, b) => (a['sequence'] as int).compareTo(b['sequence'] as int),
        );
      for (final m in ordered) {
        final date = DateTime.parse(m['created_at'] as String);
        if (!within(date) ||
            m['actor_kind'] != 'human' ||
            m['author_id'] == null ||
            m['purpose'] == 'workspace_welcome')
          continue;
        final text = m['content'] as String, id = m['id'] as String;
        void add(String key, String title, Uri? address) {
          links[key] = LibraryEntry(
            title: title,
            type: 'Collegamento',
            key: 'link:$id:${address == null ? title : 'page'}',
            date: date,
            messageId: id,
            address: address,
            author: m['author_name'] as String?,
          );
        }

        final prefix = ['Pagina salvata: ', 'Pagina condivisa: ']
            .where((p) => m['purpose'] == 'conversation' && text.startsWith(p))
            .firstOrNull;
        final explicit = prefix == null
            ? null
            : publicLibraryPage(text.substring(prefix.length));
        if (explicit != null) {
          add('page:$explicit', shortLibraryPage(explicit), explicit);
          continue;
        }
        for (final match in RegExp(
          r"""\bhttps?://[^\s<>"'`]+""",
          caseSensitive: false,
        ).allMatches(text)) {
          final uri = publicLibraryPage(
            match.group(0)!.replaceFirst(RegExp(r'[),.;!?\]}]+$'), ''),
          );
          if (uri != null) add('host:${uri.host}', uri.host, null);
        }
      }
      list.addAll(links.values.where(matches));
    }
    list.sort((a, b) {
      final sort = b.date.compareTo(a.date);
      return sort != 0 ? sort : a.key.compareTo(b.key);
    });
    return list;
  }
}
