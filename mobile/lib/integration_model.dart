import 'api.dart';
import 'chat_journal.dart';
import 'workspace_command_journal.dart';
import 'workspace_governance.dart'
    show GroupRecord, groupRows, groupDenied, groupIssue;

/// Provider credentials stay on the server. Only a launch ticket issued for this
/// installation and this provider may be handed to the system browser.
Uri integrationLaunchUri(Uri origin, String provider, String value) {
  final u = Uri.tryParse(value);
  if (!{'google', 'microsoft'}.contains(provider) ||
      u == null ||
      !u.hasAuthority ||
      (u.scheme != 'https' && u.scheme != 'http') ||
      u.origin != origin.origin ||
      u.userInfo.isNotEmpty ||
      u.hasFragment ||
      u.path != '/api/v1/integrations/$provider/launch' ||
      u.queryParametersAll.length != 1 ||
      u.queryParametersAll['ticket']?.length != 1 ||
      (u.queryParameters['ticket'] ?? '').isEmpty) {
    throw const FormatException('Indirizzo del collegamento non riconosciuto.');
  }
  return u;
}

class WorkspaceIntegration {
  WorkspaceIntegration(this.api, this.space, this.kind, DraftVault vault)
    : actor = api.actorId,
      journal = WorkspaceCommandJournal(
        api,
        vault,
        namespace: 'integration-$kind',
        collection: space,
      );
  final RimiamApi api;
  final String space, kind, actor;
  final WorkspaceCommandJournal journal;
  String get base => '/api/v1/workspaces/${Uri.encodeComponent(space)}';
  int epoch = 0, serial = 0;
  bool open = false, canWrite = false;
  int? admission;
  GroupRecord data = {};
  Map<String, GroupRecord?> providers = {};
  String email = '';
  void invalidate() {
    epoch++;
    serial++;
    open = false;
    canWrite = false;
    admission = null;
    data = {};
    providers = {};
    email = '';
  }

  bool get admitted => open && actor.isNotEmpty && actor == api.actorId;
  void guard([int? captured]) {
    if (!admitted || (captured != null && captured != epoch))
      throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
  }

  Future<void> load(DateTime day, String? page, {bool poll = false}) async {
    final stamp = epoch, index = ++serial;
    try {
      await _read(day, page, poll: poll, stamp: stamp, index: index);
    } catch (e) {
      if (stamp == epoch && index == serial && groupDenied(e)) invalidate();
      rethrow;
    }
  }

  Future<void> _read(
    DateTime day,
    String? page, {
    required bool poll,
    required int stamp,
    required int index,
  }) async {
    if (actor.isEmpty || actor != api.actorId)
      throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
    final start = DateTime(day.year, day.month, day.day),
        end = DateTime(day.year, day.month, day.day + 30);
    final query = Uri(
      queryParameters: {
        if (kind == 'calendar') ...{
          'start': start.toUtc().toIso8601String(),
          'end': end.toUtc().toIso8601String(),
        },
        if (page != null) (kind == 'calendar' ? 'afterAction' : 'before'): page,
      },
    ).query;
    final view = await api.get('$base/$kind${query.isEmpty ? '' : '?$query'}');
    if (stamp != epoch || index != serial) return;
    if (api.actorId != actor || view['workspaceId'] != space)
      throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    if (poll &&
        admitted &&
        view['accessRevision'] != null &&
        view['accessRevision'] == data['accessRevision']) {
      data = view;
      return;
    }
    final parts = await Future.wait([
      api.get('$base/workspace'),
      if (kind == 'email') api.get('/api/v1/native/session'),
    ]);
    if (stamp != epoch || index != serial) return;
    final snap = parts[0];
    final m = groupRows(snap['members'])
        .where((m) => m['user_id'] == actor && m['active'] == true)
        .firstOrNull;
    if (api.actorId != actor ||
        snap['workspace']?['id'] != space ||
        m == null ||
        (kind == 'email' && parts[1]['user']?['id'] != actor)) {
      throw const ApiError(403, 'WORKSPACE_ACCESS_DENIED');
    }
    if (!open) await journal.load();
    final statuses = await Future.wait(
      ['google', 'microsoft'].map((p) async {
        try {
          return await api.get('/api/v1/integrations/$p/status');
        } on Object {
          return null;
        }
      }),
    );
    if (stamp != epoch || index != serial) return;
    if (api.actorId != actor) throw const ApiError(401, 'AUTH_CONTEXT_CHANGED');
    if (kind == 'email') email = parts[1]['user']['email'] as String;
    data = view;
    admission = snap['reading']?['admission'] as int?;
    canWrite = m['contributes'] == true;
    providers = {'google': statuses[0], 'microsoft': statuses[1]};
    open = true;
  }

