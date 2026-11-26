part of 'native_push.dart';

class NativePushSettings extends StatefulWidget {
  const NativePushSettings({
    super.key,
    required this.api,
    required this.workspaceId,
  });
  final RimiamApi api;
  final String workspaceId;
  @override
  State<NativePushSettings> createState() => _NativePushSettingsState();
}

class _NativePushSettingsState extends State<NativePushSettings>
    with WidgetsBindingObserver {
  late PushRegistration _registration;
  late final StreamSubscription<String> _listener;
  Map<String, dynamic>? _preference;
  bool _configured = false,
      _allowed = false,
      _matches = false,
      _checkingToken = false,
      _mutating = false;
  String _issue = '';
  int _turn = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _registration = PushRegistration.forApi(widget.api);
    _listener = _registration.device.events
        .where((e) => e == 'tokenChanged')
        .listen((_) {
          if (!_mutating) unawaited(_refresh());
        });
    unawaited(_refresh());
  }

  @override
  void didUpdateWidget(NativePushSettings old) {
    super.didUpdateWidget(old);
    if (old.api != widget.api || old.workspaceId != widget.workspaceId) {
      _preference = null;
      _registration = PushRegistration.forApi(widget.api);
      unawaited(_refresh());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_mutating) unawaited(_refresh());
  }

  @override
  void dispose() {
    _turn++;
    WidgetsBinding.instance.removeObserver(this);
    _listener.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final turn = ++_turn;
    try {
      final saved = await _registration.binding();
      final pref = await _registration.preference(widget.workspaceId, saved);
      if (!mounted || turn != _turn) return;
      // Opt-out remains available if the OS cannot read permissions or a token.
      setState(() {
        _preference = pref;
        _matches = false;
        _checkingToken = pref['enabled'] == true;
      });
      final os = await _registration.device.status();
      if (!mounted || turn != _turn) return;
      setState(() {
        _issue = '';
        _configured = os['configured'] == true;
        _allowed = os['allowed'] == true;
        _checkingToken =
            _configured &&
            _allowed &&
            pref['enabled'] == true &&
            saved['deviceId'] == pref['deviceId'];
      });
      if (!_checkingToken) return;
      final actual = await _registration.device.token();
      if (mounted && turn == _turn)
        setState(() {
          _checkingToken = false;
          _matches = saved['tokenHash'] == _hash(actual);
        });
    } on Object {
      if (mounted && turn == _turn)
        setState(() {
          _issue =
              'Verifica del telefono non riuscita. Riprova quando sei online.';
          _checkingToken = false;
        });
    }
  }

  Future<void> _change(bool enable) async {
    if (_mutating) return;
    final turn = ++_turn, workspace = widget.workspaceId;
    setState(() {
      _mutating = true;
      _issue = '';
    });
    try {
      if (enable) {
        if (!await _registration.enable(workspace)) {
          if (mounted && turn == _turn)
            setState(
              () => _issue = 'Per ricevere gli avvisi, consenti le notifiche nelle impostazioni del telefono.',
            );
          return;
        }
      } else {
        final id = _preference?['deviceId'];
        if (id is! String) return;
        await _registration.disable(workspace, id);
      }
      if (mounted && turn == _turn) await _refresh();
    } on Object {
      if (mounted && turn == _turn)
        setState(
          () => _issue = 'Il telefono non ha confermato la modifica. Verifica la connessione e riprova.',
        );
    } finally {
      if (mounted) setState(() => _mutating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pref = _preference,
        optedIn = pref?['optedIn'] == true,
        available = pref?['configured'] == true && _configured;
    final status = pref == null
        ? 'Verifica degli avvisi…'
        : !available
        ? 'Il gestore deve configurare le notifiche per questo sistema.'
        : _checkingToken
        ? 'Verifica della registrazione…'
        : optedIn && _matches
        ? 'Avvisi attivi per questo spazio.'
        : optedIn
        ? 'Preferenza salvata. Controlla i permessi e la registrazione del telefono.'
        : 'Ricevi un avviso quando ci sono novità nello spazio. Il testo dei messaggi resta nella chat.';
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Notifiche sul telefono'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(uiText(context, status)),
            const SizedBox(height: 12),
            if (available && !_checkingToken && !_matches)
              FilledButton(
                onPressed: _mutating ? null : () => _change(true),
                child: Text(uiText(context, 'Attiva per questo spazio')),
              ),
            if (optedIn)
              OutlinedButton(
                onPressed: _mutating ? null : () => _change(false),
                child: Text(uiText(context, 'Disattiva per questo spazio')),
              ),
            TextButton(
              onPressed: () async {
                try {
                  await _registration.device.settings();
                } on Object {
                  if (mounted)
                    setState(
                      () => _issue = 'Apri le impostazioni del telefono e seleziona le notifiche di RIMIAM.',
                    );
                }
              },
              child: Text(uiText(context, 'Apri impostazioni del dispositivo')),
            ),
            if (_issue.isNotEmpty) ...[
              Semantics(liveRegion: true, child: Text(uiText(context, _issue))),
              TextButton(
                onPressed: _mutating ? null : _refresh,
                child: Text(uiText(context, 'Riprova verifica')),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
