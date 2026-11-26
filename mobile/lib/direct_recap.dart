import 'ui_language.dart';

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat_journal.dart';
import 'direct_view.dart';

class DirectRecap extends StatefulWidget {
  const DirectRecap({
    super.key,
    required this.api,
    required this.id,
    required this.vault,
  });
  final RimiamApi api;
  final String id;
  final DraftVault vault;
  @override
  State<DirectRecap> createState() => _DirectRecapState();
}

class _DirectRecapState extends State<DirectRecap> with WidgetsBindingObserver {
  late final String _actor, _prefix;
  Map<String, dynamic>? _view;
  bool _busy = false,
      _loading = false,
      _active = true,
      _pendingRecap = false,
      _uncertain = false;
  int _generation = 0;
  String _error = '';
  late final Timer _refresh;
  @override
  void initState() {
    super.initState();
    _actor = widget.api.actorId;
    _prefix =
        'rimiam.direct.control.v1.${sha256.convert(utf8.encode(jsonEncode([widget.api.origin.origin, _actor, widget.id])))}';
    WidgetsBinding.instance.addObserver(this);
    _load();
    _refresh = Timer.periodic(const Duration(seconds: 6), (_) {
      if (_active && !_busy) _load();
    });
  }

  @override
  void dispose() {
    _refresh.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    _active = s == AppLifecycleState.resumed;
    if (_active) {
      _load();
    } else if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
      _generation++;
      setState(() => _view = null);
    }
  }

  Future<void> _load() async {
    if (_loading || !_active) return;
    final gen = _generation;
    _loading = true;
    try {
      final v = await readDirect(widget.api, widget.id, _actor);
      if (!mounted || gen != _generation) return;
      final key = '$_prefix.recap';
      final raw = await widget.vault.read(key);
      if (!mounted || gen != _generation) return;
      final requested = raw == null
          ? null
          : (jsonDecode(raw) as Map<String, dynamic>)['id'];
      final ready =
          requested != null &&
          (v['recaps'] as List).any((r) => r['id'] == requested);
      if (ready) await widget.vault.replace(key, null);
      if (mounted && gen == _generation)
        setState(() {
          _view = v;
          _pendingRecap = requested != null && !ready;
          if (ready) {
            _uncertain = false;
            _error = '';
          }
          if (_error == 'Riepilogo non disponibile.') _error = '';
        });
    } catch (e) {
      if (mounted && gen == _generation)
        setState(() {
          if (directDenied(e)) _view = null;
          _error = 'Riepilogo non disponibile.';
        });
    } finally {
      _loading = false;
      if (mounted && gen != _generation && _active) unawaited(_load());
    }
  }

  Future<void> _act(String type) async {
    final current = _view;
    if (_busy || current == null || widget.api.actorId != _actor || !_active)
      return;
    setState(() {
      _busy = true;
      _generation++;
      _error = '';
    });
    final key = '$_prefix.$type';
    try {
      final v = await readDirect(widget.api, widget.id, _actor);
      if (!mounted || !_active) return;
      setState(() => _view = v);
      if (type == 'recap' &&
          (v['consent'] != true ||
              v['peerConsent'] != true ||
              (v['messages'] as List).isEmpty))
        return;
      if (type == 'consent' &&
          current['consentVersion'] != v['consentVersion']) {
        setState(
          () => _error =
              'La preferenza è cambiata. Controlla il consenso aggiornato.',
        );
        return;
      }
      final previous = await widget.vault.read(key);
      final action = previous == null
          ? <String, dynamic>{
              'type': type,
              'id': widget.api.newId(),
              'expectedActorId': _actor,
              if (type == 'consent') ...{
                'enabled': v['consent'] != true,
                'expectedVersion': v['consentVersion'],
              },
            }
          : jsonDecode(previous) as Map<String, dynamic>;
      if (action['type'] != type ||
          action['expectedActorId'] != _actor ||
          action['id'] is! String)
        throw const FormatException('Richiesta non valida');
      if (previous != null &&
          ((type == 'recap' &&
                  (v['recaps'] as List).any((r) => r['id'] == action['id'])) ||
              (type == 'consent' &&
                  action['expectedVersion'] != v['consentVersion']))) {
        await widget.vault.replace(key, null);
        return;
      }
      await widget.vault.replace(key, jsonEncode(action));
      if (type == 'recap' && mounted) setState(() => _pendingRecap = true);
      if (!mounted || !_active || widget.api.actorId != _actor) return;
      final result = await widget.api.post(directPath(widget.id), action);
      if ((type == 'recap' && result['recapId'] != action['id']) ||
          (type == 'consent' && result['consentVersion'] is! int))
        throw const FormatException('Conferma inattesa');
      await widget.vault.replace(key, null);
    } catch (e) {
      if (e is ApiError &&
          [
            'DIRECT_CONSENT_STALE',
            'AI_CONFIGURATION_REQUIRED',
            'NO_MESSAGES_TO_SUMMARIZE',
          ].contains(e.code)) {
        try {
          await widget.vault.replace(key, null);
        } catch (_) {
          /* Preserve the request if the vault is temporarily locked. */
        }
      }
      if (mounted)
        setState(() {
          _uncertain = e is ApiError && e.code == 'DIRECT_RECAP_ATTEMPT_EXISTS';
          _error = _uncertain
              ? 'La richiesta è registrata. Il risultato non è ancora disponibile.'
              : e is ApiError && e.code == 'AI_CONFIGURATION_REQUIRED'
              ? 'Il servizio AI per i riepiloghi non è configurato.'
              : 'Richiesta non completata. Controlla lo stato prima di riprovare.';
        });
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        await _load();
      }
    }
  }

  Future<void> _endAttempt() async {
    final forget = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(uiText(context, 'Chiudere il tentativo?')),
        content: Text(
          uiText(
            context,
            'Se il riepilogo è ancora in corso, il risultato potrà comparire qui. Potrai richiederne un altro quando vuoi.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(uiText(context, 'Continua ad attendere')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(uiText(context, 'Chiudi tentativo')),
          ),
        ],
      ),
    );
    if (!mounted || forget != true || _busy || !_pendingRecap) return;
    setState(() => _busy = true);
    try {
      await widget.vault.replace('$_prefix.recap', null);
      if (mounted)
        setState(() {
          _pendingRecap = false;
          _uncertain = false;
          _error = '';
        });
    } catch (_) {
      if (mounted)
        setState(() => _error = 'Impossibile chiudere il tentativo.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = _view;
    final peer = v?['peer']['name'] ?? '';
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Riepilogo personale'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error.isNotEmpty)
              ListTile(
                title: Text(uiText(context, _error)),
                trailing: IconButton(
                  onPressed: _load,
                  tooltip: uiText(context, 'Aggiorna'),
                  icon: const Icon(Icons.refresh),
                ),
              ),
            if (v == null && _error.isEmpty) const LinearProgressIndicator(),
            if (v != null) ...[
              Text(
                uiText(
                  context,
                  'Emme può leggere l’intera conversazione quando entrambi siete d’accordo. Il riepilogo richiesto è visibile solo a te.',
                ),
              ),
              SwitchListTile(
                title: Text(uiText(context, 'Consento il riepilogo')),
                value: v['consent'] == true,
                onChanged: _busy ? null : (_) => _act('consent'),
              ),
              Text(
                v['peerConsent'] == true
                    ? uiText(context, '{0} ha dato il consenso.', [peer])
                    : uiText(context, 'In attesa del consenso di {0}.', [peer]),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton(
                  onPressed:
                      _busy ||
                          v['consent'] != true ||
                          v['peerConsent'] != true ||
                          (v['messages'] as List).isEmpty
                      ? null
                      : () => _act('recap'),
                  child: Text(
                    _pendingRecap
                        ? uiText(context, 'Verifica richiesta')
                        : uiText(context, 'Riassumi per me'),
                  ),
                ),
              ),
              if (_pendingRecap && _uncertain)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: _busy ? null : _endAttempt,
                    child: Text(uiText(context, 'Chiudi tentativo')),
                  ),
                ),
              if (_busy) const LinearProgressIndicator(),
              for (final r in v['recaps'] as List)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(r['text'] as String),
                      if ((r['sourceIds'] as List).isNotEmpty)
                        ExpansionTile(
                          title: Text(uiText(context, 'Messaggi originali')),
                          children: [
                            for (final id in r['sourceIds'] as List)
                              for (final m in (v['messages'] as List).where(
                                (m) => m['id'] == id,
                              ))
                                ListTile(
                                  title: Text(m['name'] as String),
                                  subtitle: Text(
                                    m['text'] as String,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  onTap: () => Navigator.pop(context, id),
                                ),
                          ],
                        ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
