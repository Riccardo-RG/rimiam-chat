package it.miriam.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun AttentionContent(state:UiState,model:WorkspaceModel,includeWorkstreams:Boolean=true) {
    val scope=rememberCoroutineScope();val view=state.attention
    LaunchedEffect(Unit){model.loadAttention()}
    if(view==null){Text("Caricamento dello stato…");return}
    Text("Merita attenzione",style=MaterialTheme.typography.titleLarge)
    if(view.rows("attention").isEmpty())Text("Nessuna attenzione segnalata nello stato corrente.",style=MaterialTheme.typography.bodyMedium)
    view.rows("attention").forEach{item->Text(item.getString("text"),style=MaterialTheme.typography.titleMedium);Text(item.getString("reason"),style=MaterialTheme.typography.bodySmall)}
    Text("Cosa è cambiato",style=MaterialTheme.typography.titleLarge);Text("Dal tuo ultimo allineamento esplicito. Questo non è consenso o ricevuta di lettura.",style=MaterialTheme.typography.bodySmall)
    view.rows("changes").forEach{change->Text(change.getString("kind").replace("."," · "),style=MaterialTheme.typography.bodyMedium);Text("Revisione ${change.getInt("revision")} · ${change.getString("createdAt")}",style=MaterialTheme.typography.bodySmall);HorizontalDivider()}
    Button(onClick={model.workspaceCommand(JSONObject().put("type","attention.aligned").put("revision",view.getInt("revision")),"Allineamento personale con lo stato")},enabled=!state.busy){Text("Sono allineato con questo stato")}
    if(!view.isNull("nextBefore"))TextButton(onClick={scope.launch{model.loadAttention(view.getInt("nextBefore"))}}){Text("Cambiamenti precedenti")}
    Text("Come collabora Miriam",style=MaterialTheme.typography.titleLarge)
    val preference=view.getJSONObject("preference")
    listOf("discreet" to "Solo quando chiamata","collaborative" to "Collaborativa","proactive" to "Proattiva").forEach{(mode,label)->FilterChip(selected=preference.getString("mode")==mode,onClick={model.workspaceCommand(JSONObject().put("type","attention.preference").put("mode",mode).put("expectedVersion",preference.getInt("version")),"Preferenza di collaborazione: $label")},enabled=!state.busy,label={Text(label)})}
    Text("Lo stile non cambia authority, consenso o permessi.",style=MaterialTheme.typography.bodySmall)
    if(includeWorkstreams)WorkstreamsContent(state,model)
}
@Composable fun WorkstreamsContent(state:UiState,model:WorkspaceModel,onFocus:((WorkstreamFocus)->Unit)?=null) {
    val view=state.attention
    LaunchedEffect(Unit){model.loadAttention()}
    if(view==null){Text("Caricamento dei filoni…");return}
    var title by remember{mutableStateOf("")};var description by remember{mutableStateOf("")}
    val canContribute=state.detail?.rows("members")?.any {it.getString("user_id")==state.user?.id && it.getBoolean("active") && it.getBoolean("contributes")}==true
    fun actorName(id:String)=state.detail?.rows("members")?.firstOrNull{it.getString("user_id")==id}?.getString("name") ?: "Partecipante"
    Text("Filoni di lavoro",style=MaterialTheme.typography.titleLarge);Text("Viste semantiche della stessa conversazione, non Sub-goal né nuove chat.",style=MaterialTheme.typography.bodySmall)
    var showInactive by rememberSaveable{mutableStateOf(false)}
    Row{Checkbox(showInactive,{showInactive=it});Text("Includi proposte e filoni conclusi")}
    val streams=view.rows("workstreams").filter{showInactive || it.getString("state")=="active"}
    if(streams.isEmpty())Text(if(showInactive)"Nessun filone registrato." else "Nessun filone attivo.")
    streams.forEach{stream->key(stream.getString("id")) {var open by rememberSaveable{mutableStateOf(false)};var source by remember{mutableStateOf("")};var history by rememberSaveable{mutableStateOf(false)}
        OutlinedCard(Modifier.fillMaxWidth(),border=BorderStroke(1.5.dp,MaterialTheme.colorScheme.outlineVariant)){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick={open=!open},modifier=Modifier.fillMaxWidth().semantics {stateDescription=if(open)"Espanso" else "Ridotto"}){Text(stream.getString("title"),style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f));Text(if(open)"−" else "+")};Text(workstreamLabel(stream.getString("state"))+" · v${stream.getInt("version")}",style=MaterialTheme.typography.labelMedium);if(open){
            Text(stream.getString("description"))
            if(onFocus!=null)TextButton(onClick={onFocus(WorkstreamFocus(stream.getString("id"),stream.getInt("version")))}){Text("Apri la conversazione del filone")}
            ReferenceLink(ConversationReference("workstream",stream.getString("id"),stream.getInt("version")))
            Text(if(stream.isNull("actor"))"Origine: ${stream.getString("origin")}" else "Registrato da ${actorName(stream.getString("actor"))}",style=MaterialTheme.typography.bodySmall)
            val actions=when(stream.getString("state")){"proposed"->listOf("activate" to "Attiva filone");"active"->listOf("resolve" to "Segna come risolto");"resolved"->listOf("archive" to "Archivia filone","reopen" to "Riapri filone");"archived"->listOf("reopen" to "Riapri filone");else->emptyList()}
            actions.forEach{(action,label)->OutlinedButton(onClick={model.workspaceCommand(command("workstream.transition","workstreamId" to stream.getString("id"),"expectedVersion" to stream.getInt("version"),"action" to action),label)},enabled=!state.busy&&canContribute){Text(label)}}
            Text("Il lifecycle del filone non conclude Goal, attività o impegni.",style=MaterialTheme.typography.bodySmall)
            TextButton(onClick={history=!history}){Text("Versioni e storia")}
            if(history)stream.rows("history").forEach{version->Text("v${version.getInt("version")} · ${version.getString("createdAt")}",style=MaterialTheme.typography.labelMedium);Text(version.getString("title"));Text(version.getString("description"));Text(if(version.isNull("lifecycleState"))"Stato non registrato in questa versione" else workstreamLabel(version.getString("lifecycleState")),style=MaterialTheme.typography.bodySmall);if(!version.isNull("actor"))Text(actorName(version.getString("actor")),style=MaterialTheme.typography.bodySmall)}
            stream.rows("sources").filter{it.getBoolean("included")}.forEach{item->Text(item.getString("content"));SourceReference(state,model,item.getString("id"));TextButton(onClick={model.workspaceCommand(JSONObject().put("type","workstream.link").put("workstreamId",stream.getString("id")).put("sourceId",item.getString("id")).put("expectedVersion",item.getInt("version")).put("included",false),"Rimuovi collegamento semantico")},enabled=!state.busy&&canContribute){Text("Rimuovi solo questo collegamento")}}
            var menu by remember{mutableStateOf(false)};Box{OutlinedButton(onClick={menu=true}){Text(state.messages.firstOrNull{it.id==source}?.content ?: "Scegli messaggio da collegare")};DropdownMenu(menu,onDismissRequest={menu=false}){state.messages.forEach{message->DropdownMenuItem(text={Text(message.content)},onClick={source=message.id;menu=false})}}}
            Button(onClick={val old=stream.rows("sources").firstOrNull{it.getString("id")==source};model.workspaceCommand(JSONObject().put("type","workstream.link").put("workstreamId",stream.getString("id")).put("sourceId",source).put("expectedVersion",old?.getInt("version") ?: 0).put("included",true),"Collegamento semantico")},enabled=!state.busy&&canContribute&&source.isNotEmpty()){Text("Collega al filone")}
        }}}
    }}
    var create by remember{mutableStateOf(false)};TextButton(onClick={create=!create},enabled=canContribute){Text("Organizza un filone")};if(create){OutlinedTextField(title,{title=it},label={Text("Titolo")},modifier=Modifier.fillMaxWidth());OutlinedTextField(description,{description=it},label={Text("Descrizione")},modifier=Modifier.fillMaxWidth());Button(onClick={model.workspaceCommand(JSONObject().put("type","workstream.save").put("title",title).put("description",description),title)},enabled=!state.busy&&canContribute&&title.isNotBlank()&&title.trim().length<=160&&description.length<=4000){Text("Crea vista semantica")}}
}
private fun workstreamLabel(state:String)=mapOf("active" to "Attivo","proposed" to "Proposto","resolved" to "Risolto","archived" to "Archiviato")[state] ?: state
