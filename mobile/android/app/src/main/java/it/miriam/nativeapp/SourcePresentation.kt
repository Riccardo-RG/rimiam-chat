package it.miriam.nativeapp

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

fun processingLabel(status:String)=when(status){"queued"->"In attesa";"processing"->"Elaborazione in corso";"ready"->"Contenuto disponibile";"needs_configuration"->"Provider da collegare";"needs_input"->"Serve un chiarimento o consenso";"failed"->"Elaborazione non riuscita";else->status}
@Composable fun SourceOriginalButton(model:WorkspaceModel,source:JSONObject){
    val context=LocalContext.current;val scope=rememberCoroutineScope();var downloading by remember{mutableStateOf(false)};var result by remember{mutableStateOf("")}
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(source.optString("media_type").takeIf{it.isNotBlank()&&it!="null"} ?: "application/octet-stream")){uri->if(uri!=null)scope.launch{downloading=true;result="";try{val bytes=model.sourceBytes(source.getString("id"));if(bytes!=null){withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use{it.write(bytes)} ?: error("Destinazione non disponibile")};result="Originale salvato"}}catch(e:Exception){result=e.message ?: "Salvataggio non riuscito"}finally{downloading=false}}}
    TextButton(onClick={save.launch(source.getString("title"))},enabled=!downloading){Text(if(downloading)"Recupero originale…" else "Salva originale…")}
    if(result.isNotEmpty())Text(result,style=MaterialTheme.typography.bodySmall)
}
@Composable fun SourceReference(state:UiState,model:WorkspaceModel,id:String){
    var open by remember{mutableStateOf(false)};val source=state.detail?.rows("sources")?.firstOrNull{it.getString("id")==id};val message=state.messages.firstOrNull{it.id==id}
    TextButton(onClick={open=!open}){Text(source?.getString("title") ?: message?.let{"Messaggio di "+it.authorName} ?: "Fonte storica del Workspace")}
    if(open){Text(source?.getString("qualification") ?: "Messaggio attribuito",style=MaterialTheme.typography.bodySmall);Text(source?.getString("content")?.ifEmpty{"L’originale è condiviso; il contenuto non è ancora disponibile."} ?: message?.content ?: "Consulta le fonti del Workspace.");if(source!=null&&!source.isNull("media_type"))SourceOriginalButton(model,source)}
}
