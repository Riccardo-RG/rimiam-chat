package it.miriam.nativeapp

import android.content.Context
import android.content.Intent
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class VoiceCaptureBinding(val account:AccountScope,val workspace:String,val focus:WorkstreamFocus?,val reference:ConversationReference?=null) {
    fun attachTo(command: JSONObject): JSONObject = command.apply {
        focus?.let { put("workstreamFocus", it.toJSON()) }
        reference?.let { put("reference", it.toJSON()) }
    }
}
class WorkspaceMedia(private val context:Context,private val scope:CoroutineScope) {
    companion object {var callInProgress=false;private set}
    var voices by mutableStateOf<List<JSONObject>>(emptyList());private set
    var calls by mutableStateOf<JSONObject?>(null);private set
    var error by mutableStateOf("");private set
    var callStatus by mutableStateOf("");private set
    var wantsCall by mutableStateOf(false);private set
    var muted by mutableStateOf(false);private set
    var consent by mutableStateOf(false)
    var dialog by mutableStateOf(false);private set
    var recording by mutableStateOf(false);private set
    var clip by mutableStateOf<File?>(null);private set
    var clipBinding by mutableStateOf<VoiceCaptureBinding?>(null);private set
    private var dialogBinding:VoiceCaptureBinding?=null
    private var submittedClip:String?=null
    private var sendingClip:String?=null
    private var room:Room?=null;private var callId:String?=null;private var generation=0;private var loop:Job?=null;private var timer:Job?=null;private var recorder:MediaRecorder?=null
    private var playbackEpoch=0;private var player:MediaPlayer?=null;private var playbackFile:File?=null;private var pendingVoice:String?=null;private var speaking=false
    private val speech=SpeechPlayback(context)
    val inCall get()=wantsCall||room!=null
    fun captureBinding(model:WorkspaceModel,reference:ConversationReference?=null):VoiceCaptureBinding? {
        val state=model.ui.value
        return VoiceCaptureBinding(state.accountScope ?: return null,state.selected ?: return null,state.workstreamFocus,reference)
    }
    // A historical reference is immutable and remains the captured reference if the composer changes.
    private fun bindingIsCurrent(model:WorkspaceModel,binding:VoiceCaptureBinding)=captureBinding(model,binding.reference)==binding && !model.ui.value.logoutPending && model.ui.value.focusIsCurrent(binding.focus)
    fun bind(model:WorkspaceModel) {
        loop?.cancel();reset();voices=emptyList();calls=null;val token=generation;val selected=model.ui.value.selected;val actor=model.ui.value.user?.id;val account=model.ui.value.accountScope
        if(selected==null||actor==null||model.ui.value.logoutPending)return
        loop=scope.launch {var lastHeartbeat=0L
            while(isActive&&generation==token&&model.ui.value.selected==selected&&model.ui.value.accountScope==account&&model.ui.value.user?.id==actor&&!model.ui.value.logoutPending) {
                model.workspaceRead("voice")?.let{voices=it.rows("messages")};model.workspaceRead("calls")?.let{calls=it};ensureActive();if(generation!=token)break
                if(wantsCall)try{
                    val call=calls?.rows("calls")?.firstOrNull{it.getString("state")=="open"}
                    val person=call?.rows("participants")?.firstOrNull{it.getString("userId")==actor&&it.getString("state")!="left"}
                    if(person?.getString("state")=="admitted") {
                        if(room==null){val credentials=model.mediaConnection(call.getString("id"));if(generation!=token||!wantsCall)break
                            val next=LiveKit.create(context);room=next;callId=call.getString("id");next.connect(credentials.getString("url"),credentials.getString("token"));if(generation!=token||!wantsCall){next.disconnect();break};next.localParticipant.setMicrophoneEnabled(true);muted=false;lastHeartbeat=System.currentTimeMillis()
                        }else if(System.currentTimeMillis()-lastHeartbeat>20_000){model.mediaConnection(call.getString("id"));lastHeartbeat=System.currentTimeMillis()}
                        callStatus=if(room?.state==Room.State.CONNECTED)"Chiamata connessa" else "Riconnessione alla chiamata…"
                        if(room?.state==Room.State.DISCONNECTED)throw ApiError("CALL_DISCONNECTED",0)
                        val recording=call.rows("recordings").any{!it.optBoolean("captureFenced") && it.getString("state") in setOf("active","starting","stopping","unknown")}
                        context.startService(Intent(context,CallService::class.java).putExtra("status",if(recording)"Registrazione attiva o arresto da confermare" else "Chiamata audio · non registrata"))
                    }else if(room!=null){disconnect();wantsCall=false}else{callStatus="Ingresso in attesa dell’arresto delle registrazioni"}
                }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"Chiamata non disponibile";disconnect();wantsCall=false}
                if(dialog)updateDialog(model)
                delay(2000)
            }
        }
    }
    private fun disconnect(){callInProgress=false;room?.disconnect();room?.release();room=null;callId=null;context.stopService(Intent(context,CallService::class.java));CallService.leave=null;callStatus=""}
    fun close(){loop?.cancel();reset();speech.close()}
    fun reset(){generation++;consent=false;endDialog();discard();stopPlayback();disconnect();wantsCall=false}
    fun join(model:WorkspaceModel){val token=generation;scope.launch {if(token!=generation)return@launch;SpeechPlayback.stopForCall();endDialog();discard();stopPlayback();try{CallService.leave={leave(model)};ContextCompat.startForegroundService(context,Intent(context,CallService::class.java));model.mediaSubmit(command("call.join"),"Entra nella chiamata");if(token!=generation)return@launch;wantsCall=true;callInProgress=true;error=""}catch(e:Exception){error=e.message?:"Chiamata non disponibile";disconnect()}}}
    fun leave(model:WorkspaceModel){val id=callId?:calls?.rows("calls")?.firstOrNull{it.getString("state")=="open"}?.getString("id");wantsCall=false;disconnect();if(id!=null)scope.launch{try{model.mediaSubmit(command("call.leave","callId" to id),"Lascia chiamata")}catch(e:Exception){error=e.message?:"Uscita da verificare"}}}
    fun toggleMute(){scope.launch{try{room?.localParticipant?.setMicrophoneEnabled(muted);muted=!muted}catch(e:Exception){error=e.message?:"Microfono non disponibile"}}}
    fun withdraw(model:WorkspaceModel,id:String){wantsCall=false;muted=true;disconnect();scope.launch{try{model.mediaSubmit(command("call.recording.withdraw","callId" to id),"Ritira consenso alla registrazione")}catch(e:Exception){error=e.message?:"Ritiro da verificare"}}}
    fun stopPlayback(){playbackEpoch++;player?.reset();player?.release();player=null;playbackFile?.delete();playbackFile=null}
    fun play(model:WorkspaceModel,id:String,call:Boolean=false){if(inCall)return;endDialog();stopPlayback();val token=generation;val playback=playbackEpoch;scope.launch{try{val file=if(call)model.mediaRecording(id)else{val bytes=model.sourceBytes(id)?:return@launch;File(context.cacheDir,"voice-${UUID.randomUUID()}").apply{writeBytes(bytes)}};if(token!=generation||playback!=playbackEpoch||inCall){file.delete();return@launch};playbackFile=file;val next=MediaPlayer();player=next;next.setDataSource(file.absolutePath);next.setOnPreparedListener{if(player===it&&playback==playbackEpoch&&!inCall)it.start()};next.setOnErrorListener{_,_,_->error="Audio non riproducibile";stopPlayback();true};next.prepareAsync()}catch(e:Exception){error=e.message?:"Audio non disponibile"}}}
    fun stopCapture(){timer?.cancel();timer=null;val current=recorder;recorder=null;recording=false;if(current!=null){try{current.stop()}catch(_:Exception){clip?.delete();clip=null;error="Registrazione troppo breve"}finally{current.release()}}}
    fun discard(){stopCapture();clip?.delete();clip=null;clipBinding=null;submittedClip=null;sendingClip=null}
    fun endDialog(){dialog=false;dialogBinding=null;pendingVoice=null;speaking=false;stopCapture();speech.stop()}
    fun start(model:WorkspaceModel,asDialog:Boolean=false,requestedBinding:VoiceCaptureBinding?=captureBinding(model)){
        if(!consent||inCall)return
        val binding=requestedBinding ?: return
        if(!bindingIsCurrent(model,binding)){error="La selezione è cambiata. Rileggi il filone prima di registrare.";return}
        discard();stopPlayback();speech.stop();pendingVoice=null;dialog=asDialog;dialogBinding=if(asDialog)binding else null;clipBinding=binding;error=""
        try{val file=File(context.cacheDir,"Voce-${UUID.randomUUID()}.m4a");clip=file
            @Suppress("DEPRECATION") val next=if(Build.VERSION.SDK_INT>=31)MediaRecorder(context)else MediaRecorder()
            recorder=next;next.setAudioSource(MediaRecorder.AudioSource.MIC);next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);next.setAudioSamplingRate(44100);next.setAudioEncodingBitRate(96000);next.setOutputFile(file.absolutePath);next.setMaxFileSize(8_000_000);next.setOnInfoListener{_,what,_->if(recorder===next&&what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED){stopCapture();if(dialog)send(model,"miriam")}};next.prepare();next.start();recording=true
            if(asDialog)timer=scope.launch{var heard=false;var lastSpeech=System.currentTimeMillis();val started=lastSpeech
                while(isActive&&dialog&&recording){if((recorder?.maxAmplitude?:0)>900){heard=true;lastSpeech=System.currentTimeMillis()};if((heard&&System.currentTimeMillis()-lastSpeech>1600)||System.currentTimeMillis()-started>120_000){recorder?.let{current->recorder=null;recording=false;try{current.stop()}finally{current.release()}};send(model,"miriam");break};delay(150)}
            }
        }catch(e:Exception){error=e.message?:"Microfono non disponibile";endDialog();discard()}
    }
    fun send(model:WorkspaceModel,mode:String){
        val file=clip?:return;val binding=clipBinding?:return
        if(!consent)return
        if(sendingClip==file.absolutePath)return
        if(!bindingIsCurrent(model,binding)){error="L’audio resta legato alla selezione iniziale. Il filone è cambiato o non è più attivo: nessun invio effettuato.";endDialog();return}
        if(submittedClip==file.absolutePath){error="Esito del precedente invio da verificare. Usa la stessa operazione conservata nei promemoria.";endDialog();return}
        val token=generation;sendingClip=file.absolutePath
        scope.launch{try{
            val bytes=withContext(Dispatchers.IO){file.readBytes()}
            if(token!=generation || clip!=file || !bindingIsCurrent(model,binding))return@launch
            if(bytes.size>8388608)throw ApiError("DOCUMENT_TOO_LARGE",413)
            val before=model.ui.value.voiceReplySourceId
            val body=command("voice.send","filename" to file.name,"bytesBase64" to Base64.encodeToString(bytes,Base64.NO_WRAP),"mode" to mode,"allowModelProcessing" to true)
            binding.attachTo(body)
            model.mediaSubmit(body,if(mode=="miriam")"Messaggio vocale a RIMIAM"else"Messaggio vocale") {submittedClip=file.absolutePath}
            if(token!=generation || captureBinding(model)?.account!=binding.account || model.ui.value.selected!=binding.workspace)return@launch
            discard();if(mode=="miriam"&&dialog&&before!=model.ui.value.voiceReplySourceId)pendingVoice=model.ui.value.voiceReplySourceId
        }catch(e:CancellationException){throw e}catch(e:Exception){if(token==generation && model.ui.value.accountScope==binding.account){error=e.message?:"Invio non completato";endDialog()}}finally{if(sendingClip==file.absolutePath)sendingClip=null}}
    }
    private fun updateDialog(model:WorkspaceModel){val source=pendingVoice
        val binding=dialogBinding
        if(binding==null || !bindingIsCurrent(model,binding)){error="La selezione del dialogo è cambiata. L’audio acquisito è conservato; nessun nuovo turno verrà inviato.";endDialog();return}
        if(source!=null){val voice=voices.firstOrNull{it.getString("sourceId")==source};if(voice!=null&&(!voice.isNull("errorCode")||voice.optString("interpretationStatus") in setOf("failed","stale"))){error=voice.optString("errorCode","La risposta richiede attenzione nel Context");endDialog();return}
            model.ui.value.messages.firstOrNull{it.actorKind=="miriam"&&it.replyToSourceId==source}?.let{pendingVoice=null;speaking=true;speech.speak(it.id,it.content)}
        }else if(speaking&&speech.currentID==null){speaking=false;if(speech.error.isNotEmpty()){error=speech.error;endDialog()}else start(model,true,binding)}
    }
}
