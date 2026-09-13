package it.miriam.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Composable fun AccessGovernance(state:UiState,model:WorkspaceModel) {
    var expanded by remember {mutableStateOf(false)};var snapshot by remember {mutableStateOf<JSONObject?>(null)};var history by remember {mutableStateOf<JSONObject?>(null)}
    var kind by remember {mutableStateOf("stewardship")};var people by remember {mutableStateOf(setOf<String>())};var reason by remember {mutableStateOf("")}
    val scope=rememberCoroutineScope()
    fun refresh(){scope.launch{snapshot=model.workspaceRead("access")}}
    fun propose(change:JSONObject){val current=snapshot ?: return;model.workspaceCommand(JSONObject().put("type","access.propose").put("expectedAccessRevision",current.getInt("accessRevision")).put("change",change).put("reason",reason),"Proposta: $reason")}
    TextButton(onClick={expanded=!expanded;if(expanded) refresh()}) {Text("Accordi e governance dell’accesso")}
    if(expanded) {
        LaunchedEffect(state.detail?.getJSONObject("workspace")?.getInt("access_revision")) {snapshot=model.workspaceRead("access")}
        Text("Amministrare l’accesso non conferisce authority sulle decisioni del progetto.")
        snapshot?.let {view->
            fun name(id:String)=view.rows("members").firstOrNull{it.getString("id")==id}?.getString("name") ?: "Partecipante"
            view.rows("relationships").forEach {r->Card(Modifier.fillMaxWidth()) {Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                Text(r.getString("holderName"),style=MaterialTheme.typography.titleMedium);Text((if(r.getString("kind")=="stewardship") "Governance accesso" else "Delega inviti")+" · v${r.getInt("version")}")
                Text(if(r.getBoolean("available")) "Esercitabile" else "Non esercitabile");Text(if(r.getBoolean("protected")) "Relazione protetta; tutte le condizioni restano vincolanti." else "Revocabile secondo le condizioni indicate.")
                r.rows("conditions").forEach {c->Text(name(c.getString("holderId")) + if(c.getBoolean("available")) " · condizione disponibile" else " · condizione non disponibile")}
                TextButton(onClick={scope.launch{history=model.workspaceRead("access-history?id=${r.getString("id")}")}}) {Text("Storia della relazione")}
                if(r.getBoolean("active")) TextButton(onClick={propose(JSONObject().put("kind","revoke").put("relationshipId",r.getString("id")))},enabled=!state.busy && reason.isNotBlank()) {Text("Proponi revoca")}
            }}}
            Text("Nuovo accordo",style=MaterialTheme.typography.titleMedium)
            Row {FilterChip(kind=="stewardship",onClick={kind="stewardship"},label={Text("Governance protetta")});Spacer(Modifier.width(4.dp));FilterChip(kind=="delegation",onClick={kind="delegation"},label={Text("Delega inviti")})}
            view.rows("members").filter{it.getBoolean("active")}.forEach {p->Row {Checkbox(p.getString("id") in people,{people=if(it) people+p.getString("id") else people-p.getString("id")});Text(p.getString("name"))}}
            OutlinedTextField(reason,{reason=it},label={Text("Motivazione (anche per le revoche)")},modifier=Modifier.fillMaxWidth())
            Button(onClick={propose(if(kind=="stewardship") JSONObject().put("kind",kind).put("people",JSONArray(people.sorted())) else JSONObject().put("kind",kind).put("personId",people.first()))},enabled=!state.busy && reason.isNotBlank() && people.isNotEmpty() && (kind!="delegation" || people.size==1)) {Text("Prepara accordo da approvare")}
            view.rows("proposals").forEach {p->Card(Modifier.fillMaxWidth()) {Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(p.getString("reason"),style=MaterialTheme.typography.titleMedium);Text(when(p.getString("status")){"pending"->"In attesa degli atti richiesti";"adopted"->"Accordo adottato";else->"Proposta superata"})
                p.getJSONArray("terms").let{terms->repeat(terms.length()){Text(terms.getString(it))}};Text("Termini v${p.getInt("termsVersion")}",style=MaterialTheme.typography.bodySmall)
                p.rows("required").forEach {required->val role=required.getString("role");val person=required.getString("personId");Text(name(person)+" · "+if(role=="holder") "accettazione personale" else "autorizzazione modifica",style=MaterialTheme.typography.bodySmall)
                    if(p.getString("status")=="pending" && person==state.user?.id && p.rows("approvals").none{it.getString("personId")==person && it.getString("role")==role}) Button(onClick={model.workspaceCommand(JSONObject().put("type","access.approve").put("proposalId",p.getString("id")).put("expectedAccessRevision",view.getInt("accessRevision")).put("role",role).put("acceptTerms",true),"Atto esplicito sui termini di accesso")},enabled=!state.busy) {Text(if(role=="holder") "Accetto questi termini per me" else "Autorizzo la modifica indicata")}
                }
            }}}
            history?.rows("versions")?.forEach {v->Text("v${v.getInt("version")} · ${v.getString("createdAt")}\nAtto di ${name(v.getString("actor"))} · ${v.getString("basis")}\nAttiva: ${v.getBoolean("active")} · protetta: ${v.getBoolean("protected")}",style=MaterialTheme.typography.bodySmall)}
        }
    }
}
