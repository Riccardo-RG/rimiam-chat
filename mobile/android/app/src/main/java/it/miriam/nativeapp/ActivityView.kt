package it.miriam.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

val LocalOpenReference = staticCompositionLocalOf<((ConversationReference) -> Unit)?> { null }
val LocalOpenWork = staticCompositionLocalOf<((String) -> Unit)?> { null }
val LocalOpenCapability = staticCompositionLocalOf<((String) -> Unit)?> { null }
data class AttachedReference(val reference: ConversationReference, val title: String)

fun referenceKindLabel(kind: String): String = when (kind) {
    "goal" -> "Goal"
    "information" -> "Informazione"
    "commitment" -> "Proposta o atto"
    "task" -> "Attività"
    "artifact" -> "Artifact"
    "question" -> "Domanda"
    "workstream" -> "Filone"
    "active_work" -> "Lavoro di Miriam"
    "scheduled_event" -> "Evento condiviso"
    "source" -> "Fonte"
    else -> "Riferimento"
}

// Only these input identities match the reference contract directly. Other keys remain visible in Work history.
fun workInputReference(key: String): ConversationReference? {
    val parts = key.split(':')
    if (parts.size != 3) return null
    val kind = when (parts[0]) {
        "goal", "information", "question", "source", "task" -> parts[0]
        "workstream_focus" -> "workstream"
        "temporal_scheduled_event" -> "scheduled_event"
        else -> return null
    }
    val version = parts[2].toIntOrNull()?.takeIf { it > 0 } ?: return null
    if (!Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}").matches(parts[1])) return null
    return ConversationReference(kind, parts[1], version)
}

@Composable fun ReferenceLink(reference: ConversationReference, label: String = "Esamina ${referenceKindLabel(reference.kind)} · v${reference.version}") {
    val open = LocalOpenReference.current ?: return
    TextButton(onClick = { open(reference) }, modifier = Modifier.testTag("reference-${reference.kind}-${reference.id}")) { Text(label) }
}

