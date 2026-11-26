import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'api.dart';

class ReceivedInvite {
  ReceivedInvite(Map<String, dynamic> row)
    : id = row['id'] as String,
      space = row['workspaceName'] as String,
      from = row['inviterName'] as String,
      expires = DateTime.parse(row['expiresAt'] as String).toLocal();
  final String id, space, from;
  final DateTime expires;
}

class InvitationInbox extends StatefulWidget {
  const InvitationInbox({super.key, required this.api, required this.items});
  final RimiamApi api;
  final List<ReceivedInvite> items;

  @override
  State<InvitationInbox> createState() => _InvitationInboxState();
}

class _InvitationInboxState extends State<InvitationInbox> {
  late final String _actor = widget.api.actorId;
  ReceivedInvite? _selected;
  bool _acceptedHistory = false, _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.items.length == 1) _selected = widget.items.first;
  }

  Future<void> _accept(ReceivedInvite item) async {
    if (_sending || !_acceptedHistory || widget.api.actorId != _actor) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final result = await widget.api.post(
        '/api/v1/invitations/${Uri.encodeComponent(item.id)}/accept',
        {'fullHistoryAccepted': true},
      );
      if (!mounted || widget.api.actorId != _actor) return;
      final target = result['workspaceId'] as String;
      if (target.isEmpty) throw const FormatException();
      Navigator.pop(context, (id: target, name: item.space));
    } on Object catch (error) {
      if (mounted)
        setState(() {
          _sending = false;
          _error =
              error is ApiError && [403, 404, 409, 410].contains(error.status)
              ? 'Questo invito non è più disponibile. Controlla l’elenco degli spazi.'
              : 'Non ho ricevuto la conferma. Controlla i tuoi spazi o riprova con questo invito.';
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = _selected;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          item == null
              ? uiText(context, 'Inviti')
              : uiText(context, 'Invito allo spazio'),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (item == null)
              for (final invite in widget.items)
                ListTile(
                  title: Text(invite.space),
                  subtitle: Text(
                    uiText(context, 'Ti invita {0}', [invite.from]),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => setState(() {
                    _selected = invite;
                    _acceptedHistory = false;
                    _error = null;
                  }),
                )
            else ...[
              Text(
                item.space,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              Text(uiText(context, 'Ti invita {0}', [item.from])),
              Text(
                uiText(context, 'Scade il {0}', [
                  MaterialLocalizations.of(context)
                      .formatShortDate(item.expires),
                ]),
              ),
              const SizedBox(height: 16),
              Text(
                uiText(
                  context,
                  'Entrando vedrai anche i messaggi, le fonti e le versioni precedenti al tuo ingresso. I futuri partecipanti potranno vedere la stessa cronologia. Se esci, gli altri conservano ciò che hai condiviso.',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                uiText(
                  context,
                  'Potrai scrivere in chat. Gli inviti, la gestione degli accessi e l’adesione alle decisioni richiedono scelte separate.',
                ),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _acceptedHistory,
                title: Text(
                  uiText(
                    context,
                    'Accetto questa visibilità della cronologia.',
                  ),
                ),
                onChanged: _sending
                    ? null
                    : (v) => setState(() => _acceptedHistory = v == true),
              ),
              if (_error != null)
                Semantics(
                  liveRegion: true,
                  child: Text(uiText(context, _error!)),
                ),
              FilledButton(
                onPressed: _sending || !_acceptedHistory
                    ? null
                    : () => _accept(item),
                child: Text(
                  _sending
                      ? uiText(context, 'Ingresso in corso…')
                      : uiText(context, 'Accetta ed entra'),
                ),
              ),
              if (widget.items.length > 1)
                TextButton(
                  onPressed: _sending
                      ? null
                      : () => setState(() {
                          _selected = null;
                          _error = null;
                        }),
                  child: Text(uiText(context, 'Tutti gli inviti')),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
