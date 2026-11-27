import 'ui_language.dart';

import 'dart:async';
import 'dart:io';

import 'package:app_links/app_links.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart' show PlatformException;

import 'api.dart';
import 'chat_journal.dart';
import 'social_signin.dart';

enum _Mode { signIn, register, recover, verify }

String accountIssue(Object e) {
  if (e is FormatException) return e.message;
  if (e is PlatformException) {
    return 'Accesso non salvato in modo sicuro sul dispositivo. Riprova.';
  }
  if (e is ApiError) {
    if (e.status == 429)
      return 'Troppi tentativi. Attendi un minuto e riprova.';
    if (e.code == 'EMAIL_NOT_VERIFIED')
      return 'Verifica la tua email per accedere.';
    if (e.code == 'ACCOUNT_INELIGIBLE')
      return 'Questo account non può accedere alla beta.';
    if (e.status == 401 || e.code == 'INVALID_EMAIL_OR_PASSWORD')
      return 'Controlla email e password.';
  }
  if (e is SocketException ||
      e is TimeoutException ||
      e is HandshakeException) {
    return 'Impossibile completare la richiesta. Controlla la connessione e riprova.';
  }
  return 'Accesso non riuscito. Riprova tra poco; se il problema continua, usa il recupero account.';
}

class AccountEntry extends StatefulWidget {
  const AccountEntry({
    super.key,
    required this.api,
    required this.changeInstallation,
    required this.authenticated,
    this.callbacks,
    this.vault = const DeviceDraftVault(),
  });
  final RimiamApi api;
  final VoidCallback changeInstallation;
  final Future<void> Function() authenticated;
  final Stream<Uri>? callbacks;
  final DraftVault vault;
  @override
  State<AccountEntry> createState() => _AccountEntryState();
}

class _AccountEntryState extends State<AccountEntry> {
  final _email = TextEditingController(),
      _name = TextEditingController(),
      _password = TextEditingController();
  late final _social = SocialSignIn(widget.api, widget.vault);
  StreamSubscription<Uri>? _sub;
  Uri? _queuedCallback;
  bool _busy = false,
      _waiting = false,
      _showPassword = false,
      _providerProblem = false;
  _Mode _mode = _Mode.signIn;
  List<String> _providers = [];
  String _message = '';
  bool _isError = false;
  final _feedbackKey = GlobalKey();

