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

data class AccountScope(val actorId: String, val apiBase: String, val sessionId: String)
data class UiState(
    val accountScope: AccountScope? = null,
    val voiceReplySourceId: String? = null, val ready: Boolean = false, val accountNotice: String = "", val invitationLink: String = "", val user: Person? = null, val logoutPending: Boolean = false,
    val spaces: List<Workspace> = emptyList(), val selected: String? = null,
    val workstreamFocus: WorkstreamFocus? = null, val messagesThrough: Int? = null,
    val activity: ActivityPage? = null, val activityRevision: Int? = null,
    val activityLoading: Boolean = false, val activityError: String = "",
    val activeWorkLoading: Boolean = false, val activeWorkError: String = "",
    val handoffs: List<ConversationHandoff> = emptyList(), val handoffRevision: Int? = null,
    val handoffLoading: Boolean = false, val handoffError: String = "",
    val workspace: WorkspaceState? = null, val detail: JSONObject? = null, val attention: JSONObject? = null, val messages: List<Message> = emptyList(),
    val hasOlder: Boolean = false, val pending: List<PendingCommand> = emptyList(), val busy: Boolean = false,
    val connection: String = "Non connesso", val error: String = "",
    val activeWork: JSONObject? = null, val tasks: JSONObject? = null, val email: JSONObject? = null, val calendar: JSONObject? = null, val calendarStart: String = java.time.LocalDate.now().toString()
)
fun UiState.focusIsCurrent(focus:WorkstreamFocus?=workstreamFocus):Boolean = focus==null || attention?.rows("workstreams")?.any {it.getString("id")==focus.workstreamId && it.getInt("version")==focus.version && it.getString("state")=="active"}==true
class WorkspaceModel(application: Application) : AndroidViewModel(application) {
    val media = WorkspaceMedia(application,viewModelScope)
    override fun onCleared(){media.close();super.onCleared()}
    private val vault = Vault(application)
    private var stored = VaultState()
    private val vaultLock = Mutex()
    private val syncLock = Mutex()
    private val activityLock = Mutex()
    private val handoffLock = Mutex()
    private val handoffSources = mutableSetOf<String>()
    // Navigation metadata only. History is reread through the current access boundary.
    private val historyStarts = mutableMapOf<Pair<String, WorkstreamFocus?>, Int>()
    private var handoffSourceWorkspace: String? = null
    private var api: Api? = null
    private var loop: Job? = null
    private var generation = 0
    private var activeWorkBefore = ""
    private var activeWorkLookup = 0
    private var tasksBefore = ""
    private var emailBefore = ""
    private var foreground = false
    private var publishedSessionToken: String? = null
    private val creationCallbacks = mutableMapOf<String, Pair<AccountScope, () -> Unit>>()
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
        val previous = ui.value.accountScope
        val accountScope = c?.takeUnless { it.logoutPending }?.let {
            if (previous != null && previous.actorId == it.user.id && previous.apiBase == it.base && publishedSessionToken == it.token) previous
            else AccountScope(it.user.id, it.base, UUID.randomUUID().toString())
        }
        publishedSessionToken = c?.token
        if (accountScope != previous) { creationCallbacks.clear(); handoffSources.clear(); handoffSourceWorkspace = null; historyStarts.clear() }
        mutable.update {
            val scoped=if(accountScope==previous)it else it.copy(spaces=emptyList(),selected=null,handoffs=emptyList(),handoffRevision=null,handoffLoading=false,handoffError="",activity=null,activityRevision=null,activityLoading=false,activityError="",workspace=null,detail=null,attention=null,calendar=null,activeWork=null,activeWorkLoading=false,activeWorkError="",tasks=null,email=null,messages=emptyList(),workstreamFocus=null,messagesThrough=null,hasOlder=false,invitationLink="")
            scoped.copy(user=c?.user,accountScope=accountScope,logoutPending=c?.logoutPending==true,pending=stored.pending.filter {p->p.actor==c?.user?.id && p.base==c.base})
        }
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
                    refreshSession(); sync(); refreshActiveWork(); loadAttention(); refreshActivity(); refreshHandoffs(); recoverKnown()
                    mutable.update { it.copy(connection = "Aggiornato") }; backoff = 2000
                } catch (e: Exception) {
                    handle(e); mutable.update { it.copy(connection = "Connessione da ripristinare · dati dell’ultimo aggiornamento") }
                    backoff = (backoff * 2).coerceAtMost(30000)
                }
                delay(backoff)
            }
        }
    }
    private fun rememberHistoryWindow() {
        val current=ui.value
        val workspace=current.selected ?: return
        if(current.messagesThrough!=null)current.messages.firstOrNull()?.let {historyStarts[workspace to current.workstreamFocus]=it.sequence}
    }
    fun select(id: String) { rememberHistoryWindow(); handoffSources.clear(); activeWorkBefore=""; tasksBefore=""; emailBefore=""; mutable.update { it.copy(selected = id, workstreamFocus=null,messagesThrough=null,hasOlder=false,handoffs = emptyList(), handoffRevision = null, handoffLoading = false, handoffError = "", activity = null, activityRevision = null, activityLoading = false, activityError = "", workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, activeWorkLoading = false, activeWorkError = "", tasks = null, email = null, messages = emptyList()) }; setForeground(foreground) }
    fun selectWorkstream(focus:WorkstreamFocus?) {
        if(ui.value.accountScope==null || ui.value.selected==null)return
        if(focus!=null && ui.value.attention?.rows("workstreams")?.none {it.getString("id")==focus.workstreamId && it.getInt("version")==focus.version}!=false) {
            mutable.update {it.copy(error="Il filone è cambiato o non è disponibile. Rileggi lo stato prima di selezionarlo.")};return
        }
        if(ui.value.workstreamFocus==focus)return
        rememberHistoryWindow()
        media.endDialog()
        mutable.update {it.copy(workstreamFocus=focus,messages=emptyList(),messagesThrough=null,hasOlder=false,error="")}
        setForeground(foreground)
    }
    private suspend fun refreshSession() {
        val client = api ?: return; val c = stored.credential ?: return; val epoch = generation
        client.call("native/session", c.token)
        val spaces = client.call("workspaces", c.token).rows("workspaces").map { Workspace(it.getString("id"), it.getString("name")) }
        currentCoroutineContext().ensureActive()
        if (epoch != generation || c.token != stored.credential?.token) return
        historyStarts.keys.removeAll {key -> spaces.none {it.id==key.first}}
        mutable.update { state ->
            if (spaces.none { it.id == state.selected }) state.copy(spaces = spaces, selected = spaces.firstOrNull()?.id, workstreamFocus=null,messagesThrough=null,handoffs = emptyList(), handoffRevision = null, handoffLoading = false, handoffError = "", activity = null, activityRevision = null, activityLoading = false, activityError = "", workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, activeWorkLoading = false, activeWorkError = "", tasks = null, email = null, messages = emptyList())
            else state.copy(spaces = spaces)
        }
    }
    private suspend fun sync(force: Boolean = false) {
        if (!syncLock.tryLock()) return
        try {
            val client = api ?: return; val c = stored.credential ?: return; val w = ui.value.selected ?: return; val epoch = generation
            val focus=ui.value.workstreamFocus
            val filter=focus?.let {"&workstreamId=${it.workstreamId}"}.orEmpty()
            val previous=ui.value
            var reset = false
            if (!force) ui.value.workspace?.let { current ->
                try {
                    val changes = client.call("workspaces/$w/changes?after=${current.revision}&limit=1", c.token)
                    if (changes.getInt("headRevision") == current.revision && ui.value.calendar != null && ui.value.messagesThrough==current.messageSequence) return
                } catch (e: ApiError) {
                    if (e.code in setOf("CURSOR_AHEAD", "SYNC_RESET_REQUIRED")) reset = true else throw e
                }
            }
            val state = client.call("workspaces/$w/state", c.token).workspaceState()
            var merged = previous.messages.toMutableList(); var older = previous.hasOlder
            var after=previous.messagesThrough ?: 0
            if (previous.workspace == null || previous.messagesThrough==null || reset || after > state.messageSequence || (focus!=null && previous.workspace.revision!=state.revision)) {
                val oldestLoaded=previous.messages.firstOrNull()?.sequence ?: historyStarts[w to focus]
                val page = client.call("workspaces/$w/history?through=${state.messageSequence}&limit=50$filter", c.token)
                if(page.getInt("through")!=state.messageSequence)throw ApiError("SYNC_INCOMPLETE",0)
                merged = page.rows("messages").map {it.message()}.toMutableList()
                older = page.getBoolean("hasMore")
                while(oldestLoaded!=null && older && (merged.firstOrNull()?.sequence ?: 0)>oldestLoaded) {
                    val before=merged.first().sequence
                    val prior=client.call("workspaces/$w/history?before=$before&through=${state.messageSequence}&limit=50$filter",c.token)
                    val rows=prior.rows("messages").map {it.message()}
                    if(prior.getInt("through")!=state.messageSequence || (prior.getBoolean("hasMore") && (rows.isEmpty() || rows.first().sequence>=before)))throw ApiError("SYNC_INCOMPLETE",0)
                    merged.addAll(0,rows);older=prior.getBoolean("hasMore")
                }
                after=state.messageSequence
            }
            while (after < state.messageSequence) {
                val page = client.call("workspaces/$w/messages?after=$after&through=${state.messageSequence}&limit=50$filter", c.token)
                if (page.getInt("through") != state.messageSequence || (page.getBoolean("hasMore") && page.getInt("nextAfter") <= after)) throw ApiError("SYNC_INCOMPLETE", 0)
                merged.addAll(page.rows("messages").map {it.message()})
                after = if(page.getBoolean("hasMore"))page.getInt("nextAfter") else state.messageSequence
            }
            val detail = client.call("workspaces/$w/workspace", c.token)
            val calendar = client.call("workspaces/$w/calendar?${calendarQuery()}", c.token)
            currentCoroutineContext().ensureActive()
            if (epoch != generation || ui.value.selected != w || ui.value.workstreamFocus!=focus || c.token != stored.credential?.token) return
            mutable.update { it.copy(workspace = state, detail = detail, calendar = calendar, messages = merged, messagesThrough=state.messageSequence,hasOlder = older, connection = "Aggiornato") }
        } finally { syncLock.unlock() }
    }
    fun loadActiveWork(before: String? = null) = viewModelScope.launch {
        activeWorkLookup++
        mutable.update { it.copy(activeWorkLoading = false, activeWorkError = "") }
        if(before != null) activeWorkBefore = before
        refreshActiveWork()
    }
    fun locateActiveWork(id: String) = viewModelScope.launch {
        val client = api ?: return@launch
        val credential = stored.credential ?: return@launch
        val account = ui.value.accountScope ?: return@launch
        val workspace = ui.value.selected ?: return@launch
        val epoch = generation
        val request = ++activeWorkLookup
        if (credential.logoutPending) return@launch
        mutable.update { it.copy(activeWorkLoading = true, activeWorkError = "") }
        try {
            var before = ""
            while (true) {
                val page = client.call("workspaces/$workspace/active-work" + if (before.isEmpty()) "" else "?before=${queryValue(before)}", credential.token)
                currentCoroutineContext().ensureActive()
                if (!scopeMatches(account, workspace, epoch) || request != activeWorkLookup) return@launch
                if (page.rows("works").any { it.getString("id") == id }) {
                    activeWorkBefore = before
                    mutable.update { it.copy(activeWork = page) }
                    break
                }
                if (page.isNull("next")) throw ApiError("WORK_NOT_FOUND", 404)
                val next = page.getString("next")
                if (next == before) throw ApiError("SYNC_INCOMPLETE", 0)
                before = next
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (scopeMatches(account, workspace, epoch) && request == activeWorkLookup) {
                mutable.update { it.copy(activeWorkError = e.message ?: "Il lavoro non è disponibile. Puoi riprovare.") }
                if (e is ApiError && (e.status == 401 || e.code in setOf("ACCOUNT_INELIGIBLE", "WORKSPACE_ACCESS_DENIED"))) handle(e)
            }
        } finally {
            if (scopeMatches(account, workspace, epoch) && request == activeWorkLookup) mutable.update { it.copy(activeWorkLoading = false) }
        }
    }
    private fun scopeMatches(account: AccountScope, workspace: String, epoch: Int) =
        ui.value.accountScope == account && ui.value.selected == workspace && generation == epoch && !ui.value.logoutPending

    fun loadHandoffs(sourceId: String? = null) = viewModelScope.launch { refreshHandoffs(force = true, sourceId = sourceId) }

    private suspend fun refreshHandoffs(force: Boolean = false, sourceId: String? = null) {
        val account = ui.value.accountScope ?: return
        val workspace = ui.value.selected ?: return
        val epoch = generation
        handoffLock.withLock {
            if (!scopeMatches(account, workspace, epoch)) return
            if (handoffSourceWorkspace != workspace) { handoffSources.clear(); handoffSourceWorkspace = workspace }
            val client = api ?: return
            val credential = stored.credential ?: return
            val revision = ui.value.workspace?.revision
            if (!force && ui.value.handoffRevision == revision) return
            mutable.update { it.copy(handoffLoading = true, handoffError = "") }
            try {
                val sources = if (sourceId == null) listOf<String?>(null) + handoffSources else listOf(sourceId)
                val incoming = mutableListOf<ConversationHandoff>()
                for (source in sources) {
                    val result = client.call("workspaces/$workspace/handoffs" + (source?.let { "?sourceId=${queryValue(it)}" } ?: ""), credential.token)
                    incoming.addAll(result.rows("handoffs").map { it.conversationHandoff() })
                }
                currentCoroutineContext().ensureActive()
                if (!scopeMatches(account, workspace, epoch)) return
                sourceId?.let { handoffSources.add(it) }
                val merged = (ui.value.handoffs + incoming).associateBy(ConversationHandoff::id).values.sortedBy(ConversationHandoff::createdAt)
                mutable.update { it.copy(handoffs = merged, handoffRevision = if (sourceId == null) revision else it.handoffRevision) }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (scopeMatches(account, workspace, epoch)) {
                    mutable.update { it.copy(handoffError = e.message ?: "Passaggi dalla conversazione non disponibili.") }
                    if (e is ApiError && (e.status == 401 || e.code in setOf("ACCOUNT_INELIGIBLE", "WORKSPACE_ACCESS_DENIED"))) handle(e)
                }
            } finally {
                if (scopeMatches(account, workspace, epoch)) mutable.update { it.copy(handoffLoading = false) }
            }
        }
    }

    fun loadActivity(older: Boolean = false) = viewModelScope.launch { refreshActivity(force = true, older = older) }

    private suspend fun refreshActivity(force: Boolean = false, older: Boolean = false) {
        if (!activityLock.tryLock()) return
        val account = ui.value.accountScope
        val workspace = ui.value.selected
        val epoch = generation
        try {
            val client = api ?: return
            val credential = stored.credential ?: return
            if (account == null || workspace == null || credential.logoutPending) return
            val previous = ui.value.activity
            val revision = ui.value.workspace?.revision
            if (!force && previous != null && ui.value.activityRevision == revision) return
            val before = if (older) previous?.next ?: return else null
            mutable.update { it.copy(activityLoading = true, activityError = "") }
            var page = client.call("workspaces/$workspace/activity?limit=40" + (before?.let { "&before=${queryValue(it)}" } ?: ""), credential.token).activityPage()
            val events = page.events.toMutableList()
            // Reload the retained range when shared state changes, including late published historical sources.
            val oldest = previous?.events?.lastOrNull()?.eventId
            while (!older && oldest != null && page.next != null && events.none { it.eventId == oldest }) {
                val cursor = page.next!!
                page = client.call("workspaces/$workspace/activity?limit=40&before=${queryValue(cursor)}", credential.token).activityPage()
                if (page.next == cursor) throw ApiError("SYNC_INCOMPLETE", 0)
                events.addAll(page.events)
            }
            currentCoroutineContext().ensureActive()
            if (!scopeMatches(account, workspace, epoch)) return
            val merged = if (older) previous!!.events + events else events
            mutable.update { it.copy(activity = ActivityPage(merged.distinctBy(ActivityEvent::eventId), page.next), activityRevision = revision) }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (account != null && workspace != null && scopeMatches(account, workspace, epoch)) {
                mutable.update { it.copy(activityError = e.message ?: "Attività non disponibile. Puoi riprovare.") }
                if (e is ApiError && (e.status == 401 || e.code in setOf("ACCOUNT_INELIGIBLE", "WORKSPACE_ACCESS_DENIED"))) handle(e)
            }
        } finally {
            if (account != null && workspace != null && scopeMatches(account, workspace, epoch)) mutable.update { it.copy(activityLoading = false) }
            activityLock.unlock()
        }
    }

    suspend fun referenceDetail(reference: ConversationReference): ReferenceDetail? {
        val client = api ?: return null
        val credential = stored.credential ?: return null
        val account = ui.value.accountScope ?: return null
        val workspace = ui.value.selected ?: return null
        val epoch = generation
        if (credential.logoutPending) return null
        return try {
            val detail = client.call("workspaces/$workspace/reference?${reference.query()}", credential.token).referenceDetail()
            currentCoroutineContext().ensureActive()
            if (detail.reference != reference) throw ApiError("REFERENCE_EVENT_MISMATCH", 0)
            if (scopeMatches(account, workspace, epoch)) detail else null
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (!scopeMatches(account, workspace, epoch)) return null
            if (e is ApiError && (e.status == 401 || e.code in setOf("ACCOUNT_INELIGIBLE", "WORKSPACE_ACCESS_DENIED"))) handle(e)
            throw e
        }
    }
    private suspend fun refreshActiveWork() {
        val client = api ?: return; val c = stored.credential ?: return; val w = ui.value.selected ?: return
        if(c.logoutPending) return
        val epoch = generation; val page = activeWorkBefore; val request = activeWorkLookup
        try {
            val result = client.call("workspaces/$w/active-work" + if(page.isEmpty()) "" else "?before=$page", c.token)
            currentCoroutineContext().ensureActive()
            if(epoch == generation && ui.value.selected == w && c.token == stored.credential?.token && stored.credential?.logoutPending != true && activeWorkBefore == page && request == activeWorkLookup && !ui.value.activeWorkLoading) mutable.update { it.copy(activeWork = result) }
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
        val accountScope=ui.value.accountScope;val selected=ui.value.selected;val focus=ui.value.workstreamFocus;val epoch=generation
        if (!syncLock.tryLock()) return@launch
        try {
            val client = api ?: return@launch; val c = stored.credential ?: return@launch; val w = ui.value.selected ?: return@launch
            val state = ui.value.workspace ?: return@launch; val first = ui.value.messages.firstOrNull() ?: return@launch
            val filter=focus?.let {"&workstreamId=${it.workstreamId}"}.orEmpty()
            val page = client.call("workspaces/$w/history?before=${first.sequence}&through=${state.messageSequence}&limit=50$filter", c.token)
            val older = page.rows("messages").map {it.message()}
            currentCoroutineContext().ensureActive()
            if (epoch == generation && ui.value.selected == w && ui.value.workstreamFocus==focus && c.token == stored.credential?.token) mutable.update { it.copy(messages = older + it.messages, hasOlder = page.getBoolean("hasMore")) }
        } catch (e: Exception) {if(e is CancellationException)throw e;if(epoch==generation && ui.value.accountScope==accountScope && ui.value.selected==selected && ui.value.workstreamFocus==focus)handle(e)} finally { syncLock.unlock() }
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
    suspend fun locateTask(id: String): JSONObject? {
        val client = api ?: return null
        val credential = stored.credential ?: return null
        val account = ui.value.accountScope ?: return null
        val workspace = ui.value.selected ?: return null
        val epoch = generation
        var before = ""
        while (true) {
            val page = client.call("workspaces/$workspace/tasks" + if (before.isEmpty()) "" else "?before=${queryValue(before)}", credential.token)
            currentCoroutineContext().ensureActive()
            if (!scopeMatches(account, workspace, epoch)) return null
            page.rows("tasks").firstOrNull { it.getString("id") == id }?.let { task ->
                tasksBefore = before
                mutable.update { it.copy(tasks = page) }
                return task
            }
            if (page.isNull("next")) return null
            val next = page.getString("next")
            if (next == before) throw ApiError("SYNC_INCOMPLETE", 0)
            before = next
        }
    }
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
    suspend fun mediaSubmit(body:JSONObject,label:String,onSaved:()->Unit={}) {
        val c=stored.credential?:throw ApiError("AUTHENTICATION_REQUIRED",401);val w=ui.value.selected?:throw ApiError("WORKSPACE_ACCESS_DENIED",403)
        val accountScope=ui.value.accountScope
        if(ui.value.busy||c.logoutPending)throw ApiError("COMMAND_BUSY",409)
        mutable.update{it.copy(busy=true,error="")}
        try {
            val pending=PendingCommand(UUID.randomUUID().toString(),c.base,c.user.id,w,body.getString("type"),label,body.toString())
            persist{it.copy(pending=it.pending+pending)}
            if(ui.value.accountScope!=accountScope || ui.value.selected!=w)throw CancellationException()
            onSaved()
            transmit(pending)
        } finally {if(ui.value.accountScope==accountScope)mutable.update{it.copy(busy=false)}}
    }
    suspend fun workspaceRead(resource:String):JSONObject? {
        val client=api ?: return null
        val credential=stored.credential ?: return null
        val account=ui.value.accountScope ?: return null
        val workspace=ui.value.selected ?: return null
        val epoch=generation
        if(credential.logoutPending)return null
        return try {
            val result=client.call("workspaces/$workspace/$resource",credential.token)
            currentCoroutineContext().ensureActive()
            if(scopeMatches(account,workspace,epoch) && stored.credential?.token==credential.token)result else null
        } catch(e:Exception) {
            if(e is CancellationException)throw e
            if(scopeMatches(account,workspace,epoch) && stored.credential?.token==credential.token)handle(e)
            null
        }
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
    fun send(content: String, workstreamFocus:WorkstreamFocus?=ui.value.workstreamFocus,reference:ConversationReference?=null,onSaved: () -> Unit = {}) {
        if(workstreamFocus!=ui.value.workstreamFocus || !ui.value.focusIsCurrent(workstreamFocus)) {mutable.update{it.copy(error="La selezione del filone è cambiata. Rileggila prima di inviare; la bozza è conservata.")};return}
        val body=command("message.send","content" to content)
        workstreamFocus?.let {body.put("workstreamFocus",it.toJSON())}
        reference?.let { body.put("reference", it.toJSON()) }
        ui.value.selected?.let {prepare("message.send",it,content,body.toString(),onSaved=onSaved)}
    }
    fun create(name: String, description: String = "", onSaved: () -> Unit = {}) { prepare("workspace.create", UUID.randomUUID().toString(), name, JSONObject().put("name",name).put("description",description).toString(), onCommitted = onSaved) }
    private fun prepare(type: String, workspace: String, content: String, commandJSON: String? = null, onSaved: () -> Unit = {}, onCommitted: () -> Unit = {}) = viewModelScope.launch {
        val c = stored.credential ?: return@launch
        val accountScope = ui.value.accountScope ?: return@launch
        if (ui.value.busy || c.logoutPending || content.isBlank()) return@launch
        mutable.update { it.copy(busy = true, error = "") }
        try {
            val command = PendingCommand(if (type == "workspace.create") workspace else UUID.randomUUID().toString(), c.base, c.user.id, workspace, type, content, commandJSON)
            persist { it.copy(pending = it.pending + command) }
            if (ui.value.accountScope != accountScope) return@launch
            if (type == "workspace.create") {
                if (ui.value.accountScope != accountScope) return@launch
                creationCallbacks[command.id] = accountScope to onCommitted
            }
            onSaved()
            transmit(command)
        } catch (e: Exception) { if (e is CancellationException) throw e; if (ui.value.accountScope == accountScope) handle(e) }
        finally { if (ui.value.accountScope == accountScope) mutable.update { it.copy(busy = false) } }
    }
    private suspend fun transmit(command: PendingCommand) {
        val client = api ?: throw ApiError("AUTHENTICATION_REQUIRED", 401)
        val c = stored.credential ?: throw ApiError("AUTHENTICATION_REQUIRED", 401)
        val accountScope = ui.value.accountScope
        if (c.base != command.base || c.user.id != command.actor || c.logoutPending) throw ApiError("AUTHENTICATION_REQUIRED", 401)
        if (command.type == "workspace.create") {
            val body = command.commandJSON?.let { JSONObject(it) } ?: JSONObject().put("name",command.content)
            val result = client.call("workspaces", c.token, "POST", body.put("commandId",command.id).put("expectedActorId",c.user.id))
            if (result.getString("id") != command.workspace) throw ApiError("INVALID_RECEIPT", 0)
        } else {
            val result = client.call("workspaces/${command.workspace}/commands", c.token, "POST", JSONObject().put("commandId", command.id).put("expectedActorId", c.user.id).put("command", command.commandJSON?.let { JSONObject(it) } ?: JSONObject().put("type", command.type).put("content", command.content)))
            if (result.getString("commandId") != command.id || result.getString("status") != "committed") throw ApiError("INVALID_RECEIPT", 0)
            if (ui.value.accountScope == accountScope && c.token == stored.credential?.token && ui.value.selected == command.workspace && stored.credential?.logoutPending != true) {
                val payload = result.optJSONObject("result")
                if (command.type == "invitation.create") payload?.optString("token")?.let { token ->
                    mutable.update { it.copy(invitationLink = payload.optString("invitationUrl").takeIf(String::isNotBlank) ?: token) }
                }
                if (command.type == "voice.send") mutable.update { it.copy(voiceReplySourceId = payload?.optString("sourceId")) }
            }
        }
        forget(command.id)
        if(ui.value.accountScope!=accountScope || c.token!=stored.credential?.token || stored.credential?.logoutPending==true)return
        if (command.type == "workspace.create") {
            val callback = creationCallbacks.remove(command.id)
            if (ui.value.accountScope != accountScope || c.token != stored.credential?.token || stored.credential?.logoutPending == true) return
            mutable.update { it.copy(selected = command.workspace, workstreamFocus=null,messagesThrough=null,handoffs = emptyList(), handoffRevision = null, handoffLoading = false, handoffError = "", activity = null, activityRevision = null, activityLoading = false, activityError = "", workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, activeWorkLoading = false, activeWorkError = "", tasks = null, email = null, messages = emptyList()) }
            if (callback != null && callback.first == accountScope) callback.second()
        }
        val refreshWorkspace=ui.value.selected
        val refreshEpoch=generation
        try {
            refreshSession(); sync(true); refreshActiveWork(); refreshActivity(); refreshHandoffs(force = true)
        } catch(e:Exception) {
            if(e is CancellationException)throw e
            if(ui.value.accountScope==accountScope && stored.credential?.token==c.token && generation==refreshEpoch && ui.value.selected==refreshWorkspace) {
                handle(e)
                mutable.update {it.copy(error="Operazione confermata. Aggiornamento dello spazio da completare: ${e.message ?: "connessione non disponibile"}")}
            }
        }
    }
    fun retry(command: PendingCommand) = viewModelScope.launch {
        val accountScope = ui.value.accountScope ?: return@launch
        if (command.actor != accountScope.actorId || command.base != accountScope.apiBase) return@launch
        if (ui.value.busy) return@launch; mutable.update { it.copy(busy = true, error = "") }
        try { transmit(command) } catch (e: Exception) { if (e is CancellationException) throw e; if (ui.value.accountScope == accountScope) handle(e) } finally { if (ui.value.accountScope == accountScope) mutable.update { it.copy(busy = false) } }
    }
    private suspend fun recoverKnown() {
        val client = api ?: return; val c = stored.credential ?: return
        val accountScope = ui.value.accountScope
        for (command in ui.value.pending) {
            try {
                val receipt = client.call("workspaces/${command.workspace}/receipts/${command.id}", c.token)
                if (receipt.getString("commandId") != command.id || receipt.getString("status") != "committed") throw ApiError("INVALID_RECEIPT", 0)
                forget(command.id)
                if (command.type == "workspace.create") {
                    val callback = creationCallbacks.remove(command.id)
                    if (ui.value.accountScope != accountScope || c.token != stored.credential?.token || stored.credential?.logoutPending == true) return
                    if (callback != null && callback.first == accountScope) {
                        mutable.update { it.copy(selected = command.workspace, workstreamFocus=null,messagesThrough=null,handoffs = emptyList(), handoffRevision = null, handoffLoading = false, handoffError = "", activity = null, activityRevision = null, activityLoading = false, activityError = "", workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, activeWorkLoading = false, activeWorkError = "", tasks = null, email = null, messages = emptyList()) }
                        callback.second()
                    }
                }
            } catch (e: ApiError) { if (e.status !in setOf(403,404)) throw e }
        }
    }
    fun discardReminder(command: PendingCommand) = viewModelScope.launch {
        val accountScope = ui.value.accountScope ?: return@launch
        if (command.actor != accountScope.actorId || command.base != accountScope.apiBase) return@launch
        try { forget(command.id);creationCallbacks.remove(command.id) } catch (e: Exception) { if (e is CancellationException) throw e; if (ui.value.accountScope == accountScope) handle(e) }
    }
    fun logout() = viewModelScope.launch { loop?.cancel(); completeLogout() }
    private suspend fun completeLogout() {
        val c = stored.credential ?: return; val client = api ?: return
        creationCallbacks.clear()
        generation++; mutable.update { it.copy(busy = false, accountScope = null, workstreamFocus=null,messagesThrough=null,handoffs = emptyList(), handoffRevision = null, handoffLoading = false, handoffError = "", activity = null, activityRevision = null, activityLoading = false, activityError = "", workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, activeWorkLoading = false, activeWorkError = "", tasks = null, email = null, messages = emptyList(), spaces = emptyList(), selected = null) }
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
                mutable.update { it.copy(busy = false, workstreamFocus=null,messagesThrough=null,handoffs = emptyList(), handoffRevision = null, handoffLoading = false, handoffError = "", activity = null, activityRevision = null, activityLoading = false, activityError = "", workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, activeWorkLoading = false, activeWorkError = "", tasks = null, email = null, messages = emptyList(), spaces = emptyList(), selected = null) }
            } else if (e.code == "WORKSPACE_ACCESS_DENIED") {
                generation++; mutable.update { it.copy(workstreamFocus=null,messagesThrough=null,handoffs = emptyList(), handoffRevision = null, handoffLoading = false, handoffError = "", activity = null, activityRevision = null, activityLoading = false, activityError = "", workspace = null, detail = null, attention = null, invitationLink = "", calendar = null, activeWork = null, activeWorkLoading = false, activeWorkError = "", tasks = null, email = null, messages = emptyList(), selected = null) }
            }
        }
    }
}
