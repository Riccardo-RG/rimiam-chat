import 'ui_language.dart';

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'installation.dart';
import 'local_secure_storage.dart';

class InstallationGate extends StatefulWidget {
  const InstallationGate({super.key, required this.builder});
  final Widget Function(Uri origin, VoidCallback change) builder;

  @override
  State<InstallationGate> createState() => _InstallationGateState();
}

class _InstallationGateState extends State<InstallationGate> {
  static const _key = 'rimiam.installation.v1';
  final _address = TextEditingController();
  Uri? _origin;
  bool _editing = false, _busy = true, _readFailed = false;
  String? _issue;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _readFailed = false;
      _issue = null;
    });
    try {
      final stored =
          await deviceSecureStorage.read(key: _key) ?? defaultInstallation();
      if (!mounted) return;
      _address.text = stored;
      if (stored.isNotEmpty) _origin = installationOrigin(stored);
      _editing = _origin == null;
    } on FormatException catch (_) {
      _editing = true;
      _issue = 'Controlla l’indirizzo di questa installazione.';
    } on Object {
      _readFailed = true;
      _issue = 'Impossibile leggere l’installazione salvata.';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _issue = null;
    });
    try {
      final selected = installationOrigin(_address.text);
      await deviceSecureStorage.write(key: _key, value: selected.origin);
      if (!mounted) return;
      _origin = selected;
      _editing = false;
    } on FormatException catch (_) {
      _issue = 'Indica l’indirizzo HTTPS di RIMIAM, senza percorso.';
    } on Object {
      _issue = 'Impossibile salvare l’installazione sul dispositivo.';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = _origin;
    if (current != null && !_editing && !_readFailed) {
      return widget.builder(
        current,
        () => setState(() {
          _address.text = current.origin;
          _issue = null;
          _editing = true;
        }),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(uiText(context, 'Installazione RIMIAM'))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_editing && !_readFailed) ...[
              TextField(
                controller: _address,
                keyboardType: TextInputType.url,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: uiText(context, 'Indirizzo del server'),
                  hintText: 'https://rimiam.example.org',
                ),
                onSubmitted: (_) => _save(),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy ? null : _save,
                child: Text(uiText(context, 'Continua')),
              ),
              if (current != null)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                          _editing = false;
                          _issue = null;
                        }),
                  child: Text(uiText(context, 'Annulla')),
                ),
            ],
            if (_issue != null) Text(uiText(context, _issue!)),
            if (_readFailed)
              TextButton(
                onPressed: _busy ? null : _load,
                child: Text(uiText(context, 'Riprova')),
              ),
            if (_busy) const Center(child: CircularProgressIndicator()),
          ],
        ),
      ),
    );
  }
}
