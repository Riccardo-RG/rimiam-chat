package it.miriam.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

fun activeWorkPhaseLabel(work:JSONObject):String {
    val phase=mapOf("queued" to "In attesa", "working" to "In corso", "needs_input" to "Serve un chiarimento", "paused" to "In pausa", "stopped" to "Fermato", "completed" to "Completato")[work.getString("phase")] ?: work.getString("phase")
    return phase + if(work.getString("validity")=="potentially_outdated") " · Da ricontrollare" else if(work.rows("issues").isNotEmpty()) " · Indicazioni da chiarire" else ""
}
@Composable fun ActiveWorkPresence(state: UiState, model: WorkspaceModel, initialWorkId:String?=null, resultsOnly:Boolean=false) {
    var showingAll by rememberSaveable(initialWorkId,resultsOnly) {mutableStateOf(initialWorkId!=null)}
    LaunchedEffect(state.accountScope,state.selected,initialWorkId) {if(initialWorkId!=null)model.locateActiveWork(initialWorkId)}
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if(resultsOnly)"Contributi di Miriam" else "Il lavoro di Miriam", style = MaterialTheme.typography.titleLarge)
        Text(if(resultsOnly)"Risultati consultabili, con fonti e ipotesi. Restano non adottati." else "Perimetro, ipotesi, fonti e storia di ogni lavoro.", style = MaterialTheme.typography.bodySmall)
        if (state.activeWorkLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (state.activeWorkError.isNotBlank()) Text(state.activeWorkError, color = MaterialTheme.colorScheme.error)
        if(initialWorkId!=null && state.activeWork?.rows("works")?.none {it.getString("id")==initialWorkId}!=false) {
            Text("Ricerca del lavoro selezionato nelle pagine conservate.",style=MaterialTheme.typography.bodySmall)
            TextButton(onClick={model.locateActiveWork(initialWorkId)},enabled=!state.activeWorkLoading) {Text("Riprova apertura del lavoro")}
            return@Column
        }
        state.activeWork?.let { view ->
            val works=view.rows("works").filter {!resultsOnly || !it.isNull("contribution")}
            if (works.isEmpty()) Text(if(resultsOnly)"Nessun contributo in questa pagina." else "Nessun lavoro avviato.")
            works.take(if(showingAll) Int.MAX_VALUE else 2).forEach { work -> key(work.getString("id")) { ActiveWorkCard(work, view, state, model,initiallyExpanded=work.getString("id")==initialWorkId) } }
            if(works.size>2) TextButton(onClick={showingAll=!showingAll}) {Text(if(showingAll) "Mostra meno" else "Tutti i lavori (${works.size})")}
            if (!view.isNull("next")) TextButton(onClick = { model.loadActiveWork(view.getString("next")) }) { Text("Altri lavori") }
            TextButton(onClick = { model.loadActiveWork("") }) { Text("Lavori recenti") }
        }
    }
}
@Composable private fun ActiveWorkCard(work: JSONObject, view: JSONObject, state: UiState, model: WorkspaceModel,initiallyExpanded:Boolean=false) {
    val id = work.getString("id"); val contract = work.getJSONObject("contract")
    var expanded by rememberSaveable(initiallyExpanded) { mutableStateOf(initiallyExpanded) }; var instruction by remember { mutableStateOf("") }
    var instructionKind by remember{mutableStateOf("input")};var instructionMenu by remember{mutableStateOf(false)};var format by remember{mutableStateOf("sintesi")}
    var history by remember { mutableStateOf("") }; var nextBefore by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    val issues = work.rows("issues")
    fun send(text: String,kind:String?=null) { val body=JSONObject().put("type","work.converse").put("workId",id).put("expectedRevision",work.getInt("revision")).put("text",text);if(kind!=null)body.put("instruction",kind);model.workspaceCommand(body,text) }
    fun inspect(before: Int? = null) { scope.launch { history = model.activeWorkHistory(id,before); nextBefore = runCatching { JSONObject(history).let { if(it.isNull("nextBefore")) null else it.getInt("nextBefore") } }.getOrNull() } }
    OutlinedCard(Modifier.fillMaxWidth().testTag("active-work-$id"),border=BorderStroke(1.5.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            TextButton(onClick = { expanded = !expanded },modifier=Modifier.fillMaxWidth().semantics {stateDescription=if(expanded)"Espanso" else "Ridotto"}) { Text(contract.getString("objective"),style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f));Text(if(expanded)"−" else "+") }
            Text(activeWorkPhaseLabel(work),style=MaterialTheme.typography.labelLarge)
            if(expanded) {
                ReferenceLink(ConversationReference("active_work",id,work.getInt("revision")),"Esamina l’evento corrente · revisione ${work.getInt("revision")}")
                view.rows("suggestions").filter{it.getString("workId")==id && it.getString("status")!="applied"}.forEach{s ->
                    Text("Miriam propone: "+s.getString("operation"));Text(s.getString("text"));Text("Interpretazione del messaggio ${s.getString("sourceId")}; non ancora applicata.",style=MaterialTheme.typography.bodySmall)
                    if(s.getString("status")=="stale")Text("Il lavoro è cambiato: questa proposta va rivalutata.")
                    if(s.getString("status")=="pending" && view.getBoolean("canControl"))TextButton(onClick={model.workspaceCommand(command("work.apply_suggestion","suggestionId" to s.getString("id"),"confirmExactInstruction" to true),s.getString("text"))},enabled=!state.busy){Text("Applica questa istruzione al lavoro")}
                }

                Text(contract.getString("scope"), style = MaterialTheme.typography.bodySmall)
                Text("Output: ${contract.getString("expectedOutput")} · Contratto v${contract.getInt("version")}")
                Text((if(contract.getString("origin") == "miriam") "Iniziativa di Miriam" else "Avviato da " + (state.detail?.rows("members")?.firstOrNull { it.getString("user_id") == contract.optString("actor") }?.getString("name") ?: "un partecipante")) + " · ${contract.getString("createdAt")}", style = MaterialTheme.typography.bodySmall)
                contract.getJSONArray("anchors").let { a -> repeat(a.length()) { Text("Ipotesi: ${a.getString(it)}") } }
                if(!work.isNull("error")) Text(aiFailureMessage(work.getString("error")) ?: "Analisi non completata. Il lavoro è conservato; verifica gli input prima di riprendere.")
                issues.forEach { issue ->
                    Text(issue.getString("content"))
                    if(view.getBoolean("canControl")) {
                        val actor = state.user?.id
                        val required = issue.getJSONArray("requiredPeople").let { a -> (0 until a.length()).map { a.getString(it) } }
                        val ack = issue.getJSONArray("acknowledgedBy").let { a -> (0 until a.length()).map { a.getString(it) } }
                        if(issue.getString("kind") == "revision" && actor in required && actor !in ack) TextButton(enabled = !state.busy, onClick = { send("confermo: ${issue.getString("id")}") }) { Text("Conferma questa direzione") }
                        if(issue.optString("actor") == actor) TextButton(enabled = !state.busy, onClick = { send("ritiro: ${issue.getString("id")}") }) { Text("Ritira la tua richiesta") }
                        if(issue.getString("kind") == "context") TextButton(enabled = !state.busy, onClick = { send("usa contesto aggiornato") }) { Text("Usa il contesto aggiornato per l’analisi") }
                    }
                }
                work.optJSONObject("contribution")?.let { result ->
                    Text("Contributo non adottato · contratto v${result.getInt("contractVersion")}", style = MaterialTheme.typography.titleSmall)
                    Text(result.getString("body")); Text(result.getString("qualification"), style = MaterialTheme.typography.bodySmall)
                    if(!result.isNull("id")) TextButton(onClick={model.workspaceCommand(JSONObject().put("type","artifact.from_contribution").put("contributionId",result.getString("id")).put("title",contract.getString("objective").take(160)).put("purpose",contract.getString("expectedOutput").take(2000)).put("nonOperative",true),"Bozza dal contributo")},enabled=!state.busy){Text("Prepara un Artifact da questo contributo")}
                    result.getJSONArray("citations").let { a -> repeat(a.length()) { index ->
                        val citation = a.getString(index)
                        Text("Riferimento del contributo: $citation", style = MaterialTheme.typography.bodySmall)
                        workInputReference(citation)?.let { ReferenceLink(it, "Esamina la versione citata") }
                    } }
                }
                if(view.getBoolean("canControl")) {
                    Row { TextButton(enabled = !state.busy, onClick = { send("pausa") }, modifier = Modifier.testTag("work-pause")) { Text("Pausa") }; TextButton(enabled = !state.busy && issues.isEmpty(), onClick = { send("riprendi") }, modifier = Modifier.testTag("work-resume")) { Text("Riprendi") }; TextButton(enabled = !state.busy, onClick = { send("ferma") }, modifier = Modifier.testTag("work-stop")) { Text("Ferma") } }
                    val choices=listOf("input" to "Aggiungi informazioni","assumption" to "Fissa un’ipotesi","objection" to "Segnala un’obiezione","redirect" to "Proponi una direzione","format" to "Cambia formato")
                    Box{OutlinedButton(onClick={instructionMenu=true}){Text(choices.first{it.first==instructionKind}.second)};DropdownMenu(instructionMenu,onDismissRequest={instructionMenu=false}){choices.forEach{(kind,label)->DropdownMenuItem(text={Text(label)},onClick={instructionKind=kind;instructionMenu=false})}}}
                    if(instructionKind=="format")Row{listOf("sintesi","elenco","dettagli").forEach{value->FilterChip(format==value,onClick={format=value},label={Text(value)})}}
                    OutlinedTextField(instruction, { instruction = it }, label = { Text("Istruzione per questo lavoro") }, modifier = Modifier.fillMaxWidth().testTag("work-instruction"))
                    Text("Spiega cosa vuoi cambiare o chiarire. Le restrizioni ancora aperte restano valide.", style = MaterialTheme.typography.bodySmall)
                    TextButton(enabled = !state.busy && (instructionKind=="format" || instruction.isNotBlank()), onClick = { send(if(instructionKind=="format") format else instruction,instructionKind); instruction = "" }) { Text("Invia istruzione") }
                }
                view.rows("events").filter { it.getString("workId") == id }.takeLast(5).forEach { event ->
                    Text("${event.getString("content")} · ${event.getString("createdAt")}", style = MaterialTheme.typography.bodySmall)
                    ReferenceLink(ConversationReference("active_work",id,event.getInt("revision")),"Esamina questo passaggio")
                }
                TextButton(onClick = { inspect() }) { Text("Storia e provenance") }
                if(history.isNotBlank()) { ReadableWorkHistory(history); nextBefore?.let { page -> TextButton(onClick = { inspect(page) }) { Text("Eventi precedenti") } } }; Unit
            }
        }
    }
}

@Composable private fun ReadableWorkHistory(raw:String) {
    val data=runCatching{JSONObject(raw)}.getOrNull() ?: return
    listOf("contracts" to "Contratti","events" to "Eventi","inputs" to "Fonti utilizzate","contributions" to "Contributi non adottati").forEach {(key,title)->
        val rows=data.optJSONArray(key) ?: return@forEach
        if(rows.length()>0) {Text(title,style=MaterialTheme.typography.titleSmall);repeat(rows.length()) {index->
            val row=rows.getJSONObject(index)
            Text(row.optString("content",row.optString("objective",row.optString("body",title))))
            if(key=="inputs")row.optJSONObject("provenance")?.optJSONObject("reference")?.let { reference ->
                ReferenceLink(reference.conversationReference(),"Esamina il riferimento esatto usato nel lavoro")
            }
            listOf("id","version","revision","contractVersion","generation","scope","expectedOutput","anchors","focus","actor","origin","sourceId","qualification","provenance","citations","reason","createdAt","key").forEach {field->if(row.has(field) && !row.isNull(field)) Text("$field: ${row.get(field)}",style=MaterialTheme.typography.bodySmall)}
        }}
    }
}
