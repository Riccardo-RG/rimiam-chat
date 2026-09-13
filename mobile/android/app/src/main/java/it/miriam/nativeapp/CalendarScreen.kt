package it.miriam.nativeapp

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import kotlinx.coroutines.launch
import java.time.*

private fun actionBody(type: String, action: JSONObject, calendar: JSONObject): JSONObject {
    val body = JSONObject().put("type", type).put("actionId", action.getString("id")).put("version", action.getInt("version"))
    if (type == "calendar.authorize") body.put("expectedContextRevision", calendar.getInt("contextRevision")).put("expectedAccessRevision", calendar.getInt("accessRevision")).put("representSelf", true)
    if (type == "calendar.reject") body.put("reason", "Rifiutata esplicitamente dalla persona rappresentata")
    return body
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun CalendarScreen(state: UiState, model: WorkspaceModel, close: () -> Unit) {
    val context = LocalContext.current
    var title by remember { mutableStateOf("") }; var reason by remember { mutableStateOf("") }
    var starts by remember { mutableStateOf(ZonedDateTime.now().plusHours(1)) }; var ends by remember { mutableStateOf(ZonedDateTime.now().plusHours(2)) }
    var selfOnly by remember { mutableStateOf(false) }; var editing by remember { mutableStateOf<JSONObject?>(null) }
    var sourceObservation by remember { mutableStateOf<String?>(null) }; var observedPayload by remember { mutableStateOf<JSONObject?>(null) }
    BackHandler { close() }
    Scaffold(topBar = { TopAppBar(title = { Text("Calendario") }, navigationIcon = { TextButton(onClick = close) { Text("Indietro") } }) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).testTag("calendar-content"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.error.isNotEmpty()) Text(state.error, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = {
                val date = LocalDate.parse(state.calendarStart)
                DatePickerDialog(context, { _, y, m, d -> model.calendarWindow(LocalDate.of(y, m + 1, d).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
            }) { Text("Mostra 30 giorni dal ${state.calendarStart}") }
            val c = state.calendar
            if (c == null || c.getString("workspaceId") != state.selected) CircularProgressIndicator()
            else {
                Text("Le proposte condividono con lo spazio contenuto preciso, azione e nome della risorsa esterna.", style = MaterialTheme.typography.bodySmall)
                if (!c.getBoolean("providerConfigured")) Text("Provider esterno non configurato. Gli appuntamenti interni sono disponibili.", style = MaterialTheme.typography.bodySmall)
                Text(if (editing == null) "Appuntamento personale" else "Modifica interna", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(title, { title = it }, readOnly = sourceObservation != null, label = { Text("Titolo appuntamento") }, modifier = Modifier.fillMaxWidth().testTag("calendar-title"))
                if (sourceObservation == null) {
                    CalendarDateTime("Inizio", starts) { starts = it }
                    CalendarDateTime("Fine", ends) { ends = it }
                } else {
                    Text("Modifica proposta dall’osservazione. Salvando, condividi solo questi dati e li stabilisci per te.")
                    observedPayload?.let { CalendarSchedule(it) }
                }
                OutlinedTextField(reason, { reason = it }, label = { Text("Motivo") }, modifier = Modifier.fillMaxWidth().testTag("calendar-reason"))
                Row { Checkbox(selfOnly, { selfOnly = it }, modifier = Modifier.testTag("calendar-self")); Text("Rappresento soltanto me") }
                Text("Non modifica vincoli o impegni altrui e non scrive su calendari esterni.", style = MaterialTheme.typography.bodySmall)
                Button(onClick = {
                    val payload = JSONObject().put("title", title).put("start", starts.toInstant().toString()).put("end", ends.toInstant().toString()).put("timeZone", ZoneId.systemDefault().id)
                    val body = JSONObject().put("type", if (editing == null) "temporal.create" else "temporal.revise").put("payload", payload).put("reason", reason).put("representSelf", true).put("expectedContextRevision", c.getInt("contextRevision"))
                    editing?.let { body.put("eventId", it.getString("id")).put("expectedVersion", it.getInt("version")) }
                    sourceObservation?.let { body.put("sourceObservationId", it).put("shareObservedContent", true).put("payload", observedPayload) }
                    model.workspaceCommand(body, title)
                    title = ""; reason = ""; selfOnly = false; editing = null
                    sourceObservation = null; observedPayload = null
                }, enabled = !state.busy && selfOnly && title.isNotBlank() && reason.isNotBlank() && ends > starts, modifier = Modifier.testTag("calendar-save")) { Text("Salva appuntamento interno") }
                if (editing != null) TextButton(onClick = { editing = null; title = ""; reason = ""; sourceObservation = null; observedPayload = null }) { Text("Annulla modifica") }
                CommitmentTimeEditor(state,model,c)
                HorizontalDivider(); Text("Stato temporale dello spazio", style = MaterialTheme.typography.titleLarge)
                if (c.rows("temporal").isEmpty()) Text("Nessun appuntamento in questo periodo.")
                for (t in c.rows("temporal")) {
                    val p = t.getJSONObject("payload")
                    Text(p.getString("title"), style = MaterialTheme.typography.titleMedium); CalendarSchedule(p)
                    CalendarHistoryControl(model,t.getString("id"),t.getString("kind"))
                    Text("${if (t.getString("kind") == "commitment") "Data dell’impegno" else "Appuntamento"} · v${t.getInt("version")} · ${t.getString("reason")}")
                    if (t.getString("personId") == state.user?.id) {
                        if (t.getString("kind") == "scheduled_event") TextButton(onClick = {
                            editing = t; title = p.getString("title"); reason = ""
                            sourceObservation = null; observedPayload = null
                            starts = Instant.parse(p.getString("start")).atZone(ZoneId.of(p.getString("timeZone"))); ends = Instant.parse(p.getString("end")).atZone(starts.zone)
                        }) { Text("Modifica solo nello spazio") }
                        for (connection in c.rows("connections").filter { it.getBoolean("active") }) for (resource in connection.rows("resources").filter { it.getBoolean("canWriteSelf") }) {
                            TextButton(onClick = {
                                val publication = c.rows("publications").find { it.getString("resourceId") == resource.getString("id") && it.optJSONObject("temporal")?.getString("id") == t.getString("id") }
                                val body = JSONObject().put("type", "calendar.propose").put("connectionId", connection.getString("id")).put("resourceId", resource.getString("id"))
                                    .put("operation", if (publication == null) "create" else "update").put("payload", p).put("temporal", JSONObject().put("kind", t.getString("kind")).put("id", t.getString("id")).put("version", t.getInt("version")))
                                    .put("reason", "Pubblicazione proposta dall’appuntamento interno").put("shareWithWorkspace", true)
                                publication?.let { body.put("publicationId", it.getString("id")) }
                                model.workspaceCommand(body, "Proposta Calendar: ${p.getString("title")}")
                            }, enabled = !state.busy) { Text("Proponi pubblicazione su ${resource.getString("label")}") }
                        }
                    }
                }
                HorizontalDivider(); Text("Proposte e risultati", style = MaterialTheme.typography.titleLarge)
                for (a in c.rows("actions")) {
                    val p = a.getJSONObject("payload")
                    Text(p.getString("title"), style = MaterialTheme.typography.titleMedium)
                    Text("${a.getString("status")} · v${a.getInt("version")}", modifier = Modifier.testTag("calendar-status-${a.getString("id")}"))
                    Text("${if (a.getString("operation") == "create") "Crea" else "Aggiorna"} su ${a.getString("target")}"); CalendarSchedule(p); Text(a.getString("reason"))
                    Text("Rappresenta soltanto ${a.optString("personName", a.getString("personId"))}, senza inviti o notifiche esterne. Autorizzare non certifica il successo.", style = MaterialTheme.typography.bodySmall)
                    if (!a.isNull("error")) Text(a.getString("error"))
                    if (a.getString("status") == "OUTCOME_UNKNOWN") Text("L’effetto potrebbe essere già avvenuto. Verifica prima di riprovare.")
                    CalendarHistoryControl(model,a.getString("id"),"action")
                    CalendarRevisionControl(state,model,c,a)
                    val controls = listOf(Triple("canAuthorize", "calendar.authorize", "Autorizzo questa azione per me"), Triple("canReject", "calendar.reject", "Rifiuta proposta"), Triple("canRetry", "calendar.retry", "Riprova azione invariata"), Triple("canReconcile", "calendar.reconcile", "Verifica esito esterno"))
                    for ((gate, type, label) in controls) if (a.getBoolean(gate)) Button(onClick = { model.workspaceCommand(actionBody(type, a, c), "$label: ${p.getString("title")}") }, enabled = !state.busy, modifier = Modifier.testTag("$type-${a.getString("id")}")) { Text(label) }
                }
                if (!c.isNull("nextActions")) TextButton(onClick = { model.moreCalendar() }) { Text("Altre proposte Calendar") }
                c.rows("connections").filter{it.getBoolean("active")}.forEach{connection->TextButton(onClick={model.workspaceCommand(command("calendar.disconnect","connectionId" to connection.getString("id"),"expectedVersion" to connection.getInt("version")),"Disconnessione Calendar")},enabled=!state.busy){Text("Disconnetti "+connection.getString("label"))}}
                HorizontalDivider(); Text("Osservazioni esterne riservate", style = MaterialTheme.typography.titleLarge)
                for (connection in c.rows("connections").filter { it.getBoolean("active") }) for (r in connection.rows("resources").filter { it.getBoolean("canRead") }) {
                    for (mode in listOf("events", "availability")) TextButton(onClick = {
                        val start = LocalDate.parse(state.calendarStart).atStartOfDay(ZoneOffset.UTC).toInstant()
                        model.workspaceCommand(JSONObject().put("type", "calendar.read").put("connectionId", connection.getString("id")).put("resourceId", r.getString("id")).put("mode", mode).put("start", start.toString()).put("end", start.plusSeconds(30*86400).toString()), "Lettura Calendar")
                    }, enabled = !state.busy) { Text("${if (mode == "events") "Leggi eventi" else "Leggi disponibilità"} · ${r.getString("label")}") }
                }
                for (o in c.rows("observations")) {
                    Text("Fonte esterna · ${o.getString("observedAt")}. Non è informazione accettata né impegno.", style = MaterialTheme.typography.bodySmall)
                    val data = o.getJSONObject("data")
                    for (e in data.rows("events")) {
                        val payload = e.getJSONObject("payload")
                        Text("${payload.getString("title")} · ${payload.getString("start")}${if (e.getBoolean("deleted")) " · non più presente" else ""}")
                        val publication = c.rows("publications").find { it.getString("resourceId") == o.getString("resourceId") && it.getString("externalId") == e.getString("id") }
                        val temporal = c.rows("temporal").find { it.getString("kind") == "scheduled_event" && it.getString("id") == publication?.optJSONObject("temporal")?.optString("id") && it.getString("personId") == state.user?.id }
                        if (temporal != null && !e.getBoolean("deleted")) TextButton(onClick = {
                            editing = temporal; sourceObservation = o.getString("id"); observedPayload = payload
                            title = payload.getString("title"); reason = ""; selfOnly = false
                            starts = Instant.parse(payload.getString("start")).atZone(ZoneId.of(payload.getString("timeZone"))); ends = Instant.parse(payload.getString("end")).atZone(starts.zone)
                        }) { Text("Proponi modifica interna da questa osservazione") }
                    }
                    for (b in data.rows("busy")) Text("Occupato: ${b.getString("start")} → ${b.getString("end")}")
                    if (!data.getBoolean("complete")) Text("Lettura parziale: occorre altro contesto.")
                    val connection = c.rows("connections").find { it.rows("resources").any { r -> r.getString("id") == o.getString("resourceId") } }
                    if (!data.isNull("nextCursor") && connection != null) TextButton(onClick = {
                        model.workspaceCommand(JSONObject().put("type", "calendar.read").put("connectionId", connection.getString("id")).put("resourceId", o.getString("resourceId")).put("mode", o.getString("mode")).put("start", o.getString("start")).put("end", o.getString("end")).put("cursor", data.getString("nextCursor")), "Altra pagina Calendar")
                    }) { Text("Continua lettura") }
                }
                for (r in c.rows("reads").filter { it.getString("status") != "COMPLETED" }) Text("${r.getString("status")} · ${if (r.isNull("error")) "" else r.getString("error")}")
                HorizontalDivider(); Text("Confronto", style = MaterialTheme.typography.titleLarge)
                for (alert in c.rows("alerts")) Text(alert.getString("detail"))
            }
            if (state.busy) CircularProgressIndicator()
        }
    }
}
@Composable private fun CalendarSchedule(payload: JSONObject) { Text("${payload.getString("start")} → ${payload.getString("end")} · ${payload.getString("timeZone")}") }
@Composable private fun CalendarDateTime(label: String, value: ZonedDateTime, changed: (ZonedDateTime) -> Unit) {
    val context = LocalContext.current
    TextButton(onClick = {
        DatePickerDialog(context, { _, y, m, d ->
            TimePickerDialog(context, { _, hour, minute -> changed(ZonedDateTime.of(y, m + 1, d, hour, minute, 0, 0, value.zone)) }, value.hour, value.minute, true).show()
        }, value.year, value.monthValue - 1, value.dayOfMonth).show()
    }) { Text("$label: ${value.toLocalDate()} ${value.toLocalTime().withSecond(0).withNano(0)}") }
}

@Composable private fun CommitmentTimeEditor(state:UiState,model:WorkspaceModel,c:JSONObject){
 val commitments=c.rows("ownCommitments");if(commitments.isEmpty())return
 var selected by remember{mutableStateOf("")};var menu by remember{mutableStateOf(false)};var reason by remember{mutableStateOf("")};var accepted by remember{mutableStateOf(false)}
 var starts by remember{mutableStateOf(ZonedDateTime.now().plusHours(1))};var ends by remember{mutableStateOf(ZonedDateTime.now().plusHours(2))}
 Text("Data di un tuo impegno già adottato",style=MaterialTheme.typography.titleMedium)
 TextButton(onClick={menu=true}){Text(commitments.firstOrNull{it.getString("id")==selected}?.getString("content") ?: "Scegli un impegno")}
 DropdownMenu(expanded=menu,onDismissRequest={menu=false}){commitments.forEach{item->DropdownMenuItem(text={Text(item.getString("content"))},onClick={selected=item.getString("id");menu=false})}}
 CalendarDateTime("Inizio",starts){starts=it};CalendarDateTime("Fine",ends){ends=it};OutlinedTextField(reason,{reason=it},label={Text("Motivazione")})
 Row{Checkbox(accepted,{accepted=it});Text("Stabilisco la data soltanto per me")};Text("Non modifica il contenuto dell’impegno né calendari esterni.",style=MaterialTheme.typography.bodySmall)
 Button(onClick={commitments.firstOrNull{it.getString("id")==selected}?.let{item->model.workspaceCommand(command("commitment.time.set","commitmentId" to selected,"expectedVersion" to item.getInt("version"),"expectedContextRevision" to c.getInt("contextRevision"),"representSelf" to true,"time" to JSONObject().put("start",starts.toInstant().toString()).put("end",ends.toInstant().toString()).put("timeZone",ZoneId.systemDefault().id),"reason" to reason),"Data dell’impegno")}},enabled=!state.busy && accepted && selected.isNotEmpty() && reason.isNotBlank() && ends.isAfter(starts)){Text("Stabilisci la data dell’impegno")}
}

@Composable private fun CalendarRevisionControl(state:UiState,model:WorkspaceModel,c:JSONObject,a:JSONObject){
 if(a.optString("proposedBy")!=state.user?.id || a.getString("personId")!=state.user?.id || a.getString("status") !in listOf("PROPOSED","AUTHORIZED","FAILED"))return
 val temporal=c.rows("temporal").firstOrNull{it.getString("id")==a.optJSONObject("temporal")?.getString("id") && it.getString("kind")==a.optJSONObject("temporal")?.getString("kind")} ?: return
 val publication=c.rows("publications").firstOrNull{it.getString("connectionId")==a.getString("connectionId") && it.getString("resourceId")==a.getString("resourceId") && it.optJSONObject("temporal")?.getString("id")==temporal.getString("id") && it.optJSONObject("temporal")?.getString("kind")==temporal.getString("kind")}
 if(a.getString("operation")=="update" && publication==null)return
 var expanded by remember(a.getString("id")){mutableStateOf(false)}
 TextButton(onClick={expanded=!expanded}){Text("Rivedi la proposta Calendar")}
 if(expanded){val payload=temporal.getJSONObject("payload");Text(payload.getString("title"));CalendarSchedule(payload);Text("Nuova versione dalla situazione interna corrente; le autorizzazioni precedenti decadono. Nessuna scrittura esterna.",style=MaterialTheme.typography.bodySmall)
  TextButton(onClick={val body=command("calendar.revise","actionId" to a.getString("id"),"expectedVersion" to a.getInt("version"),"connectionId" to a.getString("connectionId"),"resourceId" to a.getString("resourceId"),"operation" to a.getString("operation"),"temporal" to JSONObject().put("id",temporal.getString("id")).put("kind",temporal.getString("kind")).put("version",temporal.getInt("version")),"payload" to payload,"reason" to "Riallineamento esplicito alla versione interna corrente","shareWithWorkspace" to true);if(a.getString("operation")=="update")body.put("publicationId",publication!!.getString("id"));model.workspaceCommand(body,"Rivedi proposta Calendar")},enabled=!state.busy){Text("Riallinea questa proposta alla versione interna")}
 }
}

@Composable private fun CalendarHistoryControl(model:WorkspaceModel,id:String,kind:String){
 var history by remember(id,kind){mutableStateOf("")};var expanded by remember(id,kind){mutableStateOf(false)};val scope=rememberCoroutineScope()
 TextButton(onClick={expanded=!expanded;if(expanded)scope.launch{history=model.calendarHistory(id,kind)}}){Text("Versioni, origine e transizioni")}
 if(expanded && history.isNotEmpty())Text(history,style=MaterialTheme.typography.bodySmall)
}