  void _revealFeedback() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _feedbackKey.currentContext;
      if (mounted && target != null)
        Scrollable.ensureVisible(target, alignment: 0.45);
    });
  }

  @override
  void initState() {
    super.initState();
    _providersAvailable();
    _sub = (widget.callbacks ?? AppLinks().uriLinkStream).listen(
      _callback,
      onError: (Object e) {
        if (mounted && _waiting)
          setState(() => _message = 'Riapri l’accesso con il tuo provider.');
      },
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    _email.dispose();
    _name.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _providersAvailable() async {
    try {
      final m = await widget.api.get('/api/v1/native/social/providers');
      if (mounted)
        setState(() {
          _providers = [
            for (final p in ['google', 'microsoft'])
              if (m[p] == true) p,
          ];
          _providerProblem = false;
        });
    } catch (_) {
      if (mounted) setState(() => _providerProblem = true);
    }
  }

  Future<void> _callback(Uri uri) async {
    if (uri.scheme != 'com.rimiam.chat' || uri.path != '/oauth/complete')
      return;
    if (_busy) {
      _queuedCallback = uri;
      return;
    }
    await _run(() async {
      try {
        if (!await _social.complete(uri) || !mounted) return;
      } catch (_) {
        if (mounted) setState(() => _waiting = false);
        rethrow;
      }
      _waiting = false;
      await widget.authenticated();
    });
  }

  Future<void> _run(Future<void> Function() fn) async {
    if (!mounted || _busy) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _message = '';
      _isError = false;
    });
    try {
      await fn();
    } catch (e) {
      if (mounted) {
        setState(() {
          _message = accountIssue(e);
          _isError = true;
        });
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        if (_message.isNotEmpty || _mode == _Mode.verify) _revealFeedback();
        final queued = _queuedCallback;
        _queuedCallback = null;
        if (queued != null) unawaited(_callback(queued));
      }
    }
  }

  void _changeMode(_Mode mode) {
    if (_busy) return;
    setState(() {
      _mode = mode;
      _message = '';
      _isError = false;
      _showPassword = false;
      _password.clear();
    });
  }

  Future<void> _submit({bool resend = false}) => _run(() async {
    final email = _email.text.trim(),
        password = _password.text,
        name = _name.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email))
      throw const FormatException('Inserisci un indirizzo email valido.');
    if (!resend && _mode == _Mode.signIn) {
      if (password.isEmpty)
        throw const FormatException('Inserisci la password.');
      await _social.clear();
      await widget.api.login(email, password);
      if (!mounted) return;
      _password.clear();
      await widget.authenticated();
      return;
    }
    if (!resend &&
        _mode == _Mode.register &&
        (name.isEmpty ||
            name.length > 120 ||
            password.length < 12 ||
            password.length > 128)) {
      throw const FormatException(
        'Inserisci il nome e una password tra 12 e 128 caratteri.',
      );
    }
    final result = await widget.api.post('/api/v1/native/account', {
      'action': resend
          ? 'send-verification'
          : _mode == _Mode.recover
          ? 'request-password-reset'
          : 'register',
      'email': email,
      if (!resend && _mode == _Mode.register) ...{
        'name': name,
        'password': password,
      },
    });
    if (result['requested'] != true)
      throw const FormatException('Richiesta non confermata. Riprova.');
    if (mounted)
      setState(() {
        final registering = !resend && _mode == _Mode.register;
        _mode = registering || (resend && _mode == _Mode.verify)
            ? _Mode.verify
            : _Mode.signIn;
        _password.clear();
        _showPassword = false;
        _message = registering ? '' : 'Se la richiesta è applicabile, riceverai un’email con il prossimo passo.';
      });
  });

  @override
  Widget build(BuildContext context) {
    final title = uiText(context, switch (_mode) {
      _Mode.signIn => 'Accedi',
      _Mode.register => 'Crea account',
      _Mode.recover => 'Recupera password',
      _Mode.verify => 'Verifica il tuo indirizzo',
    });
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const LanguagePicker(),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(widget.api.origin.origin),
            subtitle: Text(uiText(context, 'Cambia installazione')),
            leading: const Icon(Icons.dns_outlined),
            onTap: _busy || _waiting ? null : widget.changeInstallation,
          ),
          Text(title, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          if (_mode == _Mode.verify) ...[
            Text(
              uiText(
                context,
                'Controlla la tua email: per entrare, apri il link di verifica. Se avevi già un account con questo indirizzo, accedi o recupera la password. Controlla anche lo spam.',
              ),
              key: _message.isEmpty && !_busy ? _feedbackKey : null,
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy ? null : () => _changeMode(_Mode.signIn),
              child: Text(uiText(context, 'Torna all’accesso')),
            ),
            TextButton(
              onPressed: _busy ? null : () => _submit(resend: true),
              child: Text(uiText(context, 'Reinvia email di verifica')),
            ),
          ] else ...[
            if (_mode == _Mode.register)
              TextField(
                controller: _name,
                enabled: !_busy,
                maxLength: 120,
                autofillHints: const [AutofillHints.name],
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(
                  labelText: uiText(context, 'Nome'),
                  counterText: '',
                ),
              ),
            TextField(
              controller: _email,
              enabled: !_busy,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.username],
              autocorrect: false,
              textInputAction: _mode == _Mode.recover
                  ? TextInputAction.done
                  : TextInputAction.next,
              onSubmitted: _mode == _Mode.recover ? (_) => _submit() : null,
              decoration: InputDecoration(labelText: uiText(context, 'Email')),
            ),
            if (_mode != _Mode.recover)
              TextField(
                controller: _password,
                enabled: !_busy,
                obscureText: !_showPassword,
                enableSuggestions: false,
                autocorrect: false,
                autofillHints: [
                  _mode == _Mode.register
                      ? AutofillHints.newPassword
                      : AutofillHints.password,
                ],
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  labelText: uiText(context, 'Password'),
                  helperText: _mode == _Mode.register
                      ? uiText(context, 'Da 12 a 128 caratteri')
                      : null,
                  suffixIcon: IconButton(
                    tooltip: _showPassword
                        ? uiText(context, 'Nascondi password')
                        : uiText(context, 'Mostra password'),
                    onPressed: () =>
                        setState(() => _showPassword = !_showPassword),
                    icon: Icon(
                      _showPassword ? Icons.visibility_off : Icons.visibility,
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy || _waiting ? null : () => _submit(),
              child: Text(
                _mode == _Mode.recover
                    ? uiText(context, 'Invia email di recupero')
                    : title,
              ),
            ),
          ],
          if (_busy)
            Semantics(
              liveRegion: true,
              child: LinearProgressIndicator(
                semanticsLabel: uiText(context, 'Attendi…'),
              ),
            ),
          if (_message.isNotEmpty)
            Padding(
              key: _feedbackKey,
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  uiText(context, _message),
                  style: _isError
                      ? TextStyle(color: Theme.of(context).colorScheme.error)
                      : null,
                ),
              ),
            ),
          if (_mode == _Mode.signIn) ...[
            for (final p in _providers)
              OutlinedButton(
                onPressed: _busy || _waiting
                    ? null
                    : () => _run(() async {
                        await _social.start(p);
                        if (mounted) setState(() => _waiting = true);
                      }),
                child: Text(
                  p == 'google'
                      ? uiText(context, 'Accedi con Google')
                      : uiText(context, 'Accedi con Microsoft'),
                ),
              ),
            if (_waiting)
              TextButton(
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                        await _social.clear();
                        if (mounted) setState(() => _waiting = false);
                      }),
                child: Text(uiText(context, 'Annulla accesso dal browser')),
              ),
            if (_providerProblem)
              TextButton(
                onPressed: _busy ? null : _providersAvailable,
                child: Text(uiText(context, 'Ricarica i metodi di accesso')),
              ),
            if (!_waiting) ...[
              TextButton(
                onPressed: _busy ? null : () => _changeMode(_Mode.register),
                child: Text(uiText(context, 'Crea account')),
              ),
              TextButton(
                onPressed: _busy ? null : () => _changeMode(_Mode.recover),
                child: Text(uiText(context, 'Password dimenticata?')),
              ),
              TextButton(
                onPressed: _busy ? null : () => _submit(resend: true),
                child: Text(uiText(context, 'Reinvia email di verifica')),
              ),
            ],
          ] else if (_mode != _Mode.verify)
            TextButton(
              onPressed: _busy ? null : () => _changeMode(_Mode.signIn),
              child: Text(uiText(context, 'Torna all’accesso')),
            ),
        ],
      ),
    );
  }
}
