import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'direct_conversation.dart';

class DirectContacts extends StatefulWidget {
  const DirectContacts({
    super.key,
    required this.api,
    this.vault = const DeviceDraftVault(),
    this.selectForInvitation = false,
  });
  final RimiamApi api;
  final DraftVault vault;
  final bool selectForInvitation;
  @override
  State<DirectContacts> createState() => _DirectContactsState();
}

class _DirectContactsState extends State<DirectContacts> {
  late final String _actor;
  final _search = TextEditingController();
  Timer? _debounce;
  int _generation = 0, _offset = 0;
  int? _next;
  List<dynamic> _contacts = const [];
  bool _loading = true, _opening = false;
  String _error = '';
  @override
  void initState() {
    super.initState();
    _actor = widget.api.actorId;
    _load(0);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load(int offset) async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = '';
      _contacts = const [];
      _next = null;
    });
    try {
      final q = Uri.encodeQueryComponent(_search.text.trim());
      final result = await widget.api.get(
        '/api/v1/contacts?q=$q&offset=$offset',
      );
      if (!mounted || generation != _generation || _actor != widget.api.actorId)
        return;
      setState(() {
        _contacts = result['contacts'] as List;
        _next = result['nextOffset'] as int?;
        _offset = offset;
      });
    } catch (_) {
      if (mounted && generation == _generation)
        setState(() => _error = 'Rubrica non disponibile.');
    } finally {
      if (mounted && generation == _generation)
        setState(() => _loading = false);
    }
  }

  Future<void> _open(Map<String, dynamic> contact) async {
    if (_opening ||
        widget.api.actorId != _actor ||
        contact['nameAmbiguous'] == true)
      return;
    if (widget.selectForInvitation) {
      Navigator.of(context)
          .pop((id: contact['id'] as String, name: contact['name'] as String));
      return;
    }
    setState(() {
      _opening = true;
      _error = '';
    });
    try {
      final result = await widget.api.post('/api/v1/direct-chats', {
        'expectedActorId': _actor,
        'contactId': contact['id'],
      });
      if (!mounted || widget.api.actorId != _actor) return;
      final api = widget.api;
      final vault = widget.vault;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => DirectConversation(
            api: api,
            id: result['id'] as String,
            name: contact['name'] as String,
            vault: vault,
          ),
        ),
      );
    } catch (_) {
      if (mounted)
        setState(() {
          _error = 'Impossibile aprire la chat con questo contatto.';
          _opening = false;
        });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        widget.selectForInvitation
            ? uiText(context, 'Scegli dalla rubrica')
            : uiText(context, 'Scrivi a un contatto'),
      ),
    ),
    body: SafeArea(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                hintText: uiText(context, 'Cerca nei tuoi contatti'),
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (_) {
                _debounce?.cancel();
                _generation++;
                setState(() {
                  _contacts = const [];
                  _loading = true;
                  _next = null;
                });
                _debounce = Timer(
                  const Duration(milliseconds: 200),
                  () => _load(0),
                );
              },
            ),
          ),
          if (_error.isNotEmpty)
            ListTile(
              title: Text(uiText(context, _error)),
              trailing: TextButton(
                onPressed: () => _load(_offset),
                child: Text(uiText(context, 'Riprova')),
              ),
            ),
          if (_loading) const LinearProgressIndicator(),
          if (!_loading && _contacts.isEmpty && _error.isEmpty)
            Text(uiText(context, 'Nessun contatto trovato.')),
          Expanded(
            child: ListView.builder(
              itemCount: _contacts.length,
              itemBuilder: (context, i) {
                final c = _contacts[i] as Map<String, dynamic>;
                return ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: Text(c['name'] as String),
                  subtitle: c['nameAmbiguous'] == true
                      ? Text(
                          widget.selectForInvitation
                              ? uiText(
                                  context,
                                  'Omonimo · usa il suo indirizzo email',
                                )
                              : uiText(context, 'Omonimo'),
                        )
                      : null,
                  onTap: _opening || c['nameAmbiguous'] == true
                      ? null
                      : () => _open(c),
                );
              },
            ),
          ),
          if (_offset > 0 || _next != null)
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                if (_offset > 0)
                  TextButton(
                    onPressed: () => _load((_offset - 30).clamp(0, _offset)),
                    child: Text(uiText(context, 'Precedenti')),
                  ),
                if (_next != null)
                  TextButton(
                    onPressed: () => _load(_next!),
                    child: Text(uiText(context, 'Altri contatti')),
                  ),
              ],
            ),
        ],
      ),
    ),
  );
}
