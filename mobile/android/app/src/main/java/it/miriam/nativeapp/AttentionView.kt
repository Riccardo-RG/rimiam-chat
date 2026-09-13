package it.miriam.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun AttentionContent(state:UiState,model:WorkspaceModel) {
    val scope=rememberCoroutineScope();val view=state.attention
    LaunchedEffect(Unit){model.loadAttention()}
    if(view==null){Text("Caricamento dello stato…");return}
    var title by remember{mutableStateOf("")};var description by remember{mutableStateOf("")};var source by remember{mutableStateOf("")}
    Text("Merita attenzione",style=MaterialTheme.typography.titleLarge)
    view.rows("attention").forEach{item->Text(item.getString("text"),style=MaterialTheme.typography.titleMedium);Text(item.getString("reason"),style=MaterialTheme.typography.bodySmall)}
    Text("Cosa è cambiato",style=MaterialTheme.typography.titleLarge);Text("Dal tuo ultimo allineamento esplicito. Questo non è consenso o ricevuta di lettura.",style=MaterialTheme.typography.bodySmall)
    view.rows("changes").forEach{change->Text("${change.getString("kind")} · ${change.getString("createdAt")}",style=MaterialTheme.typography.bodySmall)}
    Button(onClick={model.workspaceCommand(JSONObject().put("type","attention.aligned").put("revision",view.getInt("revision")),"Allineamento personale con lo stato")},enabled=!state.busy){Text("Sono allineato con questo stato")}
    if(!view.isNull("nextBefore"))TextButton(onClick={scope.launch{model.loadAttention(view.getInt("nextBefore"))}}){Text("Cambiamenti precedenti")}
    Text("Come collabora Miriam",style=MaterialTheme.typography.titleLarge)
    val preference=view.getJSONObject("preference")
    listOf("discreet" to "Solo quando chiamata","collaborative" to "Collaborativa","proactive" to "Proattiva").forEach{(mode,label)->FilterChip(selected=preference.getString("mode")==mode,onClick={model.workspaceCommand(JSONObject().put("type","attention.preference").put("mode",mode).put("expectedVersion",preference.getInt("version")),"Preferenza di collaborazione: $label")},enabled=!state.busy,label={Text(label)})}
    Text("Lo stile non cambia authority, consenso o permessi.",style=MaterialTheme.typography.bodySmall)
    Text("Filoni di lavoro",style=MaterialTheme.typography.titleLarge);Text("Viste semantiche della stessa conversazione, non Sub-goal né nuove chat.",style=MaterialTheme.typography.bodySmall)
    view.rows("workstreams").forEach{stream->var open by remember(stream.getString("id")){mutableStateOf(false)}
        Card(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick={open=!open}){Text(stream.getString("title"))};if(open){
            Text(stream.getString("description"));stream.rows("sources").filter{it.getBoolean("included")}.forEach{item->Text(item.getString("content"));TextButton(onClick={model.workspaceCommand(JSONObject().put("type","workstream.link").put("workstreamId",stream.getString("id")).put("sourceId",item.getString("id")).put("expectedVersion",item.getInt("version")).put("included",false),"Rimuovi collegamento semantico")},enabled=!state.busy){Text("Rimuovi solo questo collegamento")}}
            var menu by remember{mutableStateOf(false)};Box{OutlinedButton(onClick={menu=true}){Text(state.messages.firstOrNull{it.id==source}?.content ?: "Scegli messaggio da collegare")};DropdownMenu(menu,onDismissRequest={menu=false}){state.messages.forEach{message->DropdownMenuItem(text={Text(message.content)},onClick={source=message.id;menu=false})}}}
            Button(onClick={val old=stream.rows("sources").firstOrNull{it.getString("id")==source};model.workspaceCommand(JSONObject().put("type","workstream.link").put("workstreamId",stream.getString("id")).put("sourceId",source).put("expectedVersion",old?.getInt("version") ?: 0).put("included",true),"Collegamento semantico")},enabled=!state.busy&&source.isNotEmpty()){Text("Collega al filone")}
        }}}
    }
    var create by remember{mutableStateOf(false)};TextButton(onClick={create=!create}){Text("Organizza un filone")};if(create){OutlinedTextField(title,{title=it},label={Text("Titolo")});OutlinedTextField(description,{description=it},label={Text("Descrizione")});Button(onClick={model.workspaceCommand(JSONObject().put("type","workstream.save").put("title",title).put("description",description),title)},enabled=!state.busy&&title.isNotBlank()){Text("Crea vista semantica")}}
}
