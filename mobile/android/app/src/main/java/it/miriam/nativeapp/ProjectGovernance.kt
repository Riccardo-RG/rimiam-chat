package it.miriam.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.people(key:String)=getJSONArray(key).let{a->(0 until a.length()).map{a.getString(it)}}
@Composable private fun ProjectCard(title:String,initiallyOpen:Boolean=false,content:@Composable ColumnScope.()->Unit) {var open by remember{mutableStateOf(initiallyOpen)};LaunchedEffect(initiallyOpen){if(initiallyOpen)open=true};Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick={open=!open}){Text(title,style=MaterialTheme.typography.titleMedium)};if(open) content()}}}
@Composable private fun ProjectChoice(label:String,value:String,options:List<Pair<String,String>>,select:(String)->Unit) {var open by remember{mutableStateOf(false)};Box{OutlinedButton(onClick={open=true}){Text(label+": "+(options.firstOrNull{it.first==value}?.second ?: "scegli"))};DropdownMenu(open,onDismissRequest={open=false}){options.forEach{(id,title)->DropdownMenuItem(text={Text(title)},onClick={select(id);open=false})}}}}
private fun projectCommand(type:String,vararg values:Pair<String,Any>)=JSONObject().put("type",type).apply{values.forEach{(key,value)->put(key,value)}}
@Composable fun ProjectGovernance(state:UiState,model:WorkspaceModel) {
    var opened by remember{mutableStateOf(false)};var data by remember{mutableStateOf<JSONObject?>(null)};val scope=rememberCoroutineScope()
    fun refresh(){scope.launch{data=model.workspaceRead("project")}}
    val selected=selectedHandoff("goal.change","project.propose","project.replace","project.revoke")
    LaunchedEffect(selected?.id) {if(selected!=null){opened=true;data=model.workspaceRead("project")}}
    TextButton(onClick={opened=!opened;if(opened) refresh()}){Text("Lifecycle, decisioni e mandati")}
    if(!opened) return
    LaunchedEffect(state.detail?.getJSONObject("workspace")?.getInt("revision")){data=model.workspaceRead("project")}
    val p=data ?: return
    fun name(id:String)=p.rows("members").firstOrNull{it.getString("id")==id}?.getString("name") ?: "Partecipante"
    Text("Goal, decisioni e mandati restano distinti. Ogni adozione richiede gli atti espliciti delle persone pertinenti.")
    p.rows("goals").forEach{g->key(g.getString("id")){ProjectCard(g.getString("content"),initiallyOpen=selected?.kind=="goal.change" && selected.target?.id==g.getString("id")){
        var mode by remember{mutableStateOf("revise")};var content by remember{mutableStateOf("")};var reason by remember{mutableStateOf("")};var people by remember{mutableStateOf(setOf<String>())};var blockers by remember{mutableStateOf(setOf<String>())};var subgoal by remember{mutableStateOf(false)}
        var baseVersion by remember {mutableIntStateOf(g.getInt("version"))}
        var baseContent by remember {mutableStateOf(g.getString("content"))}
        val origin=selected?.takeIf {it.kind=="goal.change" && it.target?.id==g.getString("id")}
        val expectedVersion=origin?.target?.version ?: baseVersion
        val currentBase=expectedVersion==g.getInt("version")
        LaunchedEffect(origin?.id){if(origin!=null)content=origin.suggestedText}
        Text("v${g.getInt("version")} · ${g.getString("status")}")
        ProjectCard("Storia del Goal"){g.rows("versions").forEach{v->Text("v${v.getInt("version")} · ${name(v.getString("actor"))} · ${v.getString("createdAt")}");Text(v.getString("content"));Text(v.getString("reason"))}}
        if(g.getString("status")=="active"){
            ProjectChoice("Cambiamento",mode,listOf("revise" to "Nuova versione, stessa iniziativa","replace" to "Nuovo Goal sostitutivo","subgoal" to "Risultato subordinato","complete" to "Completa","abandon" to "Abbandona")){mode=it}
            if(mode !in listOf("complete","abandon")) OutlinedTextField(content,{content=it},label={Text("Contenuto proposto")})
            OutlinedTextField(reason,{reason=it},label={Text("Motivazione")})
            if(mode=="replace") Row{Checkbox(subgoal,{subgoal=it});Text("Il precedente diventa un Sub-goal")}
            Text("Altre persone il cui intento è interessato",style=MaterialTheme.typography.bodySmall)
            p.rows("members").filter{it.getBoolean("active")&&it.getBoolean("eligible")}.forEach{person->Row{Checkbox(person.getString("id") in people,{people=if(it)people+person.getString("id") else people-person.getString("id")});Text(person.getString("name"))}}
            Text("Gli obblighi restano validi. Segnala quelli incompatibili che impediscono la transizione.",style=MaterialTheme.typography.bodySmall)
            p.rows("acts").filter{it.getString("status")=="effective"&&!it.isNull("actId")}.forEach{act->Row{Checkbox(act.getString("actId") in blockers,{blockers=if(it)blockers+act.getString("actId") else blockers-act.getString("actId")});Text(act.getString("content"))}}
            if(!currentBase) {
                Text("La proposta parte dalla v$expectedVersion; il Goal è ora alla v${g.getInt("version")}. Rileggi il contenuto corrente prima di continuare.",color=MaterialTheme.colorScheme.error)
                Text(g.getString("content"))
                if(origin==null) TextButton(onClick={baseVersion=g.getInt("version");baseContent=g.getString("content")}) {Text("Usa la versione corrente mantenendo la bozza")}
            }
            Button(onClick={model.workspaceCommand(projectCommand("goal.propose","goalId" to g.getString("id"),"expectedVersion" to expectedVersion,"mode" to mode,"content" to if(mode in listOf("complete","abandon"))baseContent else content,"reason" to reason,"previousBecomesSubgoal" to (mode=="replace"&&subgoal),"affectedPeople" to JSONArray(people.sorted()),"blockingActIds" to JSONArray(blockers.sorted()),"preserveExistingObligations" to true).withHandoff(origin),"Proposta sul Goal")},enabled=!state.busy&&reason.isNotBlank()&&(mode in listOf("complete","abandon")||content.isNotBlank())&&state.canUseHandoff(origin)&&currentBase){Text("Proponi cambiamento")}
        }
    }}}
    p.rows("goalProposals").forEach{proposal->ProjectCard(proposal.getString("content")){
        Text("${proposal.getString("mode")} · ${proposal.getString("status")}");Text(proposal.getString("reason"));Text("Richiesti: "+proposal.people("people").map(::name).joinToString(", "))
        proposal.rows("obligations").forEach{o->Text((if(o.getBoolean("blocking"))"Blocca: " else "Conservato: ")+(p.rows("acts").firstOrNull{it.optString("actId")==o.getString("actId")}?.getString("content") ?: "Obbligo precedente"))}
        if(proposal.getString("status")=="pending") ProjectApprovals(state,model,p,proposal.people("people"),proposal.rows("approvals"),proposal.getString("goalId"),when(proposal.getString("mode")){"complete","abandon"->"goal.conclude";"subgoal"->"goal.subgoal";else->"goal.change"},"goal.approve","transitionId",proposal.getString("id"))
    }}
    ProjectActForm(state,model,p)
    p.rows("acts").forEach{act->ProjectCard(act.getString("content")){
        Text("${act.getString("kind")} · ${act.getString("status")}");Text("Persone: "+act.people("people").map(::name).joinToString(", "))
        act.rows("approvals").forEach{a->Text("${name(a.getString("actorId"))} per ${name(a.getString("personId"))} · ${a.getString("createdAt")}",style=MaterialTheme.typography.bodySmall)}
        if(act.getString("status")=="proposed") ProjectApprovals(state,model,p,act.people("people"),act.rows("approvals"),if(!act.isNull("replacesActId"))act.getString("replacesActId") else act.optString("goalId"),when(act.getString("operation")){"revoke"->"act.revoke";"replace"->"act.replace";else->"act.create"},"project.approve","proposalId",act.getString("proposalId"))
    }}
    ProjectMandates(state,model,p)
}
@Composable private fun ProjectApprovals(state:UiState,model:WorkspaceModel,p:JSONObject,people:List<String>,approvals:List<JSONObject>,scopeId:String,capability:String,type:String,idKey:String,id:String){
    fun approve(person:String,mandate:String?){val c=projectCommand(type,idKey to id,"expectedAccessRevision" to p.getInt("accessRevision"),"representedPersonId" to person,"confirmExactContent" to true);if(mandate!=null)c.put("mandateId",mandate);model.workspaceCommand(c,"Approvazione del contenuto esatto")}
    people.filter{person->approvals.none{it.getString("personId")==person}}.forEach{person->
        if(person==state.user?.id)Button(onClick={approve(person,null)},enabled=!state.busy){Text("Approvo il contenuto esatto per me")}
        p.rows("mandates").filter{it.getBoolean("available")&&it.getString("holderId")==state.user?.id&&it.getString("grantorId")==person&&it.getJSONObject("scope").getString("id")==scopeId&&it.getString("capability")==capability}.forEach{m->val name=p.rows("members").firstOrNull{it.getString("id")==person}?.getString("name") ?: "persona rappresentata";Button(onClick={approve(person,m.getString("id"))},enabled=!state.busy){Text("Approvo per $name nel mandato v${m.getInt("version")}")}}
    }
}
@Composable private fun ProjectActForm(state:UiState,model:WorkspaceModel,p:JSONObject){
    var kind by remember{mutableStateOf("decision")};var content by remember{mutableStateOf("")};var reason by remember{mutableStateOf("")};var goal by remember{mutableStateOf("")};var operation by remember{mutableStateOf("establish")};var previous by remember{mutableStateOf("")};var people by remember{mutableStateOf(setOf<String>())}
    var goalVersion by remember {mutableIntStateOf(0)}
    val currentGoal=goal.isBlank() || p.rows("goals").any {it.getString("id")==goal && it.getInt("version")==goalVersion}
    val origin=selectedHandoff("project.propose","project.replace","project.revoke")
    val targetAct=origin?.target?.let {ref->p.rows("acts").firstOrNull {it.getString("proposalId")==ref.id && it.getString("status")=="effective" && !it.isNull("actId")}}
    LaunchedEffect(origin?.id){if(origin!=null){content=origin.suggestedText;operation=when(origin.kind){"project.replace"->"replace";"project.revoke"->"revoke";else->"establish"};previous=targetAct?.getString("actId").orEmpty();targetAct?.let{kind=it.getString("kind")}}}
    val originMatches=origin==null || when(origin.kind){"project.propose"->operation=="establish";"project.replace"->operation=="replace" && previous==targetAct?.getString("actId");else->operation=="revoke" && previous==targetAct?.getString("actId")}
    ProjectCard("Prepara una decisione, un vincolo o un impegno",initiallyOpen=origin!=null){
        ProjectChoice("Tipo",kind,listOf("decision" to "Decisione","constraint" to "Vincolo","commitment" to "Impegno")){kind=it};ProjectChoice("Operazione",operation,listOf("establish" to "Stabilisci","replace" to "Sostituisci","revoke" to "Revoca")){operation=it}
        if(operation!="establish")ProjectChoice("Atto precedente",previous,p.rows("acts").filter{it.getString("status")=="effective"&&!it.isNull("actId")}.map{it.getString("actId") to it.getString("content")}){previous=it}
        OutlinedTextField(content,{content=it},label={Text("Contenuto esatto")});OutlinedTextField(reason,{reason=it},label={Text("Motivazione")});ProjectChoice("Goal collegato",goal,listOf("" to "Nessuno")+p.rows("goals").map{it.getString("id") to it.getString("content")}){goal=it;goalVersion=p.rows("goals").firstOrNull {g->g.getString("id")==it}?.getInt("version") ?: 0}
        p.rows("members").filter{it.getBoolean("active")&&it.getBoolean("eligible")}.forEach{person->Row{Checkbox(person.getString("id") in people,{people=if(it)people+person.getString("id") else people-person.getString("id")});Text(person.getString("name"))}}
        if(!currentGoal) Text("Il Goal collegato è cambiato. Seleziona di nuovo la versione da collegare.",color=MaterialTheme.colorScheme.error)
        Button(onClick={val c=projectCommand("project.propose","kind" to kind,"operation" to operation,"content" to content,"reason" to reason,"people" to JSONArray(people.sorted()),"goal" to (if(goal.isBlank())JSONObject.NULL else JSONObject().put("id",goal).put("version",goalVersion)));if(operation!="establish")c.put("replacesActId",previous);model.workspaceCommand(c.withHandoff(origin),"Proposta: $content")},enabled=!state.busy&&content.isNotBlank()&&reason.isNotBlank()&&people.isNotEmpty()&&(operation=="establish"||previous.isNotBlank())&&state.canUseHandoff(origin)&&originMatches&&currentGoal){Text("Proponi, senza adottare")}
    }
}
@Composable private fun ProjectMandates(state:UiState,model:WorkspaceModel,p:JSONObject){
    var holder by remember{mutableStateOf("")};var target by remember{mutableStateOf("")};var capability by remember{mutableStateOf("goal.change")};var reason by remember{mutableStateOf("")}
    var targetVersion by remember {mutableIntStateOf(0)}
    val targetParts=target.split(":")
    val currentTarget=targetParts.size==2 && when(targetParts[0]) {
        "goal" -> p.rows("goals").any {it.getString("id")==targetParts[1] && it.getInt("version")==targetVersion}
        "act" -> p.rows("acts").any {it.optString("actId")==targetParts[1] && it.getString("status")=="effective" && targetVersion==1}
        else -> false
    }
    fun name(id:String)=p.rows("members").firstOrNull{it.getString("id")==id}?.getString("name") ?: "Partecipante"
    ProjectCard("Delega la tua posizione entro uno scope"){
        ProjectChoice("Destinatario",holder,p.rows("members").filter{it.getBoolean("active")&&it.getBoolean("eligible")}.map{it.getString("id") to it.getString("name")}){holder=it}
        ProjectChoice("Scope esatto",target,p.rows("goals").map{("goal:"+it.getString("id")) to it.getString("content")}+p.rows("acts").filter{!it.isNull("actId")&&it.getString("status")=="effective"}.map{("act:"+it.getString("actId")) to it.getString("content")}){target=it;val parts=it.split(":");targetVersion=if(parts.firstOrNull()=="goal")p.rows("goals").firstOrNull {g->g.getString("id")==parts.getOrNull(1)}?.getInt("version") ?: 0 else 1}
        ProjectChoice("Capacità",capability,listOf("goal.change","goal.conclude","goal.subgoal","act.create","act.replace","act.revoke").map{it to it}){capability=it};OutlinedTextField(reason,{reason=it},label={Text("Motivazione")})
        Text("Deleghi senza scadenza soltanto la tua rappresentanza sull’oggetto/versione indicati. Il destinatario deve accettare.")
        if(target.isNotBlank()&&!currentTarget)Text("Lo scope selezionato è cambiato. Rileggilo e selezionalo di nuovo.",color=MaterialTheme.colorScheme.error)
        Button(onClick={val parts=target.split(":");if(parts.size==2){model.workspaceCommand(projectCommand("mandate.offer","holderId" to holder,"scope" to JSONObject().put("kind",parts[0]).put("id",parts[1]).put("version",targetVersion),"capability" to capability,"expiresAt" to JSONObject.NULL,"reason" to reason,"representSelf" to true),"Offerta di mandato")}},enabled=!state.busy&&holder.isNotBlank()&&currentTarget&&reason.isNotBlank()){Text("Offri mandato")}
    }
    p.rows("mandates").forEach{m->key(m.getString("id")){ProjectCard("${name(m.getString("grantorId"))} → ${name(m.getString("holderId"))}"){
        var explanation by remember{mutableStateOf("")};val status=m.getString("status");val actor=state.user?.id
        Text(m.getString("terms"));Text("v${m.getInt("version")} · $status");m.rows("versions").forEach{v->Text("v${v.getInt("version")} · ${name(v.getString("actor"))} · ${v.getString("status")} · ${v.getString("reason")}",style=MaterialTheme.typography.bodySmall)}
        OutlinedTextField(explanation,{explanation=it},label={Text("Motivazione dell’atto")})
        val actions=mutableListOf<Pair<String,String>>()
        if(actor==m.getString("holderId")&&status=="offered"){actions.add("accept" to "Accetto questi termini");actions.add("decline" to "Rifiuto")}
        if(actor==m.getString("holderId")&&status=="accepted")actions.add("relinquish" to "Rinuncio al mandato")
        if(actor==m.getString("grantorId")&&status in listOf("offered","accepted","contested"))actions.add("revoke" to "Revoco il mio mandato")
        if(actor==m.getString("grantorId")&&status=="accepted")actions.add("contest" to "Contesto la mia rappresentanza")
        if(actor==m.getString("grantorId")&&status=="contested")actions.add("confirm" to "Confermo la rappresentanza")
        actions.forEach{(response,label)->Button(onClick={model.workspaceCommand(projectCommand("mandate.respond","mandateId" to m.getString("id"),"expectedVersion" to m.getInt("version"),"response" to response,"reason" to explanation),"Atto sul mandato")},enabled=!state.busy&&explanation.isNotBlank()){Text(label)}}
    }}}
}
