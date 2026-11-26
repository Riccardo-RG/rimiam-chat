import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/installation.dart';
import '../lib/installation_gate.dart';
import '../lib/local_secure_storage.dart';

void main() {
  test('release builds accept a bare HTTPS installation and debug alone allows emulator HTTP', () {
    expect(
      installationOrigin(
        ' https://group.example:8443/ ',
        allowEmulator: false,
      ).origin,
      'https://group.example:8443',
    );
    for (final value in [
      'http://example.test',
      'http://127.0.0.1',
      'https://name@example.test',
      'https://@example.test',
      'https://example.test?q=a',
      'https://example.test#secret',
      'https://example.test/space',
      'https://example.test:99999',
      'file:///something',
    ]) {
      expect(
        () => installationOrigin(value, allowEmulator: false),
        throwsFormatException,
        reason: value,
      );
    }
    expect(
      installationOrigin('http://10.0.2.2:4633', allowEmulator: true).port,
      4633,
    );
  });

  testWidgets(
    'switching the installation is explicit and restores the selected origin on relaunch',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({
        'rimiam.installation.v1': 'https://one.example',
      });
      Widget app() => MaterialApp(
        home: InstallationGate(
          builder: (origin, change) =>
              TextButton(onPressed: change, child: Text(origin.origin)),
        ),
      );
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      await tester.tap(find.text('https://one.example'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'http://other.example');
      await tester.tap(find.text('Continua'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Indica l’indirizzo HTTPS'), findsOneWidget);
      expect(
        await deviceSecureStorage.read(key: 'rimiam.installation.v1'),
        'https://one.example',
      );
      await tester.enterText(find.byType(TextField), 'https://two.example');
      await tester.tap(find.text('Continua'));
      await tester.pumpAndSettle();
      expect(find.text('https://two.example'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(find.text('https://two.example'), findsOneWidget);
    },
  );
}
