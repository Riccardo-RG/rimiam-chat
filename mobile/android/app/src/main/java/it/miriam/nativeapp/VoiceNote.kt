package it.miriam.nativeapp

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import java.io.File
import java.util.UUID
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect

@Composable fun VoiceNoteControls(ready:(Uri)->Unit) {
    val context=LocalContext.current
    var recorder by remember{mutableStateOf<MediaRecorder?>(null)};var file by remember{mutableStateOf<File?>(null)};var error by remember{mutableStateOf("")};var active by remember{mutableStateOf(true)}
    fun finish(){val current=recorder ?: return;recorder=null;try{current.stop();file?.let{ready(Uri.fromFile(it))}}catch(_:Exception){file?.delete();file=null;error="Registrazione troppo breve o non disponibile"}finally{current.release()}}
    fun start(){if(WorkspaceMedia.callInProgress){error="Termina la chiamata prima di registrare una nota.";return};if(!active || recorder!=null)return;try{
        file?.delete()
        val output=File(context.cacheDir,"Nota-vocale-${UUID.randomUUID()}.m4a")
        file=output
        @Suppress("DEPRECATION") val next=if(Build.VERSION.SDK_INT>=31) MediaRecorder(context) else MediaRecorder()
        recorder=next;next.setAudioSource(MediaRecorder.AudioSource.MIC);next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);next.setAudioSamplingRate(44100);next.setAudioEncodingBitRate(96000);next.setOutputFile(output.absolutePath);next.setMaxFileSize(8_000_000);next.setOnInfoListener{_,what,_->if(what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED)finish()};next.prepare();next.start();error=""
    }catch(_:Exception){recorder?.release();recorder=null;file?.delete();file=null;error="Registrazione non disponibile"}}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){if(it && active)start() else if(active)error="Consenti il microfono nelle impostazioni per registrare una nota."}
    DisposableEffect(Unit){onDispose{active=false;runCatching{recorder?.stop()};recorder?.release();recorder=null;file?.delete()}}
    LifecycleEventEffect(Lifecycle.Event.ON_STOP){active=false;finish()}
    LifecycleEventEffect(Lifecycle.Event.ON_START){active=true}
    OutlinedButton(onClick={if(recorder!=null)finish() else if(ContextCompat.checkSelfPermission(context,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)start() else permission.launch(Manifest.permission.RECORD_AUDIO)}){Text(if(recorder==null)"Registra nota vocale" else "Ferma registrazione")}
    if(recorder!=null)Text("Registrazione in corso · resta sul dispositivo finché non la condividi.",style=MaterialTheme.typography.bodySmall)
    if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
}
