package it.miriam.nativeapp

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class Person(val id: String, val name: String, val email: String)
data class Workspace(val id: String, val name: String)
data class WorkstreamFocus(val workstreamId:String,val version:Int) {
    fun toJSON()=JSONObject().put("workstreamId",workstreamId).put("version",version)
}
data class ConversationReference(val kind: String, val id: String, val version: Int, val eventId: String? = null) {
    fun toJSON() = JSONObject().put("kind", kind).put("id", id).put("version", version).apply {
        eventId?.let { put("eventId", it) }
    }
    fun query() = "kind=${queryValue(kind)}&id=${queryValue(id)}&version=$version" +
        (eventId?.let { "&eventId=${queryValue(it)}" } ?: "")
}
data class ActivityEvent(val eventId: String, val occurredAt: String, val actor: String?, val actorName: String,
    val kind: String, val title: String, val summary: String, val qualification: String, val reference: ConversationReference)
data class ActivityPage(val events: List<ActivityEvent>, val next: String?)
data class ReferenceDetail(val reference: ConversationReference, val title: String, val content: String,
    val qualification: String, val actor: String?, val createdAt: String, val current: Boolean,
    val sourceIds: List<String>, val provenance: JSONObject, val event: ActivityEvent?)
data class HandoffApplication(val actor: String, val commandId: String, val commandType: String, val createdAt: String,
    val resultReference: ConversationReference?, val preparedKind: String?, val preparedId: String?)
data class ConversationHandoff(val id: String, val sourceId: String, val sourceMessageId: String, val kind: String,
    val summary: String, val suggestedText: String, val target: ConversationReference?, val candidateId: String?,
    val sourceIds: List<String>, val status: String, val createdAt: String, val application: HandoffApplication?)
fun JSONObject.conversationHandoff() = ConversationHandoff(getString("id"), getString("sourceId"), getString("sourceMessageId"),
    getString("kind"), getString("summary"), getString("suggestedText"), optJSONObject("target")?.conversationReference(), nullableString("candidateId"),
    getJSONArray("sourceIds").let { a -> (0 until a.length()).map { a.getString(it) } }, getString("status"), getString("createdAt"),
    optJSONObject("application")?.let { a -> HandoffApplication(a.getString("actor"), a.getString("commandId"), a.getString("commandType"), a.getString("createdAt"),
        a.optJSONObject("resultReference")?.conversationReference(), a.optJSONObject("prepared")?.getString("kind"), a.optJSONObject("prepared")?.getString("id")) })
