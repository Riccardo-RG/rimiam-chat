package it.miriam.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

private fun emailEnvelope(sender: String) = JSONObject().put("sender", sender).put("to", JSONArray()).put("cc", JSONArray()).put("bcc", JSONArray()).put("subject", "").put("body", "").put("attachments", JSONArray()).put("kind", "new").put("target", JSONObject.NULL)
private fun addresses(text: String) = JSONArray(text.split(',').map { it.trim() }.filter { it.isNotEmpty() })
private fun listText(e: JSONObject, key: String): String = e.getJSONArray(key).let { a -> (0 until a.length()).joinToString(", ") { a.getString(it) } }
private fun fileReference(a: JSONObject) = JSONObject().put("id", a.getString("id")).put("kind", a.getString("kind")).put("version", a.getInt("version")).put("hash", a.getString("hash")).put("filename", a.getString("filename"))
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun EmailScreen(state: UiState, model: WorkspaceModel, close: () -> Unit) {
    var connection by remember { mutableStateOf("") }; var editing by remember { mutableStateOf<JSONObject?>(null) }
    var to by remember { mutableStateOf("") }; var cc by remember { mutableStateOf("") }; var bcc by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("") }; var body by remember { mutableStateOf("") }; var reason by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("new") }; var target by remember { mutableStateOf<JSONObject?>(null) }; var files by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var query by remember { mutableStateOf("") }; val excerpts = remember { mutableStateMapOf<String,String>() }
    var instruction by remember { mutableStateOf("") };var composition by remember { mutableStateOf<JSONObject?>(null) };var compositionId by remember { mutableStateOf<String?>(null) };val scope=rememberCoroutineScope()
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(state.selected, state.user?.id, owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { while (true) { model.loadEmail(); delay(2000) } } }
    BackHandler { close() }
    fun reset() { compositionId=null;connection="";editing=null;to="";cc="";bcc="";subject="";body="";reason="";kind="new";target=null;files=emptyList() }
    fun perform(c: JSONObject) { model.workspaceCommand(c,"Operazione email privata") }
    fun read(id: String, request: JSONObject) { perform(JSONObject().put("type","email.read").put("connectionId",id).put("request",request)) }
    Scaffold(topBar={ TopAppBar(title={Text("Workspace Email")},navigationIcon={TextButton(onClick=close){Text("Indietro")}}) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).testTag("email-content"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("Mailbox, bozze e invii sono riservati a te. Solo la condivisione esplicita porta contenuti nello spazio.")
            if(state.error.isNotEmpty())Text(state.error,color=MaterialTheme.colorScheme.error)
            val c=state.email
            if(c==null||c.getString("workspaceId")!=state.selected)CircularProgressIndicator()
            else {
                if(!c.getBoolean("providerConfigured"))Text("Provider Email non configurato. Le bozze interne sono disponibili.")
                Text(if(editing==null)"Nuova bozza" else "Modifica bozza",style=MaterialTheme.typography.titleLarge)
                val mailbox=c.rows("connections").find{it.getString("id")==connection}
                Text("Da: ${mailbox?.getString("sender")?:state.user?.email.orEmpty()} · $kind")
                TextButton(onClick={connection=""}){Text("Non collegata — solo bozza")}
                for(m in c.rows("connections").filter{it.getBoolean("active")})TextButton(onClick={connection=m.getString("id")}){Text("Usa mailbox: ${m.getString("sender")}")}
                OutlinedTextField(to,{to=it},label={Text("To, separati da virgole")},modifier=Modifier.fillMaxWidth().testTag("email-to"))
                OutlinedTextField(cc,{cc=it},label={Text("CC")},modifier=Modifier.fillMaxWidth())
                OutlinedTextField(bcc,{bcc=it},label={Text("BCC")},modifier=Modifier.fillMaxWidth())
                OutlinedTextField(subject,{subject=it},label={Text("Oggetto email")},modifier=Modifier.fillMaxWidth().testTag("email-subject"))
                OutlinedTextField(body,{body=it},label={Text("Corpo email")},minLines=3,modifier=Modifier.fillMaxWidth().testTag("email-body"))
                for(a in c.rows("workspaceAttachments")+c.rows("attachments"))Row {
                    Checkbox(files.any{it.getString("id")==a.getString("id")},{checked->files=files.filterNot{it.getString("id")==a.getString("id")};if(checked)files=files+fileReference(a)})
                    Text("${a.getString("filename")} · v${a.getInt("version")} · ${a.getString("kind")}")
                }
                OutlinedTextField(reason,{reason=it},label={Text("Motivo bozza")},modifier=Modifier.fillMaxWidth().testTag("email-reason"))
                Button(onClick={
                    val e=emailEnvelope(mailbox?.getString("sender")?:state.user?.email.orEmpty()).put("to",addresses(to)).put("cc",addresses(cc)).put("bcc",addresses(bcc)).put("subject",subject).put("body",body).put("kind",kind).put("target",target?:JSONObject.NULL).put("attachments",JSONArray(files))
                    val command=JSONObject().put("type",if(editing==null)"email.draft.create" else "email.draft.revise").put("connectionId",connection.takeIf{it.isNotEmpty()}?:JSONObject.NULL).put("envelope",e).put("reason",reason)
                    editing?.let{command.put("draftId",it.getString("id")).put("expectedVersion",it.getInt("version"));compositionId?.let{command.put("compositionId",it)}};perform(command);reset()
                },enabled=!state.busy&&reason.isNotBlank(),modifier=Modifier.testTag("email-save")){Text("Salva bozza interna")}
                TextButton(onClick={reset()}){Text("Nuova bozza")}
                Text("Miriam riceve solo testo della bozza e istruzione. Il risultato deve essere controllato e salvato; non invia email.")
                OutlinedTextField(instruction,{instruction=it},label={Text("Istruzione per Miriam")},modifier=Modifier.fillMaxWidth())
                composition?.let { result ->
                    val suggestion=result.getJSONObject("suggestion")
                    if(!suggestion.isNull("needsClarification"))Text(suggestion.getString("needsClarification"))
                    else {Text(suggestion.getString("subject"));Text(suggestion.getString("body"));Button(onClick={
                        c.rows("drafts").find{it.getString("id")==result.getString("draftId")&&it.getInt("version")==result.getInt("version")}?.let{d ->
                            val e=d.getJSONObject("envelope");editing=d;connection=if(d.isNull("connectionId"))"" else d.getString("connectionId");to=listText(e,"to");cc=listText(e,"cc");bcc=listText(e,"bcc");subject=suggestion.getString("subject");body=suggestion.getString("body");kind=e.getString("kind");target=e.optJSONObject("target");files=e.rows("attachments");reason="";compositionId=result.getString("id")
                        }
                    }){Text("Usa come revisione da controllare")}}
                }
                HorizontalDivider();Text("Bozze interne private",style=MaterialTheme.typography.titleLarge)
                for(d in c.rows("drafts")){
                    val e=d.getJSONObject("envelope");Text("${e.getString("subject")} · v${d.getInt("version")}",style=MaterialTheme.typography.titleMedium);EmailContents(e)
                    Button(onClick={scope.launch{composition=model.composeEmail(d,instruction)}},enabled=!state.busy&&instruction.isNotBlank()){Text("Suggerisci testo con Miriam")}
                    TextButton(onClick={compositionId=null;editing=d;connection=if(d.isNull("connectionId"))"" else d.getString("connectionId");to=listText(e,"to");cc=listText(e,"cc");bcc=listText(e,"bcc");subject=e.getString("subject");body=e.getString("body");kind=e.getString("kind");target=e.optJSONObject("target");files=e.rows("attachments");reason=""}){Text("Modifica bozza")}
                    if(!d.isNull("connectionId")&&!c.rows("actions").any{it.getString("draftId")==d.getString("id")&&it.getInt("version")==d.getInt("version")})Button(onClick={perform(JSONObject().put("type","email.propose").put("draftId",d.getString("id")).put("version",d.getInt("version")).put("discloseToRecipients",true))},enabled=!state.busy,modifier=Modifier.testTag("email-propose-${d.getString("id")}")){Text("Prepara proposta di invio esatta")}
                }
                if(!c.isNull("nextDrafts"))TextButton(onClick={model.emailPage(c.getString("nextDrafts"))}){Text("Bozze precedenti")}
                TextButton(onClick={model.emailPage("")}){Text("Bozze recenti")}
                HorizontalDivider();Text("Proposte e risultati privati",style=MaterialTheme.typography.titleLarge)
                for(a in c.rows("actions")){
                    val e=a.getJSONObject("envelope");Text("${e.getString("subject")} · ${a.getString("status")} · v${a.getInt("version")}",modifier=Modifier.testTag("email-status-${a.getString("id")}"));EmailContents(e)
                    Text("L’invio divulga esattamente contenuto e allegati ai destinatari, inclusi CC/BCC. Rappresenti soltanto te.")
                    if(!a.isNull("error"))Text(a.getString("error"));if(a.getString("status")=="OUTCOME_UNKNOWN")Text("Potrebbe essere già inviata. Non reinviare senza prova sufficiente.")
                    if(!a.isNull("receipt"))Text("Accettata dal provider: ${a.getJSONObject("receipt").getString("providerMessageId")}. Non prova lettura o consegna finale.")
                    val controls=listOf(Triple("canAuthorize","email.authorize","Autorizzo invio e disclosure per me"),Triple("canReject","email.reject","Rifiuta invio"),Triple("canRetry","email.retry","Riprova stesso invio"),Triple("canReconcile","email.reconcile","Verifica esito email"))
                    for((gate,type,label)in controls)if(a.getBoolean(gate))Button(onClick={
                        val command=JSONObject().put("type",type).put("actionId",a.getString("id")).put("version",a.getInt("version"));if(type=="email.authorize")command.put("expectedContextRevision",c.getInt("contextRevision")).put("expectedAccessRevision",c.getInt("accessRevision")).put("representSelf",true).put("discloseToRecipients",true);if(type=="email.reject")command.put("reason","Rifiuto esplicito");perform(command)
                    },enabled=!state.busy,modifier=Modifier.testTag("$type-${a.getString("id")}")){Text(label)}
                }
                HorizontalDivider();Text("Mailbox privata",style=MaterialTheme.typography.titleLarge)
                OutlinedTextField(query,{query=it},label={Text("Ricerca nella mailbox")},modifier=Modifier.fillMaxWidth())
                for(m in c.rows("connections").filter{it.getBoolean("active")}){
                    Text("${m.getString("sender")} · lettura ${m.getBoolean("canRead")} · invio personale ${m.getBoolean("canSend")}")
                    if(m.getBoolean("canRead"))Button(onClick={read(m.getString("id"),JSONObject().put("mode","search").put("query",query))},enabled=!state.busy&&query.isNotBlank()){Text("Cerca privatamente · ${m.getString("label")}")}
                    TextButton(onClick={perform(JSONObject().put("type","email.disconnect").put("connectionId",m.getString("id")).put("expectedVersion",m.getInt("version")))}){Text("Disconnetti mailbox")}
                }
                for(o in c.rows("observations")){
                    Text("Osservazione privata · ${o.getString("observedAt")}");val data=o.getJSONObject("data")
                    for(m in data.rows("messages")){
                        Text(m.getString("subject"),style=MaterialTheme.typography.titleMedium);Text("Da ${m.getString("from")} · thread ${m.optString("threadId")}");Text(m.getString("body"))
                        TextButton(onClick={read(o.getString("connectionId"),JSONObject().put("mode","message").put("targetId",m.getString("id")))}){Text("Rileggi messaggio privato")}
                        if(!m.isNull("threadId"))TextButton(onClick={read(o.getString("connectionId"),JSONObject().put("mode","thread").put("targetId",m.getString("threadId")))}){Text("Leggi thread privato")}
                        for(k in listOf("reply","forward"))TextButton(onClick={reset();connection=o.getString("connectionId");kind=k;target=JSONObject().put("observationId",o.getString("id")).put("messageId",m.getString("id"));subject="${if(k=="reply")"Re" else "Fwd"}: ${m.getString("subject")}";body=if(k=="forward")m.getString("body") else "";to=if(k=="reply")listText(m,"replyTo").ifEmpty{m.getString("from")} else ""}){Text(if(k=="reply")"Prepara reply" else "Prepara forward")}
                        val key=o.getString("id")+":"+m.getString("id")
                        OutlinedTextField(excerpts[key].orEmpty(),{excerpts[key]=it},label={Text("Estratto da condividere")},modifier=Modifier.fillMaxWidth())
                        Text("Solo questo estratto entra nella storia visibile ai membri attuali e futuri ammessi. Non diventa informazione accettata.")
                        Button(onClick={perform(JSONObject().put("type","email.disclose").put("observationId",o.getString("id")).put("messageId",m.getString("id")).put("text",excerpts[key]).put("fullHistoryDisclosed",true))},enabled=!state.busy&&!excerpts[key].isNullOrBlank()){Text("Condividi questo estratto nello spazio")}
                        for(a in m.rows("attachments"))TextButton(onClick={read(o.getString("connectionId"),JSONObject().put("mode","attachment").put("observationId",o.getString("id")).put("messageId",m.getString("id")).put("attachmentId",a.getString("id")))}){Text("Leggi allegato privato: ${a.getString("filename")}")}
                    }
                    if(!data.getBoolean("complete"))Text("Lettura parziale: serve altro contesto.")
                    if(!data.isNull("nextCursor"))TextButton(onClick={read(o.getString("connectionId"),JSONObject(o.getJSONObject("request").toString()).put("cursor",data.getString("nextCursor")))}){Text("Continua lettura privata")}
                }
                for(a in c.rows("attachments")){
                    Text("Allegato privato: ${a.getString("filename")} · v${a.getInt("version")}");Text("Condividere rende il file visibile ai membri attuali e futuri ammessi alla storia conservata.")
                    Button(onClick={perform(JSONObject().put("type","email.attachment.disclose").put("attachmentId",a.getString("id")).put("fullHistoryDisclosed",true))},enabled=!state.busy){Text("Condividi allegato nello spazio")}
                }
                for(r in c.rows("reads").filter{it.getString("status")!="COMPLETED"})Text("${r.getString("status")} · ${if(r.isNull("error"))"" else r.getString("error")}")
                Text("Disclosure condivise",style=MaterialTheme.typography.titleLarge)
                for(d in c.rows("disclosures"))Text("Fonte condivisa esplicitamente: ${d.getString("sourceId")} · ${d.getString("createdAt")}")
            }
        }
    }
}
@Composable private fun EmailContents(e: JSONObject){
    Text("Da: ${e.getString("sender")}\nTo: ${listText(e,"to")}\nCC: ${listText(e,"cc")}\nBCC: ${listText(e,"bcc")}")
    Text("${e.getString("kind")} · ${e.optJSONObject("target")?.optString("messageId")?:"nuovo messaggio"}");Text(e.getString("body"))
    for(a in e.rows("attachments"))Text("Allegato: ${a.getString("filename")} · v${a.getInt("version")} · SHA256 ${a.getString("hash")}")
}
