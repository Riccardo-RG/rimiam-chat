import 'ui_language.dart';

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'attachment_staging.dart';
import 'profile_photo_codec.dart';
import 'studio_appearance.dart';

typedef ProfileJson = Map<String, dynamic>;
String profileInitials(String n) {
  final words = n.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  return words.isEmpty
      ? '?'
      : (words.first.characters.first +
                (words.length > 1 ? words.last.characters.first : ''))
            .toUpperCase();
}

String profilePhotoPath({
  required int version,
  String? workspace,
  String? person,
}) => Uri(
  path: '/api/v1/identity-photos',
  queryParameters: {
    'image': '1',
    'v': '$version',
    if (workspace != null) 'workspace': workspace,
    if (person != null) 'person': person,
  },
).toString();

class IdentityAvatar extends StatefulWidget {
  const IdentityAvatar({
    super.key,
    required this.api,
    required this.name,
    required this.photo,
    this.workspace,
    this.person,
    this.radius = 20,
  });
  final RimiamApi api;
  final String name;
  final ProfileJson? photo;
  final String? workspace, person;
  final double radius;
  @override
  State<IdentityAvatar> createState() => _IdentityAvatarState();
}

class _IdentityAvatarState extends State<IdentityAvatar> {
  String? identity;
  Future<Uint8List>? image;
  @override
  void initState() {
    super.initState();
    refresh();
  }

  @override
  void didUpdateWidget(IdentityAvatar old) {
    super.didUpdateWidget(old);
    refresh();
  }

