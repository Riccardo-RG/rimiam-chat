package chat.rimiam.devicevoice

import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/** Device speech cannot fall back to a voice that requires the network. */
class DeviceVoiceModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var engine: TextToSpeech? = null
  private var pending: Promise? = null
  private var generation = 0

  override fun definition() = ModuleDefinition {
    Name("RimiamDeviceVoice")
    AsyncFunction("speak") { text: String, language: String, promise: Promise ->
      main.post {
        finish()
        val context = appContext.reactContext?.applicationContext
        if (context == null || text.isBlank() || text.length > 12000) {
          promise.reject("VOICE_UNAVAILABLE", "Lettura non disponibile.", null)
          return@post
        }
        pending = promise
        val current = generation
        try {
          engine = TextToSpeech(context) { status ->
            // Some engines deliver onInit before their constructor returns.
            main.post {
              if (current == generation) {
                if (status != TextToSpeech.SUCCESS) finish("Voce locale non disponibile.")
                else start(text, language, current)
              }
            }
          }
          main.postDelayed({
            if (current == generation) finish("La lettura sul dispositivo non è terminata.")
          }, 10L * 60L * 1000L)
        } catch (_: RuntimeException) {
          finish("Impossibile avviare la voce locale.")
        }
      }
      Unit
    }
    AsyncFunction("stop") { promise: Promise ->
      main.post { finish(); promise.resolve(null) }
      Unit
    }
    OnActivityEntersBackground { main.post { finish() } }
    OnDestroy { main.post { finish() } }
  }

  private fun start(text: String, language: String, current: Int) {
    val tts = engine ?: return finish("Voce locale non disponibile.")
    try {
      val locale = Locale.forLanguageTag(language)
      val voice = tts.voices.orEmpty()
        .filter { it.locale.language == locale.language && !it.isNetworkConnectionRequired &&
          TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features.orEmpty() }
        .maxByOrNull { it.quality + if (it.locale == locale) 1000 else 0 }
      if (voice == null || tts.setVoice(voice) != TextToSpeech.SUCCESS || tts.voice?.name != voice.name) {
        finish("Installa una voce locale nella lingua selezionata.")
        return
      }
      val parts = text.chunked(TextToSpeech.getMaxSpeechInputLength().coerceAtLeast(1))
      val lastId = parts.lastIndex.toString()
      tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) {}
        override fun onDone(id: String?) { if (id == lastId) main.post { if (current == generation) finish() } }
        @Deprecated("Required by the Android listener")
        override fun onError(id: String?) { main.post { if (current == generation) finish("Lettura vocale interrotta.") } }
      })
      for ((index, part) in parts.withIndex()) {
        if (tts.speak(part, TextToSpeech.QUEUE_ADD, null, index.toString()) != TextToSpeech.SUCCESS) {
          finish("Lettura vocale non disponibile.")
          return
        }
      }
    } catch (_: RuntimeException) { finish("Lettura vocale non disponibile.") }
  }

  private fun finish(error: String? = null) {
    generation++
    val result = pending
    pending = null
    try { engine?.stop() } finally {
      engine?.shutdown()
      engine = null
    }
    if (error != null) result?.reject("VOICE_UNAVAILABLE", error, null)
    else result?.resolve(null)
  }
}
