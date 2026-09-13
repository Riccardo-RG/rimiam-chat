package it.miriam.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class BoundaryTest {
    @Test fun realSessionConversationDurableRecoveryAndRevocation() = runBlocking {
        val api = Api("http://10.0.2.2:3102")
        val login = api.call("native/session", method = "POST", body = JSONObject().put("email", "native-android@example.test").put("password", "Native-test-only-2026!"))
        val token = login.getString("token"); val user = login.getJSONObject("user").person()
        val w = api.call("workspaces", token).rows("workspaces").first { it.getString("name") == "Native shared verification" }.getString("id")
        val name = "native-test-${UUID.randomUUID()}"
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val vault = Vault(context, name)
        val pending = PendingCommand(UUID.randomUUID().toString(), api.base, user.id, w, "message.send", "Android recovery ${UUID.randomUUID()}")
        vault.save(VaultState(Credential(api.base, user, token), listOf(pending)))
        val body = JSONObject().put("commandId", pending.id).put("command", JSONObject().put("type", pending.type).put("content", pending.content))
        api.call("workspaces/$w/commands", token, "POST", body) // committed response is deliberately not recorded locally
        val restarted = Vault(context, name).load()
        assertEquals(pending, restarted.pending.single())
        val receipt = api.call("workspaces/$w/receipts/${pending.id}", restarted.credential!!.token)
        assertEquals("committed", receipt.getString("status"))
        assertEquals(pending.id, receipt.getString("commandId"))
        api.call("workspaces/$w/commands", token, "POST", body) // exact replay
        val state = api.call("workspaces/$w/state", token).workspaceState()
        var after = 0; val contents = mutableListOf<String>()
        do {
            val page = api.call("workspaces/$w/messages?after=$after&through=${state.messageSequence}&limit=1", token)
            contents.addAll(page.rows("messages").map { it.getString("content") })
            after = page.getInt("nextAfter")
        } while (page.getBoolean("hasMore"))
        assertEquals(1, contents.count { it == pending.content })
        assertEquals(state.messageSequence, after)
        val nextId = UUID.randomUUID().toString()
        api.call("workspaces/$w/commands", token, "POST", JSONObject().put("commandId", nextId).put("command", JSONObject().put("type", "message.send").put("content", "While Android inactive $nextId")))
        val changes = api.call("workspaces/$w/changes?after=${state.revision}", token)
        assertTrue(changes.getInt("headRevision") > state.revision)
        val refreshed = api.call("workspaces/$w/state", token).workspaceState()
        val tail = api.call("workspaces/$w/messages?after=$after&through=${refreshed.messageSequence}", token)
        assertTrue(tail.rows("messages").any { it.getString("content") == "While Android inactive $nextId" })
        vault.save(restarted.copy(pending = emptyList()))
        api.call("native/session", token, "DELETE")
        vault.save(VaultState())
        try { api.call("native/session", token); fail("Revoked session accepted") } catch (e: ApiError) { assertEquals(401, e.status) }
        assertNull(vault.load().credential)
    }
    @Test fun voicePersistenceAndUnavailableCallingBoundary() = runBlocking {
        val api=Api("http://10.0.2.2:3102")
        val login=api.call("native/session",method="POST",body=JSONObject().put("email","native-android@example.test").put("password","Native-test-only-2026!"));val token=login.getString("token")
        val w=api.call("workspaces",token).rows("workspaces").first{it.getString("name")=="Native shared verification"}.getString("id")
        val audio="RIFF....WAVE native Android fixture".toByteArray();val id=java.util.UUID.randomUUID().toString()
        val body=JSONObject().put("commandId",id).put("command",command("voice.send","filename" to "voice.wav","bytesBase64" to android.util.Base64.encodeToString(audio,android.util.Base64.NO_WRAP),"mode" to "miriam","allowModelProcessing" to true))
        val source=api.call("workspaces/$w/commands",token,"POST",body).getJSONObject("result").getString("sourceId")
        api.call("workspaces/$w/commands",token,"POST",body)
        assertEquals(1,api.call("workspaces/$w/voice",token).rows("messages").count{it.getString("sourceId")==source})
        assertArrayEquals(audio,api.bytes("workspaces/$w/source-file?id=$source",token))
        val calls=api.call("workspaces/$w/calls",token);assertFalse(calls.getBoolean("configured"));assertTrue(calls.getString("consentText").contains("ADR-0009"))
        api.call("native/session",token,"DELETE")
        try{api.call("workspaces/$w/voice",token);fail("Revoked session read voice history")}catch(error:ApiError){assertEquals(401,error.status)}
    }
    @Test fun secureStorageIsEncryptedAndRejectsTampering() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "native-storage-test-${UUID.randomUUID()}"
        val vault = Vault(context, name)
        val command = PendingCommand("id", "https://example.test", "a", "w", "message.send", "Private pending content")
        vault.save(VaultState(pending = listOf(command)))
        val file = java.io.File(context.noBackupFilesDir, "$name.enc")
        assertFalse(file.readText().contains(command.content))
        assertEquals(command, Vault(context, name).load().pending.single())
        val content = JSONObject(file.readText()).put("iv", android.util.Base64.encodeToString(ByteArray(12), android.util.Base64.NO_WRAP))
        file.writeText(content.toString())
        assertThrows(Exception::class.java) { vault.load() }
        assertThrows(Exception::class.java) { Api("http://untrusted.example") }
        assertThrows(Exception::class.java) { Api("https://user:password@example.test") }
    }
}
