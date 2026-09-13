package it.miriam.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ArtifactEditor(state:UiState,model:WorkspaceModel,existing:JSONObject?=null,dismiss:()->Unit){
    var title by remember{mutableStateOf(existing?.optString("title") ?: "")};var purpose by remember{mutableStateOf(existing?.optString("purpose")?.takeIf{it!="null"} ?: "")};var reason by remember{mutableStateOf("")}
    val blocks=remember {mutableStateListOf<JSONObject>().apply {val previous=existing?.optJSONArray("blocks");if(previous!=null&&previous.length()>0)repeat(previous.length()){add(JSONObject(previous.getJSONObject(it).toString()))} else add(JSONObject().put("type","paragraph").put("text",existing?.optString("body") ?: ""))}}
    var remove by remember{mutableStateOf<Int?>(null)};var menu by remember{mutableStateOf(false)}
    fun update(index:Int,change:(JSONObject)->Unit){val next=JSONObject(blocks[index].toString());change(next);blocks[index]=next}
    BackHandler{dismiss()}
    Dialog(onDismissRequest=dismiss,properties=DialogProperties(usePlatformDefaultWidth=false)){Surface(Modifier.fillMaxSize()){Scaffold(topBar={TopAppBar(title={Text(if(existing==null)"Nuovo Artifact" else "Modifica bozza")},navigationIcon={TextButton(onClick=dismiss){Text("Chiudi")}})}){padding->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            OutlinedTextField(title,{title=it},label={Text("Titolo")},modifier=Modifier.fillMaxWidth());OutlinedTextField(purpose,{purpose=it},label={Text("A cosa serve?")},modifier=Modifier.fillMaxWidth());OutlinedTextField(reason,{reason=it},label={Text("Motivo della versione")},modifier=Modifier.fillMaxWidth())
            blocks.forEachIndexed{index,block->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                when(block.getString("type")){
                    "paragraph","heading"->OutlinedTextField(block.getString("text"),{text->update(index){it.put("text",text)}},label={Text(if(block.getString("type")=="heading")"Titolo della sezione" else "Testo")},modifier=Modifier.fillMaxWidth())
                    "checklist"->{val items=block.getJSONArray("items");repeat(items.length()){i->val item=items.getJSONObject(i);Row{Checkbox(item.getBoolean("checked"),{checked->update(index){it.getJSONArray("items").getJSONObject(i).put("checked",checked)}});OutlinedTextField(item.getString("text"),{text->update(index){it.getJSONArray("items").getJSONObject(i).put("text",text)}},label={Text("Voce")})}};TextButton(onClick={update(index){it.getJSONArray("items").put(JSONObject().put("text","").put("checked",false))}}){Text("Aggiungi voce")}}
                    "table"->{val columns=block.getJSONArray("columns");val rows=block.getJSONArray("rows");Column(Modifier.horizontalScroll(rememberScrollState())){Row{repeat(columns.length()){c->OutlinedTextField(columns.getString(c),{text->update(index){it.getJSONArray("columns").put(c,text)}},label={Text("Colonna ${c+1}")},modifier=Modifier.width(160.dp))}};repeat(rows.length()){r->Row{repeat(columns.length()){c->OutlinedTextField(rows.getJSONArray(r).optString(c),{text->update(index){it.getJSONArray("rows").getJSONArray(r).put(c,text)}},label={Text("Riga ${r+1}")},modifier=Modifier.width(160.dp))}}}};TextButton(onClick={update(index){it.getJSONArray("rows").put(JSONArray(List(columns.length()){ "" }))}}){Text("Aggiungi riga")};TextButton(onClick={update(index){it.getJSONArray("columns").put("Colonna");val all=it.getJSONArray("rows");repeat(all.length()){r->all.getJSONArray(r).put("")}}}){Text("Aggiungi colonna")}}
                    "image"->{var imageMenu by remember{mutableStateOf(false)};Box{OutlinedButton(onClick={imageMenu=true}){Text(state.detail?.rows("sources")?.firstOrNull{it.getString("id")==block.optString("sourceId")}?.getString("title") ?: "Scegli immagine condivisa")};DropdownMenu(imageMenu,onDismissRequest={imageMenu=false}){state.detail?.rows("sources")?.filter{it.optString("media_type").startsWith("image/")}?.forEach{source->DropdownMenuItem(text={Text(source.getString("title"))},onClick={update(index){it.put("sourceId",source.getString("id"))};imageMenu=false})}}};OutlinedTextField(block.optString("alt"),{text->update(index){it.put("alt",text)}},label={Text("Descrizione accessibile")});OutlinedTextField(block.optString("caption"),{text->update(index){it.put("caption",text)}},label={Text("Didascalia")})}
                }
                TextButton(onClick={remove=index}){Text("Rimuovi blocco")}
            }}}
            Box{OutlinedButton(onClick={menu=true}){Text("Aggiungi blocco")};DropdownMenu(menu,onDismissRequest={menu=false}){listOf("paragraph" to "Paragrafo","heading" to "Titolo","checklist" to "Checklist","table" to "Tabella","image" to "Immagine condivisa").forEach{(type,label)->DropdownMenuItem(text={Text(label)},onClick={val value=JSONObject().put("type",type);when(type){"paragraph","heading"->value.put("text","");"checklist"->value.put("items",JSONArray().put(JSONObject().put("text","").put("checked",false)));"table"->value.put("columns",JSONArray(listOf("Voce","Dettaglio"))).put("rows",JSONArray().put(JSONArray(listOf("",""))));"image"->value.put("sourceId","").put("alt","").put("caption","")};blocks.add(value);menu=false})}}}
            Text("Salva una bozza versionata non operativa. Non adotta contenuti né modifica obblighi.",style=MaterialTheme.typography.bodySmall)
            Button(onClick={val sources=mutableSetOf<String>();blocks.filter{it.getString("type")=="image"}.forEach{sources.add(it.optString("sourceId"))};val info=JSONArray();if(existing!=null){state.detail?.rows("artifactInformation")?.filter{it.getString("artifact_id")==existing.getString("artifact_id")&&it.getInt("artifact_version")==existing.getInt("version")}?.forEach{info.put(JSONObject().put("id",it.getString("information_id")).put("version",it.getInt("information_version")))};state.detail?.rows("artifactSources")?.filter{it.getString("artifact_id")==existing.getString("artifact_id")&&it.getInt("artifact_version")==existing.getInt("version")}?.forEach{sources.add(it.getString("source_id"))}}
                val body=JSONObject().put("type","artifact.compose").put("title",title).put("purpose",purpose).put("reason",reason).put("blocks",JSONArray(blocks)).put("information",info).put("sourceIds",JSONArray(sources.filter{it.isNotEmpty()}.sorted())).put("nonOperative",true)
                if(existing!=null){body.put("artifactId",existing.getString("artifact_id")).put("expectedVersion",existing.getInt("version"));if(!existing.isNull("contribution_id"))body.put("contributionId",existing.getString("contribution_id"))};model.workspaceCommand(body,"Bozza: $title",dismiss)
            },enabled=!state.busy&&title.isNotBlank()&&purpose.isNotBlank()&&reason.isNotBlank()&&blocks.isNotEmpty()){Text("Salva bozza")}
            if(state.error.isNotEmpty())Text(state.error,color=MaterialTheme.colorScheme.error)
        }
    }}}
    remove?.let{index->AlertDialog(onDismissRequest={remove=null},title={Text("Rimuovere il blocco dalla nuova bozza?")},text={Text("Le versioni precedenti restano consultabili.")},confirmButton={TextButton(onClick={blocks.removeAt(index);remove=null}){Text("Rimuovi")}},dismissButton={TextButton(onClick={remove=null}){Text("Annulla")}})}
}
