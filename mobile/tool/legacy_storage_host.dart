import 'dart:io';

/// Read-only compatibility with the two record families written by RIMIAM's
/// previous native app. The channel cannot read sessions, arbitrary keychain
/// entries or files. Dart verifies membership and checks retained file digests.
Future<void> configureLegacyStorageHost(Directory host) async {
  Future<void> insert(String path, String needle, String code) async {
    final file = File('${host.path}/$path'), text = await file.readAsString();
    if (needle.allMatches(text).length != 1)
      throw StateError('Template migrazione inatteso in $path');
    await file.writeAsString(text.replaceFirst(needle, '$needle\n$code'));
  }

  await insert(
    'ios/Runner/AppDelegate.swift',
    'import UIKit',
    'import Security',
  );
  await insert(
    'ios/Runner/AppDelegate.swift',
    'GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)',
    _appleLegacy,
  );
  await insert(
    'android/app/src/main/kotlin/test/rimiam/rimiam_probe/MainActivity.kt',
    'super.configureFlutterEngine(engine)',
    _androidLegacy,
  );
}

const _appleLegacy = r'''
    let legacy = FlutterMethodChannel(name: "rimiam/legacy_drafts", binaryMessenger: engineBridge.applicationRegistrar.messenger())
    legacy.setMethodCallHandler { call, reply in
      if call.method == "roots" {
        let fm = FileManager.default
        reply(["documents":fm.urls(for:.documentDirectory,in:.userDomainMask)[0].path,
               "cache":fm.urls(for:.cachesDirectory,in:.userDomainMask)[0].path,
               "temporary":fm.temporaryDirectory.path])
        return
      }
      guard call.method == "read" || call.method == "has",
            let key = call.arguments as? String,
            key.range(of: #"^rimiam\.(?:draft|pending)\.[0-9a-f]{64}(?:\.[0-9a-fA-F-]{36}\.\d{1,3})?$"#, options:.regularExpression) != nil else { reply(FlutterMethodNotImplemented); return }
      let bytes=Data(key.utf8)
      for service in ["app:no-auth","app"] {
        let query:[String:Any] = [
          kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service,
          kSecAttrAccount as String:bytes, kSecAttrGeneric as String:bytes,
          kSecReturnData as String:call.method == "read", kSecMatchLimit as String:kSecMatchLimitOne,
          kSecUseAuthenticationUI as String:kSecUseAuthenticationUIFail
        ]
        var item:CFTypeRef?
        let status=SecItemCopyMatching(query as CFDictionary,&item)
        if status == errSecItemNotFound { continue }
        guard status == errSecSuccess else { reply(FlutterError(code:"legacy_locked",message:nil,details:nil));return }
        if call.method == "has" { reply(true);return }
        guard let data=item as? Data, data.count<=4096, let value=String(data:data,encoding:.utf8) else {
          reply(FlutterError(code:"legacy_damaged",message:nil,details:nil));return
        }
        reply(value); return
      }
      if call.method == "has" { reply(false) } else { reply(nil) }
    }
''';

const _androidLegacy = r'''
        io.flutter.plugin.common.MethodChannel(engine.dartExecutor.binaryMessenger,"rimiam/legacy_drafts").setMethodCallHandler { call, result ->
            if (call.method == "roots") {
                result.success(mapOf("documents" to filesDir.canonicalPath,"cache" to cacheDir.canonicalPath))
            } else {
                val key=call.arguments as? String
                if (key==null || !Regex("""^rimiam\.(?:draft|pending)\.[0-9a-f]{64}(?:\.[0-9a-fA-F-]{36}\.\d{1,3})?$""").matches(key) || call.method !in setOf("has","read")) {
                    result.notImplemented()
                } else try {
                    val prefs=getSharedPreferences("SecureStore",android.content.Context.MODE_PRIVATE)
                    val entry=when {
                        prefs.contains("key_v1-"+key) -> "key_v1-"+key
                        prefs.contains(key) -> key
                        else -> null
                    }
                    if(call.method=="has") result.success(entry!=null)
                    else if(entry==null) result.success(null)
                    else {
                        val item=org.json.JSONObject(requireNotNull(prefs.getString(entry,null)))
                        require(item.optString("scheme")=="aes" && !item.optBoolean("requireAuthentication") &&
                            item.optString("keystoreAlias","key_v1")=="key_v1")
                        val alias="AES/GCM/NoPadding:key_v1"+(if(item.optBoolean("usesKeystoreSuffix")) ":keystoreUnauthenticated" else "")
                        val store=java.security.KeyStore.getInstance("AndroidKeyStore").apply{ load(null) }
                        val secret=store.getKey(alias,null) as? javax.crypto.SecretKey ?: error("unavailable")
                        val iv=android.util.Base64.decode(item.getString("iv"),android.util.Base64.DEFAULT)
                        val ciphertext=android.util.Base64.decode(item.getString("ct"),android.util.Base64.DEFAULT)
                        val bits=item.getInt("tlen");require(bits in 96..128 && ciphertext.size<=4096)
                        val cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
                        cipher.init(javax.crypto.Cipher.DECRYPT_MODE,secret,javax.crypto.spec.GCMParameterSpec(bits,iv))
                        result.success(String(cipher.doFinal(ciphertext),Charsets.UTF_8))
                    }
                } catch (_:Exception) {result.error("legacy_unavailable",null,null)}
            }
        }
''';
