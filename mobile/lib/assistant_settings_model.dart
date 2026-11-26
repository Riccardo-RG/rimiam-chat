import 'api.dart';

typedef SettingsJson = Map<String, dynamic>;
const _path = '/api/v1/assistant-settings';

class AssistantConnection {
  AssistantConnection(SettingsJson json)
    : id = json['id'] as String,
      revision = json['revision'] as String,
      label = json['label'] as String,
      agent = json['kind'] == 'agent',
      configured = json['configured'] as bool,
      destination = json['destination'] as String,
      provider = json['provider'] as String;
  final String id, revision, label, destination, provider;
  final bool agent, configured;
  bool get selectable => configured || id == 'default';
  String get usage {
    if (!configured) return 'Connessione inattiva. Nessun consumo.';
    return switch (provider) {
      'openai' || 'anthropic' =>
        'Le chiamate sono a carico dell’account API dell’installazione.',
      'ollama' => 'Le richieste usano il server Ollama scelto dal gestore.',
      _ => 'I costi dipendono dal servizio collegato dal gestore.',
    };
  }
}

class AssistantConfiguration {
  AssistantConfiguration(SettingsJson json)
    : revision = json['revision'] as int,
      connectionId = json['connectionId'] as String,
      name = json['displayName'] as String,
      instructions = json['instructions'] as String,
      defaults = json['defaultInstructions'] as String,
      rules = json['baseInstructions'] as String,
      effective = json['effectiveInstructions'] as String,
      canManage = json['canManage'] as bool,
      reconfirm = json['needsReconfirmation'] as bool,
      connections = (json['connections'] as List)
          .cast<SettingsJson>()
          .map(AssistantConnection.new)
          .toList(),
      spaces = (json['managedSpaces'] as List).cast<SettingsJson>();
  final int revision;
  final String connectionId, name, instructions, defaults, rules, effective;
  final bool canManage, reconfirm;
  final List<AssistantConnection> connections;
  final List<SettingsJson> spaces;
  AssistantConnection? connection(String id) =>
      connections.where((entry) => entry.id == id).firstOrNull;
}

class AssistantSettingsRepository {
  AssistantSettingsRepository(this.api) : actor = api.actorId;
  final RimiamApi api;
  final String actor;
  void checkActor() {
    if (actor.isEmpty || api.actorId != actor)
      throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
  }

  Future<AssistantConfiguration> read(String? workspace) async {
    checkActor();
    final view = await api.get(
      workspace == null
          ? _path
          : '$_path?workspaceId=${Uri.encodeQueryComponent(workspace)}',
    );
    checkActor();
    return AssistantConfiguration(view);
  }

  Future<AssistantConfiguration> save({
    required String? workspace,
    required AssistantConfiguration base,
    required String connectionId,
    required String name,
    required String instructions,
  }) async {
    checkActor();
    if (!base.canManage)
      throw const ApiError(403, 'ASSISTANT_CREATOR_REQUIRED');
    final connection = base.connection(connectionId);
    if (connection == null || !connection.selectable)
      throw const ApiError(409, 'ASSISTANT_CONNECTION_UNAVAILABLE');
    final trimmedName = name.trim(), style = instructions.trim();
    if (trimmedName.isEmpty ||
        trimmedName.length > 48 ||
        !RegExp(
          r"^[\p{L}\p{N}][\p{L}\p{M}\p{N} .’'_-]*$",
          unicode: true,
        ).hasMatch(trimmedName)) {
      throw const FormatException(
        'Il nome deve iniziare con una lettera o un numero. Usa al massimo 48 caratteri.',
      );
    }
    if (style.length > 5000 || style.contains('\u0000')) {
      throw const FormatException(
        'Le istruzioni devono contenere al massimo 5.000 caratteri di testo.',
      );
    }
    final view = await api.post(_path, {
      if (workspace != null) 'workspaceId': workspace,
      'expectedActorId': actor,
      'expectedRevision': base.revision,
      'connectionRevision': connection.revision,
      'connectionId': connection.id,
      'displayName': trimmedName,
      'instructions': style,
    });
    checkActor();
    return AssistantConfiguration(view);
  }
}

bool assistantAccessEnded(Object error) =>
    error is ApiError &&
    (error.status == 401 ||
        error.status == 403 ||
        error.code == 'AUTH_CONTEXT_CHANGED');

String assistantProblem(Object error) {
  if (error is FormatException) return error.message;
  if (assistantAccessEnded(error))
    return 'Hai perso l’accesso a queste impostazioni.';
  if (error is ApiError) {
    return switch (error.code) {
      'ASSISTANT_SETTINGS_STALE' || 'STATE_STALE' =>
        'Le impostazioni sono cambiate. Controlla la versione salvata.',
      'ASSISTANT_CONNECTION_CHANGED' => 'La destinazione è cambiata. Ricarica le impostazioni e conferma la nuova connessione.',
      'ASSISTANT_CONNECTION_UNAVAILABLE' => 'Questa connessione è stata disattivata. Ricarica per sceglierne un’altra.',
      _ => 'Impossibile completare la richiesta. Controlla la connessione e riprova.',
    };
  }
  return 'Impossibile raggiungere il server.';
}
