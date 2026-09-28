package it.miriam.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class BoundaryTest {
    @Test fun conversationHandoffUsesExistingCommandJournalAndScopedResult() = runBlocking {
        val api=Api("http://10.0.2.2:3102")
        val login=api.call("native/session",method="POST",body=JSONObject().put("email","native-android@example.test").put("password","Native-test-only-2026!"))
        val token=login.getString("token")
        val user=login.getJSONObject("user").person()
        suspend fun createWorkspace():String {
            val id=UUID.randomUUID().toString()
            api.call("workspaces",token,"POST",JSONObject().put("commandId",id).put("expectedActorId",user.id).put("name","Handoff Android $id"))
            return id
        }
        val workspace=createWorkspace()
        val other=createWorkspace()
        val marker=UUID.randomUUID().toString()
        val source=api.call("workspaces/$workspace/commands",token,"POST",JSONObject().put("commandId",UUID.randomUUID().toString()).put("expectedActorId",user.id).put("command",command("message.send","content" to "@Miriam Native handoff goal $marker"))).getJSONObject("result").getString("messageId")
        val application=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as android.app.Application
        val vault=Vault(application)
        val previous=vault.load()
        val models=ViewModelStore()
        try {
            vault.save(VaultState(Credential(api.base,user,token)))
            val model=withContext(Dispatchers.Main){WorkspaceModel(application).also{models.put("handoff-test",it)}}
            withTimeout(10000){model.ui.first{it.ready}}
            withContext(Dispatchers.Main){model.select(workspace);model.setForeground(true)}
            val ready=withTimeout(30000){model.ui.first{it.handoffs.any {h->h.sourceMessageId==source}}}
            val handoff=ready.handoffs.single{it.sourceMessageId==source}
            assertEquals("ready",handoff.status)
            assertEquals("Validare RIMIAM $marker",handoff.suggestedText)
            assertEquals(listOf(source),handoff.sourceIds)
            assertTrue(api.call("workspaces/$workspace/state",token).rows("goals").isEmpty())
            withContext(Dispatchers.Main){model.loadHandoffs(source)}.join()
            assertEquals(1,model.ui.value.handoffs.count{it.id==handoff.id})
            assertTrue(model.ui.value.canUseHandoff(handoff))

            val edited="Goal riveduto su Android $marker"
            var recorded:PendingCommand?=null
            withContext(Dispatchers.Main){
                model.workspaceCommand(command("goal.establish","content" to edited).withHandoff(handoff),edited){
                    recorded=model.ui.value.pending.single()
                    assertFalse(model.ui.value.canUseHandoff(handoff))
                }
            }
            val applied=withTimeout(20000){model.ui.first{!it.busy && it.handoffs.any {h->h.id==handoff.id && h.status=="applied"}}}
            val result=applied.handoffs.single{it.id==handoff.id}.application!!
            assertEquals(recorded!!.id,result.commandId)
            assertEquals(user.id,result.actor)
            assertEquals(handoff.id,JSONObject(recorded!!.commandJSON!!).getJSONObject("conversationOrigin").getString("handoffId"))
            assertEquals("goal",result.resultReference!!.kind)
            assertEquals(edited,applied.workspace!!.goals.single().content)
            assertFalse(applied.canUseHandoff(handoff))
            api.call("workspaces/$workspace/commands",token,"POST",JSONObject().put("commandId",recorded!!.id).put("expectedActorId",user.id).put("command",JSONObject(recorded!!.commandJSON!!)))
            assertEquals(1,api.call("workspaces/$workspace/state",token).rows("goals").size)

            withContext(Dispatchers.Main){
                val pendingRead=model.loadHandoffs(source)
                model.select(other)
                pendingRead.join()
            }
            val otherView=withTimeout(20000){model.ui.first{it.selected==other && it.handoffRevision!=null}}
            assertTrue(otherView.handoffs.isEmpty())
            withContext(Dispatchers.Main){model.workspaceCommand(command("goal.establish","content" to "Non deve passare nell’altro spazio").withHandoff(handoff),"Controllo isolamento")}
            val denied=withTimeout(20000){model.ui.first{!it.busy && it.pending.isNotEmpty() && it.error.isNotBlank()}}
            assertTrue(api.call("workspaces/$other/state",token).rows("goals").isEmpty())
            assertEquals(handoff.id,JSONObject(denied.pending.single().commandJSON!!).getJSONObject("conversationOrigin").getString("handoffId"))
            withContext(Dispatchers.Main){model.discardReminder(denied.pending.single())}.join()
            withContext(Dispatchers.Main){model.logout()}.join()
            assertTrue(model.ui.value.handoffs.isEmpty())
        }finally{
            withContext(Dispatchers.Main){models.clear()}
            vault.save(previous)
            runCatching{api.call("native/session",token,"DELETE")}
        }
        Unit
    }
    @Test fun activityReferencesPreserveHistoryVoiceAndWorkspaceIsolation() = runBlocking {
        val api = Api("http://10.0.2.2:3102")
        val login = api.call("native/session", method = "POST", body = JSONObject().put("email", "native-android@example.test").put("password", "Native-test-only-2026!"))
        val token = login.getString("token")
        val user = login.getJSONObject("user").person()
        suspend fun createWorkspace(): String {
            val id = UUID.randomUUID().toString()
            api.call("workspaces", token, "POST", JSONObject().put("commandId", id).put("expectedActorId", user.id).put("name", "Android Activity $id"))
            return id
        }
        val workspace = createWorkspace()
        val other = createWorkspace()
        suspend fun send(body: JSONObject) = api.call("workspaces/$workspace/commands", token, "POST", JSONObject().put("commandId", UUID.randomUUID().toString()).put("expectedActorId", user.id).put("command", body)).getJSONObject("result")
        val first = send(command("workstream.save", "title" to "Versione storica Android", "description" to "Descrizione conservata"))
        val id = first.getString("id")
        val historical = ConversationReference("workstream", id, 1, "workstream:$id:1")
        send(command("workstream.transition", "workstreamId" to id, "expectedVersion" to 1, "action" to "resolve"))
        repeat(40) { send(command("workstream.save", "title" to "Passaggio Android $it", "description" to "")) }
        val application = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as android.app.Application
        val vault = Vault(application)
        val previous = vault.load()
        val models = ViewModelStore()
        try {
            vault.save(VaultState(Credential(api.base, user, token)))
            val model = withContext(Dispatchers.Main) { WorkspaceModel(application).also { models.put("activity-test", it) } }
            withTimeout(10000) { model.ui.first { it.ready } }
            withContext(Dispatchers.Main) { model.select(workspace); model.setForeground(true) }
            val loaded = withTimeout(20000) { model.ui.first { it.selected == workspace && it.activity != null && !it.activityLoading } }
            assertEquals(40, loaded.activity!!.events.size)
            assertNotNull(loaded.activity.next)
            withContext(Dispatchers.Main) { model.loadActivity(older = true) }.join()
            assertEquals(42, model.ui.value.activity!!.events.size)
            assertNull(model.ui.value.activity!!.next)
            assertEquals(1, model.ui.value.activity!!.events.count { it.reference == historical })
            val detail = withContext(Dispatchers.Main) { model.referenceDetail(historical) }!!
            assertEquals(historical, detail.reference)
            assertFalse(detail.current)
            assertEquals("Versione storica Android", detail.title)
            assertEquals("active", detail.provenance.getString("recordedLifecycle"))
            assertEquals("resolved", detail.provenance.getString("currentState"))
            assertEquals(historical.eventId, detail.event!!.eventId)
            assertTrue(detail.qualification.isNotBlank())

            var journalReference: ConversationReference? = null
            withContext(Dispatchers.Main) {
                model.send("Parliamo di questa versione", reference = historical) {
                    journalReference = JSONObject(model.ui.value.pending.single().commandJSON!!).getJSONObject("reference").conversationReference()
                }
            }
            withTimeout(20000) { model.ui.first { !it.busy && it.messages.any { m -> m.content == "Parliamo di questa versione" } } }
            assertEquals(historical, journalReference)
            assertEquals(historical, model.ui.value.messages.first { it.content == "Parliamo di questa versione" }.reference)

            val binding = withContext(Dispatchers.Main) { model.media.captureBinding(model, historical) }!!
            val audio = "RIFF....WAVE Android reference fixture".toByteArray()
            val voice = binding.attachTo(command("voice.send", "filename" to "reference.wav", "bytesBase64" to android.util.Base64.encodeToString(audio, android.util.Base64.NO_WRAP), "mode" to "message", "allowModelProcessing" to true))
            withContext(Dispatchers.Main) { model.mediaSubmit(voice, "Audio su riferimento storico") }
            val source = model.ui.value.voiceReplySourceId!!
            val voiceMessage = model.ui.value.messages.first { it.reference == historical && it.content != "Parliamo di questa versione" }
            assertEquals(historical, voiceMessage.reference)
            assertArrayEquals(audio, api.bytes("workspaces/$workspace/source-file?id=$source", token))

            val late = withContext(Dispatchers.Main) {
                val lookup = async(start = CoroutineStart.UNDISPATCHED) { model.referenceDetail(historical) }
                model.select(other)
                lookup.await()
            }
            assertNull(late)
            val otherView = withTimeout(20000) { model.ui.first { it.selected == other && it.activity != null && !it.activityLoading } }
            assertTrue(otherView.activity!!.events.isEmpty())
            assertTrue(otherView.messages.none { it.reference == historical })
            withContext(Dispatchers.Main) { model.logout() }.join()
            assertNull(model.ui.value.activity)
        } finally {
            withContext(Dispatchers.Main) { models.clear() }
            vault.save(previous)
            runCatching { api.call("native/session", token, "DELETE") }
        }
        Unit
    }
    @Test fun workstreamFocusUsesSharedHistoryAndRejectsStaleSelection() = runBlocking {
        val api = Api("http://10.0.2.2:3102")
        val login = api.call("native/session", method="POST", body=JSONObject().put("email","native-android@example.test").put("password","Native-test-only-2026!"))
        val token=login.getString("token");val user=login.getJSONObject("user").person()
        val workspace=UUID.randomUUID().toString()
        api.call("workspaces",token,"POST",JSONObject().put("commandId",workspace).put("name","Android focus ${UUID.randomUUID()}").put("expectedActorId",user.id))
        suspend fun send(body:JSONObject)=api.call("workspaces/$workspace/commands",token,"POST",JSONObject().put("commandId",UUID.randomUUID().toString()).put("expectedActorId",user.id).put("command",body)).getJSONObject("result")
        val stream=send(command("workstream.save","title" to "Filone Android","description" to "Una vista della conversazione condivisa"))
        val focus=WorkstreamFocus(stream.getString("id"),stream.getInt("version"))
        val originalIds=mutableListOf<String>()
        repeat(53) {index->
            originalIds+=send(command("message.send","content" to "Nel filone $index","workstreamFocus" to focus.toJSON())).getString("messageId")
        }
        val outside=send(command("message.send","content" to "Fuori dal filone" )).getString("messageId")
        val application=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as android.app.Application
        val vault=Vault(application);val previous=vault.load();val models=ViewModelStore()
        try {
            vault.save(VaultState(Credential(api.base,user,token)))
            val model=withContext(Dispatchers.Main) {WorkspaceModel(application).also {models.put("focus-test",it)}}
            withTimeout(10000) {model.ui.first {it.ready}}
            withContext(Dispatchers.Main) {model.select(workspace);model.setForeground(true)}
            withTimeout(20000) {model.ui.first {it.workspace?.id==workspace && it.attention!=null && it.messagesThrough!=null}}
            withContext(Dispatchers.Main) {model.selectWorkstream(focus)}
            val focused=withTimeout(20000) {model.ui.first {it.workstreamFocus==focus && it.messagesThrough!=null}}
            assertEquals(50,focused.messages.size);assertTrue(focused.hasOlder)
            assertTrue(focused.messages.all {it.workstreamFocus==focus});assertTrue(focused.messages.none {it.id==outside})
            withContext(Dispatchers.Main) {model.loadOlder()}.join()
            assertEquals(53,model.ui.value.messages.size);assertFalse(model.ui.value.hasOlder)

            // Switching reading views must not replace loaded history with just the latest page.
            withContext(Dispatchers.Main) {model.selectWorkstream(null)}
            withTimeout(20000) {model.ui.first {it.workstreamFocus==null && it.messagesThrough!=null}}
            withContext(Dispatchers.Main) {model.selectWorkstream(focus)}
            val restored=withTimeout(20000) {model.ui.first {it.workstreamFocus==focus && it.messagesThrough!=null}}
            assertEquals(originalIds,restored.messages.map {it.id})
            withContext(Dispatchers.Main) {model.select(workspace)}
            withTimeout(20000) {model.ui.first {it.workstreamFocus==null && it.messagesThrough!=null && it.attention!=null}}
            withContext(Dispatchers.Main) {model.selectWorkstream(focus)}
            val reopenedHistory=withTimeout(20000) {model.ui.first {it.workstreamFocus==focus && it.messagesThrough!=null}}
            assertEquals(originalIds,reopenedHistory.messages.map {it.id})

            val saved=AtomicInteger()
            withContext(Dispatchers.Main) {model.send("Dal modello nel filone",focus) {saved.incrementAndGet()}}
            withTimeout(20000) {model.ui.first {!it.busy && it.messages.any {message->message.content=="Dal modello nel filone"}}}
            assertEquals(1,saved.get())
            assertEquals(focus,model.ui.value.messages.last().workstreamFocus)
            send(command("workstream.transition","workstreamId" to focus.workstreamId,"expectedVersion" to 1,"action" to "resolve"))
            withTimeout(20000) {model.ui.first {it.attention?.rows("workstreams")?.firstOrNull {row->row.getString("id")==focus.workstreamId}?.getInt("version")==2}}
            assertEquals(focus,model.ui.value.workstreamFocus);assertFalse(model.ui.value.focusIsCurrent())
            withContext(Dispatchers.Main) {model.send("Non inviare con selezione superata",focus) {saved.incrementAndGet()}}
            assertEquals(1,saved.get());assertTrue(model.ui.value.pending.isEmpty())
            withContext(Dispatchers.Main) {model.selectWorkstream(WorkstreamFocus(focus.workstreamId,2))}
            withTimeout(20000) {model.ui.first {it.workstreamFocus?.version==2 && it.messagesThrough!=null}}
            assertFalse(model.ui.value.focusIsCurrent())
            assertTrue(model.ui.value.messages.all {it.workstreamFocus==focus})

            send(command("workstream.transition","workstreamId" to focus.workstreamId,"expectedVersion" to 2,"action" to "reopen"))
            withTimeout(20000) {model.ui.first {it.attention?.rows("workstreams")?.firstOrNull {row->row.getString("id")==focus.workstreamId}?.getInt("version")==3}}
            val reopened=WorkstreamFocus(focus.workstreamId,3)
            withContext(Dispatchers.Main) {model.selectWorkstream(reopened)}
            withTimeout(20000) {model.ui.first {it.workstreamFocus==reopened && it.messagesThrough!=null}}
            val audio="RIFF....WAVE focused Android fixture".toByteArray()
            val voice=send(command("voice.send","filename" to "focus.wav","bytesBase64" to android.util.Base64.encodeToString(audio,android.util.Base64.NO_WRAP),"mode" to "message","allowModelProcessing" to true,"workstreamFocus" to reopened.toJSON()))
            withTimeout(20000) {model.ui.first {it.messages.any {row->row.id==voice.getString("messageId")}}}
            assertEquals(reopened,model.ui.value.messages.first {it.id==voice.getString("messageId")}.workstreamFocus)
            assertArrayEquals(audio,api.bytes("workspaces/$workspace/source-file?id=${voice.getString("sourceId")}",token))

            val removed=originalIds.last()
            send(command("workstream.link","workstreamId" to focus.workstreamId,"sourceId" to removed,"expectedVersion" to 1,"included" to false))
            withTimeout(20000) {model.ui.first {it.messagesThrough!=null && it.messages.none {row->row.id==removed}}}
            val empty=send(command("workstream.save","title" to "Filone vuoto","description" to ""))
            withTimeout(20000) {model.ui.first {it.attention?.rows("workstreams")?.any {row->row.getString("id")==empty.getString("id")}==true}}
            val emptyFocus=WorkstreamFocus(empty.getString("id"),empty.getInt("version"))
            val olderJob=withContext(Dispatchers.Main) {model.loadOlder()}
            withContext(Dispatchers.Main) {model.selectWorkstream(emptyFocus)}
            olderJob.join()
            val emptyView=withTimeout(20000) {model.ui.first {it.workstreamFocus==emptyFocus && it.messagesThrough!=null}}
            assertTrue(emptyView.messages.isEmpty());assertEquals("Aggiornato",emptyView.connection)
            withContext(Dispatchers.Main) {model.selectWorkstream(null)}
            withTimeout(20000) {model.ui.first {it.workstreamFocus==null && it.messages.any {row->row.id==outside}}}
            withContext(Dispatchers.Main) {model.logout()}.join()
            assertNull(model.ui.value.workstreamFocus);assertNull(model.ui.value.messagesThrough)
        } finally {
            withContext(Dispatchers.Main) {models.clear()}
            vault.save(previous)
            runCatching {api.call("native/session",token,"DELETE")}
        }
        Unit
    }
    @Test fun creationModelConfirmsOnlyCommittedPayloadAndScopesTheSession() = runBlocking {
        val api = Api("http://10.0.2.2:3102")
        val login = api.call("native/session", method = "POST", body = JSONObject().put("email", "native-android@example.test").put("password", "Native-test-only-2026!"))
        val token = login.getString("token"); val user = login.getJSONObject("user").person()
        val application = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as android.app.Application
        val vault = Vault(application); val previous = vault.load()
        val models = ViewModelStore()
        try {
            vault.save(VaultState(Credential(api.base, user, token)))
            val model = withContext(Dispatchers.Main) { WorkspaceModel(application).also { models.put("creation-test", it) } }
            withTimeout(10000) { model.ui.first { it.ready } }
            val scope = model.ui.value.accountScope!!
            assertEquals(user.id, scope.actorId); assertEquals(api.base, scope.apiBase)
            val rejectedCallbacks = AtomicInteger()
            withContext(Dispatchers.Main) { model.create("Rejected creation", "x".repeat(2001)) { rejectedCallbacks.incrementAndGet() } }
            val failed = withTimeout(10000) { model.ui.first { !it.busy && it.pending.isNotEmpty() && it.error.isNotEmpty() } }
            assertEquals(0, rejectedCallbacks.get())
            val pending = failed.pending.single()
            assertEquals("x".repeat(2001), JSONObject(pending.commandJSON!!).getString("description"))
            assertEquals(scope, failed.accountScope)
            withContext(Dispatchers.Main) { model.discardReminder(pending) }.join()

            val committedCallbacks = AtomicInteger()
            val description = "Introduzione Android\nConservata come messaggio attribuito."
            withContext(Dispatchers.Main) { model.create("Rimiam ${UUID.randomUUID()}", description) { committedCallbacks.incrementAndGet() } }
            val created = withTimeout(15000) { model.ui.first { !it.busy && committedCallbacks.get() == 1 } }
            assertTrue(created.pending.isEmpty()); assertEquals(0, rejectedCallbacks.get())
            val workspace = created.selected!!
            val messages = api.call("workspaces/$workspace/messages?after=0&through=2", token).rows("messages")
            assertEquals(description, messages.first().getString("content"))
            assertEquals("workspace_introduction", messages.first().getString("purpose"))
            assertTrue(api.call("workspaces/$workspace/state", token).rows("goals").isEmpty())

            withContext(Dispatchers.Main) { model.logout() }.join()
            assertNull(model.ui.value.accountScope); assertFalse(model.ui.value.busy)
            withContext(Dispatchers.Main) { model.login(api.base, "native-android@example.test", "Native-test-only-2026!") }.join()
            withContext(Dispatchers.Main) { model.setForeground(false) }
            val nextScope = model.ui.value.accountScope!!
            assertEquals(scope.actorId, nextScope.actorId); assertEquals(scope.apiBase, nextScope.apiBase)
            assertNotEquals(scope.sessionId, nextScope.sessionId)
            assertEquals(1, committedCallbacks.get())
            withContext(Dispatchers.Main) { model.logout() }.join()
        } finally {
            withContext(Dispatchers.Main) { models.clear() }
            vault.save(previous)
            runCatching { api.call("native/session", token, "DELETE") }
        }
        Unit
    }
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
    @Test fun preDesignIntroductionLifecycleAndProvenance() = runBlocking {
        val api=Api("http://10.0.2.2:3102")
        val login=api.call("native/session",method="POST",body=JSONObject().put("email","native-android@example.test").put("password","Native-test-only-2026!"))
        val token=login.getString("token");val user=login.getJSONObject("user").person();val w=UUID.randomUUID().toString()
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val vault=Vault(context,"predesign-${UUID.randomUUID()}")
        val pending=PendingCommand(w,api.base,user.id,w,"workspace.create","Creazione Android",JSONObject().put("name","Creazione Android").put("description","Descrizione conservata nel journal").toString())
        vault.save(VaultState(Credential(api.base,user,token),listOf(pending)))
        val restored=vault.load().pending.single()
        val body=JSONObject(restored.commandJSON!!).put("commandId",restored.id).put("expectedActorId",user.id)
        repeat(2){api.call("workspaces",token,"POST",body)}
        val page=api.call("workspaces/$w/messages?after=0&through=2",token).rows("messages")
        assertEquals(2,page.size);assertEquals("workspace_introduction",page[0].getString("purpose"));assertEquals("Descrizione conservata nel journal",page[0].getString("content"))
        assertEquals("workspace_welcome",page[1].getString("purpose"));assertEquals(page[0].getString("id"),page[1].getString("replyToSourceId"))
        assertTrue(api.call("workspaces/$w/state",token).rows("goals").isEmpty())
        suspend fun send(c:JSONObject)=api.call("workspaces/$w/commands",token,"POST",JSONObject().put("commandId",UUID.randomUUID().toString()).put("command",c)).getJSONObject("result")
        val stream=send(command("workstream.save","title" to "Locale","description" to ""))
        listOf("resolve","archive","reopen").forEachIndexed {index,action->send(command("workstream.transition","workstreamId" to stream.getString("id"),"expectedVersion" to index+1,"action" to action))}
        val current=api.call("workspaces/$w/attention",token).rows("workstreams").single();assertEquals("active",current.getString("state"));assertEquals(4,current.getInt("version"))
        val fixture=api.call("workspaces",token).rows("workspaces").first{it.getString("name")=="Pre-design provenance fixture"}.getString("id")
        val detail=api.call("workspaces/$fixture/workspace",token)
        assertEquals(2,detail.rows("versions").size)
        assertTrue(detail.rows("versions").all{it.getString("qualification").contains("Ipotesi di test non verificata")})
        assertTrue(detail.rows("candidates").all{it.getString("origin")=="inferred" && it.getJSONArray("source_ids").length()>0})
        assertTrue(detail.rows("candidates").any{it.getJSONObject("uses").rows("information").any{use->!use.getBoolean("current") && use.getInt("version")==1}})
        vault.save(VaultState());api.call("native/session",token,"DELETE");Unit
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
