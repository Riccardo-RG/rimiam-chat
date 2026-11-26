part of 'configure_push_host.dart';

Future<void> configureApplePush(
  Directory host,
  HostChange change,
  String? env,
) async {
  const delegate = 'ios/Runner/AppDelegate.swift',
      scene = 'ios/Runner/SceneDelegate.swift';
  if (env != null) {
    await change(
      'ios/Runner/LocalTest.entitlements',
      '</dict>',
      '<key>aps-environment</key><string>$env</string></dict>',
    );
    await change(
      'ios/Runner/Info.plist',
      '<key>CFBundleIdentifier</key>',
      '<key>RimiamNativePush</key><true/><key>CFBundleIdentifier</key>',
    );
  }
  await change(
    delegate,
    'import UIKit',
    'import UIKit\nimport UserNotifications',
  );
  await change(
    delegate,
    '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
    '''    UNUserNotificationCenter.current().delegate = self
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)''',
  );
  await change(
    delegate,
    '  func didInitializeImplicitFlutterEngine(',
    r'''  private let notifications = RimiamPushBridge()

  func tappedRimiamNotice(_ response: UNNotificationResponse) {
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
      notifications.didTap(response.notification.request.content.userInfo)
    }
  }

  override func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completion: @escaping () -> Void) {
    tappedRimiamNotice(response)
    completion()
  }

  override func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completion: @escaping (UNNotificationPresentationOptions) -> Void) {
    completion([])
  }

  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: token)
    notifications.didRegister(token)
  }
  override func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
    notifications.registrationFailed()
  }

  func didInitializeImplicitFlutterEngine(''',
  );
  const registration =
      'GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)';
  await change(
    delegate,
    registration,
    '$registration\n    notifications.start(engineBridge.applicationRegistrar.messenger())',
  );
  final swift = File('${host.path}/$delegate');
  await swift.writeAsString(_appleBridge, mode: FileMode.append);
  await change(
    scene,
    'class SceneDelegate: FlutterSceneDelegate {',
    r'''class SceneDelegate: FlutterSceneDelegate {
  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)
    if let response = connectionOptions.notificationResponse {
      (UIApplication.shared.delegate as? AppDelegate)?.tappedRimiamNotice(response)
    }
  }''',
  );
  const project = 'ios/Runner.xcodeproj/project.pbxproj';
  const fileId = 'BC1720402E88000000000001',
      buildId = 'BC1720402E88000000000002';
  await change(
    project,
    '/* Begin PBXFileReference section */',
    '''/* Begin PBXFileReference section */
        $fileId /* Localizable.xcstrings */ = {isa = PBXFileReference; lastKnownFileType = text.json.xcstrings; path = Localizable.xcstrings; sourceTree = "<group>"; };''',
  );
  await change(
    project,
    '/* Begin PBXBuildFile section */',
    '''/* Begin PBXBuildFile section */
        $buildId /* Localizable.xcstrings in Resources */ = {isa = PBXBuildFile; fileRef = $fileId; };''',
  );
  await change(
    project,
    '97C146FD1CF9000F007C117D /* Assets.xcassets */,',
    '97C146FD1CF9000F007C117D /* Assets.xcassets */,\n                $fileId /* Localizable.xcstrings */,',
  );
  await change(
    project,
    '97C146FE1CF9000F007C117D /* Assets.xcassets in Resources */,',
    '97C146FE1CF9000F007C117D /* Assets.xcassets in Resources */,\n                $buildId /* Localizable.xcstrings in Resources */,',
  );
  await File('${host.path}/ios/Runner/Localizable.xcstrings').writeAsString(
    jsonEncode({
      'sourceLanguage': 'en',
      'version': '1.0',
      'strings': {
        'rimiam_space_activity': {
          'extractionState': 'manual',
          'localizations': {
            for (final e in {
              'en': 'There are updates in one of your spaces.',
              'it': 'Ci sono aggiornamenti in uno dei tuoi spazi.',
            }.entries)
              e.key: {
                'stringUnit': {'state': 'translated', 'value': e.value},
              },
          },
        },
      },
    }),
  );
}

const _appleBridge = r'''

private final class RimiamPushBridge {
  private var channel: FlutterMethodChannel?
  private var pending: [String:String]?
  private var tokenReplies: [FlutterResult] = []
  private var timeout: DispatchWorkItem?
  private var lastToken: String?

  func didTap(_ payload: [AnyHashable:Any]) {
    let data = payload["body"] as? [AnyHashable:Any] ?? payload
    guard let id = data["id"] as? String, let device = data["deviceId"] as? String,
          UUID(uuidString:id) != nil, UUID(uuidString:device) != nil else { return }
    pending = ["id":id,"deviceId":device]
    channel?.invokeMethod("notice", arguments:nil)
  }

  func start(_ messenger: FlutterBinaryMessenger) {
    let bridge = FlutterMethodChannel(name:"rimiam/native_push",binaryMessenger:messenger)
    channel = bridge
    bridge.setMethodCallHandler { [weak self] call, reply in
      guard let self else { reply(FlutterMethodNotImplemented); return }
      let center = UNUserNotificationCenter.current()
      let configured = Bundle.main.object(forInfoDictionaryKey:"RimiamNativePush") as? Bool == true
      switch call.method {
      case "status":
        center.getNotificationSettings { settings in
          let status = settings.authorizationStatus
          DispatchQueue.main.async { reply(["configured":configured,"allowed":status == .authorized || status == .provisional || status == .ephemeral]) }
        }
      case "request":
        guard configured else { reply(false); return }
        center.requestAuthorization(options:[.alert,.sound]) { allowed, _ in DispatchQueue.main.async { reply(allowed) } }
      case "token":
        guard configured else { reply(FlutterError(code:"push_unconfigured",message:nil,details:nil)); return }
        self.tokenReplies.append(reply)
        if self.tokenReplies.count == 1 {
          let work = DispatchWorkItem { [weak self] in self?.registrationFailed() }
          self.timeout = work
          DispatchQueue.main.asyncAfter(deadline:.now()+12,execute:work)
          UIApplication.shared.registerForRemoteNotifications()
        }
      case "settings":
        UIApplication.shared.open(URL(string:UIApplication.openSettingsURLString)!, options:[:]) { ok in
          reply(ok ? nil : FlutterError(code:"settings_unavailable",message:nil,details:nil))
        }
      case "pending": reply(self.pending)
      case "ack":
        if let read = call.arguments as? [String:String], read == self.pending { self.pending = nil }
        reply(nil)
      default: reply(FlutterMethodNotImplemented)
      }
    }
  }

  func didRegister(_ data: Data) {
    let token = data.map { String(format:"%02x",$0) }.joined()
    let changed = lastToken != nil && lastToken != token
    lastToken = token
    finish(token)
    if changed { channel?.invokeMethod("tokenChanged",arguments:nil) }
  }
  func registrationFailed() { finish(FlutterError(code:"token_unavailable",message:nil,details:nil)) }
  private func finish(_ value: Any) {
    timeout?.cancel(); timeout = nil
    let calls = tokenReplies; tokenReplies = []
    for reply in calls { reply(value) }
  }
}
''';
