package it.miriam.nativeapp

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

data class UiState(
    val voiceReplySourceId: String? = null, val ready: Boolean = false, val accountNotice: String = "", val invitationLink: String = "", val user: Person? = null, val logoutPending: Boolean = false,
    val spaces: List<Workspace> = emptyList(), val selected: String? = null,
    val workspace: WorkspaceState? = null, val detail: JSONObject? = null, val attention: JSONObject? = null, val messages: List<Message> = emptyList(),
    val hasOlder: Boolean = false, val pending: List<PendingCommand> = emptyList(), val busy: Boolean = false,
    val connection: String = "Non connesso", val error: String = "",
    val activeWork: JSONObject? = null, val tasks: JSONObject? = null, val email: JSONObject? = null, val calendar: JSONObject? = null, val calendarStart: String = java.time.LocalDate.now().toString()
)
class WorkspaceModel(application: Application) : AndroidViewModel(application) {
    val media = WorkspaceMedia(application,viewModelScope)
    override fun onCleared(){media.close();super.onCleared()}
    private val vault = Vault(application)
    private var stored = VaultState()
    private val vaultLock = Mutex()
    private val syncLock = Mutex()
    private var api: Api? = null
    private var loop: Job? = null
    private var generation = 0
    private var activeWorkBefore = ""
    private var tasksBefore = ""
    private var emailBefore = ""
    private var foreground = false
    private val mutable = MutableStateFlow(UiState())
    val ui = mutable.asStateFlow()
    init {
        viewModelScope.launch {
            try {
                stored = withContext(Dispatchers.IO) { vault.load() }
                api = stored.credential?.let { Api(it.base) }
                publishVault()
                mutable.update { it.copy(ready = true) }
                setForeground(foreground)
            } catch (e: Exception) { mutable.update { it.copy(ready = true, error = "Storage sicuro non disponibile. Nessun comando verrà inviato.") } }
        }
    }
    private fun publishVault() {
        val c = stored.credential
        mutable.update { it.copy(user = c?.user, logoutPending = c?.logoutPending == true, pending = stored.pending.filter { p -> p.actor == c?.user?.id && p.base == c.base }) }
    }
    private suspend fun persist(change: (VaultState) -> VaultState) = vaultLock.withLock {
        val next = change(stored)
        withContext(Dispatchers.IO) { vault.save(next) }
        stored = next; publishVault()
    }
    private suspend fun forget(id: String) { persist { it.copy(pending = it.pending.filterNot { p -> p.id == id }) } }
    fun requestAccount(base:String,action:String,email:String,name:String="",password:String="") = viewModelScope.launch {
        if(ui.value.busy) return@launch;mutable.update{it.copy(busy=true,error="",accountNotice="")}
        try {val body=JSONObject().put("action",action).put("email",email);if(action=="register") body.put("name",name).put("password",password)
            Api(base).call("native/account",method="POST",body=body)
            mutable.update{it.copy(accountNotice="Richiesta ricevuta. Se applicabile, controlla l’email e segui il link per completare l’operazione.")}
        } catch(e:Exception) {handle(e)} finally {mutable.update{it.copy(busy=false)}}
    }
    fun login(base: String, email: String, password: String) = viewModelScope.launch {
        if (ui.value.busy) return@launch
        mutable.update { it.copy(busy = true, error = "") }
        try {
            val client = Api(base)
            val result = client.call("native/session", method = "POST", body = JSONObject().put("email", email).put("password", password))
            val credential = Credential(client.base, result.getJSONObject("user").person(), result.getString("token"))
            persist { it.copy(credential = credential) }; api = client
            refreshSession(); setForeground(true)
        } catch (e: Exception) { handle(e) }
        finally { mutable.update { it.copy(busy = false) } }
    }
    fun setForeground(active: Boolean) {
        foreground = active; generation++; loop?.cancel(); loop = null
        if (!active) { mutable.update { it.copy(connection = "In pausa") }; return }
        if (stored.credential == null) return
        loop = viewModelScope.launch {
            var backoff = 2000L
            while (foreground && stored.credential != null) {
                try {
                    if (stored.credential?.logoutPending == true) { completeLogout(); return@launch }
                    refreshSession(); sync(); refreshActiveWork(); loadAttention(); recoverKnown()
                    mutable.update { it.copy(connection = "Aggiornato") }; backoff = 2000
                } catch (e: Exception) {
                    handle(e); mutable.update { it.copy(connection = "Connessione da ripristinare · dati dell’ultimo aggiornamento") }
                    backoff = (backoff * 2).coerceAtMost(30000)
                }
                delay(backoff)
            }
        }
    }
    fun select(id: String) { activeWorkBefore=""; tasksBefore=""; emailBefore=""; mutable.update { it.copy(selected = id, workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, tasks = null, email = null, messages = emptyList()) }; setForeground(foreground) }
    private suspend fun refreshSession() {
        val client = api ?: return; val c = stored.credential ?: return; val epoch = generation
        client.call("native/session", c.token)
        val spaces = client.call("workspaces", c.token).rows("workspaces").map { Workspace(it.getString("id"), it.getString("name")) }
        currentCoroutineContext().ensureActive()
        if (epoch != generation || c.token != stored.credential?.token) return
        mutable.update { state ->
            if (spaces.none { it.id == state.selected }) state.copy(spaces = spaces, selected = spaces.firstOrNull()?.id, workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, tasks = null, email = null, messages = emptyList())
            else state.copy(spaces = spaces)
        }
    }
    private suspend fun sync(force: Boolean = false) {
        if (!syncLock.tryLock()) return
        try {
            val client = api ?: return; val c = stored.credential ?: return; val w = ui.value.selected ?: return; val epoch = generation
            var reset = false
            if (!force) ui.value.workspace?.let { current ->
                try {
                    val changes = client.call("workspaces/$w/changes?after=${current.revision}&limit=1", c.token)
                    if (changes.getInt("headRevision") == current.revision && ui.value.calendar != null) return
                } catch (e: ApiError) {
                    if (e.code in setOf("CURSOR_AHEAD", "SYNC_RESET_REQUIRED")) reset = true else throw e
                }
            }
            val state = client.call("workspaces/$w/state", c.token).workspaceState()
            var merged = ui.value.messages.toMutableList(); var older = ui.value.hasOlder
            if (ui.value.workspace == null || reset || (merged.lastOrNull()?.sequence ?: 0) > state.messageSequence) {
                val page = client.call("workspaces/$w/history?through=${state.messageSequence}&limit=50", c.token)
                merged = page.rows("messages").map { Message(it.getString("id"), it.getInt("sequence"), it.getString("content"), it.getString("authorName"), it.optString("actorKind","human"),it.optJSONArray("citationSourceIds")?.let{a->(0 until a.length()).map{index->a.getString(index)}} ?: emptyList(),it.optString("replyToSourceId").takeIf {id->id.isNotBlank()&&id!="null"}) }.toMutableList()
                older = page.getBoolean("hasMore")
            }
            var after = merged.lastOrNull()?.sequence ?: 0
            while (after < state.messageSequence) {
                val page = client.call("workspaces/$w/messages?after=$after&through=${state.messageSequence}&limit=50", c.token)
                if (page.getInt("nextAfter") <= after || page.getInt("through") != state.messageSequence) throw ApiError("SYNC_INCOMPLETE", 0)
                merged.addAll(page.rows("messages").map { Message(it.getString("id"), it.getInt("sequence"), it.getString("content"), it.getString("authorName"), it.optString("actorKind","human"),it.optJSONArray("citationSourceIds")?.let{a->(0 until a.length()).map{index->a.getString(index)}} ?: emptyList(),it.optString("replyToSourceId").takeIf {id->id.isNotBlank()&&id!="null"}) })
                after = page.getInt("nextAfter")
            }
            val detail = client.call("workspaces/$w/workspace", c.token)
            val calendar = client.call("workspaces/$w/calendar?${calendarQuery()}", c.token)
            currentCoroutineContext().ensureActive()
            if (epoch != generation || ui.value.selected != w || c.token != stored.credential?.token) return
            mutable.update { it.copy(workspace = state, detail = detail, calendar = calendar, messages = merged, hasOlder = older, connection = "Aggiornato") }
        } finally { syncLock.unlock() }
    }
    fun loadActiveWork(before: String? = null) = viewModelScope.launch {
        if(before != null) activeWorkBefore = before
        refreshActiveWork()
    }
    private suspend fun refreshActiveWork() {
        val client = api ?: return; val c = stored.credential ?: return; val w = ui.value.selected ?: return
        if(c.logoutPending) return
        val epoch = generation; val page = activeWorkBefore
        try {
            val result = client.call("workspaces/$w/active-work" + if(page.isEmpty()) "" else "?before=$page", c.token)
            currentCoroutineContext().ensureActive()
            if(epoch == generation && ui.value.selected == w && c.token == stored.credential?.token && stored.credential?.logoutPending != true && activeWorkBefore == page) mutable.update { it.copy(activeWork = result) }
        } catch(e: Exception) {
            if(epoch == generation && c.token == stored.credential?.token) { mutable.update { it.copy(activeWork = null) }; handle(e) }
        }
    }
    suspend fun activeWorkHistory(id: String, before: Int? = null): String {
        val client = api ?: return ""; val c = stored.credential ?: return ""; val w = ui.value.selected ?: return ""; val epoch = generation
        if(c.logoutPending) return ""
        return try {
            val result = client.call("workspaces/$w/active-work-history?id=$id" + (before?.let { "&before=$it" } ?: ""), c.token)
            currentCoroutineContext().ensureActive()
            if(epoch == generation && ui.value.selected == w && c.token == stored.credential?.token && stored.credential?.logoutPending != true) result.toString(2) else ""
        } catch(e: Exception) { handle(e); "" }
    }
    suspend fun calendarHistory(id: String, kind: String): String {
        val client = api ?: return ""; val c = stored.credential ?: return ""; val w = ui.value.selected ?: return ""; val epoch = generation
        if(c.logoutPending) return ""
        return try {
            val result = client.call("workspaces/$w/calendar-history?id=$id&kind=$kind", c.token)
            currentCoroutineContext().ensureActive()
            if(epoch == generation && ui.value.selected == w && c.token == stored.credential?.token && stored.credential?.logoutPending != true) result.toString(2) else ""
        } catch(e: Exception) { handle(e); "" }
    }
    fun loadOlder() = viewModelScope.launch {
        if (!syncLock.tryLock()) return@launch
        try {
            val client = api ?: return@launch; val c = stored.credential ?: return@launch; val w = ui.value.selected ?: return@launch
            val state = ui.value.workspace ?: return@launch; val first = ui.value.messages.firstOrNull() ?: return@launch; val epoch = generation
            val page = client.call("workspaces/$w/history?before=${first.sequence}&through=${state.messageSequence}&limit=50", c.token)
            val older = page.rows("messages").map { Message(it.getString("id"), it.getInt("sequence"), it.getString("content"), it.getString("authorName"), it.optString("actorKind","human"),it.optJSONArray("citationSourceIds")?.let{a->(0 until a.length()).map{index->a.getString(index)}} ?: emptyList(),it.optString("replyToSourceId").takeIf {id->id.isNotBlank()&&id!="null"}) }
            currentCoroutineContext().ensureActive()
            if (epoch == generation && ui.value.selected == w && c.token == stored.credential?.token) mutable.update { it.copy(messages = older + it.messages, hasOlder = page.getBoolean("hasMore")) }
        } catch (e: Exception) { handle(e) } finally { syncLock.unlock() }
    }
    private fun calendarQuery(): String {
        val start = java.time.LocalDate.parse(ui.value.calendarStart).atStartOfDay(java.time.ZoneOffset.UTC).toInstant()
        return "start=${start}&end=${start.plusSeconds(30*86400)}"
    }
    fun calendarWindow(start: String) {
        generation++
        mutable.update { it.copy(calendarStart = start, calendar = null) }
        viewModelScope.launch { try { sync(true) } catch(e: Exception) { handle(e) } }
    }
    suspend fun loadTasks() {
        val client=api?:return;val c=stored.credential?:return;val w=ui.value.selected?:return;val epoch=generation;val page=tasksBefore
        if(c.logoutPending)return
        try {
            val next=client.call("workspaces/$w/tasks"+(if(page.isEmpty())"" else "?before=$page"),c.token)
            currentCoroutineContext().ensureActive()
            if(epoch==generation&&ui.value.selected==w&&stored.credential?.token==c.token&&stored.credential?.logoutPending!=true&&tasksBefore==page)mutable.update{it.copy(tasks=next)}
        }catch(e:Exception){if(epoch==generation&&stored.credential?.token==c.token){mutable.update{it.copy(tasks=null)};handle(e)}}
    }
    fun tasksPage(before:String){tasksBefore=before;viewModelScope.launch{loadTasks()}}
    suspend fun workHistory(id:String,kind:String):String {
        val client=api?:return "";val c=stored.credential?:return "";val w=ui.value.selected?:return "";val epoch=generation
        if(c.logoutPending)return ""
        return try { val result=client.call("workspaces/$w/tasks-history?id=$id&kind=$kind",c.token);currentCoroutineContext().ensureActive();if(epoch==generation&&ui.value.selected==w&&stored.credential?.token==c.token&&stored.credential?.logoutPending!=true)result.toString(2) else "" }catch(e:Exception){handle(e);""}
    }
    suspend fun loadEmail() {
        val client=api?:return; val c=stored.credential?:return; val w=ui.value.selected?:return;val epoch=generation;val page=emailBefore
        if(c.logoutPending)return
        try {
            val next=client.call("workspaces/$w/email"+(if(page.isEmpty())"" else "?before=$page"),c.token)
            currentCoroutineContext().ensureActive()
            if(epoch==generation&&ui.value.selected==w&&stored.credential?.token==c.token&&stored.credential?.logoutPending!=true&&emailBefore==page)mutable.update{it.copy(email=next)}
        }catch(e:Exception){if(epoch==generation&&stored.credential?.token==c.token){mutable.update{it.copy(email=null)};handle(e)}}
    }
    fun emailPage(before:String){emailBefore=before;viewModelScope.launch{loadEmail()}}
    suspend fun composeEmail(draft:JSONObject,instruction:String):JSONObject? {
        val client=api?:return null;val c=stored.credential?:return null;val w=ui.value.selected?:return null;val epoch=generation
        if(ui.value.busy||c.logoutPending)return null
        mutable.update{it.copy(busy=true,error="")}
        return try {
            val result=client.call("workspaces/$w/email-compose",c.token,"POST",JSONObject().put("draftId",draft.getString("id")).put("version",draft.getInt("version")).put("instruction",instruction))
            currentCoroutineContext().ensureActive()
            if(epoch==generation&&ui.value.selected==w&&stored.credential?.token==c.token&&stored.credential?.logoutPending!=true)result else null
        } catch(e:Exception) {if(epoch==generation&&stored.credential?.token==c.token)handle(e);null} finally {mutable.update{it.copy(busy=false)}}
    }
    fun workspaceCommand(body: JSONObject, label: String, onSaved:()->Unit = {}) { ui.value.selected?.let { prepare(body.getString("type"), it, label, body.toString(),onSaved) } }
    fun moreCalendar() = viewModelScope.launch {
        val c = stored.credential ?: return@launch; val client = api ?: return@launch; val w = ui.value.selected ?: return@launch
        val current = ui.value.calendar ?: return@launch; val cursor = current.optString("nextActions").takeIf { it.isNotEmpty() && it != "null" } ?: return@launch; val epoch = generation
        try {
            val next = client.call("workspaces/$w/calendar?${calendarQuery()}&afterAction=$cursor", c.token)
            if (epoch != generation || ui.value.selected != w || stored.credential?.token != c.token) return@launch
            next.put("actions", org.json.JSONArray(current.rows("actions") + next.rows("actions")))
            mutable.update { it.copy(calendar = next) }
        } catch(e: Exception) { handle(e) }
    }
    suspend fun connectGoogle(capability: String): String? {
        val client = api ?: return null; val c = stored.credential ?: return null; val w = ui.value.selected ?: return null; val epoch = generation
        return try {
            val response = client.call("workspaces/$w/google-connect", c.token, "POST", JSONObject().put("capability", capability))
            if (epoch != generation || ui.value.selected != w || stored.credential?.token != c.token) null else response.getString("authorizationUrl")
        } catch (e: Exception) { handle(e); null }
    }
    suspend fun loadAttention(before:Int?=null) {if(before==null && ui.value.attention?.optInt("revision")==ui.value.workspace?.revision) return;val result=workspaceRead("attention"+(before?.let{"?before=$it"} ?: ""));if(result!=null) mutable.update{it.copy(attention=result)}}
    suspend fun sourceBytes(id:String):ByteArray? {
        val client=api?:return null;val c=stored.credential?:return null;val w=ui.value.selected?:return null;val epoch=generation
        if(c.logoutPending)return null
        return try {val bytes=client.bytes("workspaces/$w/source-file?id=$id",c.token);currentCoroutineContext().ensureActive();if(epoch==generation&&ui.value.selected==w&&stored.credential?.token==c.token&&stored.credential?.logoutPending!=true) bytes else null} catch(e:Exception){handle(e);null}
    }
    suspend fun mediaConnection(id:String):JSONObject {
        val client=api?:throw ApiError("AUTHENTICATION_REQUIRED",401);val c=stored.credential?:throw ApiError("AUTHENTICATION_REQUIRED",401);val w=ui.value.selected?:throw ApiError("WORKSPACE_ACCESS_DENIED",403);val epoch=generation
        val result=client.call("workspaces/$w/call-connect",c.token,"POST",JSONObject().put("callId",id));currentCoroutineContext().ensureActive()
        if(epoch!=generation||ui.value.selected!=w||stored.credential?.token!=c.token||stored.credential?.logoutPending==true)throw CancellationException()
        return result
    }
    suspend fun mediaRecording(id:String):java.io.File {
        val client=api?:throw ApiError("AUTHENTICATION_REQUIRED",401);val c=stored.credential?:throw ApiError("AUTHENTICATION_REQUIRED",401);val w=ui.value.selected?:throw ApiError("WORKSPACE_ACCESS_DENIED",403);val epoch=generation
        val file=client.download("workspaces/$w/call-audio?id=$id",c.token,getApplication<Application>().cacheDir)
        if(epoch!=generation||ui.value.selected!=w||stored.credential?.token!=c.token||stored.credential?.logoutPending==true){file.delete();throw CancellationException()};return file
    }
    suspend fun mediaSubmit(body:JSONObject,label:String) {
        val c=stored.credential?:throw ApiError("AUTHENTICATION_REQUIRED",401);val w=ui.value.selected?:throw ApiError("WORKSPACE_ACCESS_DENIED",403)
        if(ui.value.busy||c.logoutPending)throw ApiError("COMMAND_BUSY",409)
        mutable.update{it.copy(busy=true,error="")}
        try{val pending=PendingCommand(UUID.randomUUID().toString(),c.base,c.user.id,w,body.getString("type"),label,body.toString());persist{it.copy(pending=it.pending+pending)};transmit(pending)}finally{mutable.update{it.copy(busy=false)}}
    }
    suspend fun workspaceRead(resource:String):JSONObject? {
        val client=api ?: return null;val c=stored.credential ?: return null;val w=ui.value.selected ?: return null;val epoch=generation
        return try {val result=client.call("workspaces/$w/$resource",c.token);if(epoch==generation && ui.value.selected==w && stored.credential?.token==c.token) result else null} catch(e:Exception) {handle(e);null}
    }
    fun acceptInvitation(token: String) = viewModelScope.launch {
        val client=api ?: return@launch;val c=stored.credential ?: return@launch
        if(ui.value.busy || !Regex("^[A-Za-z0-9_-]+$").matches(token)) return@launch
        val epoch=generation;mutable.update{it.copy(busy=true,error="")}
        try {
            client.call("invitations/$token",c.token,"POST",JSONObject().put("fullHistoryAccepted",true))
            if(epoch==generation && stored.credential?.token==c.token) refreshSession()
        } catch(e:Exception) {handle(e)} finally {mutable.update{it.copy(busy=false)}}
    }
    fun send(content: String, onSaved: () -> Unit = {}) { ui.value.selected?.let { prepare("message.send", it, content, onSaved = onSaved) } }
    fun create(name: String, onSaved: () -> Unit = {}) { prepare("workspace.create", UUID.randomUUID().toString(), name, onSaved = onSaved) }
    private fun prepare(type: String, workspace: String, content: String, commandJSON: String? = null, onSaved: () -> Unit = {}) = viewModelScope.launch {
        val c = stored.credential ?: return@launch
        if (ui.value.busy || content.isBlank()) return@launch
        mutable.update { it.copy(busy = true, error = "") }
        try {
            val command = PendingCommand(if (type == "workspace.create") workspace else UUID.randomUUID().toString(), c.base, c.user.id, workspace, type, content, commandJSON)
            persist { it.copy(pending = it.pending + command) }
            onSaved()
            transmit(command)
        } catch (e: Exception) { handle(e) }
        finally { mutable.update { it.copy(busy = false) } }
    }
    private suspend fun transmit(command: PendingCommand) {
        val client = api ?: throw ApiError("AUTHENTICATION_REQUIRED", 401)
        val c = stored.credential ?: throw ApiError("AUTHENTICATION_REQUIRED", 401)
        if (c.base != command.base || c.user.id != command.actor || c.logoutPending) throw ApiError("AUTHENTICATION_REQUIRED", 401)
        if (command.type == "workspace.create") {
            val result = client.call("workspaces", c.token, "POST", JSONObject().put("commandId", command.id).put("name", command.content))
            if (result.getString("id") != command.workspace) throw ApiError("INVALID_RECEIPT", 0)
        } else {
            val result = client.call("workspaces/${command.workspace}/commands", c.token, "POST", JSONObject().put("commandId", command.id).put("expectedActorId", c.user.id).put("command", command.commandJSON?.let { JSONObject(it) } ?: JSONObject().put("type", command.type).put("content", command.content)))
            if(command.type=="invitation.create" && stored.credential?.user?.id==command.actor && ui.value.selected==command.workspace) result.optJSONObject("result")?.optString("token")?.let { token->mutable.update{it.copy(invitationLink=result.optJSONObject("result")?.optString("invitationUrl")?.takeIf{url->url.isNotBlank()} ?: token)} }
            if(command.type=="voice.send" && stored.credential?.user?.id==command.actor && ui.value.selected==command.workspace) mutable.update{it.copy(voiceReplySourceId=result.optJSONObject("result")?.optString("sourceId"))}
            if (result.getString("commandId") != command.id || result.getString("status") != "committed") throw ApiError("INVALID_RECEIPT", 0)
        }
        forget(command.id)
        if (command.type == "workspace.create") mutable.update { it.copy(selected = command.workspace, workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, tasks = null, email = null, messages = emptyList()) }
        refreshSession(); sync(true); refreshActiveWork()
    }
    fun retry(command: PendingCommand) = viewModelScope.launch {
        if (ui.value.busy) return@launch; mutable.update { it.copy(busy = true, error = "") }
        try { transmit(command) } catch (e: Exception) { handle(e) } finally { mutable.update { it.copy(busy = false) } }
    }
    private suspend fun recoverKnown() {
        val client = api ?: return; val c = stored.credential ?: return
        for (command in ui.value.pending) {
            try {
                val receipt = client.call("workspaces/${command.workspace}/receipts/${command.id}", c.token)
                if (receipt.getString("commandId") != command.id || receipt.getString("status") != "committed") throw ApiError("INVALID_RECEIPT", 0)
                forget(command.id)
            } catch (e: ApiError) { if (e.status !in setOf(403,404)) throw e }
        }
    }
    fun discardReminder(command: PendingCommand) = viewModelScope.launch { try { forget(command.id) } catch (e: Exception) { handle(e) } }
    fun logout() = viewModelScope.launch { loop?.cancel(); completeLogout() }
    private suspend fun completeLogout() {
        val c = stored.credential ?: return; val client = api ?: return
        generation++; mutable.update { it.copy(workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, tasks = null, email = null, messages = emptyList(), spaces = emptyList(), selected = null) }
        try {
            persist { it.copy(credential = c.copy(logoutPending = true)) }
            try { client.call("native/session", c.token, "DELETE") } catch (e: ApiError) { if (e.status != 401) throw e }
            persist { it.copy(credential = null) }; mutable.update { it.copy(connection = "Disconnesso", error = "") }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            mutable.update { it.copy(error = "Logout da completare online. La sessione resta custodita per richiederne la revoca.") }
        }
    }
    private suspend fun handle(e: Exception) {
        if (e is CancellationException) throw e
        mutable.update { it.copy(error = e.message ?: "Connessione non disponibile") }
        if (e is ApiError) {
            if (e.status == 401 || e.code == "ACCOUNT_INELIGIBLE") {
                generation++
                persist { it.copy(credential = null) }
                mutable.update { it.copy(workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, tasks = null, email = null, messages = emptyList(), spaces = emptyList(), selected = null) }
            } else if (e.code == "WORKSPACE_ACCESS_DENIED") {
                generation++; mutable.update { it.copy(workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, tasks = null, email = null, messages = emptyList(), selected = null) }
            }
        }
    }
}
