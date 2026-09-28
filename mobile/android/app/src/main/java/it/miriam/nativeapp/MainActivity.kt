package it.miriam.nativeapp

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.SaveableStateHolder
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch

private val MiriamLightColors = lightColorScheme(
    primary=Color(0xFF087443),
    onPrimary=Color.White,
    primaryContainer=Color(0xFFEDF1EA),
    onPrimaryContainer=Color(0xFF087443),
    secondary=Color(0xFF713AB7),
    onSecondary=Color.White,
    secondaryContainer=Color(0xFFF1EAF9),
    onSecondaryContainer=Color(0xFF713AB7),
    tertiary=Color(0xFFA94B00),
    onTertiary=Color.White,
    tertiaryContainer=Color(0xFFFFF0DF),
    onTertiaryContainer=Color(0xFFA94B00),
    background=Color(0xFFF7F8F5),
    surface=Color.White,
    onBackground=Color(0xFF202A23),
    onSurface=Color(0xFF202A23),
    surfaceVariant=Color(0xFFEDF1EA),
    onSurfaceVariant=Color(0xFF5D6C61),
    outline=Color(0xFF89988C),
    outlineVariant=Color(0xFF89988C),
    error=Color(0xFF963F34),
    inverseSurface=Color(0xFF1A211C),
    inverseOnSurface=Color(0xFFEDF3EC),
    inversePrimary=Color(0xFF8DDBAB),
    surfaceTint=Color(0xFF087443),
    surfaceDim=Color(0xFFEDF1EA),
    surfaceBright=Color.White,
    surfaceContainerLowest=Color.White,
    surfaceContainerLow=Color.White,
    surfaceContainer=Color(0xFFF7F8F5),
    surfaceContainerHigh=Color(0xFFEDF1EA),
    surfaceContainerHighest=Color(0xFFEDF1EA)
)
private val MiriamDarkColors = darkColorScheme(
    primary=Color(0xFF8DDBAB),
    onPrimary=Color(0xFF103821),
    primaryContainer=Color(0xFF253028),
    onPrimaryContainer=Color(0xFF8DDBAB),
    secondary=Color(0xFFC5A3F0),
    onSecondary=Color(0xFF30253F),
    secondaryContainer=Color(0xFF30253F),
    onSecondaryContainer=Color(0xFFC5A3F0),
    tertiary=Color(0xFFFFBD76),
    onTertiary=Color(0xFF3B2D1D),
    tertiaryContainer=Color(0xFF3B2D1D),
    onTertiaryContainer=Color(0xFFFFBD76),
    background=Color(0xFF111613),
    surface=Color(0xFF1A211C),
    onBackground=Color(0xFFEDF3EC),
    onSurface=Color(0xFFEDF3EC),
    surfaceVariant=Color(0xFF253028),
    onSurfaceVariant=Color(0xFFB0BEB3),
    outline=Color(0xFF627568),
    outlineVariant=Color(0xFF627568),
    error=Color(0xFFFFB3A6),
    inverseSurface=Color.White,
    inverseOnSurface=Color(0xFF202A23),
    inversePrimary=Color(0xFF087443),
    surfaceTint=Color(0xFF8DDBAB),
    surfaceDim=Color(0xFF111613),
    surfaceBright=Color(0xFF253028),
    surfaceContainerLowest=Color(0xFF111613),
    surfaceContainerLow=Color(0xFF1A211C),
    surfaceContainer=Color(0xFF1A211C),
    surfaceContainerHigh=Color(0xFF253028),
    surfaceContainerHighest=Color(0xFF253028)
)
private val MiriamTypography = Typography().let { it.copy(headlineLarge=it.headlineLarge.copy(fontFamily=FontFamily.Serif,fontWeight=FontWeight.Bold),headlineMedium=it.headlineMedium.copy(fontFamily=FontFamily.Serif,fontWeight=FontWeight.Bold),headlineSmall=it.headlineSmall.copy(fontFamily=FontFamily.Serif,fontWeight=FontWeight.Bold),titleLarge=it.titleLarge.copy(fontWeight=FontWeight.SemiBold),titleMedium=it.titleMedium.copy(fontWeight=FontWeight.SemiBold)) }
internal class ConversationPosition {
    val list = LazyListState()
    var anchor: String? = null
    var anchorOffset = 0
    var followsLatest = true
    var requested by mutableIntStateOf(0)
    var consumed = 0
}
internal class WorkspacePresentation {
    val destination = mutableStateOf("")
    val draft = mutableStateOf("")
    val draftFocus = mutableStateOf<WorkstreamFocus?>(null)
    val draftReference = mutableStateOf<AttachedReference?>(null)
    val handoff = mutableStateOf<ConversationHandoff?>(null)
    val handoffMessages = mutableStateListOf<String>()
    val referenceTrail = mutableStateListOf<ConversationReference>()
    val referenceOrigin = mutableStateOf("")
    val focusedWork = mutableStateOf<String?>(null)
    val conversations = mutableMapOf<String,ConversationPosition>()
    val scrollPositions = mutableMapOf<String,ScrollState>()
}
internal class WorkspacePresentationStore : ViewModel() {
    private var account: AccountScope? = null
    private val workspaces = mutableMapOf<String, WorkspacePresentation>()
    fun forAccount(scope: AccountScope): MutableMap<String, WorkspacePresentation> {
        if (account != scope) { workspaces.clear(); account = scope }
        return workspaces
    }
    fun clearAccount(): MutableMap<String, WorkspacePresentation> {
        workspaces.clear(); account = null
        return workspaces
    }
}
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState);enableEdgeToEdge();setContent { MaterialTheme(colorScheme=if(isSystemInDarkTheme()) MiriamDarkColors else MiriamLightColors,typography=MiriamTypography,shapes=Shapes(small=RoundedCornerShape(8.dp),medium=RoundedCornerShape(12.dp),large=RoundedCornerShape(16.dp))) { val model:WorkspaceModel=viewModel();Column {CallStatusBanner(model);Box(Modifier.weight(1f)){MiriamScreen(model)}} } } }
}
@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable fun MiriamScreen(model: WorkspaceModel = viewModel()) {
    val state by model.ui.collectAsStateWithLifecycle()
    val context=LocalContext.current
    val focusManager=LocalFocusManager.current
    val scope=rememberCoroutineScope()
    var server by remember { mutableStateOf(if(BuildConfig.DEBUG) "http://10.0.2.2:3002" else "") }
    var accountMode by remember {mutableStateOf("login")};var accountName by remember {mutableStateOf("")}
    var email by remember { mutableStateOf("") };var password by remember { mutableStateOf("") }
    val presentationStore: WorkspacePresentationStore = viewModel()
    val presentations = state.accountScope?.let(presentationStore::forAccount) ?: presentationStore.clearAccount()
    val presentation = presentations.getOrPut(state.selected.orEmpty()) { WorkspacePresentation() }
    val lensStateHolder = key(state.accountScope) { rememberSaveableStateHolder() }
    val homeScroll=rememberSaveable(state.accountScope,saver=LazyListState.Saver) {LazyListState()}
    var draft by presentation.draft
    var draftFocus by presentation.draftFocus
    var draftReference by presentation.draftReference
    var handoff by presentation.handoff
    var destination by presentation.destination
    var focusedWork by presentation.focusedWork
    var workspaceName by rememberSaveable(state.accountScope) { mutableStateOf("") }
    var workspaceDescription by rememberSaveable(state.accountScope) { mutableStateOf("") }
    var discard by remember(state.accountScope) { mutableStateOf<PendingCommand?>(null) }
    val trimmedWorkspaceName = workspaceName.trim()
    val workspaceNameLength = trimmedWorkspaceName.codePointCount(0, trimmedWorkspaceName.length)
    val trimmedWorkspaceDescription = workspaceDescription.trim()
    val workspaceDescriptionLength = trimmedWorkspaceDescription.codePointCount(0, trimmedWorkspaceDescription.length)
    val pendingCreations = state.pending.filter { it.type == "workspace.create" }
    var home by rememberSaveable(state.accountScope) { mutableStateOf(true) }
    var createdWorkspace by rememberSaveable(state.accountScope) { mutableStateOf<String?>(null) }
    var toolsOpen by rememberSaveable(state.accountScope,state.selected) { mutableStateOf(false) }
    val draftMatchesFocus=draft.isBlank() || draftFocus==state.workstreamFocus
    val canSendDraft=!state.busy && draft.isNotBlank() && draftMatchesFocus && state.focusIsCurrent()
    val conversationKey=state.workstreamFocus?.let {"${it.workstreamId}:${it.version}"}.orEmpty()
    val conversationPosition=presentation.conversations.getOrPut(conversationKey) {ConversationPosition()}
    var positionAttached by remember(conversationPosition,home) {mutableStateOf(false)}
    val currentMessages by rememberUpdatedState(state.messages)
    val historyReady by rememberUpdatedState(!home && state.messagesThrough!=null)
    LaunchedEffect(conversationPosition,home) {
        snapshotFlow {conversationPosition.list.layoutInfo to conversationPosition.list.isScrollInProgress}.collect {(layout,scrolling)->
            if(positionAttached && historyReady) {
                if(scrolling)conversationPosition.followsLatest=!conversationPosition.list.canScrollForward
                val visible=layout.visibleItemsInfo.firstOrNull {item -> currentMessages.any {it.id==item.key}}
                if(visible!=null) {
                    conversationPosition.anchor=visible.key as String
                    conversationPosition.anchorOffset=(-visible.offset).coerceAtLeast(0)
                }
            }
        }
    }
    LaunchedEffect(conversationPosition,home,state.messages.firstOrNull()?.id,state.messages.lastOrNull()?.id,state.messagesThrough,conversationPosition.requested) {
        if(!home && state.messagesThrough!=null) {
            withFrameNanos { }
            val count=conversationPosition.list.layoutInfo.totalItemsCount
            if(count>0) {
                if(conversationPosition.requested!=conversationPosition.consumed || conversationPosition.followsLatest) {
                    conversationPosition.list.scrollToItem(count-1)
                    conversationPosition.followsLatest=true
                    conversationPosition.consumed=conversationPosition.requested
                } else if(!positionAttached) {
                    val anchorIndex=state.messages.indexOfFirst {it.id==conversationPosition.anchor}
                    if(anchorIndex>=0) {
                        val prefix=count-state.messages.size-state.pending.size-(if(state.error.isNotEmpty())1 else 0)
                        conversationPosition.list.scrollToItem((prefix+anchorIndex).coerceIn(0,count-1),conversationPosition.anchorOffset)
                    } else conversationPosition.list.scrollToItem(0)
                }
                positionAttached=true
            }
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { model.setForeground(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { model.setForeground(false);model.media.endDialog();model.media.discard();model.media.stopPlayback() }
    LaunchedEffect(state.selected,state.accountScope,state.logoutPending) {model.media.bind(model)}
    LaunchedEffect(state.spaces,state.accountScope,state.busy) {
        if(state.ready && !state.busy) presentations.keys.filter {id -> id.isNotEmpty() && state.spaces.none {it.id==id}}.forEach {id ->
            presentations.remove(id)
            listOf("","goal","context","work","artifacts","activity","attention","sources","people","email","calendar","tasks","questions","voice","calls","reference").forEach {lensStateHolder.removeState("$id:$it")}
        }
    }
    fun referenceBack() {
        if (presentation.referenceTrail.size > 1) presentation.referenceTrail.removeAt(presentation.referenceTrail.lastIndex)
        else destination = presentation.referenceOrigin.value
    }
    BackHandler(!home || toolsOpen) {
        if (toolsOpen) {
            if (destination == "reference") referenceBack()
            else if (destination.isNotEmpty()) destination = ""
            else toolsOpen = false
        } else home = true
    }
    fun openBrowser(url:String) { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url))) }
    fun navigate(target:String) { focusManager.clearFocus();if(target=="work")focusedWork=null;destination=target;toolsOpen=true }
    fun inspectWork(id:String) {navigate("work");focusedWork=id}
    fun prepareHandoff(value: ConversationHandoff) {
        if (model.ui.value.accountScope != state.accountScope || model.ui.value.selected != state.selected) return
        handoff = if (value.kind in setOf("email.prepare", "calendar.prepare")) null else value
        model.loadHandoffs(value.sourceId)
        navigate(handoffDestination(value.kind))
    }
    fun inspectReference(reference: ConversationReference) {
        if (destination != "reference") {
            presentation.referenceOrigin.value = if (toolsOpen) destination else ""
            presentation.referenceTrail.clear()
        }
        if (presentation.referenceTrail.lastOrNull() != reference) presentation.referenceTrail.add(reference)
        navigate("reference")
    }
    fun discussReference(detail: ReferenceDetail) {
        if (model.ui.value.accountScope != state.accountScope || model.ui.value.selected != state.selected) return
        if (draft.isBlank()) draftFocus = state.workstreamFocus
        draftReference = AttachedReference(detail.reference, detail.title)
        toolsOpen = false
    }
    fun focusConversation(focus:WorkstreamFocus) {model.selectWorkstream(focus);if(model.ui.value.workstreamFocus==focus){focusManager.clearFocus();toolsOpen=false}}
    fun sendDraft(toMiriam:Boolean) {
        val sent=draft;val focus=draftFocus;val attachment=draftReference
        if(!canSendDraft || model.ui.value.accountScope!=state.accountScope || model.ui.value.selected!=state.selected || model.ui.value.workstreamFocus!=focus)return
        model.send(if(toMiriam)"@Miriam $sent" else sent,focus,attachment?.reference) {
            if(draft==sent && draftFocus==focus && draftReference==attachment) {draft="";draftReference=null}
            conversationPosition.requested++
        }
    }
    fun connect(capability:String) { val account=state.accountScope;scope.launch {model.connectGoogle(capability)?.let {url -> if(model.ui.value.accountScope==account) openBrowser(url)}} }
    val speech=rememberSpeechPlayback("${state.accountScope}:${state.selected}:$home:${state.logoutPending}")
    val wide=with(LocalDensity.current) {LocalWindowInfo.current.containerSize.width.toDp()>=840.dp}
    val compactHeight=with(LocalDensity.current) {LocalWindowInfo.current.containerSize.height.toDp()<500.dp}
    CompositionLocalProvider(
        LocalOpenReference provides ::inspectReference, LocalOpenWork provides ::inspectWork, LocalOpenCapability provides ::navigate,
        LocalSelectedHandoff provides handoff, LocalDetachHandoff provides { handoff = null }, LocalOpenHandoff provides ::prepareHandoff
    ) {
    Scaffold(topBar={TopAppBar(title={
        if(home || state.user==null) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Image(painter=painterResource(R.drawable.rimiam_mark),contentDescription=null,modifier=Modifier.size(28.dp))
                Text("RIMIAM",maxLines=1,overflow=TextOverflow.Ellipsis)
            }
        } else Column {
            Text(state.workspace?.name ?: state.spaces.firstOrNull {it.id==state.selected}?.name ?: "Workspace",maxLines=1,overflow=TextOverflow.Ellipsis)
            Text("Conversazione condivisa",style=MaterialTheme.typography.labelSmall)
        }
    },navigationIcon={if(!home && state.user!=null) TextButton(onClick={focusManager.clearFocus();toolsOpen=false;home=true}) {Text("Home")}},actions={if(state.user!=null && !state.logoutPending) {if(!home) TextButton(onClick={focusManager.clearFocus();toolsOpen=!toolsOpen},modifier=Modifier.testTag("tools-open")) {Text("Lo spazio")} else TextButton(onClick={model.logout()},modifier=Modifier.testTag("logout")) {Text("Esci")}}})}
    ) {insets ->
        Row(Modifier.padding(insets).consumeWindowInsets(insets).imePadding().fillMaxSize()) {
            Column(Modifier.weight(1f).fillMaxHeight()) {
            if(!home && state.user!=null && !state.logoutPending) ConversationActivity(state,compactHeight,onWork=::inspectWork,onAllWork={navigate("work")},onActivity={focusedWork=null;navigate("activity")})
            LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("content").padding(horizontal=20.dp),state=if(home) homeScroll else conversationPosition.list,verticalArrangement=Arrangement.spacedBy(14.dp),contentPadding=PaddingValues(vertical=16.dp)) {
                if(!state.ready) item {CircularProgressIndicator()}
                else if(state.logoutPending) item {Text("Logout da completare");Text(state.error);Button(onClick={model.logout()}) {Text("Riprova revoca")}}
                else if(state.user==null) {
                    item {Text("Le cose prendono forma, insieme.",style=MaterialTheme.typography.headlineMedium);Spacer(Modifier.height(8.dp));Text("Uno spazio per parlarne, ritrovare il filo e costruire con Miriam.")}
                    item {Row {listOf("login" to "Accedi","register" to "Registrati","request-password-reset" to "Recupera").forEach {(mode,label)->FilterChip(accountMode==mode,onClick={accountMode=mode},label={Text(label)})}}}
                    if(accountMode=="register") item {OutlinedTextField(accountName,{accountName=it},label={Text("Nome")},modifier=Modifier.fillMaxWidth());Text("Password: almeno 12 caratteri",style=MaterialTheme.typography.bodySmall)}
                    item {OutlinedTextField(email,{email=it},label={Text("Email")},modifier=Modifier.fillMaxWidth().testTag("email"),singleLine=true)}
                    if(accountMode!="request-password-reset") item {OutlinedTextField(password,{password=it},label={Text("Password")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth().testTag("password"),singleLine=true)}
                    item {Button(onClick={val secret=password;password="";if(accountMode=="login") model.login(server,email,secret) else model.requestAccount(server,accountMode,email,accountName,secret)},enabled=!state.busy && email.isNotBlank() && (accountMode=="request-password-reset" || password.isNotEmpty()) && (accountMode!="register" || (accountName.isNotBlank() && password.length>=12)),modifier=Modifier.testTag("login")) {Text(if(accountMode=="login") "Accedi" else if(accountMode=="register") "Crea account" else "Richiedi recupero")}}
                    if(accountMode=="login") item {TextButton(onClick={model.requestAccount(server,"send-verification",email)},enabled=!state.busy && email.isNotBlank()) {Text("Richiedi nuova verifica email")}}
                    if(state.accountNotice.isNotEmpty()) item {Text(state.accountNotice,style=MaterialTheme.typography.bodySmall)}
                    item {TextButton(onClick={openBrowser(webBase(server))},enabled=server.startsWith("https://") || (BuildConfig.DEBUG && server.startsWith("http://"))) {Text("Crea account o recupera accesso")}}
                    item {OutlinedTextField(server,{server=it},label={Text("Server HTTPS (locale in debug)")},modifier=Modifier.fillMaxWidth().testTag("server"),singleLine=true)}
                } else if(home || state.selected==null) {
                    item {Text("Da dove ripartiamo?",style=MaterialTheme.typography.headlineMedium);Spacer(Modifier.height(8.dp));Text("I vostri spazi. Le conversazioni e ciò che avete costruito insieme.",style=MaterialTheme.typography.bodyLarge)}
                    item {Text("I tuoi spazi",style=MaterialTheme.typography.titleLarge)}
                    items(state.spaces,key={it.id}) {space -> OutlinedCard(onClick={model.select(space.id);home=false},modifier=Modifier.fillMaxWidth().testTag("workspace-${space.id}"),shape=RoundedCornerShape(20.dp)) {Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {Text(space.name,style=MaterialTheme.typography.titleLarge);Text("Riprendi la conversazione →",style=MaterialTheme.typography.bodySmall)}}}
                    if(state.spaces.isEmpty()) item {Text("Il primo spazio può iniziare da una semplice idea.")}
                    item {
                        OutlinedTextField(workspaceName,{workspaceName=it},label={Text("Nome del nuovo Workspace")},placeholder={Text("Es. Rimiam")},modifier=Modifier.fillMaxWidth().testTag("workspace-name"),singleLine=true,isError=workspaceNameLength>120,supportingText={Text(if(workspaceNameLength>120) "Il nome può contenere al massimo 120 caratteri." else "$workspaceNameLength / 120")})
                        OutlinedTextField(workspaceDescription,{workspaceDescription=it},label={Text("Descrizione iniziale (facoltativa)")},modifier=Modifier.fillMaxWidth().testTag("workspace-description"),minLines=3,maxLines=6,isError=workspaceDescriptionLength>2000,supportingText={Text(if(workspaceDescriptionLength>2000) "La descrizione può contenere al massimo 2000 caratteri." else "$workspaceDescriptionLength / 2000")})
                        Text("Puoi raccontare da dove partite. La descrizione sarà condivisa nella conversazione, a tuo nome. Il Goal si definisce separatamente.",style=MaterialTheme.typography.bodySmall)
                        Button(onClick=createWorkspace@{
                            val name=workspaceName;val description=workspaceDescription;val accountScope=state.accountScope
                            if(accountScope==null || model.ui.value.accountScope!=accountScope) return@createWorkspace
                            model.create(name,description) {
                                if(model.ui.value.accountScope==accountScope) {
                                    if(workspaceName==name && workspaceDescription==description) {workspaceName="";workspaceDescription=""}
                                    createdWorkspace=model.ui.value.selected
                                    home=false
                                }
                            }
                        },enabled=!state.busy && state.accountScope!=null && workspaceNameLength in 1..120 && workspaceDescriptionLength<=2000 && pendingCreations.isEmpty(),modifier=Modifier.testTag("workspace-create")) {Text("Crea Workspace")}
                    }
                    items(pendingCreations,key={"pending-creation-${it.id}"}) {command -> Card {Column(Modifier.padding(12.dp)) {
                        Text("Creazione da verificare",style=MaterialTheme.typography.labelMedium)
                        Text(command.content)
                        command.commandJSON?.let {payload -> runCatching {org.json.JSONObject(payload).optString("description")}.getOrNull()?.takeIf {it.isNotBlank()}?.let {Text(it)}}
                        Text("Verifica questa creazione prima di avviarne un’altra. Il recupero usa gli stessi dati già inviati.",style=MaterialTheme.typography.bodySmall)
                        TextButton(onClick={model.retry(command)},enabled=!state.busy) {Text("Riprova la stessa operazione")}
                        TextButton(onClick={discard=command},enabled=!state.busy) {Text("Rimuovi promemoria locale")}
                    }}}
                    item {InvitationEntry(state,model)}
                } else {
                    state.workstreamFocus?.let {focus -> item {WorkstreamFocusStrip(state,{model.selectWorkstream(null)},{navigate("work")},::focusConversation)}}
                    if(createdWorkspace==state.selected) item {
                        OutlinedCard(Modifier.fillMaxWidth(),border=BorderStroke(1.5.dp,MaterialTheme.colorScheme.outlineVariant)) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                            Text("Lo spazio è pronto",style=MaterialTheme.typography.titleMedium)
                            Text("Potete iniziare a parlarne. Puoi invitare una persona quando vuoi.",style=MaterialTheme.typography.bodyMedium)
                            FlowRow {TextButton(onClick={createdWorkspace=null;navigate("people")}) {Text("Invita una persona")};TextButton(onClick={createdWorkspace=null}) {Text("Più tardi")}}
                        }}
                    }
                    item {Row(verticalAlignment=Alignment.CenterVertically) {Text("CONVERSAZIONE",style=MaterialTheme.typography.labelSmall);Spacer(Modifier.weight(1f));Text(state.connection,style=MaterialTheme.typography.labelSmall,modifier=Modifier.testTag("connection"));if(state.busy) CircularProgressIndicator(Modifier.padding(start=8.dp).size(18.dp),strokeWidth=2.dp)}}
                    state.detail?.optJSONArray("interpretations")?.let { reads ->
                        val statuses = (0 until reads.length()).map { reads.getJSONObject(it).getString("status") }
                        if (statuses.any { it in setOf("queued", "running") }) item { Text("Miriam sta leggendo il contesto pertinente…", style=MaterialTheme.typography.bodySmall) }
                        else if (statuses.any { it in setOf("failed", "stale") }) item { TextButton(onClick={navigate("context")}) { Text("Una lettura di Miriam richiede attenzione") } }
                    }
                    if(state.hasOlder) item {TextButton(onClick={model.loadOlder()}) {Text("Carica messaggi precedenti")}}
                    if(speech.error.isNotEmpty()) item {Text(speech.error,color=MaterialTheme.colorScheme.error)}
                    if(state.messages.isEmpty()) item {Text(if(state.messagesThrough==null)"Caricamento della conversazione…" else if(state.workstreamFocus!=null)"Nessun messaggio collegato a questo filone nella vista corrente." else "Raccontate cosa avete in mente. Miriam seguirà il filo del progetto.",style=MaterialTheme.typography.bodyLarge)}
                    items(state.messages,key={it.id}) {message ->
                        ConversationMessage(message) {
                            message.reference?.let { ReferenceLink(it, "Riferimento del messaggio · ${referenceKindLabel(it.kind)} v${it.version}") }
                            message.workstreamFocus?.let {original->Text("Filone all’invio: ${original.workstreamId} · v${original.version}",style=MaterialTheme.typography.labelSmall);TextButton(onClick={navigate("work")}){Text("Filoni e storia")}}
                            VoiceMessageView(model,message.id)
                            if(message.actorKind=="miriam")SpokenReplyButton(speech,message.id,message.content)
                            message.citationSourceIds.forEach{SourceReference(state,model,it)}
                            MessageHandoffs(message,state,model,message.id in presentation.handoffMessages) {
                                if(message.id !in presentation.handoffMessages)presentation.handoffMessages.add(message.id)
                            }
                        }
                    }
                    items(state.pending,key={"pending-${it.id}"}) {command -> Card {Column(Modifier.padding(12.dp)) {Text("Operazione da verificare",style=MaterialTheme.typography.labelMedium);Text(command.content);TextButton(onClick={model.retry(command)},enabled=!state.busy) {Text("Riprova la stessa operazione")};TextButton(onClick={discard=command}) {Text("Rimuovi promemoria locale")}}}}
                }
                if(state.error.isNotEmpty()) item {Text(state.error,color=MaterialTheme.colorScheme.error)}
            }
            if(state.user!=null && !state.logoutPending && state.selected!=null && !home) {
            Surface(color=MaterialTheme.colorScheme.background) {Column(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=if(compactHeight)0.dp else 8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                draftReference?.let { ComposerReference(it) { draftReference = null } }
                OutlinedTextField(
                    value=draft,
                    onValueChange={value ->
                        if(draft.isBlank())draftFocus=state.workstreamFocus
                        draft=value
                    },
                    label={Text("Continuiamo da qui…")},
                    supportingText=if(compactHeight && state.workstreamFocus==null)null else ({Text(state.workstreamFocus?.let {"Nello stesso spazio · filone selezionato v${it.version}"} ?: "Messaggio nella conversazione condivisa")}),
                    modifier=Modifier.fillMaxWidth().testTag("message"),
                    shape=RoundedCornerShape(16.dp),
                    maxLines=5
                )
                if(!draftMatchesFocus) {
                    Text("La bozza resta legata ${draftFocus?.let {"al filone ${it.workstreamId.take(8)} · v${it.version}"} ?: "alla conversazione completa"}. Non è stata spostata.",style=MaterialTheme.typography.bodySmall)
                    TextButton(onClick={draftFocus=state.workstreamFocus},enabled=state.focusIsCurrent()) {Text("Usa questa bozza nella vista attuale")}
                }
                FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                    TextButton(onClick={navigate("sources")}) {Text("＋ Fonte")}
                    TextButton(onClick={navigate("voice")}) {Text("Voce")}
                    TextButton(onClick={sendDraft(true)},enabled=canSendDraft){Text("Chiedi a Miriam")}
                    FilledTonalButton(onClick={sendDraft(false)},enabled=canSendDraft,modifier=Modifier.testTag("send")) {Text("Invia")}
                }
                if(model.media.dialog) TextButton(onClick={model.media.endDialog()}) {Text("Termina dialogo vocale")}
                else if(model.media.recording) TextButton(onClick={model.media.stopCapture()}) {Text("Ferma nota vocale")}
                else if(model.media.clip!=null) TextButton(onClick={navigate("voice")}) {Text("Nota vocale pronta · apri i controlli")}
            }}
        }
            }
            if(wide && toolsOpen && !home && state.user!=null && !state.logoutPending) {
                VerticalDivider(thickness=1.5.dp)
                Surface(Modifier.width(400.dp).fillMaxHeight()) {
                    WorkspaceLens(state,model,presentation,lensStateHolder,::navigate,{destination=""},{toolsOpen=false},::connect,::focusConversation,::referenceBack,::discussReference)
                }
            }
        }
    }
    if(toolsOpen && !wide && !home && state.user!=null && !state.logoutPending) ModalBottomSheet(onDismissRequest={toolsOpen=false},sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Box(Modifier.fillMaxHeight(0.94f)) {WorkspaceLens(state,model,presentation,lensStateHolder,::navigate,{destination=""},{toolsOpen=false},::connect,::focusConversation,::referenceBack,::discussReference)}
    }
    discard?.let {command -> AlertDialog(onDismissRequest={discard=null},title={Text("Rimuovere il promemoria?")},text={Text("Non annulla un’operazione già ricevuta dal server.")},confirmButton={TextButton(onClick={model.discardReminder(command);discard=null}) {Text("Rimuovi")}},dismissButton={TextButton(onClick={discard=null}) {Text("Annulla")}})}
    }
}
@Composable private fun WorkspaceLens(state:UiState,model:WorkspaceModel,presentation:WorkspacePresentation,lensStateHolder:SaveableStateHolder,open:(String)->Unit,root:()->Unit,close:()->Unit,connect:(String)->Unit,focus:(WorkstreamFocus)->Unit,referenceBack:()->Unit,discuss:(ReferenceDetail)->Unit) {
    val destination by presentation.destination
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically) {
            if(destination.isEmpty()) Text("Lo spazio",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
            else TextButton(onClick=if(destination=="reference")referenceBack else root,modifier=Modifier.weight(1f)) {Text(if(destination=="reference")"Indietro" else "Lo spazio")}
            TextButton(onClick=close,modifier=Modifier.testTag("lens-close")) {Text("Conversazione")}
        }
        HorizontalDivider(thickness=1.5.dp)
        presentation.handoff.value?.takeIf {handoffDestination(it.kind)==destination}?.let {HandoffOriginPanel(state,it)}
        Box(Modifier.weight(1f).consumeWindowInsets(WindowInsets.systemBars)) {
            lensStateHolder.SaveableStateProvider("${state.selected}:$destination") {key(state.accountScope,state.selected,destination) {
                when(destination) {
                    "" -> Column(Modifier.fillMaxSize().verticalScroll(presentation.scrollPositions.getOrPut(""){ScrollState(0)}).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                        WorkspaceNavigation(state,open)
                        HorizontalDivider(thickness=1.5.dp)
                        Text("Servizi collegati",style=MaterialTheme.typography.titleSmall)
                        TextButton(onClick={connect("calendar")}) {Text("Collega Google Calendar")}
                        TextButton(onClick={connect("email")}) {Text("Collega Gmail")}
                        if(state.error.isNotEmpty())Text(state.error,color=MaterialTheme.colorScheme.error)
                        Spacer(Modifier.height(24.dp))
                    }
                    "tasks" -> TasksScreen(state,model,root)
                    "calendar" -> CalendarScreen(state,model,root)
                    "email" -> EmailScreen(state,model,root)
                    "activity" -> ActivityContent(state,model,presentation.scrollPositions.getOrPut(destination){ScrollState(0)})
                    "reference" -> presentation.referenceTrail.lastOrNull()?.let { reference ->
                        key(reference) { ReferenceContent(state,model,reference,discuss) }
                    }
                    else -> WorkspaceDetailScreen(destination,state,model,scrollState=presentation.scrollPositions.getOrPut(destination){ScrollState(0)},focusWorkId=presentation.focusedWork.value,open=open,onFocus=focus,voiceReference=presentation.draftReference.value?.reference,back=root)
                }
            }}
        }
    }
}
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun WorkspaceNavigation(state:UiState,open:(String)->Unit) {
    Surface(color=MaterialTheme.colorScheme.inverseSurface,shape=RoundedCornerShape(12.dp)) {
        Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text("Quello che resta.",style=MaterialTheme.typography.headlineSmall)
            Text("La struttura della vostra conversazione.",style=MaterialTheme.typography.bodyMedium)
        }
    }
    val entries=listOf(
        Triple("goal","Dove volete arrivare","Goal, adesioni e storia"),
        Triple("context","Quello che è emerso","Informazioni, fonti e punti aperti"),
        Triple("work","Il lavoro","Filoni, attività e lavoro di Miriam"),
        Triple("artifacts","Quello che avete costruito","Contributi, bozze e documenti")
    )
    entries.forEach {(destination,title,detail) ->
        TextButton(onClick={open(destination)},modifier=Modifier.fillMaxWidth().testTag("$destination-open"),shape=RoundedCornerShape(4.dp),contentPadding=PaddingValues(vertical=12.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {Text(title,style=MaterialTheme.typography.titleMedium);Text(detail,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                Text("→",style=MaterialTheme.typography.titleLarge)
            }
        }
        HorizontalDivider(thickness=1.5.dp)
    }
    state.workspace?.goals?.firstOrNull{it.currentPrimary}?.let {Text(it.content,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
        listOf("sources" to "Fonti","people" to "Persone e inviti","email" to "Email","calendar" to "Calendario","tasks" to "Attività e follow-up","questions" to "Domande aperte","activity" to "Attività dello spazio","attention" to "Da considerare","calls" to "Chiamata audio","voice" to "Voce e Miriam").forEach {(destination,label) ->
            TextButton(onClick={open(destination)},modifier=Modifier.testTag("$destination-open")) {Text(label)}
        }
    }
}
@Composable private fun WorkstreamFocusStrip(state:UiState,clear:()->Unit,inspect:()->Unit,update:(WorkstreamFocus)->Unit) {
    val focus=state.workstreamFocus ?: return
    val stream=state.attention?.rows("workstreams")?.firstOrNull{it.getString("id")==focus.workstreamId}
    OutlinedCard(Modifier.fillMaxWidth(),border=BorderStroke(1.5.dp,MaterialTheme.colorScheme.outline)) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text("FILONE · SELEZIONE v${focus.version}",style=MaterialTheme.typography.labelMedium)
        Text(stream?.getString("title") ?: "Filone da verificare",style=MaterialTheme.typography.titleMedium)
        Text("Una vista della conversazione condivisa. I messaggi sono filtrati dai collegamenti attuali.",style=MaterialTheme.typography.bodySmall)
        if(!state.focusIsCurrent())Text("Il filone è cambiato, concluso o non ancora verificato. L’invio è sospeso; testo e audio restano conservati.",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
        if(stream!=null && stream.getInt("version")!=focus.version)TextButton(onClick={update(WorkstreamFocus(focus.workstreamId,stream.getInt("version")))}) {Text("Aggiorna la vista alla versione ${stream.getInt("version")}")}
        TextButton(onClick=inspect){Text("Perimetro e storia del filone")}
        TextButton(onClick=clear,modifier=Modifier.testTag("focus-clear")){Text("Tutta la conversazione")}
    }}
}
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ConversationActivity(state: UiState, compactHeight:Boolean, onWork: (String) -> Unit, onAllWork: () -> Unit, onActivity: () -> Unit) {
    val workAttention = state.attention?.rows("attention").orEmpty().filter { it.getString("kind") == "work" }
    val urgent = workAttention.filter { it.getString("reason") in setOf("Miriam ha bisogno di un chiarimento", "Risultato da ricontrollare") }
    Column(Modifier.fillMaxWidth().padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
        if(compactHeight) FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            TextButton(onClick=onAllWork) {Text("${workAttention.size} lavori",style=MaterialTheme.typography.labelMedium)}
            urgent.groupBy {it.getString("reason")}.forEach {(reason,items)->key(reason) {WorkAttentionGroup(reason,items,onWork)}}
            TextButton(onClick=onActivity,modifier=Modifier.testTag("activity-open")) {Text("Attività →",style=MaterialTheme.typography.labelMedium)}
        } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick=onAllWork,modifier=Modifier.weight(1f)) {Text(if(workAttention.isEmpty())"IL LAVORO" else "${workAttention.size} lavori da seguire",style=MaterialTheme.typography.labelMedium)}
            TextButton(onClick = onActivity, modifier = Modifier.testTag("activity-open")) { Text("Attività →",style=MaterialTheme.typography.labelMedium) }
        }
        if(!compactHeight && urgent.isNotEmpty()) FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            urgent.groupBy {it.getString("reason")}.forEach {(reason,items)->
                key(reason) { WorkAttentionGroup(reason,items,onWork) }
            }
        }
        if (state.activityError.isNotBlank()) TextButton(onClick = onActivity) { Text("Attività da aggiornare") }
        HorizontalDivider(thickness = 1.5.dp)
    }
}
@Composable private fun WorkAttentionGroup(reason:String,items:List<org.json.JSONObject>,onWork:(String)->Unit) {
    var expanded by rememberSaveable(reason) {mutableStateOf(false)}
    val label=if(reason=="Miriam ha bisogno di un chiarimento")"${items.size} da chiarire" else "${items.size} da ricontrollare"
    Box {
        AssistChip(onClick={if(items.size==1)onWork(items.first().getString("id")) else expanded=true},label={Text(label)})
        DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}) {
            items.forEach {item->DropdownMenuItem(text={Column {Text(item.getString("text"));Text(reason,style=MaterialTheme.typography.labelSmall)}},onClick={expanded=false;onWork(item.getString("id"))})}
        }
    }
}
@Composable private fun ConversationMessage(message:Message,attachments:@Composable ColumnScope.()->Unit) {
    val ai=message.actorKind=="miriam"
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Surface(color=if(ai)MaterialTheme.colorScheme.inverseSurface else MaterialTheme.colorScheme.surfaceVariant,shape=if(ai)RoundedCornerShape(8.dp) else CircleShape) {
            Box(Modifier.size(34.dp),contentAlignment=Alignment.Center) {Text(if(ai)"✦" else message.authorName.take(1).uppercase(),style=MaterialTheme.typography.titleMedium)}
        }
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text(if(message.purpose=="workspace_welcome") "Miriam · introduzione automatica" else if(ai) "Miriam · AI" else message.authorName+if(message.purpose=="workspace_introduction") " · descrizione iniziale" else "",style=MaterialTheme.typography.labelLarge)
            if(message.createdAt.isNotBlank())Text(messageTime(message.createdAt),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            SelectionContainer {Text(message.content,style=MaterialTheme.typography.bodyLarge)}
            attachments()
            HorizontalDivider(Modifier.padding(top=10.dp),color=MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
fun messageTime(value:String):String=runCatching {java.time.format.DateTimeFormatter.ofPattern("d MMM · HH:mm",java.util.Locale.ITALIAN).withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.parse(value))}.getOrDefault(value)
private fun webBase(base:String):String {val uri=Uri.parse(base);return if(uri.host in listOf("10.0.2.2","127.0.0.1","localhost") && uri.port==3002) uri.buildUpon().encodedAuthority("${uri.host}:3000").build().toString() else base}