  bool get pendingWork =>
      groupRows(data['reads'])
          .any((r) => {'QUEUED', 'READING'}.contains(r['status'])) ||
      groupRows(data['actions'])
          .any((a) => {'AUTHORIZED', 'EXECUTING'}.contains(a['status']));
  Future<void> send(GroupRecord command) async {
    guard();
    final stamp = epoch;
    await journal.send(
      space,
      command,
      allowed: () => admitted && canWrite && stamp == epoch,
    );
  }

  Future<Uri> connect(String provider) async {
    guard();
    final stamp = epoch, status = providers[provider];
    if (!canWrite ||
        status?['configured'] != true ||
        !(status?['capabilities'] as List).contains(kind))
      throw const ApiError(409, 'NOT_CONFIGURED');
    final result = await api.post('$base/$provider-connect', {
      'capability': kind,
    });
    guard(stamp);
    return integrationLaunchUri(
      api.origin,
      provider,
      result['authorizationUrl'] as String,
    );
  }

  String get capabilityTitle => kind == 'email' ? 'posta' : 'calendario';
}

const externalStates = {
  'PROPOSED': 'Da autorizzare',
  'AUTHORIZED': 'Autorizzata',
  'EXECUTING': 'In esecuzione',
  'SUCCEEDED': 'Confermata dal servizio',
  'OUTCOME_UNKNOWN': 'Esito da verificare',
  'REJECTED': 'Rifiutata',
  'FAILED': 'Non riuscita',
  'QUEUED': 'In coda',
  'READING': 'Lettura in corso',
  'READY': 'Disponibile',
};
String externalState(dynamic s) => externalStates[s] ?? 'Stato non disponibile';
String integrationIssue(Object error) {
  if (error is FormatException) return error.message;
  if (error is ApiError) {
    switch (error.code) {
      case 'EMAIL_EFFECT_MAY_EXIST':
      case 'EMAIL_RECONCILIATION_REQUIRED':
      case 'EMAIL_EFFECT_UNRESOLVED':
      case 'CALENDAR_EFFECT_MAY_ALREADY_EXIST':
      case 'CALENDAR_RECONCILIATION_REQUIRED':
        return 'L’operazione potrebbe essere già avvenuta. Apri il dettaglio e scegli «Verifica esito».';
      case 'EMAIL_EXCERPT_NOT_IN_SOURCE':
        return 'Copia un estratto esatto del messaggio originale.';
      case 'NOT_CONFIGURED':
        return 'Il collegamento non è ancora configurato su questa installazione.';
      case 'AI_CONFIGURATION_REQUIRED':
        return 'Scegli un modello nelle impostazioni di Emme prima di chiedere un suggerimento.';
    }
  }
  return groupIssue(error);
}

GroupRecord integrationEffect(
  WorkspaceIntegration scope,
  GroupRecord action,
  String operation,
) {
  scope.guard();
  const flags = {
    'authorize': 'canAuthorize',
    'reject': 'canReject',
    'retry': 'canRetry',
    'reconcile': 'canReconcile',
  };
  if (!scope.canWrite ||
      action[flags[operation]] != true ||
      action['status'] == 'OUTCOME_UNKNOWN' && operation != 'reconcile')
    throw const FormatException('Questa operazione non è disponibile.');
  return {
    'type': '${scope.kind}.$operation',
    'actionId': action['id'],
    'version': action['version'],
    if (operation == 'authorize') ...{
      'expectedContextRevision': scope.data['contextRevision'],
      'expectedAccessRevision': scope.data['accessRevision'],
      'representSelf': true,
      if (scope.kind == 'email') 'discloseToRecipients': true,
    },
    if (operation == 'reject') 'reason': 'Proposta rifiutata dal titolare',
  };
}
