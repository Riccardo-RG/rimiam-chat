import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../lib/account_entry.dart';
import '../lib/api.dart';
import '../lib/chat_journal.dart';
import '../lib/social_signin.dart';

class _Api extends RimiamApi {
  _Api() : super(Uri.parse('https://rimiam.example.test'));
  final calls = <Map<String, dynamic>>[];
  final signIn = Completer<void>();
  @override
  Future<void> login(String email, String password) => signIn.future;
  @override
  Future<Map<String, dynamic>> get(String path) async {
    expect(path, '/api/v1/native/social/providers');
    return {'google': true, 'microsoft': false};
  }

  @override
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    expect(path, '/api/v1/native/account');
    calls.add(body);
    return {'requested': true};
  }

  @override
  Future<void> exchangeSocial({
    required String code,
    required String state,
    required String verifier,
  }) async {
    calls.add({'code': code, 'state': state, 'verifier': verifier});
  }
}

class _Vault implements DraftVault {
  final data = <String, String>{};
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> replace(String key, String? value) async {
    if (value == null) {
      data.remove(key);
    } else {
      data[key] = value;
    }
  }
}

void main() {
  testWidgets(
    'registration, verification and recovery send only the specified account command',
    (tester) async {
      final api = _Api();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: AccountEntry(
                api: api,
                vault: _Vault(),
                callbacks: const Stream.empty(),
                authenticated: () async {
                  fail('La registrazione non ammette un utente');
                },
                changeInstallation: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Accedi con Google'), findsOneWidget);
      expect(find.text('Accedi con Microsoft'), findsNothing);
      await tester.tap(find.text('Crea account'));
      await tester.pumpAndSettle();
      Future<void> fill(String label, String text) =>
          tester.enterText(find.widgetWithText(TextField, label), text);
      await fill('Nome', 'Giulia');
      await fill('Email', 'giulia@example.test');
      await fill('Password', 'Una-password-fittizia');
      await tester.tap(find.widgetWithText(FilledButton, 'Crea account'));
      await tester.pumpAndSettle();
      expect(api.calls.single, {
        'action': 'register',
        'name': 'Giulia',
        'email': 'giulia@example.test',
        'password': 'Una-password-fittizia',
      });
      expect(find.text('Verifica il tuo indirizzo'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Password'), findsNothing);
      await tester.ensureVisible(find.text('Reinvia email di verifica'));
      await tester.tap(find.text('Reinvia email di verifica'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Torna all’accesso'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'Email'))
            .controller!
            .text,
        'giulia@example.test',
      );
      await tester.tap(find.text('Password dimenticata?'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Invia email di recupero'));
      await tester.pumpAndSettle();
      expect(api.calls.skip(1), [
        {'action': 'send-verification', 'email': 'giulia@example.test'},
        {'action': 'request-password-reset', 'email': 'giulia@example.test'},
      ]);
      expect(find.textContaining('riceverai un’email'), findsOneWidget);
    },
  );

  testWidgets(
    'a rejected sign-in reveals the error on a phone and keeps the form available',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 590);
      addTearDown(tester.view.reset);
      final api = _Api();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListView(
              children: [
                AccountEntry(
                  api: api,
                  vault: _Vault(),
                  callbacks: const Stream.empty(),
                  changeInstallation: () {},
                  authenticated: () async => fail('Invalid sign-in'),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Email'),
        'giulia@example.test',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password'),
        'incorrect',
      );
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      api.signIn.completeError(ApiError(401, 'INVALID_EMAIL_OR_PASSWORD'));
      await tester.pumpAndSettle();
      expect(
        find.text('Controlla email e password.').hitTestable(),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Accedi'))
            .onPressed,
        isNotNull,
      );
    },
  );

  test('a failed system browser launch explains the failure and clears the attempt', () async {
    final api = _Api(), vault = _Vault();
    addTearDown(api.close);
    final social = SocialSignIn(
      api,
      vault,
      open: (_) async => throw PlatformException(code: 'launch_failed'),
    );
    await expectLater(
      social.start('google'),
      throwsA(
        isA<FormatException>().having(
          (error) => accountIssue(error),
          'feedback',
          'Impossibile aprire il browser di sistema.',
        ),
      ),
    );
    expect(vault.data, isEmpty);
  });

  test('the same installation completes a persisted browser login only for its original state and callback', () async {
    final api = _Api(), vault = _Vault();
    addTearDown(api.close);
    Uri? opened;
    await SocialSignIn(
      api,
      vault,
      open: (u) async {
        opened = u;
        return true;
      },
    ).start('google');
    final url = opened!, pending = jsonDecode(vault.data.values.single);
    expect(url.origin, api.origin.origin);
    expect(
      url.queryParameters['challenge'],
      base64Url
          .encode(
            sha256.convert(utf8.encode(pending['verifier'] as String)).bytes,
          )
          .replaceAll('=', ''),
    );
    expect(url.queryParameters.containsKey('verifier'), false);
    final fresh = SocialSignIn(api, vault);
    final callback = Uri(
      scheme: 'com.rimiam.chat',
      path: '/oauth/complete',
      queryParameters: {'state': pending['state'], 'code': 'x' * 43},
    );
    expect(await fresh.complete(callback.replace(host: 'elsewhere')), false);
    expect(
      await fresh.complete(callback.replace(query: 'state=wrong&code=x')),
      false,
    );
    expect(vault.data, isNotEmpty);
    expect(await fresh.complete(callback), true);
    expect(api.calls.single['verifier'], pending['verifier']);
    expect(await fresh.complete(callback), false);
    expect(vault.data, isEmpty);
  });
}
