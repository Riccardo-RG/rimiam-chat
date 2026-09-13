package it.miriam.nativeapp

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import java.util.Locale
import java.util.UUID

// Device presentation only, never a model invocation, command or domain event.
class SpeechPlayback(context:Context) {
    companion object {private val instances=mutableSetOf<SpeechPlayback>();fun stopForCall(){instances.toList().forEach{it.stop()}}}
    var currentID by mutableStateOf<String?>(null);private set
    var error by mutableStateOf("");private set
    private var ready=false;private var closed=false
    private val handler=Handler(Looper.getMainLooper())
    private var lastUtterance:String?=null
    private val tts=TextToSpeech(context.applicationContext){status->handler.post{if(!closed){ready=status==TextToSpeech.SUCCESS;if(!ready)error="Voce del dispositivo non disponibile"}}}
    init {instances.add(this);tts.setOnUtteranceProgressListener(object:UtteranceProgressListener(){
        override fun onStart(id:String?) {}
        override fun onDone(id:String?) {handler.post{if(id==lastUtterance){currentID=null;lastUtterance=null}}}
        @Deprecated("Platform callback") override fun onError(id:String?) {handler.post{if(id!=null && lastUtterance?.substringBefore(":")==id.substringBefore(":")){stop();error="Lettura vocale interrotta o non disponibile"}}}
    })}
    fun stop(){lastUtterance=null;currentID=null;tts.stop()}
    fun close(){instances.remove(this);closed=true;stop();tts.shutdown()}
    fun speak(id:String,text:String){
        if(WorkspaceMedia.callInProgress){error="Termina la chiamata prima della lettura vocale.";return}
        stop();error=""
        if(!ready){error="Voce non pronta: riprova dopo aver installato una voce sul dispositivo";return}
        val locale=Locale.getDefault()
        val voice=tts.voices?.filter{!it.isNetworkConnectionRequired}?.sortedByDescending{it.locale==locale}?.firstOrNull{it.locale.language==locale.language}
        if(voice==null || tts.setVoice(voice)!=TextToSpeech.SUCCESS){error="Installa una voce offline nella lingua del dispositivo. Nessun testo è stato inviato a un servizio online.";return}
        val chunks=text.chunked(TextToSpeech.getMaxSpeechInputLength().coerceAtLeast(1));val generation=UUID.randomUUID().toString()
        currentID=id;lastUtterance="$generation:${chunks.lastIndex}"
        for((index,chunk) in chunks.withIndex()) if(tts.speak(chunk,if(index==0)TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD,null,"$generation:$index")!=TextToSpeech.SUCCESS){stop();error="Riproduzione vocale non disponibile";break}
    }
}
@Composable fun rememberSpeechPlayback(boundary:String):SpeechPlayback {
    val context=LocalContext.current
    val speech=remember(boundary){SpeechPlayback(context)}
    DisposableEffect(speech){onDispose{speech.close()}}
    LifecycleEventEffect(Lifecycle.Event.ON_STOP){speech.stop()}
    return speech
}
@Composable fun SpokenReplyButton(speech:SpeechPlayback,id:String,text:String){
    TextButton(onClick={if(speech.currentID==id)speech.stop() else speech.speak(id,text)}){Text(if(speech.currentID==id)"Ferma lettura" else "Ascolta con la voce del dispositivo")}
}