@Composable fun ActivityEventCard(event: ActivityEvent, compact: Boolean = false) {
    val open = LocalOpenReference.current
    OutlinedCard(
        onClick = { open?.invoke(event.reference) },
        modifier = Modifier.fillMaxWidth().testTag("activity-${event.eventId}"),
        border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${event.actorName} · ${messageTime(event.occurredAt)}", style = MaterialTheme.typography.labelSmall)
            Text(event.title, style = MaterialTheme.typography.titleSmall, maxLines = if (compact) 2 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            if (event.summary.isNotBlank()) Text(event.summary, style = MaterialTheme.typography.bodyMedium, maxLines = if (compact) 2 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            Text(event.qualification, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${referenceKindLabel(event.reference.kind)} · v${event.reference.version} · esamina →", style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable fun ActivityContent(state: UiState, model: WorkspaceModel, scrollState: ScrollState = rememberScrollState()) {
    Column(Modifier.fillMaxSize().verticalScroll(scrollState).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Attività dello spazio", style = MaterialTheme.typography.headlineMedium)
        Text("I passaggi registrati, con le persone, le versioni e le fonti a cui si riferiscono.")
        HorizontalDivider(thickness = 1.5.dp)
        TextButton(onClick = { model.loadActivity() }, enabled = !state.activityLoading) { Text("Aggiorna attività") }
        if (state.activityLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (state.activityError.isNotBlank()) Text(state.activityError, color = MaterialTheme.colorScheme.error)
        if (state.activity?.events?.isEmpty() == true) Text("Nessun passaggio registrato finora.")
        state.activity?.events?.forEach { event -> key(event.eventId) { ActivityEventCard(event) } }
        if (state.activity?.next != null) TextButton(onClick = { model.loadActivity(older = true) }, enabled = !state.activityLoading, modifier = Modifier.testTag("activity-older")) { Text("Passaggi precedenti") }
    }
}

@Composable fun ReferenceContent(
    state: UiState,
    model: WorkspaceModel,
    reference: ConversationReference,
    onDiscuss: (ReferenceDetail) -> Unit
) {
    var detail by remember(state.accountScope, state.selected, reference) { mutableStateOf<ReferenceDetail?>(null) }
    var error by remember(state.accountScope, state.selected, reference) { mutableStateOf("") }
    var loading by remember(state.accountScope, state.selected, reference) { mutableStateOf(true) }
    var refresh by remember(reference) { mutableIntStateOf(0) }
    val openWork = LocalOpenWork.current
    val openCapability = LocalOpenCapability.current
    LaunchedEffect(state.accountScope, state.selected, reference, refresh) {
        loading = true
        error = ""
        detail = null
        try {
            detail = model.referenceDetail(reference)
            if (detail == null) error = "La vista è cambiata. Riapri il riferimento o aggiorna questa lettura."
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message ?: "Riferimento non disponibile." }
        finally { loading = false }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("${referenceKindLabel(reference.kind)} · v${reference.version}", style = MaterialTheme.typography.labelLarge)
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        detail?.let { value ->
            ReferenceBody(value, state)
            Button(onClick = { onDiscuss(value) }, modifier = Modifier.testTag("reference-discuss")) { Text("Parlane con Miriam") }
            Text("Il riferimento accompagna il tuo prossimo messaggio o la tua nota vocale. Nessun invio automatico.", style = MaterialTheme.typography.bodySmall)
            if (reference.kind == "active_work") TextButton(onClick = { openWork?.invoke(reference.id) }) { Text("Apri i controlli correnti di questo lavoro") }
            else {
                val destination = when (reference.kind) {
                    "goal" -> "goal"
                    "information", "commitment" -> "context"
                    "task" -> "tasks"
                    "artifact" -> "artifacts"
                    "question" -> "questions"
                    "workstream" -> "work"
                    "scheduled_event" -> "calendar"
                    else -> "sources"
                }
                TextButton(onClick = { openCapability?.invoke(destination) }) { Text("Apri stato e controlli dello spazio") }
            }
        }
        TextButton(onClick = { refresh++ }, enabled = !loading) { Text("Rileggi riferimento e stato corrente") }
    }
}

@Composable private fun ReferenceBody(detail: ReferenceDetail, state: UiState) {
    Text(detail.event?.title ?: detail.title, style = MaterialTheme.typography.headlineSmall)
    detail.event?.let { event ->
        Text("${event.actorName} · ${messageTime(event.occurredAt)}", style = MaterialTheme.typography.labelMedium)
        if (detail.title != event.title) Text(detail.title, style = MaterialTheme.typography.titleSmall)
        if (event.summary.isNotBlank()) Text(event.summary)
        Text(event.qualification, style = MaterialTheme.typography.bodySmall)
    } ?: Text("${personLabel(state, detail.actor)} · ${messageTime(detail.createdAt)}", style = MaterialTheme.typography.labelMedium)
    HorizontalDivider(thickness = 1.5.dp)
    SelectionContainer { Text(detail.content, style = MaterialTheme.typography.bodyLarge) }
    if (detail.event != null) Text("Relazione con lo stato corrente", style = MaterialTheme.typography.titleSmall)
    Text(detail.qualification, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(if (detail.current) "Questa versione compare nello stato corrente. La qualifica specifica che cosa rappresenta." else "Questo riferimento non compare nello stato corrente. La sua storia resta conservata.", style = MaterialTheme.typography.bodySmall)
    ReferenceProvenance(detail.provenance, state)
    if (detail.sourceIds.isNotEmpty()) {
        Text("Fonti conservate", style = MaterialTheme.typography.titleSmall)
        detail.sourceIds.forEach { id ->
            if (detail.reference.kind == "source" && detail.reference.id == id) Text("Fonte originale · $id", style = MaterialTheme.typography.labelSmall)
            else ReferenceLink(ConversationReference("source", id, 1), "Apri fonte · ${id.take(8)}")
        }
    }
    var identifiers by rememberSaveable(detail.reference) { mutableStateOf(false) }
    TextButton(onClick = { identifiers = !identifiers }) { Text("Identità del riferimento") }
    if (identifiers) SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${detail.reference.id} · v${detail.reference.version}", style = MaterialTheme.typography.bodySmall)
            detail.reference.eventId?.let { Text("Evento: $it", style = MaterialTheme.typography.bodySmall) }
        }
    }
}

private fun personLabel(state: UiState, actor: String?): String = actor?.let { id ->
    state.detail?.rows("members")?.firstOrNull { it.getString("user_id") == id }?.getString("name") ?: "Partecipante · $id"
} ?: "Atto registrato"

@Composable private fun ReferenceProvenance(provenance: JSONObject, state: UiState) {
    val labels = linkedMapOf(
        "reason" to "Motivo", "status" to "Stato registrato", "currentVersion" to "Versione corrente",
        "currentPrimary" to "Goal primario corrente", "goalVersion" to "Versione del Goal",
        "adoptedAt" to "Adozione registrata", "currentDraftVersion" to "Bozza corrente",
        "currentAdoptedVersion" to "Versione adottata corrente", "selectedCurrentlyAdopted" to "Questa versione è adottata ora",
        "contractVersion" to "Versione del contratto di lavoro", "currentContractVersion" to "Contratto di lavoro corrente",
        "currentRevision" to "Revisione corrente", "currentPhase" to "Fase corrente del lavoro", "currentValidity" to "Validità corrente del lavoro",
        "scope" to "Perimetro", "expectedOutput" to "Risultato atteso", "contributionQualification" to "Qualifica del contributo",
        "recordedLifecycle" to "Stato del filone registrato", "recordedAction" to "Passaggio registrato", "currentState" to "Stato corrente",
        "dueAt" to "Scadenza", "startsAt" to "Inizio", "endsAt" to "Fine", "timeZone" to "Fuso orario",
        "documentVersion" to "Versione del documento", "authorName" to "Autore attribuito", "url" to "Indirizzo della fonte"
    )
    labels.forEach { (key, label) ->
        if (provenance.has(key) && !provenance.isNull(key)) {
            val raw = provenance.get(key)
            val value = if (raw is Boolean) (if (raw) "sì" else "no") else raw.toString()
            Text("$label: $value", style = MaterialTheme.typography.bodySmall)
        }
    }
    listOf("explicitAdherents" to "Adesioni esplicite", "representedPeople" to "Persone rappresentate").forEach { (key, label) ->
        provenance.optJSONArray(key)?.let { people ->
            val names = (0 until people.length()).map { personLabel(state, people.getString(it)) }
            Text("$label: ${names.ifEmpty { listOf("nessuna") }.joinToString(", ")}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable fun ComposerReference(attachment: AttachedReference, clear: () -> Unit) {
    val open = LocalOpenReference.current
    OutlinedCard(Modifier.fillMaxWidth(), border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { open?.invoke(attachment.reference) }, modifier = Modifier.weight(1f)) {
                Text("${referenceKindLabel(attachment.reference.kind)} · v${attachment.reference.version}\n${attachment.title}", maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            TextButton(onClick = clear, modifier = Modifier.testTag("reference-detach")) { Text("Scollega") }
        }
    }
}
