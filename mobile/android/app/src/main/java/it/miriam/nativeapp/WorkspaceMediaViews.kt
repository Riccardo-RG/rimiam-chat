package it.miriam.nativeapp

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect

@Composable fun ConversationVoiceControls(model:WorkspaceModel) {
    val state by model.ui.collectAsState();val media=model.media;var dialogue by remember{mutableStateOf(false)};var permissionError by remember{mutableStateOf("")}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){allowed->if(allowed)media.start(model,dialogue)else permissionError="Consenti l’accesso al microfono nelle impostazioni."}
    LifecycleEventEffect(Lifecycle.Event.ON_STOP){media.endDialog();media.discard();media.stopPlayback()}
    Column {
        Text("Voce e dialogo con RIMIAM",style=MaterialTheme.typography.titleSmall)
        Switch(checked=media.consent,onCheckedChange={media.consent=it},enabled=!media.recording&&!media.dialog)
        Text("Condivido l’audio nel Workspace e autorizzo la trascrizione con il servizio configurato.",style=MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick={if(media.recording)media.stopCapture()else{dialogue=false;permission.launch(Manifest.permission.RECORD_AUDIO)}},enabled=media.consent&&!media.inCall&&!media.dialog){Text(if(media.recording)"Ferma nota vocale"else"Registra messaggio vocale")}
        if(media.clip!=null&&!media.recording)TextButton(onClick={media.send(model,"message")},enabled=media.consent&&!state.busy){Text("Invia messaggio vocale")}
        Button(onClick={if(media.dialog)media.endDialog()else{dialogue=true;permission.launch(Manifest.permission.RECORD_AUDIO)}},enabled=media.consent&&!media.inCall&&!state.busy){Text(if(media.dialog)"Termina dialogo vocale"else"Parla con RIMIAM")}
        if(media.dialog)Text(if(media.recording)"Ti ascolto: una pausa invia il turno."else"Trascrizione e risposta in preparazione. Le azioni richiedono i normali controlli di conferma.")
        if(permissionError.isNotEmpty())Text(permissionError,color=MaterialTheme.colorScheme.error)
        if(media.error.isNotEmpty())Text(media.error,color=MaterialTheme.colorScheme.error)
    }
}
@Composable fun VoiceMessageView(model:WorkspaceModel,messageId:String) {
    val voice=model.media.voices.firstOrNull{it.getString("messageId")==messageId}?:return
    TextButton(onClick={model.media.play(model,voice.getString("sourceId"))}){Text("Ascolta audio originale")}
    TextButton(onClick={model.media.stopPlayback()}){Text("Ferma audio")}
    Text(if(!voice.isNull("transcript"))voice.getString("transcript")else if(!voice.isNull("errorCode"))voice.getString("errorCode")else"Trascrizione in elaborazione…")
    Text(voice.getString("qualification"),style=MaterialTheme.typography.bodySmall)
    if(!voice.isNull("researchQuery")){val query=voice.getString("researchQuery");Text("Ricerca proposta: $query");TextButton(onClick={model.workspaceCommand(command("research.request","query" to query,"discloseQuery" to true),"Ricerca richiesta a voce")}){Text("Invia questa query al servizio di ricerca")}}
}
@Composable fun WorkspaceCallControls(model:WorkspaceModel) {
    val state by model.ui.collectAsState();val media=model.media;val view=media.calls;var expanded by remember{mutableStateOf(false)};var error by remember{mutableStateOf("")}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){granted->if(granted.values.all{it})media.join(model)else error="Consenti microfono e notifiche per mantenere visibile la chiamata anche in background."}
    TextButton(onClick={expanded=!expanded}){Text("Chiamata audio tra partecipanti${if(media.inCall)" · in corso"else""}")}
    if(!expanded)return
    Column {
        Text("RIMIAM non partecipa dal vivo. La registrazione richiede tutti i consensi personali; l’analisi si richiede dopo la chiamata.",style=MaterialTheme.typography.bodySmall)
        if(view?.optBoolean("configured")!=true)Text("Servizio chiamate da configurare.")
        if(media.inCall){Button(onClick={media.leave(model)}){Text("Lascia chiamata")};TextButton(onClick={media.toggleMute()}){Text(if(media.muted)"Attiva microfono"else"Disattiva microfono")}}
        else Button(onClick={permission.launch(if(Build.VERSION.SDK_INT>=33)arrayOf(Manifest.permission.RECORD_AUDIO,Manifest.permission.POST_NOTIFICATIONS)else arrayOf(Manifest.permission.RECORD_AUDIO))},enabled=view?.optBoolean("configured")==true&&!state.busy){Text("Entra nella chiamata")}
        Text(media.callStatus)
        view?.rows("calls")?.forEach{call->key(call.getString("id")){
            val id=call.getString("id");var show by remember{mutableStateOf(call.getString("state")=="open")}
            TextButton(onClick={show=!show}){Text("Chiamata ${id.take(8)} · ${call.getString("state")}")}
            if(show){
                if(!call.isNull("errorCode"))Text(call.getString("errorCode"),color=MaterialTheme.colorScheme.error)
                call.rows("participants").forEach{p->Text("${p.getString("name")} · ${p.getString("state")} · ${if(p.getBoolean("consented"))"consenso espresso"else"nessun consenso corrente"}",style=MaterialTheme.typography.bodySmall)}
                if(call.rows("recordings").any{!it.optBoolean("captureFenced") && it.getString("state") in setOf("active","starting","stopping","unknown")})Text("Registrazione attiva o arresto da confermare",style=MaterialTheme.typography.titleSmall)
                val self=call.rows("participants").firstOrNull{it.getString("userId")==state.user?.id&&it.getString("state")=="admitted"}
                if(media.inCall&&self!=null){if(!call.getBoolean("recordingRequested")){Button(onClick={model.workspaceCommand(command("call.recording.request","callId" to id),"Richiedi registrazione")},enabled=view.getBoolean("recordingConfigured")){Text("Richiedi registrazione")}}
                    else{if(!self.getBoolean("consented")){Text(view.getString("consentText"),style=MaterialTheme.typography.bodySmall);Button(onClick={model.workspaceCommand(command("call.recording.consent","callId" to id,"epoch" to call.getInt("epoch"),"consentText" to view.getString("consentText")),"Consenso personale alla registrazione")}){Text("Acconsento personalmente")}}
                        TextButton(onClick={media.withdraw(model,id)}){Text("Ritira consenso · esci e rientra senza registrazione")}
                    }
                }
                call.rows("recordings").forEach{r->Text("${r.getString("createdAt")} · ${r.getString("state")} · ${r.optString("transcriptionStatus")}",style=MaterialTheme.typography.bodySmall)
                    if(r.getString("state")=="complete"){TextButton(onClick={media.play(model,r.getString("id"),true)}){Text("Ascolta registrazione")};TextButton(onClick={media.stopPlayback()}){Text("Ferma audio")}}
                    r.rows("segments").forEach{s->var text by remember(s.getString("id")){mutableStateOf(false)};TextButton(onClick={text=!text}){Text("Trascrizione da ${s.getInt("startSeconds")}s · fonte non accettata")};if(text){Text(s.getString("content"));Text(s.getString("qualification"),style=MaterialTheme.typography.bodySmall)}}
                    if(!r.isNull("errorCode"))Text(r.getString("errorCode"))
                }
                if(call.getString("state")=="ended")Button(onClick={model.workspaceCommand(command("call.analyze","callId" to id),"Analizza chiamata")}){Text(if(call.getBoolean("analysisRequested"))"Prosegui analisi esistente"else"Richiedi analisi a RIMIAM")}
                if(call.rows("recordings").any{it.optString("transcriptionStatus") in setOf("failed","needs_configuration")})TextButton(onClick={model.workspaceCommand(command("call.transcription.retry","callId" to id),"Riprova trascrizione")}){Text("Riprova trascrizione")}
                var history by remember{mutableStateOf(false)};TextButton(onClick={history=!history}){Text("Consensi e storia")};if(history)call.rows("events").forEach{e->if(!e.isNull("consentText"))Text(e.getString("consentText"),style=MaterialTheme.typography.bodySmall);Text("${e.getString("createdAt")} · ${e.getString("kind")} · ${e.optString("actorId")}",style=MaterialTheme.typography.bodySmall)}
            }
        }}
        if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
        if(media.error.isNotEmpty())Text(media.error,color=MaterialTheme.colorScheme.error)
    }
}

@Composable fun CallStatusBanner(model: WorkspaceModel) {
    if (!model.media.inCall) return
    val captured = model.media.calls?.rows("calls")?.any { call -> call.rows("recordings").any { !it.optBoolean("captureFenced") && it.getString("state") in setOf("active", "starting", "stopping", "unknown") } } == true
    Surface(tonalElevation=3.dp) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp),verticalAlignment=Alignment.CenterVertically) {
            Text(if(captured) "REGISTRAZIONE attiva o in verifica" else "Chiamata audio · nessuna registrazione attiva rilevata",modifier=Modifier.weight(1f),style=MaterialTheme.typography.labelMedium)
            TextButton(onClick={model.media.leave(model)}) {Text("Esci")}
        }
    }
}
