package it.miriam.nativeapp

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch

private val MiriamColors = lightColorScheme(primary=Color(0xFF176B62), onPrimary=Color.White, background=Color(0xFFF6F5F1), surface=Color(0xFFFCFCF9), onSurface=Color(0xFF233331), surfaceVariant=Color(0xFFE9EDE7))
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState);enableEdgeToEdge();setContent { MaterialTheme(colorScheme=MiriamColors) { val model:WorkspaceModel=viewModel();Column {CallStatusBanner(model);Box(Modifier.weight(1f)){MiriamScreen(model)}} } } }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun MiriamScreen(model: WorkspaceModel = viewModel()) {
    val state by model.ui.collectAsStateWithLifecycle()
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var server by remember { mutableStateOf(if(BuildConfig.DEBUG) "http://10.0.2.2:3002" else "") }
    var accountMode by remember {mutableStateOf("login")};var accountName by remember {mutableStateOf("")}
    var email by remember { mutableStateOf("") };var password by remember { mutableStateOf("") }
    var draft by remember(state.user?.id,state.selected) { mutableStateOf("") }
    var workspaceName by remember { mutableStateOf("") };var discard by remember { mutableStateOf<PendingCommand?>(null) }
    var home by remember { mutableStateOf(true) };var destination by remember { mutableStateOf("") };var toolsOpen by remember { mutableStateOf(false) }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { model.setForeground(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { model.setForeground(false);model.media.endDialog();model.media.discard();model.media.stopPlayback() }
    LaunchedEffect(state.selected,state.user?.id,state.logoutPending) {model.media.bind(model)}
    LaunchedEffect(state.selected) {destination=""}
    LaunchedEffect(state.user?.id) { home=true;destination="";toolsOpen=false }
    BackHandler(!home || destination.isNotEmpty()) { if(destination.isNotEmpty()) destination="" else home=true }
    fun openBrowser(url:String) { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url))) }
    fun navigate(target:String) { destination=target;toolsOpen=false }
    if(state.user != null && !state.logoutPending && state.selected != null && !home) {
        when(destination) {
            "tasks" -> { key(state.user?.id,state.selected){TasksScreen(state,model) {destination=""}};return }
            "calendar" -> { key(state.user?.id,state.selected){CalendarScreen(state,model) {destination=""}};return }
            "email" -> { key(state.user?.id,state.selected) { EmailScreen(state,model) {destination=""} };return }
            "context","sources","questions","artifacts","people","attention" -> { key(state.user?.id,state.selected) { WorkspaceDetailScreen(destination,state,model) {destination=""} };return }
        }
    }
    val speech=rememberSpeechPlayback("${state.user?.id}:${state.selected}:$home:$destination:${state.logoutPending}")
    val wide=with(LocalDensity.current) {LocalWindowInfo.current.containerSize.width.toDp()>=840.dp}
    Scaffold(topBar={TopAppBar(title={Text(if(home || state.user==null) "MIRIAM" else state.workspace?.name ?: "Workspace")},navigationIcon={if(!home && state.user!=null) TextButton(onClick={home=true}) {Text("Home")}},actions={if(state.user!=null && !state.logoutPending) {if(!home) TextButton(onClick={toolsOpen=true},modifier=Modifier.testTag("tools-open")) {Text("Esplora")} else TextButton(onClick={model.logout()},modifier=Modifier.testTag("logout")) {Text("Esci")}}})},
        bottomBar={if(state.user!=null && !state.logoutPending && state.selected!=null && !home) {
            Surface(tonalElevation=2.dp) {Row(Modifier.navigationBarsPadding().imePadding().fillMaxWidth().padding(12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(draft,{draft=it},label={Text("Scrivi al gruppo e a Miriam")},modifier=Modifier.weight(1f).testTag("message"),maxLines=5)
                TextButton(onClick={val sent=draft;model.send("@Miriam " + sent){if(draft==sent)draft=""}},enabled=!state.busy && draft.isNotBlank()){Text("Miriam")}
                FilledTonalButton(onClick={val sent=draft;model.send(sent) {if(draft==sent) draft=""}},enabled=!state.busy && draft.isNotBlank(),modifier=Modifier.testTag("send")) {Text("Invia")}
            }}
        }}
    ) {insets ->
        Row(Modifier.padding(insets).fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).testTag("content").padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(14.dp),contentPadding=PaddingValues(vertical=16.dp)) {
                if(!state.ready) item {CircularProgressIndicator()}
                else if(state.logoutPending) item {Text("Logout da completare");Text(state.error);Button(onClick={model.logout()}) {Text("Riprova revoca")}}
                else if(state.user==null) {
                    item {Text("Il progetto prende forma, insieme.",style=MaterialTheme.typography.headlineMedium);Text("Persone e Miriam collaborano in spazi che ricordano, ragionano e costruiscono.")}
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
                    item {Text("Cosa costruiamo oggi?",style=MaterialTheme.typography.headlineMedium);Text("La conversazione diventa comprensione condivisa, decisioni e lavoro che continua.",style=MaterialTheme.typography.bodyLarge)}
                    item {Text("I tuoi Workspace",style=MaterialTheme.typography.titleLarge)}
                    items(state.spaces,key={it.id}) {space -> Card(onClick={model.select(space.id);home=false},modifier=Modifier.fillMaxWidth().testTag("workspace-${space.id}")) {Column(Modifier.padding(20.dp)) {Text(space.name,style=MaterialTheme.typography.titleMedium);Text("Apri la conversazione →",style=MaterialTheme.typography.bodySmall)}}}
                    if(state.spaces.isEmpty()) item {Text("Il primo spazio può iniziare da una semplice idea.")}
                    item {OutlinedTextField(workspaceName,{workspaceName=it},label={Text("Nome del nuovo Workspace")},modifier=Modifier.fillMaxWidth());Button(onClick={val name=workspaceName;model.create(name) {if(workspaceName==name) workspaceName="";home=false}},enabled=!state.busy && workspaceName.isNotBlank()) {Text("Crea Workspace")}}
                    item {InvitationEntry(state,model)}
                } else {
                    state.workspace?.goals?.firstOrNull{it.currentPrimary}?.let {goal -> item {TextButton(onClick={navigate("context")}) {Column {Text("IL NOSTRO GOAL",style=MaterialTheme.typography.labelSmall);Text(goal.content,style=MaterialTheme.typography.titleMedium)}}}}
                    if(state.workspace?.goals?.isEmpty()==true) item {TextButton(onClick={navigate("context")}) {Text("Dove volete arrivare?")}}
                    state.attention?.rows("attention")?.firstOrNull()?.let {focus->item {TextButton(onClick={navigate("attention")}) {Column {Text("ADESSO",style=MaterialTheme.typography.labelSmall);Text(focus.getString("text"))}}}}
                    item {Row {Text(state.connection,style=MaterialTheme.typography.labelSmall,modifier=Modifier.testTag("connection"));Spacer(Modifier.weight(1f));if(state.busy) CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp)}}
                    state.detail?.optJSONArray("interpretations")?.let { reads ->
                        val statuses = (0 until reads.length()).map { reads.getJSONObject(it).getString("status") }
                        if (statuses.any { it in setOf("queued", "running") }) item { Text("Miriam sta leggendo il contesto pertinente…", style=MaterialTheme.typography.bodySmall) }
                        else if (statuses.any { it in setOf("failed", "stale") }) item { TextButton(onClick={navigate("context")}) { Text("Una lettura di Miriam richiede attenzione") } }
                    }
                    if(state.activeWork?.rows("works")?.isNotEmpty()==true) item {key(state.user?.id,state.selected) {ActiveWorkPresence(state,model)}}
                    item {WorkspaceCallControls(model);ConversationVoiceControls(model)}
                    if(state.hasOlder) item {TextButton(onClick={model.loadOlder()}) {Text("Carica messaggi precedenti")}}
                    if(speech.error.isNotEmpty()) item {Text(speech.error,color=MaterialTheme.colorScheme.error)}
                    if(state.messages.isEmpty()) item {Text("Raccontate cosa avete in mente. Miriam seguirà il filo del progetto.",style=MaterialTheme.typography.bodyLarge)}
                    items(state.messages,key={it.id}) {message -> Column(Modifier.fillMaxWidth().padding(vertical=5.dp)) {Text(if(message.actorKind=="miriam") "Miriam · AI" else message.authorName+" · persona",style=MaterialTheme.typography.labelMedium,color=if(message.actorKind=="miriam") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant);Text(message.content,style=MaterialTheme.typography.bodyLarge);VoiceMessageView(model,message.id);if(message.actorKind=="miriam")SpokenReplyButton(speech,message.id,message.content);message.citationSourceIds.forEach{SourceReference(state,model,it)}}}
                    items(state.pending,key={"pending-${it.id}"}) {command -> Card {Column(Modifier.padding(12.dp)) {Text("Operazione da verificare",style=MaterialTheme.typography.labelMedium);Text(command.content);TextButton(onClick={model.retry(command)},enabled=!state.busy) {Text("Riprova la stessa operazione")};TextButton(onClick={discard=command}) {Text("Rimuovi promemoria locale")}}}}
                }
                if(state.error.isNotEmpty()) item {Text(state.error,color=MaterialTheme.colorScheme.error)}
            }
            if(wide && !home && state.user!=null) Surface(Modifier.width(280.dp).fillMaxHeight(),tonalElevation=1.dp) {Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {WorkspaceNavigation(::navigate)}}
        }
    }
    if(toolsOpen) ModalBottomSheet(onDismissRequest={toolsOpen=false}) {Column(Modifier.padding(horizontal=20.dp).verticalScroll(rememberScrollState())) {
        Text("Il Workspace",style=MaterialTheme.typography.headlineSmall);WorkspaceNavigation(::navigate)
        TextButton(onClick={scope.launch {model.connectGoogle("calendar")?.let(::openBrowser)}}) {Text("Collega Google Calendar")}
        TextButton(onClick={scope.launch {model.connectGoogle("email")?.let(::openBrowser)}}) {Text("Collega Gmail")}
        if(state.error.isNotEmpty()) Text(state.error,color=MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(24.dp))
    }}
    discard?.let {command -> AlertDialog(onDismissRequest={discard=null},title={Text("Rimuovere il promemoria?")},text={Text("Non annulla un’operazione già ricevuta dal server.")},confirmButton={TextButton(onClick={model.discardReminder(command);discard=null}) {Text("Rimuovi")}},dismissButton={TextButton(onClick={discard=null}) {Text("Annulla")}})}
}
@Composable private fun WorkspaceNavigation(open:(String)->Unit) {
    listOf("attention" to "Adesso e cosa è cambiato","context" to "Context e Goal","questions" to "Domande aperte","artifacts" to "Artifacts","sources" to "Fonti e ricerca","tasks" to "Lavoro e follow-up","calendar" to "Calendario","email" to "Workspace Email","people" to "Persone e accesso").forEach {(key,label)->TextButton(onClick={open(key)},modifier=Modifier.fillMaxWidth().testTag("$key-open")) {Text(label,modifier=Modifier.fillMaxWidth())}}
}
private fun webBase(base:String):String {val uri=Uri.parse(base);return if(uri.host in listOf("10.0.2.2","127.0.0.1","localhost") && uri.port==3002) uri.buildUpon().encodedAuthority("${uri.host}:3000").build().toString() else base}
