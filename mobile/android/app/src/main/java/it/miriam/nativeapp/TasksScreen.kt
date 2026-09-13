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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

@Composable private fun WorkTime(label:String,value:String,change:(String)->Unit) {
    val context=LocalContext.current
    val date=runCatching{Instant.parse(value)}.getOrDefault(Instant.now()).atZone(ZoneId.systemDefault())
    TextButton(onClick={DatePickerDialog(context,{_,y,m,d->TimePickerDialog(context,{_,h,min->change(date.withYear(y).withMonth(m+1).withDayOfMonth(d).withHour(h).withMinute(min).withSecond(0).toInstant().toString())},date.hour,date.minute,true).show()},date.year,date.monthValue-1,date.dayOfMonth).show()}){Text("$label: ${date.toLocalDate()} ${date.toLocalTime().withSecond(0).withNano(0)}")}
}
private fun emptyWork()=JSONObject().put("title","").put("description","").put("dueAt",JSONObject.NULL).put("timeZone",ZoneId.systemDefault().id).put("suggestedPerson",JSONObject.NULL).put("references",JSONArray())
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun TasksScreen(state:UiState,model:WorkspaceModel,close:()->Unit){
    var title by remember{mutableStateOf("")};var detail by remember{mutableStateOf("")};var reason by remember{mutableStateOf("")};var suggested by remember{mutableStateOf("")}
    var due by remember{mutableStateOf(Instant.now().plusSeconds(86400).toString())};var hasDue by remember{mutableStateOf(false)}
    var editing by remember{mutableStateOf<JSONObject?>(null)};var refs by remember{mutableStateOf(JSONArray())};var candidate by remember{mutableStateOf<String?>(null)}
    var reminder by remember{mutableStateOf("")};var remindAt by remember{mutableStateOf(Instant.now().plusSeconds(600).toString())};var target by remember{mutableStateOf<JSONObject?>(null)};var follow by remember{mutableStateOf<JSONObject?>(null)}
    var history by remember{mutableStateOf("")};var suggestionsOpen by remember{mutableStateOf(false)}
    val scope=rememberCoroutineScope();val lifecycle=LocalLifecycleOwner.current
    LaunchedEffect(state.selected,state.user?.id,lifecycle){lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED){while(true){model.loadTasks();delay(2000)}}}
    BackHandler{close()}
    fun send(c:JSONObject){model.workspaceCommand(c,"Tasks / follow-up")}
    fun base(t:JSONObject,type:String)=JSONObject().put("type",type).put("taskId",t.getString("id")).put("expectedVersion",t.getInt("version")).put("reason",reason.ifBlank{"Atto personale esplicito"})
    fun reset(){editing=null;title="";detail="";reason="";hasDue=false;suggested="";refs=JSONArray();candidate=null}
    val view=state.tasks
    fun name(id:String)=view?.rows("members")?.find{it.getString("id")==id}?.getString("name")?:id.ifEmpty{"Non assegnato"}
    Scaffold(topBar={TopAppBar(title={Text("Lavoro e follow-up")},navigationIcon={TextButton(onClick=close){Text("Indietro")}})}){padding->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).testTag("tasks-content"),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text("Task, responsabilità e impegni sono distinti. Un promemoria non autorizza azioni.")
            if(state.error.isNotEmpty())Text(state.error,color=MaterialTheme.colorScheme.error)
            if(view==null)CircularProgressIndicator() else{
                Text(if(editing==null)"Nuovo Task non assegnato" else "Modifica / proposta",style=MaterialTheme.typography.titleLarge)
                OutlinedTextField(title,{title=it},label={Text("Attività")},modifier=Modifier.fillMaxWidth().testTag("task-title"))
                OutlinedTextField(detail,{detail=it},label={Text("Perimetro e aspettative")},modifier=Modifier.fillMaxWidth())
                Row{Checkbox(hasDue,{hasDue=it});Text("Scadenza facoltativa")};if(hasDue)WorkTime("Entro",due){due=it}
                Text("Possibile referente — non assegnato: ${name(suggested)}")
                TextButton(onClick={suggested=""}){Text("Nessuno")};for(m in view.rows("members"))TextButton(onClick={suggested=m.getString("id")}){Text("Suggerisci ${m.getString("name")}")}
                OutlinedTextField(reason,{reason=it},label={Text("Motivo")})
                Button(onClick={
                    val c=emptyWork().put("title",title).put("description",detail).put("dueAt",if(hasDue)due else JSONObject.NULL).put("suggestedPerson",suggested.ifEmpty{null}?:JSONObject.NULL).put("references",refs)
                    val t=editing
                    if(t==null){val b=JSONObject().put("type","task.create").put("content",c);candidate?.let{b.put("candidateId",it)};send(b)}
                    else send(base(t,if(t.isNull("responsible"))"task.revise" else "task.propose_revision").put("content",c))
                    reset()
                },enabled=!state.busy&&title.isNotBlank(),modifier=Modifier.testTag("task-save")){Text(if(editing?.isNull("responsible")==false)"Proponi modifica da accettare" else "Salva Task")}
                if(editing!=null)TextButton(onClick=::reset){Text("Annulla modifica")}
                TextButton(onClick={suggestionsOpen=!suggestionsOpen}){Text("Proposte Miriam — non sono Task")}
                if(suggestionsOpen)for(s in view.rows("suggestions")){Text(s.getString("content"));Text(s.getString("qualification"));TextButton(onClick={reset();title=s.getString("subject");detail=s.getString("content");candidate=s.getString("id")}){Text("Prepara Task")}}
                for(t in view.rows("tasks")){
                    HorizontalDivider();val id=t.getString("id");val responsible=if(t.isNull("responsible"))"" else t.getString("responsible");val status=t.getString("status")
                    Text(t.getString("title"),style=MaterialTheme.typography.titleLarge);Text(t.getString("description"));Text("$status · v${t.getInt("version")} · ${if(t.isNull("dueAt"))"Senza scadenza" else t.getString("dueAt")}")
                    Text("Responsabilità: ${name(responsible)}");if(responsible.isNotEmpty())Text("Accettata su v${t.getInt("acceptedVersion")}${if(t.getBoolean("responsibleAvailable"))"" else " · accesso non disponibile"}")
                    Text("${name(t.getString("actor"))} · ${t.getString("reason")}",style=MaterialTheme.typography.bodySmall)
                    if(!t.isNull("suggestedPerson"))Text("Suggerito: ${name(t.getString("suggestedPerson"))} — nessuna assegnazione implicita")
                    for(r in t.rows("references"))Text("${r.getString("kind")} · ${r.getString("id")} · v${r.getInt("version")}",style=MaterialTheme.typography.bodySmall)
                    if(responsible.isEmpty()&&status !in listOf("completed","cancelled"))Button(onClick={send(base(t,"task.accept").put("representSelf",true))},enabled=!state.busy,modifier=Modifier.testTag("task-accept-$id")){Text("Me ne occupo")}
                    if(responsible==state.user?.id)TextButton(onClick={send(base(t,"task.relinquish").put("representSelf",true))},enabled=!state.busy){Text("Lascio la responsabilità")}
                    if(responsible.isEmpty()||responsible==state.user?.id){
                        TextButton(onClick={send(base(t,"task.status").put("status","completed").put("noNormativeEffect",true))},enabled=!state.busy&&status!="completed"){Text("Segna completato — solo Task")}
                        TextButton(onClick={send(base(t,"task.status").put("status","cancelled").put("noNormativeEffect",true))},enabled=!state.busy&&status!="cancelled"){Text("Annulla Task — conserva obblighi")}
                    }
                    if(status !in listOf("completed","cancelled"))TextButton(onClick={editing=t;title=t.getString("title");detail=t.getString("description");refs=t.getJSONArray("references");suggested=if(t.isNull("suggestedPerson"))"" else t.getString("suggestedPerson");hasDue=!t.isNull("dueAt");if(hasDue)due=t.getString("dueAt")}){Text("Modifica / proponi")}
                    TextButton(onClick={follow=null;target=JSONObject().put("kind","task").put("id",id).put("version",t.getInt("version"));reminder="Verificare: ${t.getString("title")}"}){Text("Prepara follow-up")}
                    TextButton(onClick={scope.launch{history=model.workHistory(id,"task")}}){Text("Storia Task")}
                    for(p in view.rows("proposals").filter{it.getString("taskId")==id}){val c=p.getJSONObject("content");Text("Proposta: ${c.getString("title")} · ${c.optString("dueAt")}");Text(c.getString("description"));if(responsible==state.user?.id)Button(onClick={send(base(t,"task.adopt_revision").put("proposalId",p.getString("id")).put("acceptResponsibility",true))},enabled=!state.busy){Text("Accetto il nuovo perimetro")}}
                }
                HorizontalDivider();Text(if(follow==null)"Nuovo follow-up per me" else "Rivedi follow-up",style=MaterialTheme.typography.titleLarge)
                OutlinedTextField(reminder,{reminder=it},label={Text("Cosa verificare")},modifier=Modifier.fillMaxWidth().testTag("followup-content"));WorkTime("Ricordamelo",remindAt){remindAt=it}
                target?.let{Text("Riferimento ${it.getString("kind")} · v${it.getInt("version")}")}
                Button(onClick={val f=follow;val c=JSONObject().put("type",if(f==null)"followup.create" else "followup.revise").put("content",reminder).put("kind","check").put("remindAt",remindAt).put("timeZone",ZoneId.systemDefault().id).put("reference",target?:JSONObject.NULL);if(f!=null)c.put("followupId",f.getString("id")).put("expectedVersion",f.getInt("version")).put("reason","Revisione esplicita");send(c);follow=null;target=null;reminder=""},enabled=!state.busy&&reminder.isNotBlank(),modifier=Modifier.testTag("followup-save")){Text("Salva follow-up")}
                for(f in view.rows("followups")){
                    val id=f.getString("id");Text(f.getString("content"),style=MaterialTheme.typography.titleMedium);Text("${name(f.getString("owner"))} · ${f.getString("status")} · v${f.getInt("version")} · ${f.getString("remindAt")}")
                    Text(if(f.getBoolean("needsReview"))"Da rivedere: accesso o riferimento cambiato" else if(!f.isNull("deliveredAt"))"Promemoria disponibile — nessuna azione eseguita" else "In attesa")
                    if(f.getString("owner")==state.user?.id){
                        TextButton(onClick={follow=f;reminder=f.getString("content");target=if(f.isNull("reference"))null else JSONObject(f.getJSONObject("reference").toString());target?.let{r->if(r.getString("kind")=="task")view.rows("tasks").find{it.getString("id")==r.getString("id")}?.let{r.put("version",it.getInt("version"))}}}){Text("Rivedi / riprogramma")}
                        for(s in listOf("done","cancelled"))TextButton(onClick={send(JSONObject().put("type","followup.close").put("followupId",id).put("expectedVersion",f.getInt("version")).put("reason","Atto esplicito").put("status",s))},enabled=!state.busy){Text(if(s=="done")"Verifica fatta" else "Annulla follow-up")}
                    };TextButton(onClick={scope.launch{history=model.workHistory(id,"followup")}}){Text("Storia follow-up")}
                }
                if(!view.isNull("next"))TextButton(onClick={model.tasksPage(view.getString("next"))}){Text("Altri elementi")}
                TextButton(onClick={model.tasksPage("")}){Text("Primi elementi")};if(history.isNotEmpty()){Text("Storia e provenance");Text(history,style=MaterialTheme.typography.bodySmall)}
            }
        }
    }
}
