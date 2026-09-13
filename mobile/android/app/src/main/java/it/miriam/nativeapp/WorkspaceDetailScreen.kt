package it.miriam.nativeapp

import android.net.Uri
import android.util.Base64
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.safeRows(key:String)=optJSONArray(key)?.let {a->(0 until a.length()).map {a.getJSONObject(it)}} ?: emptyList()
private fun JSONObject.strings(key:String)=optJSONArray(key)?.let {a->(0 until a.length()).map {a.getString(it)}} ?: emptyList()
@Composable private fun Choice(label:String, selected:String, values:List<Pair<String,String>>, changed:(String)->Unit) {
    var expanded by remember {mutableStateOf(false)}
    Box {OutlinedButton(onClick={expanded=true}) {Text(label+": "+(values.firstOrNull{it.first==selected}?.second ?: "scegli"))};DropdownMenu(expanded,onDismissRequest={expanded=false}) {values.forEach {(id,text)->DropdownMenuItem(text={Text(text)},onClick={changed(id);expanded=false})}}}
}
@Composable private fun DetailCard(title:String, content:@Composable ColumnScope.()->Unit) {
    var expanded by remember {mutableStateOf(false)}
    Card(Modifier.fillMaxWidth()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {TextButton(onClick={expanded=!expanded}) {Text(title,style=MaterialTheme.typography.titleMedium)};if(expanded) content()}}
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun WorkspaceDetailScreen(destination:String,state:UiState,model:WorkspaceModel,back:()->Unit) {
    BackHandler {back()}
    val title=mapOf("attention" to "Adesso","context" to "Context e Goal","sources" to "Fonti e ricerca","questions" to "Domande aperte","artifacts" to "Artifacts","people" to "Persone e accesso")[destination] ?: "Workspace"
    Scaffold(topBar={TopAppBar(title={Text(title)},navigationIcon={TextButton(onClick=back) {Text("Indietro")}})}) {padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            if(state.detail==null) Text("Caricamento del Workspace…") else when(destination) {
                "attention" -> AttentionContent(state,model)
                "context" -> ContextContent(state,model)
                "sources" -> SourcesContent(state,model)
                "questions" -> QuestionsContent(state,model)
                "artifacts" -> ArtifactsContent(state,model)
                "people" -> PeopleContent(state,model)
            }
            if(state.error.isNotEmpty()) Text(state.error,color=MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(24.dp))
        }
    }
}
@Composable private fun ContextContent(state:UiState,model:WorkspaceModel) {
    val d=state.detail ?: return;val w=d.getJSONObject("workspace");val members=d.rows("members");val actor=state.user?.id
    fun name(id:String)=members.firstOrNull{it.getString("user_id")==id}?.getString("name") ?: "Partecipante"
    var goal by remember {mutableStateOf("")}
    val pending = d.safeRows("interpretations").filter { it.getString("status") != "completed" }
    if (pending.isNotEmpty()) Text("Letture di Miriam", style=MaterialTheme.typography.titleMedium)
    pending.forEach { reading -> key(reading.getString("id")) {
        val status = reading.getString("status")
        DetailCard(if (status in setOf("queued", "running")) "Lettura in corso" else "Lettura da rivedere") {
            SourceReference(state, model, reading.getString("source_id"))
            Text(if (status == "stale") "Il contesto è cambiato durante la lettura." else aiFailureMessage(reading.optString("error_code")) ?: if (status == "failed") "Lettura non completata. Verifica gli input e riprova." else "Miriam sta leggendo il contesto pertinente.")
            if (status in setOf("failed", "stale")) TextButton(
                onClick={model.workspaceCommand(command("interpretation.retry", "interpretationId" to reading.getString("id")), "Riprova lettura")},
                enabled=!state.busy && members.any { it.getString("user_id") == actor && it.getBoolean("active") && it.getBoolean("contributes") }
            ) { Text("Riprova lettura") }
        }
    } }
    ProjectGovernance(state,model)
    Text("Goal",style=MaterialTheme.typography.titleLarge)
    if(d.rows("goals").isEmpty()) {Text("Potete conversare anche prima di stabilire un Goal.");OutlinedTextField(goal,{goal=it},label={Text("Il tuo intento iniziale")},modifier=Modifier.fillMaxWidth());Button(onClick={model.workspaceCommand(command("goal.establish","content" to goal),goal)},enabled=!state.busy && goal.isNotBlank()) {Text("Stabilisci il tuo Goal")}}
    d.rows("goals").forEach {g -> key(g.getString("id")) {DetailCard(g.getString("content")) {
        val adherences=d.rows("adherences").filter{it.getString("goal_id")==g.getString("id") && it.getInt("goal_version")==g.getInt("current_version")}
        Text("Versione ${g.getInt("current_version")} · "+if(g.getBoolean("current_primary")) "Goal corrente" else "Storico")
        Text("Stabilito da "+name(g.getString("established_by")))
        Text("Adesioni: "+adherences.map{name(it.getString("user_id"))}.ifEmpty{listOf("nessuna")}.joinToString(", "))
        if(g.getBoolean("current_primary") && adherences.none{it.getString("user_id")==actor}) Button(onClick={model.workspaceCommand(command("goal.adhere","goalId" to g.getString("id"),"version" to g.getInt("current_version")),"Adesione personale al Goal")},enabled=!state.busy) {Text("Aderisco a questa versione")}
        Text("Aderire non delega authority né approva decisioni future.",style=MaterialTheme.typography.bodySmall)
    }}}
    Text("Informazioni accettate",style=MaterialTheme.typography.titleLarge)
    d.rows("information").forEach {info -> key(info.getString("id")) {DetailCard(info.getString("subject")) {
        var replacement by remember {mutableStateOf("")};var reason by remember {mutableStateOf("")}
        Text(info.getString("content"));Text("${info.getString("qualification")} · v${info.getInt("current_version")} · accettata da ${name(info.getString("accepted_by"))}",style=MaterialTheme.typography.bodySmall)
        Text("Riferimento di lavoro, non consenso collettivo né certezza garantita.",style=MaterialTheme.typography.bodySmall)
        d.rows("versions").filter{it.getString("information_id")==info.getString("id")}.forEach {v->Text("v${v.getInt("version")} · ${v.getString("accepted_by_name")} · ${v.getString("created_at")}",style=MaterialTheme.typography.labelSmall);Text(v.getString("content"));Text(v.getString("reason"),style=MaterialTheme.typography.bodySmall)}
        Choice("Correzione",replacement,d.rows("candidates").filter{it.getString("classification")=="descriptive" && it.getInt("context_revision")==w.getInt("context_revision")}.map{it.getString("id") to it.getString("content")}) {replacement=it}
        OutlinedTextField(reason,{reason=it},label={Text("Motivo")})
        Button(onClick={model.workspaceCommand(command("information.correct","informationId" to info.getString("id"),"expectedVersion" to info.getInt("current_version"),"candidateId" to replacement,"reason" to reason,"descriptiveOnly" to true),"Correzione versionata")},enabled=!state.busy && replacement.isNotEmpty() && reason.isNotBlank()) {Text("Accetta correzione")}
    }}}
    Text("Da valutare",style=MaterialTheme.typography.titleLarge)
    d.rows("candidates").forEach {c->key(c.getString("id")) {DetailCard(c.getString("content")) {
        Text("${c.getString("qualification")} · ${c.getString("author_name")}",style=MaterialTheme.typography.bodySmall);Text(c.getString("source_content"));Text("Candidato non adottato",style=MaterialTheme.typography.bodySmall)
        if(c.getInt("context_revision")!=w.getInt("context_revision")) Text("Lo stato è cambiato: proposta da rivalutare.") else when(c.getString("classification")) {
            "descriptive" -> Button(onClick={model.workspaceCommand(command("information.accept","candidateId" to c.getString("id"),"descriptiveOnly" to true),"Accetta riferimento descrittivo")},enabled=!state.busy) {Text("Accetta come riferimento descrittivo")}
            "question" -> Button(onClick={model.workspaceCommand(command("question.open","candidateId" to c.getString("id"),"sourceId" to c.getString("source_id"),"content" to c.getString("content")),"Registra domanda")},enabled=!state.busy) {Text("Registra domanda aperta")}
            "normative" -> {var people by remember {mutableStateOf(setOf<String>())};Text("La proposta richiede l’approvazione delle persone indicate.");members.filter{it.getBoolean("active")}.forEach {p->Row {Checkbox(p.getString("user_id") in people,{people=if(it) people+p.getString("user_id") else people-p.getString("user_id")});Text(p.getString("name"))}};Button(onClick={model.workspaceCommand(command("commitment.propose","candidateId" to c.getString("id"),"people" to JSONArray(people.sorted())),"Proposta di impegno")},enabled=!state.busy && people.isNotEmpty()) {Text("Proponi impegno")}}
        }
    }}}
    Text("Atti e proposte",style=MaterialTheme.typography.titleLarge)
    d.rows("commitments").forEach {c->DetailCard(c.getString("content")) {
        Text(if(c.isNull("adopted_at")) "Proposta non ancora efficace" else "Atto adottato");Text("Persone rappresentate: "+c.strings("people").map(::name).joinToString(", "))
        if(c.isNull("adopted_at") && actor in c.strings("people")) Button(onClick={model.workspaceCommand(command("commitment.approve","proposalId" to c.getString("id"),"expectedContextRevision" to w.getInt("context_revision"),"expectedAccessRevision" to w.getInt("access_revision"),"representSelf" to true),"Approvazione personale dell’impegno")},enabled=!state.busy) {Text("Approvo soltanto per me")}
    }}
}
@Composable private fun SourcesContent(state:UiState,model:WorkspaceModel) {
    val d=state.detail ?: return;val context=LocalContext.current
    var processMedia by remember {mutableStateOf(false)}
    var file by remember {mutableStateOf<Uri?>(null)};var query by remember {mutableStateOf("")};var disclosed by remember {mutableStateOf(false)};var fileError by remember {mutableStateOf("")}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) {file=it;processMedia=false}
    Text("Condividi materiale",style=MaterialTheme.typography.titleLarge);Text("Fonti visibili ai membri attuali e futuri. Leggere una fonte non ne adotta il contenuto.")
    OutlinedButton(onClick={picker.launch(arrayOf("text/plain","text/csv","text/markdown","application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/*","audio/*"))}) {Text("Scegli file, immagine o audio")}
    var previousSource by remember{mutableStateOf("")};var previousMenu by remember{mutableStateOf(false)}
    TextButton(onClick={previousMenu=true}){Text(if(previousSource.isEmpty())"Nuovo documento" else "Aggiorna una fonte esistente")}
    DropdownMenu(expanded=previousMenu,onDismissRequest={previousMenu=false}){DropdownMenuItem(text={Text("Nuovo documento")},onClick={previousSource="";previousMenu=false});d.rows("sources").filter{it.getString("kind")=="document"}.forEach{source->DropdownMenuItem(text={Text(source.getString("title")+" · "+source.getString("created_at"))},onClick={previousSource=source.getString("id");previousMenu=false})}}
    VoiceNoteControls {file=it;processMedia=false}
    Row {Checkbox(processMedia,{processMedia=it});Text("Consento l’invio di immagini/audio al provider configurato per comprenderli")}
    Text("Testi fino a 1 MB; PDF, DOCX, immagini e audio fino a 8 MB. Puoi condividere l’originale senza autorizzare l’elaborazione AI.",style=MaterialTheme.typography.bodySmall)
    file?.let {uri -> Button(onClick={try {
        val name=if(uri.scheme=="file") uri.lastPathSegment ?: "Nota-vocale.m4a" else context.contentResolver.query(uri,null,null,null,null)?.use {cursor->if(cursor.moveToFirst()) {val column=cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);if(column>=0) cursor.getString(column) else null} else null} ?: "document.txt"
        val bytes=context.contentResolver.openInputStream(uri)?.use{readBoundedDocument(it)} ?: error("Documento non leggibile")
        val limit=if(name.substringAfterLast(".").lowercase() in listOf("txt","md","csv")) 1_048_576 else 8_388_608
        require(bytes.size<=limit) {"File troppo grande per questo formato."}
        val body=command("document.upload","filename" to name,"bytesBase64" to Base64.encodeToString(bytes,Base64.NO_WRAP));if(processMedia) body.put("allowModelProcessing",true);if(previousSource.isNotEmpty())body.put("previousSourceId",previousSource);model.workspaceCommand(body,"Condividi $name"){file=null;processMedia=false;previousSource=""}
    } catch(e:Exception) {fileError=e.message ?: "Impossibile leggere il documento"}},enabled=!state.busy) {Text("Condividi nel Workspace")}}
    if(fileError.isNotEmpty()) Text(fileError,color=MaterialTheme.colorScheme.error)
    Text("Ricerca web",style=MaterialTheme.typography.titleLarge);OutlinedTextField(query,{query=it},label={Text("Cosa vuoi cercare?")},modifier=Modifier.fillMaxWidth());Row {Checkbox(disclosed,{disclosed=it});Text("Autorizzo l’invio di questa query al servizio di ricerca")}
    Button(onClick={model.workspaceCommand(command("research.request","query" to query,"discloseQuery" to true),"Ricerca: $query")},enabled=!state.busy && query.isNotBlank() && disclosed) {Text("Cerca")}
    d.rows("research").forEach {work->DetailCard(work.getString("query")) {Text(if(work.getString("status")=="needs_configuration") "Servizio di ricerca da collegare" else work.getString("status"));Button(onClick={model.workspaceCommand(command("research.retry","workId" to work.getString("id")),"Riprendi ricerca")},enabled=!state.busy) {Text("Riprova")};TextButton(onClick={model.workspaceCommand(command("research.cancel","workId" to work.getString("id")),"Interrompi ricerca")},enabled=!state.busy) {Text("Interrompi")}}}
    Text("Fonti condivise",style=MaterialTheme.typography.titleLarge);d.rows("sources").forEach {source->DetailCard(source.getString("title")) {Text(source.getString("qualification"),style=MaterialTheme.typography.bodySmall);Text(source.getString("content").ifEmpty{"Originale condiviso; contenuto non ancora disponibile."});if(!source.isNull("media_type"))SourceOriginalButton(model,source);DetailCard("Storia dell’elaborazione"){source.safeRows("processing_history").forEach{event->Text(event.getString("created_at")+" · "+event.getString("kind"),style=MaterialTheme.typography.bodySmall);if(!event.isNull("error_code"))Text(event.getString("error_code"))}};Text(source.getString("created_at"),style=MaterialTheme.typography.bodySmall)
        if(!source.isNull("processing_status")){val status=source.getString("processing_status");Text(processingLabel(status),style=MaterialTheme.typography.bodySmall);if(!source.isNull("processing_error"))Text(source.getString("processing_error"));if(status in listOf("needs_configuration","needs_input","failed"))TextButton(onClick={val c=command("document.retry","sourceId" to source.getString("id"));if(processMedia)c.put("allowModelProcessing",true);model.workspaceCommand(c,"Elabora "+source.getString("title"))},enabled=!state.busy){Text("Richiedi elaborazione")}}
        if(!source.isNull("extraction_provider"))Text("Estratto tramite "+source.getString("extraction_provider"),style=MaterialTheme.typography.bodySmall)}}
}
@Composable private fun QuestionsContent(state:UiState,model:WorkspaceModel) {
    val d=state.detail ?: return;var content by remember {mutableStateOf("")};var source by remember {mutableStateOf("")}
    DetailCard("Nuova domanda") {OutlinedTextField(content,{content=it},label={Text("Cosa resta da chiarire?")});Choice("Messaggio di origine",source,state.messages.map{it.id to it.content}) {source=it};Button(onClick={model.workspaceCommand(command("question.open","content" to content,"sourceId" to source),content)},enabled=!state.busy && content.isNotBlank() && source.isNotBlank()) {Text("Registra domanda")}}
    d.rows("questions").forEach {q->key(q.getString("id")) {DetailCard(q.getString("content")) {
        var answer by remember {mutableStateOf("")};var reason by remember {mutableStateOf("")};val open=q.getString("status")=="open"
        Text((if(open) "Aperta" else "Risposta registrata")+" · v${q.getInt("version")}");Text(q.getString("reason"),style=MaterialTheme.typography.bodySmall)
        if(open) Choice("Informazione che risponde",answer,d.rows("information").map{it.getString("id") to it.getString("content")}) {answer=it}
        OutlinedTextField(reason,{reason=it},label={Text("Motivazione")})
        Button(onClick={if(open) {val info=d.rows("information").firstOrNull{it.getString("id")==answer};if(info!=null) model.workspaceCommand(command("question.answer","questionId" to q.getString("id"),"expectedVersion" to q.getInt("version"),"informationId" to answer,"informationVersion" to info.getInt("current_version"),"reason" to reason),"Risposta alla domanda")} else model.workspaceCommand(command("question.reopen","questionId" to q.getString("id"),"expectedVersion" to q.getInt("version"),"reason" to reason),"Riapertura domanda")},enabled=!state.busy && reason.isNotBlank() && (!open || answer.isNotBlank())) {Text(if(open) "Collega la risposta" else "Riapri domanda")}
    }}}
}
@Composable private fun ArtifactsContent(state:UiState,model:WorkspaceModel) {
    var editing by remember{mutableStateOf(false)};var existing by remember{mutableStateOf<JSONObject?>(null)}
    if(editing)ArtifactEditor(state,model,existing){editing=false}
    TextButton(onClick={existing=null;editing=true}){Text("Scrivi un nuovo Artifact")}
    val d=state.detail ?: return;var title by remember {mutableStateOf("")};var notes by remember {mutableStateOf("")};var question by remember {mutableStateOf("")};var selected by remember {mutableStateOf(setOf<String>())}
    DetailCard("Prepara un documento") {
        OutlinedTextField(title,{title=it},label={Text("Titolo")});OutlinedTextField(notes,{notes=it},label={Text("Istruzioni e note")});Choice("Domanda a cui risponde",question,d.rows("questions").map{it.getString("id") to it.getString("content")}) {question=it}
        d.rows("information").forEach {info->Row {Checkbox(info.getString("id") in selected,{selected=if(it) selected+info.getString("id") else selected-info.getString("id")});Text(info.getString("subject"))}}
        Button(onClick={val q=d.rows("questions").firstOrNull{it.getString("id")==question};if(q!=null) model.workspaceCommand(command("artifact.draft","title" to title,"notes" to notes,"questionId" to question,"questionVersion" to q.getInt("version"),"information" to JSONArray(d.rows("information").filter{it.getString("id") in selected}.map{JSONObject().put("id",it.getString("id")).put("version",it.getInt("current_version"))}),"sourceIds" to JSONArray()),"Prepara $title")},enabled=!state.busy && title.isNotBlank() && question.isNotBlank() && selected.isNotEmpty()) {Text("Prepara bozza")}
        Text("La bozza non è adottata e non autorizza azioni esterne.",style=MaterialTheme.typography.bodySmall)
    }
    d.rows("artifacts").forEach {a->val version=d.rows("artifactVersions").firstOrNull{it.getString("artifact_id")==a.getString("id") && it.getInt("version")==a.getInt("current_draft_version")};if(version!=null) key(a.getString("id")) {DetailCard(version.getString("title")) {
        var people by remember {mutableStateOf(setOf<String>())}
        Text("Bozza v${version.getInt("version")}"+if(a.isNull("current_adoption_id")) " · non adottata" else " · esiste una versione adottata");ArtifactBody(state,model,version);TextButton(onClick={existing=version;editing=true}){Text("Modifica la bozza")}
        if(version.strings("outdated_reasons").isNotEmpty()) Text("Potenzialmente superata: "+version.strings("outdated_reasons").joinToString("; "),color=MaterialTheme.colorScheme.error)
        DetailCard("Storia") {d.rows("artifactVersions").filter{it.getString("artifact_id")==a.getString("id")}.forEach {v->Text("v${v.getInt("version")} · ${v.getString("reason")}");ArtifactBody(state,model,v)}}
        Text("Chi deve approvare questa versione?");d.rows("members").filter{it.getBoolean("active")}.forEach {person->Row {Checkbox(person.getString("user_id") in people,{people=if(it) people+person.getString("user_id") else people-person.getString("user_id")});Text(person.getString("name"))}}
        Button(onClick={model.workspaceCommand(command("artifact.review","artifactId" to a.getString("id"),"version" to version.getInt("version"),"people" to JSONArray(people.sorted()),"nonOperative" to true),"Proposta di adozione del documento")},enabled=!state.busy && people.isNotEmpty()) {Text("Proponi adozione non operativa")}
        d.rows("artifactReviews").filter{it.getString("artifact_id")==a.getString("id") && it.getInt("artifact_version")==version.getInt("version") && state.user?.id in it.strings("people")}.forEach {review->if(d.rows("artifactApprovals").none{it.getString("review_id")==review.getString("id") && it.getString("person_id")==state.user?.id}) Button(onClick={model.workspaceCommand(command("artifact.approve","reviewId" to review.getString("id"),"expectedAccessRevision" to d.getJSONObject("workspace").getInt("access_revision"),"representSelf" to true,"nonOperative" to true),"Approvazione personale dell’Artifact")},enabled=!state.busy) {Text("Approvo questa versione per me")}}
    }}}
}
@Composable private fun PeopleContent(state:UiState,model:WorkspaceModel) {
    val d=state.detail ?: return;var email by remember {mutableStateOf("")};var disclosed by remember {mutableStateOf(false)};var sendEmail by remember {mutableStateOf(false)};var confirm by remember {mutableStateOf("")}
    d.rows("members").forEach {person->Text(person.getString("name"),style=MaterialTheme.typography.titleMedium);Text(if(person.getBoolean("active")) "Membro" else "Partecipazione terminata",style=MaterialTheme.typography.bodySmall)}
    Text("Membership e contribuzione non conferiscono project authority.",style=MaterialTheme.typography.bodySmall)
    if(d.rows("access").any{it.getString("holder_id")==state.user?.id && it.getBoolean("active") && it.getBoolean("invitations")}) {
        DetailCard("Invita una persona") {OutlinedTextField(email,{email=it},label={Text("Email")});Row {Checkbox(disclosed,{disclosed=it});Text("L’invito dichiara l’accesso alla storia condivisa conservata")};Row {Checkbox(sendEmail,{sendEmail=it});Text("Invia anche un’email al destinatario")};Button(onClick={model.workspaceCommand(command("invitation.create","email" to email,"fullHistoryDisclosed" to true,"sendEmail" to sendEmail),"Invito a $email")},enabled=!state.busy && email.isNotBlank() && disclosed) {Text("Crea invito")};if(state.invitationLink.isNotEmpty()) {Text(state.invitationLink);val context=LocalContext.current;TextButton(onClick={context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT,state.invitationLink),"Condividi invito"))}) {Text("Condividi invito")}}}
        d.rows("invitations").forEach {invite->Text(invite.getString("recipient_email"));Text(invitationDeliveryLabel(invite.optString("delivery_status")),style=MaterialTheme.typography.bodySmall);if(invite.isNull("accepted_at") && invite.isNull("revoked_at")) TextButton(onClick={model.workspaceCommand(command("invitation.revoke","invitationId" to invite.getString("id")),"Revoca invito")},enabled=!state.busy) {Text("Revoca invito")}}
    }
    var removing by remember{mutableStateOf<String?>(null)}
    if(d.rows("access").any{it.getString("holder_id")==state.user?.id && it.getBoolean("active") && it.getBoolean("remove_members")})d.rows("members").filter{it.getBoolean("active") && it.getString("user_id")!=state.user?.id}.forEach{person->TextButton(onClick={removing=person.getString("user_id")}){Text("Rimuovi accesso: "+person.getString("name"))}}
    if(removing!=null)AlertDialog(onDismissRequest={removing=null},title={Text("Rimuovere accesso?")},text={Text("Storia e obblighi restano; le relazioni protette richiedono i loro accordi.")},confirmButton={TextButton(onClick={model.workspaceCommand(command("member.remove","personId" to removing,"expectedAccessRevision" to d.getJSONObject("workspace").getInt("access_revision"),"confirmed" to true),"Rimozione accesso");removing=null}){Text("Rimuovi accesso")}},dismissButton={TextButton(onClick={removing=null}){Text("Annulla")}})
    WorkspaceLinks(state,model)
    AccessGovernance(state,model)
    TextButton(onClick={confirm="access.relinquish"}) {Text("Rinuncia alla tua governance")};TextButton(onClick={confirm="member.leave"}) {Text("Lascia il Workspace")}
    if(confirm.isNotEmpty()) AlertDialog(onDismissRequest={confirm=""},title={Text(if(confirm=="member.leave") "Lasciare il Workspace?" else "Rinunciare alla governance?")},text={Text("Storia e obblighi restano. Nessun successore viene nominato automaticamente.")},confirmButton={TextButton(onClick={model.workspaceCommand(command(confirm,"confirmed" to true),"Termina partecipazione personale");confirm=""}) {Text("Conferma")}},dismissButton={TextButton(onClick={confirm=""}) {Text("Annulla")}})
}
@Composable fun InvitationEntry(state:UiState,model:WorkspaceModel) {
    var token by remember {mutableStateOf("")};var accepted by remember {mutableStateOf(false)}
    DetailCard("Hai ricevuto un invito?") {OutlinedTextField(token,{token=it},label={Text("Link o codice d’invito")},modifier=Modifier.fillMaxWidth());Text("L’ammissione permette di leggere la storia condivisa conservata. Non implica adesione al Goal o authority.");Row {Checkbox(accepted,{accepted=it});Text("Accetto questa conseguenza dell’ammissione")};Button(onClick={val value=runCatching{Uri.parse(token).getQueryParameter("invite")}.getOrNull() ?: token;model.acceptInvitation(value)},enabled=!state.busy && token.isNotBlank() && accepted) {Text("Accetta invito")}}
}

