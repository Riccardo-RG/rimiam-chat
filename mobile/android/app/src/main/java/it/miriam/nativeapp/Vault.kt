package it.miriam.nativeapp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Credential(val base: String, val user: Person, val token: String, val logoutPending: Boolean = false)
data class PendingCommand(val id: String, val base: String, val actor: String, val workspace: String, val type: String, val content: String, val commandJSON: String? = null)
data class VaultState(val credential: Credential? = null, val pending: List<PendingCommand> = emptyList())

// Android Keystore holds the encryption key; one atomic encrypted file holds session and outgoing journal.
// Backup is disabled. No server Workspace history or passwords are persisted.
class Vault(context: Context, private val name: String = "miriam-session-v1") {
    private val file = AtomicFile(File(context.noBackupFilesDir, "$name.enc"))
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(name, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun load(): VaultState {
        if (!file.baseFile.exists()) return VaultState()
        val envelope = JSONObject(file.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
        cipher.updateAAD(name.toByteArray())
        val data = JSONObject(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)).toString(Charsets.UTF_8))
        val c = data.optJSONObject("credential")?.let { Credential(it.getString("base"), it.getJSONObject("user").person(), it.getString("token"), it.getBoolean("logoutPending")) }
        val pending = data.rows("pending").map { PendingCommand(it.getString("id"), it.getString("base"), it.getString("actor"), it.getString("workspace"), it.getString("type"), it.getString("content"), it.optString("commandJSON").takeIf { value -> value.isNotEmpty() }) }
        return VaultState(c, pending)
    }
    fun save(state: VaultState) {
        val data = JSONObject().put("pending", JSONArray(state.pending.map { JSONObject().put("id", it.id).put("base", it.base).put("actor", it.actor).put("workspace", it.workspace).put("type", it.type).put("content", it.content).apply { it.commandJSON?.let { json -> put("commandJSON", json) } } }))
        state.credential?.let { data.put("credential", JSONObject().put("base", it.base).put("token", it.token).put("logoutPending", it.logoutPending).put("user", JSONObject().put("id", it.user.id).put("name", it.user.name).put("email", it.user.email))) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(name.toByteArray())
        val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).put("data", Base64.encodeToString(cipher.doFinal(data.toString().toByteArray()), Base64.NO_WRAP))
        val stream = file.startWrite()
        try { stream.write(envelope.toString().toByteArray()); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }
}