fun queryValue(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
private fun JSONObject.nullableString(key: String) = if (isNull(key)) null else getString(key)
fun JSONObject.conversationReference() = ConversationReference(getString("kind"), getString("id"), getInt("version"), nullableString("eventId"))
fun JSONObject.activityEvent() = ActivityEvent(getString("eventId"), getString("occurredAt"), nullableString("actor"),
    getString("actorName"), getString("kind"), getString("title"), getString("summary"), getString("qualification"), getJSONObject("reference").conversationReference())
fun JSONObject.activityPage() = ActivityPage(rows("events").map { it.activityEvent() }, nullableString("next"))
fun JSONObject.referenceDetail() = ReferenceDetail(getJSONObject("reference").conversationReference(), getString("title"),
    getString("content"), getString("qualification"), nullableString("actor"), getString("createdAt"), getBoolean("current"),
    getJSONArray("sourceIds").let { a -> (0 until a.length()).map { a.getString(it) } }, getJSONObject("provenance"), optJSONObject("event")?.activityEvent())
data class Message(val id: String, val sequence: Int, val content: String, val authorName: String, val actorKind: String = "human",val citationSourceIds:List<String> = emptyList(),val replyToSourceId:String? = null,val purpose:String = "conversation",val createdAt:String = "",val workstreamFocus:WorkstreamFocus?=null,val reference:ConversationReference?=null)
fun JSONObject.message()=Message(getString("id"),getInt("sequence"),getString("content"),getString("authorName"),optString("actorKind","human"),optJSONArray("citationSourceIds")?.let{a->(0 until a.length()).map{a.getString(it)}} ?: emptyList(),optString("replyToSourceId").takeIf{it.isNotBlank()&&it!="null"},optString("purpose","conversation"),optString("createdAt"),optJSONObject("workstreamFocus")?.let{WorkstreamFocus(it.getString("workstreamId"),it.getInt("version"))},optJSONObject("reference")?.conversationReference())
data class Goal(val id: String, val content: String, val version: Int, val currentPrimary: Boolean)
data class Information(val id: String, val content: String, val qualification: String, val version: Int, val acceptedBy: String, val candidateId: String)
data class Commitment(val id: String, val content: String, val adopted: Boolean,val status:String="proposed",val kind:String="commitment")
data class WorkspaceState(val id: String, val name: String, val revision: Int, val messageSequence: Int, val goals: List<Goal>, val information: List<Information>, val commitments: List<Commitment>)
fun aiFailureMessage(code: String): String? = when (code) {
    "AI_CONFIGURATION_REQUIRED" -> "Le risposte AI non sono disponibili: il modello non è ancora collegato."
    "AI_OUTPUT_PARSE_ERROR" -> "La risposta del modello è incompleta o non valida. Nessun nuovo risultato pubblicato; puoi riprovare."
    "AI_TIMEOUT" -> "Il modello non ha risposto in tempo. Il lavoro è conservato; puoi riprovare."
    "AI_RATE_LIMITED" -> "Il servizio AI ha raggiunto il limite d’uso. Attendi prima di riprovare."
    "AI_PROVIDER_UNAVAILABLE" -> "Il servizio AI non è raggiungibile in questo momento. Puoi riprovare più tardi."
    "AI_REQUEST_REJECTED" -> "Il servizio AI non può elaborare questa richiesta. Occorre verificarne dimensioni e configurazione prima di riprovare."
    "MORE_CONTEXT_REQUIRED" -> "Manca contesto sufficiente. Aggiungi le informazioni pertinenti e riprova la lettura."
    "INVALID_SOURCE_REFERENCE", "INVALID_ANALYSIS_CITATION" -> "La risposta citava una fonte non disponibile. Nessun nuovo risultato pubblicato; puoi riprovare."
    "WORK_CAPABILITY_UNAVAILABLE" -> "L’analisi non può proseguire con i permessi attualmente disponibili."
    else -> null
}
class ApiError(val code: String, val status: Int) : Exception(aiFailureMessage(code) ?: when(code) {
    "WORK_STATE_STALE" -> "Il lavoro è cambiato. Rileggi lo stato prima di inviare nuovamente l’istruzione."
    "WORK_NOT_FOUND" -> "Il lavoro selezionato non è disponibile nel Workspace. Il riferimento storico resta separato dai controlli correnti."
    "WORK_INSTRUCTION_UNCLEAR" -> "Istruzione non applicata. Apri il lavoro e specifica come vuoi contribuire, oppure chiarisci la richiesta a Miriam."
    "AUTHENTICATION_REQUIRED" -> "Sessione scaduta o revocata. Accedi di nuovo."
    "EMAIL_NOT_VERIFIED", "ACCOUNT_INELIGIBLE" -> "Verifica l’account prima di continuare."
    "WORKSPACE_ACCESS_DENIED" -> "Non hai più accesso a questo Workspace."
    "INVALID_EMAIL_OR_PASSWORD" -> "Email o password non corrette."
    "RECEIPT_NOT_FOUND" -> "Esito non ancora disponibile; puoi riprovare la stessa operazione."
    "INVALID_RECEIPT" -> "La conferma ricevuta non corrisponde all’operazione. L’esito resta da verificare; usa il recupero conservato."
    "WORKSTREAM_NOT_FOUND" -> "Il filone non è disponibile in questo Workspace. Torna alla conversazione o rileggi i filoni."
    "WORKSTREAM_NOT_ACTIVE" -> "Il filone non è attivo. Puoi consultarne la storia; per aggiungere nuovi messaggi serve un filone attivo."
    "WORKSTREAM_TRANSITION_INVALID" -> "Il filone è cambiato: questa transizione non è disponibile nel suo stato attuale."
    "REFERENCE_NOT_FOUND" -> "Questa versione non è disponibile nel Workspace. Il riferimento e la bozza restano conservati."
    "REFERENCE_EVENT_MISMATCH" -> "L’evento non corrisponde alla versione selezionata. Riapri il riferimento dalla sua storia."
    "HANDOFF_NOT_FOUND" -> "Il passaggio dalla conversazione non è disponibile in questo Workspace."
    "HANDOFF_ALREADY_APPLIED" -> "Questo passaggio è già stato applicato. Rileggi l’esito conservato prima di procedere."
    "HANDOFF_TARGET_STALE" -> "Il riferimento del suggerimento è cambiato. La bozza è conservata: rileggi lo stato prima di riprepararla."
    "HANDOFF_COMMAND_MISMATCH" -> "Il modulo non corrisponde al passaggio selezionato. Scollega l’origine per preparare un’operazione diversa."
    else -> "Operazione non completata: $code"
})
fun JSONObject.rows(key: String): List<JSONObject> = getJSONArray(key).let { array -> (0 until array.length()).map { array.getJSONObject(it) } }
fun JSONObject.person() = Person(getString("id"), getString("name"), getString("email"))
fun JSONObject.workspaceState(): WorkspaceState {
    val w = getJSONObject("workspace")
    return WorkspaceState(w.getString("id"), w.getString("name"), w.getInt("revision"), getInt("messageSequence"),
        rows("goals").map { Goal(it.getString("id"), it.getString("content"), it.getInt("version"), it.getBoolean("currentPrimary")) },
        rows("information").map { Information(it.getString("id"), it.getString("content"), it.getString("qualification"), it.getInt("version"), it.getString("acceptedBy"), it.getString("candidateId")) },
        rows("commitments").map { Commitment(it.getString("id"), it.getString("content"), it.optString("status")=="effective",it.optString("status","proposed"),it.optString("kind","commitment")) })
}
class Api(base: String) {
    val base = base.trimEnd('/')
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()
    init {
        val url = URI(base)
        val local = BuildConfig.DEBUG && url.scheme == "http" && url.host in setOf("10.0.2.2", "127.0.0.1", "localhost")
        if ((url.scheme != "https" && !local) || url.host == null || url.userInfo != null || url.query != null || url.fragment != null || url.path !in setOf("", "/")) throw ApiError("INVALID_SERVER_URL", 0)
    }
    suspend fun bytes(path:String,token:String):ByteArray {
        val request=Request.Builder().url("$base/api/v1/$path").header("Authorization","Bearer $token").build()
        return suspendCancellableCoroutine { continuation ->
            val call=http.newCall(request);continuation.invokeOnCancellation{call.cancel()}
            call.enqueue(object:Callback {
                override fun onFailure(call:Call,e:IOException){if(continuation.isActive)continuation.resumeWithException(e)}
                override fun onResponse(call:Call,response:Response){response.use {try {
                    if(it.header("X-Miriam-API-Version")!="1")throw ApiError("INCOMPATIBLE_SERVER",it.code)
                    if(!it.isSuccessful)throw ApiError(JSONObject(it.body?.string() ?: "{}").optJSONObject("error")?.optString("code") ?: "REQUEST_FAILED",it.code)
                    val value=it.body?.bytes() ?: throw IOException("File non disponibile")
                    if(continuation.isActive)continuation.resume(value)
                }catch(e:Exception){if(continuation.isActive)continuation.resumeWithException(e)}}}
            })
        }
    }
    suspend fun download(path:String,token:String,directory:java.io.File):java.io.File = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val request=Request.Builder().url("$base/api/v1/$path").header("Authorization","Bearer $token").build()
        val file=java.io.File.createTempFile("call-",".mp3",directory)
        try{http.newCall(request).execute().use {response->
            if(!response.isSuccessful||response.header("X-Miriam-API-Version")!="1")throw ApiError("CALL_AUDIO_NOT_AVAILABLE",response.code)
            val body=response.body?:throw IOException("Audio non disponibile")
            body.byteStream().use {input->file.outputStream().use {output->input.copyTo(output)}}
        };file}catch(e:Exception){file.delete();throw e}
    }
    suspend fun call(path: String, token: String? = null, method: String = "GET", body: JSONObject? = null): JSONObject {
        val request = Request.Builder().url("$base/api/v1/$path").header("Accept", "application/json")
        if (token != null) request.header("Authorization", "Bearer $token")
        request.method(method, body?.toString()?.toRequestBody("application/json".toMediaType()))
        return suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        try {
                            if (it.header("X-Miriam-API-Version") != "1") throw ApiError("INCOMPATIBLE_SERVER", it.code)
                            val result = JSONObject(it.body?.string() ?: "{}")
                            if (!it.isSuccessful) throw ApiError(result.optJSONObject("error")?.optString("code") ?: "REQUEST_FAILED", it.code)
                            if (continuation.isActive) continuation.resume(result)
                        } catch (e: Exception) { if (continuation.isActive) continuation.resumeWithException(e) }
                    }
                }
            })
        }
    }
}

// Pure command construction shared by native capability views; authorization stays server-side.
fun command(type:String,vararg fields:Pair<String,Any?>):JSONObject=JSONObject().put("type",type).apply {fields.forEach {(key,value)->put(key,value)}}