  void refresh() {
    final p = widget.photo;
    final path = p?['present'] == true
        ? profilePhotoPath(
            version: p!['version'],
            workspace: widget.workspace,
            person: widget.person,
          )
        : null;
    final key = '${widget.api.origin.origin}|${widget.api.actorId}|$path';
    if (key == identity) return;
    identity = key;
    image = path == null ? null : widget.api.getBytes(path);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List>(
    key: ValueKey(identity),
    future: image,
    builder: (c, s) => CircleAvatar(
      radius: widget.radius,
      foregroundImage: s.hasData ? MemoryImage(s.data!) : null,
      child: Text(profileInitials(widget.name)),
    ),
  );
}

class MemberProfilePage extends StatelessWidget {
  const MemberProfilePage({
    super.key,
    required this.api,
    required this.workspace,
    required this.member,
  });
  final RimiamApi api;
  final String workspace, member;
  @override
  Widget build(BuildContext c) => _ProfilePage(
    key: ValueKey((api, api.actorId, workspace, member)),
    api: api,
    workspace: workspace,
    member: member,
  );
}

class AccountProfilePage extends StatelessWidget {
  const AccountProfilePage({super.key, required this.api});
  final RimiamApi api;
  @override
  Widget build(BuildContext c) =>
      _ProfilePage(key: ValueKey((api, api.actorId)), api: api);
}

class _ProfilePage extends StatefulWidget {
  const _ProfilePage({
    super.key,
    required this.api,
    this.workspace,
    this.member,
  });
  final RimiamApi api;
  final String? workspace, member;
  @override
  State<_ProfilePage> createState() => _ProfileState();
}

class _ProfileState extends State<_ProfilePage> with WidgetsBindingObserver {
  final phone = TextEditingController();
  late final actor = widget.api.actorId;
  ProfileJson? profile, photo;
  String? issue;
  bool active = true, busy = false, verified = false;
  int generation = 0;
  bool get own => widget.workspace == null;
  bool get current => mounted && active && widget.api.actorId == actor;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    read();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    phone.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
      generation++;
      setState(() {
        active = false;
        verified = false;
      });
    }
    if (s == AppLifecycleState.resumed) {
      active = true;
      read();
    }
  }

  Future<void> read() async {
    final g = ++generation, w = widget.workspace, id = widget.member;
    try {
      final result = await Future.wait([
        widget.api.get(
          own
              ? '/api/v1/profile'
              : '/api/v1/workspaces/${Uri.encodeComponent(w!)}/profiles/${Uri.encodeComponent(id!)}',
        ),
        widget.api.get(
          w == null
              ? '/api/v1/identity-photos'
              : '/api/v1/identity-photos?workspace=${Uri.encodeQueryComponent(w)}',
        ),
      ]);
      if (!current || g != generation) return;
      if (result[0]['id'] != (own ? actor : id) || result[1]['actor'] != actor)
        throw const FormatException();
      setState(() {
        final versionChanged = profile?['version'] != result[0]['version'];
        if (versionChanged || phone.text == (profile?['phone'] ?? '')) {
          phone.text = result[0]['phone'] as String? ?? '';
        }
        verified = true;
        profile = result[0];
        photo = own ? result[1]['own'] : result[1]['members'][id];
        issue = null;
      });
    } catch (e) {
      if (current && g == generation)
        setState(() {
          verified = true;
          profile = null;
          photo = null;
          phone.clear();
          issue = e is ApiError && {403, 404}.contains(e.status)
              ? 'Il profilo non è più disponibile.'
              : 'Impossibile caricare il profilo.';
        });
    }
  }

  Future<void> savePhone() async {
    final row = profile;
    if (!own || !current || !verified || busy || row == null) return;
    final text = phone.text.trim(), digits = text.replaceAll(RegExp(r'\D'), '');
    if (text.isNotEmpty &&
        (!RegExp(r'^\+?[\d ()./\-]+$').hasMatch(text) ||
            digits.length < 6 ||
            digits.length > 15 ||
            text.length > 32)) {
      setState(
        () => issue = 'Controlla il numero, con prefisso se necessario.',
      );
      return;
    }
    setState(() => busy = true);
    try {
      final value = await widget.api.post('/api/v1/profile', {
        'expectedActorId': actor,
        'expectedVersion': row['version'],
        'phone': text.isEmpty ? null : text,
      });
      if (current && value['id'] == actor)
        setState(() {
          profile = value;
          issue = null;
          phone.text = value['phone'] ?? '';
        });
    } catch (e) {
      if (current) {
        await read();
        if (current)
          setState(
            () => issue = e is ApiError && e.status == 409
                ? 'Il profilo è cambiato. Verifica il numero aggiornato.'
                : 'Controlla il numero salvato prima di riprovare.',
          );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext c) {
    final row = profile, name = row?['name'] as String? ?? '';
    return Scaffold(
      appBar: AppBar(
        title: Text(own ? uiText(c, 'Il mio profilo') : uiText(c, 'Profilo')),
        actions: [
          IconButton(
            tooltip: uiText(c, 'Aggiorna profilo'),
            icon: const Icon(Icons.refresh),
            onPressed: busy ? null : read,
          ),
        ],
      ),
      body: SafeArea(
        child: Visibility(
          visible: active && (verified || row == null),
          maintainState: true,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (issue != null) Text(uiText(c, issue!)),
              if (row == null && issue == null) const LinearProgressIndicator(),
              if (row != null) ...[
                IdentityPhotoControls(
                  api: widget.api,
                  name: name,
                  photo: photo,
                  workspace: widget.workspace,
                  person: own ? actor : widget.member,
                  editable: own,
                  changeWorkspacePhoto: false,
                  onChanged: read,
                ),
                Text(name, style: Theme.of(c).textTheme.headlineSmall),
                ListTile(
                  title: Text(uiText(c, 'Email')),
                  subtitle: SelectableText(row['email'] as String),
                ),
                if (own) ...[
                  TextField(
                    controller: phone,
                    keyboardType: TextInputType.phone,
                    maxLength: 32,
                    enabled: !busy,
                    decoration: InputDecoration(
                      labelText: uiText(c, 'Telefono facoltativo'),
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                  Text(
                    uiText(
                      c,
                      'Visibile alle persone che condividono uno spazio con te.',
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton(
                      onPressed:
                          busy || (row['phone'] ?? '') == phone.text.trim()
                          ? null
                          : savePhone,
                      child: Text(uiText(c, 'Salva numero')),
                    ),
                  ),
                ] else if (row['phone'] != null)
                  ListTile(
                    title: Text(uiText(c, 'Telefono')),
                    subtitle: SelectableText(row['phone'] as String),
                  ),
              ],
              if (own) const AppearanceControls(),
            ],
          ),
        ),
      ),
    );
  }
}

class IdentityPhotoControls extends StatefulWidget {
  const IdentityPhotoControls({
    super.key,
    required this.api,
    required this.name,
    required this.photo,
    required this.editable,
    required this.changeWorkspacePhoto,
    required this.onChanged,
    this.workspace,
    this.person,
  });
  final RimiamApi api;
  final String name;
  final ProfileJson? photo;
  final bool editable, changeWorkspacePhoto;
  final String? workspace, person;
  final Future<void> Function() onChanged;
  @override
  State<IdentityPhotoControls> createState() => _PhotoControlsState();
}

class _PhotoControlsState extends State<IdentityPhotoControls> {
  bool busy = false;
  String? issue;
  Future<void> change({bool remove = false}) async {
    final p = widget.photo;
    if (busy || !widget.editable) return;
    final who = widget.api.actorId, version = p?['version'] as int? ?? 0;
    setState(() {
      busy = true;
      issue = null;
    });
    try {
      String? data;
      if (remove) {
        if ((await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: Text(uiText(c, 'Rimuovere la foto?')),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(c, false),
                    child: Text(uiText(c, 'Annulla')),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(c, true),
                    child: Text(uiText(c, 'Rimuovi foto')),
                  ),
                ],
              ),
            )) !=
            true)
          return;
      } else {
        final picked = await ImagePicker().pickImage(
          source: ImageSource.gallery,
          maxWidth: 640,
          maxHeight: 640,
          imageQuality: 83,
          requestFullMetadata: false,
        );
        if (picked == null) return;
        try {
          if (await picked.length() > 8 * 1024 * 1024) {
            throw const FormatException('La foto è troppo grande.');
          }
          data = base64Encode(
            await profilePhotoJpeg(await picked.readAsBytes()),
          );
        } finally {
          await AttachmentStaging.releasePickerCopies([picked]);
        }
      }
      // Returning from the system gallery briefly disables the parent controls
      // while its membership snapshot refreshes. The server authorizes the
      // write anew and checks the version captured when the picker was opened.
      if (!mounted || widget.api.actorId != who) return;
      await widget.api.post('/api/v1/identity-photos', {
        'expectedActorId': who,
        'expectedVersion': version,
        if (widget.changeWorkspacePhoto) 'workspace': widget.workspace,
        'image': data,
      });
      if (mounted) await widget.onChanged();
    } catch (_) {
      if (mounted) {
        await widget.onChanged();
        if (mounted)
          setState(
            () => issue = 'Controlla la foto salvata prima di riprovare.',
          );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext c) {
    final present = widget.photo?['present'] == true;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          children: [
            Semantics(
              button: present,
              label: present
                  ? uiText(c, 'Apri foto di {0}', [widget.name])
                  : null,
              child: InkWell(
                onTap: !present
                    ? null
                    : () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => _PhotoPreview(
                            api: widget.api,
                            path: profilePhotoPath(
                              version: widget.photo!['version'],
                              workspace: widget.workspace,
                              person: widget.person,
                            ),
                            name: widget.name,
                          ),
                        ),
                      ),
                child: IdentityAvatar(
                  api: widget.api,
                  name: widget.name,
                  photo: widget.photo,
                  workspace: widget.workspace,
                  person: widget.person,
                  radius: 36,
                ),
              ),
            ),
            if (widget.editable)
              TextButton(
                onPressed: busy ? null : () => change(),
                child: Text(
                  present
                      ? uiText(c, 'Cambia foto')
                      : uiText(c, 'Aggiungi foto'),
                ),
              ),
            if (widget.editable && present)
              TextButton(
                onPressed: busy ? null : () => change(remove: true),
                child: Text(uiText(c, 'Rimuovi foto')),
              ),
          ],
        ),
        if (issue != null) Text(uiText(c, issue!)),
      ],
    );
  }
}

class _PhotoPreview extends StatefulWidget {
  const _PhotoPreview({
    required this.api,
    required this.path,
    required this.name,
  });
  final RimiamApi api;
  final String path, name;
  @override
  State<_PhotoPreview> createState() => _PhotoPreviewState();
}

class _PhotoPreviewState extends State<_PhotoPreview>
    with WidgetsBindingObserver {
  late final actor = widget.api.actorId;
  Future<Uint8List>? image;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    image = widget.api.getBytes(widget.path);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden)
      setState(() => image = null);
    if (s == AppLifecycleState.resumed && actor == widget.api.actorId)
      setState(() => image = widget.api.getBytes(widget.path));
  }

  @override
  Widget build(BuildContext c) => Scaffold(
    appBar: AppBar(title: Text(widget.name)),
    body: Center(
      child: FutureBuilder<Uint8List>(
        key: ObjectKey(image),
        future: image,
        builder: (c, s) => s.hasData
            ? InteractiveViewer(
                child: Image.memory(s.data!, fit: BoxFit.contain),
              )
            : s.hasError
            ? Text(uiText(c, 'Foto non disponibile.'))
            : const CircularProgressIndicator(),
      ),
    ),
  );
}
