import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/workspace_tool_host.dart';

void main() {
  late GlobalKey<WorkspaceToolHostState> tools;
  late TextEditingController draft;
  late ScrollController scroll;
  late List<Object?> results;

  setUp(() {
    tools = GlobalKey<WorkspaceToolHostState>();
    draft = TextEditingController(text: 'Testo ancora da inviare');
    scroll = ScrollController();
    results = [];
  });
  tearDown(() {
    draft.dispose();
    scroll.dispose();
  });

  Widget tool({bool guard = false}) => Builder(
    builder: (c) => PopScope(
      canPop: !guard,
      child: Scaffold(
        appBar: AppBar(title: const Text('Documenti')),
        body: Column(
          children: [
            TextField(decoration: const InputDecoration(labelText: 'Titolo')),
            TextButton(
              onPressed: () => Navigator.push(
                c,
                MaterialPageRoute<void>(
                  builder: (_) =>
                      Scaffold(appBar: AppBar(title: const Text('Anteprima'))),
                ),
              ),
              child: const Text('Apri anteprima'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(c, 'id-originale'),
              child: const Text('Vai al messaggio'),
            ),
          ],
        ),
      ),
    ),
  );
  Widget shell({bool allowed = true, bool revoked = false}) => MaterialApp(
    navigatorObservers: [workspaceOverlayObserver],
    home: WorkspaceToolHost(
      key: tools,
      authorized: allowed,
      revoked: revoked,
      child: Scaffold(
        appBar: AppBar(title: const Text('Lancio RIMIAM')),
        body: Column(
          children: [
            Expanded(
              child: ListView.builder(
                controller: scroll,
                itemExtent: 48,
                itemCount: 90,
                itemBuilder: (_, i) => Text('Messaggio $i'),
              ),
            ),
            TextField(controller: draft),
          ],
        ),
      ),
    ),
  );
  void size(WidgetTester t, double w) {
    t.view.devicePixelRatio = 1;
    t.view.physicalSize = Size(w, 800);
    addTearDown(t.view.resetDevicePixelRatio);
    addTearDown(t.view.resetPhysicalSize);
  }

  void open({bool guard = false}) =>
      tools.currentState!.open(tool(guard: guard)).then(results.add);

  testWidgets(
    'the same document survives full width, source return and chat scroll',
    (t) async {
      size(t, 1024);
      await t.pumpWidget(shell());
      scroll.jumpTo(1060);
      open();
      await t.pumpAndSettle();
      expect(
        t.getRect(find.text('Lancio RIMIAM')).right,
        lessThan(t.getRect(find.text('Documenti')).left),
      );
      final semantics = t.ensureSemantics();
      try {
        expect(find.bySemanticsLabel('Allarga'), findsOneWidget);
        expect(find.bySemanticsLabel('Lancio RIMIAM'), findsOneWidget);
      } finally {
        semantics.dispose();
      }
      expect(find.text('Testo ancora da inviare'), findsOneWidget);
      await t.enterText(
        find.widgetWithText(TextField, 'Titolo'),
        'Bozza documento',
      );
      await t.tap(find.text('Allarga'));
      await t.pumpAndSettle();
      expect(find.text('Lancio RIMIAM'), findsNothing);
      expect(find.text('Bozza documento'), findsOneWidget);
      await t.tap(find.text('Affianca'));
      await t.pumpAndSettle();
      expect(find.text('Lancio RIMIAM'), findsOneWidget);
      await t.tap(find.text('Vai al messaggio'));
      await t.pumpAndSettle();
      expect(results, ['id-originale']);
      expect(find.text('Documenti'), findsNothing);
      expect(scroll.offset, 1060);
      expect(draft.text, 'Testo ancora da inviare');
      expect(t.takeException(), isNull);
    },
  );
  testWidgets(
    'a narrower viewport keeps the live editor; system Back pops nested pages first',
    (t) async {
      size(t, 1024);
      await t.pumpWidget(shell());
      open();
      await t.pumpAndSettle();
      await t.enterText(
        find.widgetWithText(TextField, 'Titolo'),
        'Ancora aperta',
      );
      await t.tap(find.text('Apri anteprima'));
      await t.pumpAndSettle();
      t.view.physicalSize = const Size(375, 667);
      await t.pumpAndSettle();
      expect(find.text('Allarga'), findsNothing);
      expect(find.text('Lancio RIMIAM'), findsNothing);
      expect(find.text('Anteprima'), findsOneWidget);
      await t.binding.handlePopRoute();
      await t.pumpAndSettle();
      expect(find.text('Ancora aperta'), findsOneWidget);
      expect(results, isEmpty);
      t.view.physicalSize = const Size(1080, 790);
      await t.pumpAndSettle();
      expect(find.text('Lancio RIMIAM'), findsOneWidget);
      await t.tap(find.text('Chiudi'));
      await t.pumpAndSettle();
      expect(results, [null]);
      expect(find.text('Testo ancora da inviare'), findsOneWidget);
      expect(t.takeException(), isNull);
    },
  );
  testWidgets(
    'choosing a second tool closes the first request and returns each result exactly once',
    (t) async {
      size(t, 1024);
      await t.pumpWidget(shell());
      open();
      await t.pumpAndSettle();
      final second = tools.currentState!.open(
        Builder(
          builder: (c) => Scaffold(
            appBar: AppBar(title: const Text('Secondo')),
            body: TextButton(
              onPressed: () => Navigator.pop(c, 42),
              child: const Text('Rientra'),
            ),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(results, [null]);
      expect(find.text('Secondo'), findsOneWidget);
      await t.tap(find.text('Rientra'));
      await t.pumpAndSettle();
      expect(await second, 42);
      expect(find.text('Lancio RIMIAM'), findsOneWidget);
    },
  );

  testWidgets(
    'revocation clears tools and suppresses return data; reauthorization keeps an unrevoked draft',
    (t) async {
      size(t, 1024);
      await t.pumpWidget(shell());
      open();
      await t.pumpAndSettle();
      await t.enterText(find.widgetWithText(TextField, 'Titolo'), 'Riservato');
      await t.pumpWidget(shell(allowed: false));
      await t.pumpAndSettle();
      expect(find.text('Riservato'), findsNothing);
      expect(find.text('Verifica accesso'), findsOneWidget);
      await t.pumpWidget(shell());
      await t.pumpAndSettle();
      expect(find.text('Riservato'), findsOneWidget);
      await t.pumpWidget(shell(allowed: false, revoked: true));
      await t.pumpAndSettle();
      expect(find.text('Documenti'), findsNothing);
      expect(results, [null]);
      expect(await tools.currentState!.open(tool()), isNull);
      await t.pumpWidget(shell());
      open();
      await t.pumpAndSettle();
      expect(find.text('Riservato'), findsNothing);
    },
  );
  testWidgets(
    'revocation dismisses an already-open root dialog without confirming its action',
    (t) async {
      size(t, 1024);
      await t.pumpWidget(shell());
      bool? confirmed;
      final tool = tools.currentState!.open(
        Builder(
          builder: (c) => Scaffold(
            body: TextButton(
              child: const Text('Verifica documento'),
              onPressed: () async {
                confirmed = await showDialog<bool>(
                  context: c,
                  builder: (d) => AlertDialog(
                    title: const Text('Anteprima riservata'),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(d, true),
                        child: const Text('Conferma'),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      );
      await t.pumpAndSettle();
      await t.tap(find.text('Verifica documento'));
      await t.pumpAndSettle();
      expect(find.text('Anteprima riservata'), findsOneWidget);
      await t.pumpWidget(shell(allowed: false, revoked: true));
      await t.pumpAndSettle();
      expect(find.text('Anteprima riservata'), findsNothing);
      expect(find.text('Conferma'), findsNothing);
      expect(await tool, isNull);
      expect(confirmed, isNull);
      expect(find.text('Lancio RIMIAM'), findsOneWidget);
    },
  );

  testWidgets(
    'Close respects an editor back guard and waits before switching tools',
    (t) async {
      size(t, 1024);
      await t.pumpWidget(shell());
      open(guard: true);
      await t.pumpAndSettle();
      await t.tap(find.text('Chiudi'));
      await t.pumpAndSettle();
      expect(find.text('Documenti'), findsOneWidget);
      final attempt = tools.currentState!.open(const Text('Nuovo strumento'));
      await t.pumpAndSettle();
      expect(await attempt, isNull);
      expect(results, isEmpty);
      await t.pumpAndSettle();
      expect(find.text('Nuovo strumento'), findsNothing);
    },
  );
}