private fun readBoundedDocument(input:java.io.InputStream):ByteArray {val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(output.size()<=8_388_608) {val count=input.read(buffer,0,minOf(buffer.size,8_388_609-output.size()));if(count<0) break;output.write(buffer,0,count)};return output.toByteArray()}

private fun invitationDeliveryLabel(status:String)=when(status) {
 "queued" -> "Email in coda"
 "needs_configuration" -> "Invio email da configurare; puoi condividere il link"
 "running" -> "Invio email in corso"
 "submitted" -> "Email affidata al servizio di invio; recapito non ancora verificato"
 "unknown" -> "Esito email incerto; non creare un nuovo invio senza verifica"
 "cancelled" -> "Invio annullato: invito non più valido"
 "expired" -> "Invio scaduto"
 else -> "Solo link, nessuna email richiesta"
}

@Composable private fun WorkspaceLinks(state:UiState,model:WorkspaceModel){
 val links=state.detail?.rows("links") ?: emptyList()
 DetailCard("Spazi collegati") {
  Text("Visibili solo a chi accede a entrambi. Nessun contenuto o permesso viene ereditato.",style=MaterialTheme.typography.bodySmall)
  links.filter{it.getBoolean("active")}.forEach{link ->
   TextButton(onClick={model.select(link.getString("id"))}){Text(link.getString("name")+" ↗")}
   TextButton(onClick={model.workspaceCommand(command("workspace.link","otherWorkspaceId" to link.getString("id"),"expectedVersion" to link.getInt("version"),"linked" to false),"Scollega spazio")},enabled=!state.busy){Text("Scollega")}
   var history by remember(link.getString("id")){mutableStateOf(false)}
   TextButton(onClick={history=!history}){Text("Origine del collegamento")}
   if(history)link.rows("history").forEach{v->Text("v${v.getInt("version")} · ${if(v.getBoolean("active"))"Collegato" else "Scollegato"} · ${v.getString("actor_id")} · ${v.getString("created_at")}",style=MaterialTheme.typography.bodySmall)}
  }
  state.spaces.filter{space->space.id!=state.selected && links.none{it.getString("id")==space.id && it.getBoolean("active")}}.forEach{space ->
   TextButton(onClick={model.workspaceCommand(command("workspace.link","otherWorkspaceId" to space.id,"expectedVersion" to (links.firstOrNull{it.getString("id")==space.id}?.getInt("version") ?: 0),"linked" to true),"Collega spazi")},enabled=!state.busy){Text("Collega: "+space.name)}
  }
 }
}
