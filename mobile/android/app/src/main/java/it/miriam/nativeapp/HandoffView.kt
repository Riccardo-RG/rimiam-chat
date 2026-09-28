package it.miriam.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONObject

val LocalSelectedHandoff = staticCompositionLocalOf<ConversationHandoff?> { null }
val LocalDetachHandoff = staticCompositionLocalOf<(() -> Unit)?> { null }
val LocalOpenHandoff = staticCompositionLocalOf<((ConversationHandoff) -> Unit)?> { null }

fun handoffDestination(kind: String) = when {
    kind.startsWith("goal.") || kind.startsWith("project.") -> "goal"
    kind.startsWith("information.") -> "context"
    kind.startsWith("task.") -> "tasks"
    kind == "artifact.prepare" -> "artifacts"
    kind == "email.prepare" -> "email"
    else -> "calendar"
}

@Composable fun selectedHandoff(vararg kinds: String): ConversationHandoff? =
    LocalSelectedHandoff.current?.takeIf { it.kind in kinds }

fun UiState.handoffPending(handoff: ConversationHandoff) = pending.any { pending ->
    runCatching { pending.commandJSON?.let { JSONObject(it).optJSONObject("conversationOrigin")?.optString("handoffId") } }.getOrNull() == handoff.id
}

fun UiState.canUseHandoff(handoff: ConversationHandoff?): Boolean = handoff == null ||
    (handoffs.firstOrNull { it.id == handoff.id }?.status == "ready" && !handoffPending(handoff))

// Called only by the matching existing form at explicit submission, never by the model dispatcher.
fun JSONObject.withHandoff(handoff: ConversationHandoff?): JSONObject = apply {
    handoff?.let { put("conversationOrigin", JSONObject().put("handoffId", it.id)) }
}

@Composable fun HandoffCard(handoff: ConversationHandoff, state: UiState) {
    val open = LocalOpenHandoff.current
    var expanded by rememberSaveable(handoff.id) { mutableStateOf(false) }
    OutlinedCard(Modifier.fillMaxWidth(), border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("DALLA CONVERSAZIONE", style = MaterialTheme.typography.labelSmall)
            Text(handoff.summary, style = MaterialTheme.typography.titleSmall)
            Text(handoff.suggestedText, style = MaterialTheme.typography.bodyMedium, maxLines = if (expanded) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Riduci il testo" else "Leggi il suggerimento completo") }
            when (handoff.status) {
                "applied" -> HandoffApplicationView(handoff, state)
                "stale" -> Text("Il riferimento è cambiato. Puoi rileggere il passaggio e preparare una nuova proposta dai controlli dello spazio.", style = MaterialTheme.typography.bodySmall)
                "navigation" -> Text("Apre i controlli personali del servizio. Nessuna azione o informazione privata viene pubblicata qui.", style = MaterialTheme.typography.bodySmall)
                else -> Text("Suggerimento da preparare e verificare. Il modulo conserva i controlli e le conferme applicabili.", style = MaterialTheme.typography.bodySmall)
            }
            handoff.target?.let { ReferenceLink(it, "Rileggi il riferimento selezionato") }
            if (handoff.status != "applied") TextButton(onClick = { open?.invoke(handoff) }, enabled = !state.handoffPending(handoff), modifier = Modifier.testTag("handoff-open-${handoff.id}")) {
                Text(if (handoff.status == "navigation") "Apri i controlli personali" else "Prepara nel modulo dello spazio")
            }
            if (state.handoffPending(handoff)) Text("Esito da verificare: usa la stessa operazione nei promemoria.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable fun MessageHandoffs(message: Message, state: UiState, model: WorkspaceModel, expanded: Boolean, expand: () -> Unit) {
    val source = if (message.actorKind == "miriam") message.replyToSourceId ?: message.id else message.id
    val handoffs = state.handoffs.filter { it.sourceId == source || it.sourceMessageId == source }
    if (message.actorKind == "miriam" || expanded) handoffs.forEach { handoff -> key(handoff.id) { HandoffCard(handoff, state) } }
    TextButton(
        onClick = { expand(); model.loadHandoffs(source) },
        enabled = !state.handoffLoading,
        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
        modifier = Modifier.testTag("message-handoffs-${message.id}")
    ) {
        Text(if(expanded) "Rileggi passaggi" else "Fonte e passaggi ···",style=MaterialTheme.typography.labelSmall)
    }
    if(expanded) ReferenceLink(ConversationReference("source",source,1),"Apri la fonte originale")
    if (expanded && !state.handoffLoading && state.handoffError.isBlank() && handoffs.isEmpty()) Text("Nessun passaggio collegato disponibile.", style = MaterialTheme.typography.bodySmall)
    if (expanded && state.handoffError.isNotBlank()) Text(state.handoffError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
}

@Composable private fun HandoffApplicationView(handoff: ConversationHandoff, state: UiState) {
    val application = handoff.application ?: return
    val actor = state.detail?.rows("members")?.firstOrNull { it.getString("user_id") == application.actor }?.getString("name") ?: application.actor
    Text("Passaggio applicato da $actor · ${messageTime(application.createdAt)}", style = MaterialTheme.typography.bodySmall)
    application.resultReference?.let { ReferenceLink(it, "Esamina il risultato registrato") }
    application.preparedId?.let { id ->
        val label = when (application.preparedKind) {
            "goal_transition" -> "Proposta di cambiamento del Goal"
            "project_proposal" -> "Proposta normativa"
            else -> "Proposta di revisione del Task"
        }
        Text("$label · $id. La preparazione non ne implica l’adozione.", style = MaterialTheme.typography.bodySmall)
        val open = LocalOpenCapability.current
        TextButton(onClick = { open?.invoke(handoffDestination(handoff.kind)) }) { Text("Apri proposte e approvazioni") }
    }
}

@Composable fun HandoffOriginPanel(state: UiState, handoff: ConversationHandoff) {
    val detach = LocalDetachHandoff.current
    val current = state.handoffs.firstOrNull { it.id == handoff.id } ?: handoff
    OutlinedCard(Modifier.fillMaxWidth(), border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.outline)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Origine: ${handoff.summary}", style = MaterialTheme.typography.titleSmall)
            ReferenceLink(ConversationReference("source", handoff.sourceId, 1), "Rileggi il contributo di origine")
            handoff.target?.let { ReferenceLink(it, "Versione collegata · v${it.version}") }
            if (!state.canUseHandoff(handoff)) Text(
                if (state.handoffPending(handoff)) "Invio da verificare: la bozza è conservata e il recupero usa la stessa operazione."
                else "Il passaggio è ${if (current.status == "applied") "già applicato" else "da rivalutare"}. La bozza resta conservata e non viene trasferita a una nuova versione.",
                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall
            )
            if (current.status == "applied") HandoffApplicationView(current, state)
            TextButton(onClick = { detach?.invoke() }, modifier = Modifier.testTag("handoff-detach")) { Text("Scollega il suggerimento · conserva la bozza") }
        }
    }
}
