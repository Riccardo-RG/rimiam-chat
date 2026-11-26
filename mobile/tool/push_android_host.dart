part of 'configure_push_host.dart';

Future<void> configureAndroidPush(
  Directory host,
  HostChange change,
  String? services,
) async {
  const app = 'android/app', manifest = '$app/src/main/AndroidManifest.xml';
  final configured = services != null && services.isNotEmpty;
  await change(
    manifest,
    '<application',
    '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <application',
  );
  if (configured) {
    // This is Firebase's public client configuration, never a service-account key.
    final config = File(services),
        input = jsonDecode(await config.readAsString());
    if (input is! Map ||
        input['client'] is! List ||
        input.containsKey('private_key'))
      throw const FormatException('Configurazione client Firebase non valida.');
    await config.copy('${host.path}/$app/google-services.json');
    await change(
      'android/settings.gradle.kts',
      'id("dev.flutter.flutter-plugin-loader") version "1.0.0"',
      '''id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.google.gms.google-services") version "4.6.0" apply false''',
    );
    await change(
      '$app/build.gradle.kts',
      'id("dev.flutter.flutter-gradle-plugin")',
      '''id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")''',
    );
    await File('${host.path}/$app/build.gradle.kts').writeAsString('''
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:35.2.0"))
    implementation("com.google.firebase:firebase-messaging")
}
''', mode: FileMode.append);
    await change(manifest, '</application>', '''    <meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false"/>
        <meta-data android:name="firebase_analytics_collection_enabled" android:value="false"/>
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="rimiam-updates"/>
        <service android:name=".RimiamMessaging" android:exported="false">
            <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT"/></intent-filter>
        </service>
    </application>''');
  }
  const file = '$app/src/main/kotlin/test/rimiam/rimiam_probe/MainActivity.kt';
  const configure = 'super.configureFlutterEngine(engine)';
  await change(file, configure, '$configure\n        bindPush(engine)');
  await change(
    file,
    'class MainActivity : FlutterActivity() {',
    'class MainActivity : FlutterActivity() {\n' +
        _androidActivity
            .replaceFirst('__CONFIGURED__', configured.toString())
            .replaceFirst(
              '__TOKEN__',
              configured
                  ? r'''
                try {
                    com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                        if (task.isSuccessful) result.success(task.result)
                        else result.error("token_unavailable", null, null)
                    }
                } catch (_: Exception) { result.error("token_unavailable", null, null) }'''
                  : 'result.error("push_unconfigured", null, null)',
            ),
  );
  if (configured)
    await File('${host.path}/$file').writeAsString(r'''

class RimiamMessaging : com.google.firebase.messaging.FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Re-read the token on the active phone. Never opt a Workspace in on refresh.
        sendBroadcast(android.content.Intent("rimiam.TOKEN_CHANGED").setPackage(packageName))
    }
}
''', mode: FileMode.append);
  for (final r in {
    'values': 'There are updates in one of your spaces.',
    'values-it': 'Ci sono aggiornamenti in uno dei tuoi spazi.',
  }.entries) {
    final out = File(
      '${host.path}/$app/src/main/res/${r.key}/rimiam_notifications.xml',
    );
    await out.parent.create(recursive: true);
    await out.writeAsString(
      '<resources><string name="rimiam_space_activity">${r.value}</string><string name="rimiam_channel_name">${r.key == 'values' ? 'Space updates' : 'Aggiornamenti degli spazi'}</string></resources>',
    );
  }
}

const _androidActivity = r'''
    private val channelId = "rimiam-updates"
    private val pushConfigured = __CONFIGURED__
    private var push: io.flutter.plugin.common.MethodChannel? = null
    private var pendingNotice: Map<String,String>? = null
    private var requestReply: io.flutter.plugin.common.MethodChannel.Result? = null
    private var listeningToken = false
    private val tokenReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context, intent: android.content.Intent) {
            push?.invokeMethod("tokenChanged", null)
        }
    }
    private fun inspectNotice(intent: android.content.Intent?) {
        val id = intent?.extras?.getString("id") ?: return
        val device = intent.extras?.getString("deviceId") ?: return
        val uuid = Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
        if (!uuid.matches(id) || !uuid.matches(device)) return
        pendingNotice=mapOf("id" to id,"deviceId" to device)
        push?.invokeMethod("notice",null)
    }
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent); setIntent(intent); inspectNotice(intent)
    }
    private fun allowed(): Boolean {
        val manager = getSystemService(android.app.NotificationManager::class.java)
        return manager.areNotificationsEnabled() && (android.os.Build.VERSION.SDK_INT < 26 ||
            manager.getNotificationChannel(channelId)?.importance != android.app.NotificationManager.IMPORTANCE_NONE)
    }
    private fun bindPush(engine: io.flutter.embedding.engine.FlutterEngine) {
        inspectNotice(intent)
        val bridge = io.flutter.plugin.common.MethodChannel(engine.dartExecutor.binaryMessenger,"rimiam/native_push")
        push=bridge
        if (pushConfigured && !listeningToken) {
            // A refresh only triggers a recheck with the SDK; a broadcast never supplies a credential.
            androidx.core.content.ContextCompat.registerReceiver(this,tokenReceiver,android.content.IntentFilter("rimiam.TOKEN_CHANGED"),
                androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
            listeningToken=true
        }
        bridge.setMethodCallHandler { call,result ->
            when(call.method) {
              "status" -> result.success(mapOf("configured" to pushConfigured, "allowed" to allowed()))
              "request" -> {
                if (!pushConfigured) result.success(false)
                else {
                    if (android.os.Build.VERSION.SDK_INT >= 26) {
                        getSystemService(android.app.NotificationManager::class.java).createNotificationChannel(
                            android.app.NotificationChannel(channelId,getString(R.string.rimiam_channel_name),android.app.NotificationManager.IMPORTANCE_DEFAULT))
                    }
                    if (android.os.Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        if (requestReply!=null) result.error("busy",null,null)
                        else {requestReply=result;requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),6437)}
                    } else result.success(allowed())
                }
              }
              "token" -> { __TOKEN__ }
              "settings" -> {
                try {
                    val action = if(android.os.Build.VERSION.SDK_INT>=26)
                        android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,packageName)
                        else android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+packageName))
                    startActivity(action);result.success(null)
                } catch (_: android.content.ActivityNotFoundException) {result.error("settings_unavailable",null,null)}
              }
              "pending" -> result.success(pendingNotice)
              "ack" -> {
                if(pendingNotice!=null && call.arguments==pendingNotice) {
                    pendingNotice=null; intent.removeExtra("id"); intent.removeExtra("deviceId")
                }
                result.success(null)
              }
              else -> result.notImplemented()
            }
        }
    }
    override fun onRequestPermissionsResult(code:Int, permissions:Array<out String>, grants:IntArray) {
        super.onRequestPermissionsResult(code,permissions,grants)
        if(code==6437){requestReply?.success(allowed());requestReply=null}
    }
    override fun onDestroy(){
        if(listeningToken)unregisterReceiver(tokenReceiver)
        requestReply?.error("interrupted",null,null);requestReply=null
        super.onDestroy()
    }
''';
