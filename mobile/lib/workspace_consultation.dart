import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'chat_journal.dart';
import 'workspace_governance.dart';

class WorkspaceConsultation {
  WorkspaceConsultation(this.group, this.vault)
    : key =
          'rimiam.context-private.v1.${sha256.convert(utf8.encode(jsonEncode([group.api.origin.origin, group.actor, group.workspaceId])))}';
  final GroupGovernance group;
  final DraftVault vault;
  final String key;
  final turns = <GroupRecord>[];
  GroupRecord? last, pending;
  bool busy = false;
  String get path => '${group.path}/consultation';
  Future<void> load() async {
    group.check();
    final previous = await group.api.getOptional('$path?kind=context');
    group.check();
    final raw = await vault.read(key);
    final restored = raw == null ? null : jsonDecode(raw) as GroupRecord;
    group.check();
    last = previous;
    pending = restored;
  }

  Future<void> abandonRetry() async {
    group.check();
    if (busy) return;
    await vault.replace(key, null);
    pending = null;
  }

  Future<GroupRecord> run(GroupRecord input) async {
    group.check();
    final epoch = group.epoch;
    void stillAdmitted() {
      group.check();
      if (epoch != group.epoch) throw StateError('Riapri la consultazione.');
    }

    if (busy) throw StateError('Consultazione in corso.');
    if (input['expectedActorId'] != group.actor)
      throw StateError('Identità cambiata.');
    if (input['action'] == 'share' && !group.canWrite)
      throw StateError('Accesso in sola lettura.');
    if (pending != null && jsonEncode(input) != jsonEncode(pending))
      throw StateError('Verifica prima la richiesta precedente.');
    final persistent = input['action'] != 'resume';
    busy = true;
    try {
      if (persistent) {
        await vault.replace(key, jsonEncode(input));
        pending = input;
      }
      stillAdmitted();
      final reply = await group.api.post(path, input);
      stillAdmitted();
      if (reply['id'] != input['id'] ||
          reply['kind'] != 'context' ||
          reply['answer'] is! String)
        throw const FormatException('Consultazione non riconosciuta.');
      if (persistent) await vault.replace(key, null);
      stillAdmitted();
      pending = null;
      if (input['action'] == 'resume') {
        turns
          ..clear()
          ..addAll(groupRows(reply['history']))
          ..add(reply);
      } else {
        final index = turns.indexWhere((r) => r['id'] == reply['id']);
        if (index == -1) {
          turns.add(reply);
        } else {
          turns[index] = reply;
        }
      }
      if (input['action'] == 'ask')
        last = {'id': reply['id'], 'createdAt': reply['createdAt']};
      return reply;
    } finally {
      busy = false;
    }
  }

  GroupRecord ask(String question) => {
    'action': 'ask',
    'kind': 'context',
    'id': group.api.newId(),
    'expectedActorId': group.actor,
    'question': question.trim(),
    if (turns.isNotEmpty) 'parentId': turns.last['id'],
  };
  GroupRecord action(String action, String id) => {
    'action': action,
    'id': id,
    'expectedActorId': group.actor,
  };
}
