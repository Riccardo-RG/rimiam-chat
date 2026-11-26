import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/workspace_activity.dart';
import '../lib/workspace_governance.dart';
import 'workspace_governance_test.dart' show Api, Vault;

class ActivityApi extends Api {
  @override
  Future<GroupRecord> get(String path) async {
    if (path.endsWith('/workspace')) {
      final snap = await super.get(path);
      return {
        ...snap,
        'messages': [
          {
            'id': 'source',
            'sequence': 10,
            'author_name': 'Ada',
            'content': 'Controlliamo le date',
            'created_at': '2026-11-26',
          },
        ],
        'questions': [
          {
            'id': 'question',
            'version': 2,
            'status': 'answered',
            'source_id': 'source',
            'content': 'Quale giorno?',
            'answer_information_id': 'ref',
            'answer_information_version': 1,
          },
        ],
      };
    }
    if (path.contains('/attention?'))
      return {
        'workstreams': [
          {
            'id': 't',
            'title': 'Materiali',
            'state': 'active',
            'description': '',
            'version': 2,
            'history': [],
            'sources': [],
          },
          {
            'id': 'old',
            'title': 'Edizione estiva',
            'state': 'archived',
            'description': '',
            'version': 3,
            'history': [],
            'sources': [],
          },
        ],
      };
    if (path.contains('/activity?')) return {'events': [], 'next': null};
    if (path.contains('/history?')) {
      final q = Uri.parse(path).queryParameters;
      expect(q['workstreamId'], isIn(['t', 'old']));
      expect(q['through'], '10');
      return {
        'through': 10,
        'nextBefore': 10,
        'hasMore': false,
        'messages': [
          {
            'id': 'source',
            'sequence': 10,
            'authorName': 'Ada',
            'content': 'Controlliamo le date',
          },
        ],
      };
    }
    return super.get(path);
  }

  @override
  Future<GroupRecord> post(String path, GroupRecord payload) async {
    posts.add(payload);
    return {
      'commandId': payload['commandId'],
      'status': 'committed',
      'result': <String,dynamic>{},
    };
  }
}

Future<void> open(
  WidgetTester t,
  ActivityApi api, {
  required bool questions,
}) async {
  await t.pumpWidget(
    MaterialApp(
      home: WorkspaceActivityScreen(
        api: api,
        workspaceId: 'space',
        workspaceName: 'Progetto',
        questions: questions,
        vault: Vault(),
      ),
    ),
  );
  await t.pumpAndSettle();
}

void main() {
  testWidgets(
    'questions retain the exact source and only publish on confirmation',
    (t) async {
      final api = ActivityApi();
      await open(t, api, questions: true);
      await t.tap(find.text('Nuova domanda'));
      await t.pumpAndSettle();
      await t.tap(find.text('Ada · Controlliamo le date'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), 'Quale data fissiamo?');
      await t.pump();
      expect(api.posts, isEmpty);
      await t.tap(find.text('Registra domanda'));
      await t.pumpAndSettle();
      expect(api.posts.single['command'], {
        'type': 'question.open',
        'sourceId': 'source',
        'content': 'Quale data fissiamo?',
      });
      await t.tap(find.text('Con risposta'));
      await t.pumpAndSettle();
      await t.tap(find.text('Quale giorno?'));
      await t.pumpAndSettle();
      expect(find.text('Risposta collegata · v1'), findsOneWidget);
    },
  );

  testWidgets('reader can inspect archived topics and cannot modify them', (
    t,
  ) async {
    final api = ActivityApi()..contributor = false;
    await open(t, api, questions: false);
    expect(find.text('Nuovo argomento'), findsNothing);
    expect(find.text('Edizione estiva'), findsNothing);
    await t.tap(find.text('Includi conclusi e archiviati'));
    await t.pumpAndSettle();
    await t.tap(find.text('Edizione estiva'));
    await t.pumpAndSettle();
    expect(find.text('Ripristina'), findsNothing);
    expect(find.text('Fonti e cronologia'), findsOneWidget);
    expect(api.posts, isEmpty);
  });

  testWidgets('topic archive confirms and preserves the inspected version', (
    t,
  ) async {
    final api = ActivityApi();
    await open(t, api, questions: false);
    await t.tap(find.text('Materiali'));
    await t.pumpAndSettle();
    await t.tap(find.text('Archivia'));
    await t.pumpAndSettle();
    expect(api.posts, isEmpty);
    await t.tap(find.widgetWithText(FilledButton, 'Archivia'));
    await t.pumpAndSettle();
    expect(api.posts.single['command'], {
      'type': 'workstream.transition',
      'workstreamId': 't',
      'expectedVersion': 2,
      'action': 'archive',
    });
  });

  testWidgets(
    'topic history opens by scope and sending retains its inspected version',
    (t) async {
      final api = ActivityApi();
      await open(t, api, questions: false);
      await t.tap(find.text('Materiali'));
      await t.pumpAndSettle();
      await t.tap(find.text('Conversazione sull’argomento'));
      await t.pumpAndSettle();
      expect(find.text('Controlliamo le date'), findsOneWidget);
      await t.enterText(find.byType(TextField), 'La data va bene.');
      await t.pumpAndSettle();
      await t.tap(find.text('Invia'));
      await t.pumpAndSettle();
      final sent = api.posts.single['command'];
      expect(sent['workstreamFocus'], {'workstreamId': 't', 'version': 2});
      expect(sent['content'], 'La data va bene.');
      expect(
        t.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
    },
  );
}
