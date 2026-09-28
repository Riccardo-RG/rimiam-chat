import SwiftUI
struct ProjectSnapshot: Decodable {
  struct Person:Decodable,Identifiable {let id:String;let name:String;let active:Bool;let eligible:Bool}
  struct Approval:Decodable {let personId:String;let actorId:String;let mandateId:String?;let createdAt:String}
  struct GoalVersion:Decodable {let version:Int;let content:String;let actor:String;let reason:String;let createdAt:String}
  struct Goal:Decodable,Identifiable {let id:String;let version:Int;let content:String;let currentPrimary:Bool;let status:String;let parentGoalId:String?;let participants:[String];let versions:[GoalVersion]}
  struct Obligation:Decodable {let actId:String;let blocking:Bool}
  struct Transition:Decodable,Identifiable {let id:String;let goalId:String;let goalVersion:Int;let mode:String;let content:String;let reason:String;let actor:String;let people:[String];let obligations:[Obligation];let status:String;let approvals:[Approval]}
  struct Scope:Decodable {let kind:String;let id:String;let version:Int}
  struct MandateVersion:Decodable {let version:Int;let status:String;let actor:String;let reason:String;let createdAt:String}
  struct Mandate:Decodable,Identifiable {let id:String;let version:Int;let grantorId:String;let holderId:String;let scope:Scope;let capability:String;let status:String;let available:Bool;let reason:String;let terms:String;let versions:[MandateVersion]}
  struct Act:Decodable,Identifiable {let proposalId:String;let actId:String?;let kind:String;let content:String;let operation:String;let replacesActId:String?;let goalId:String?;let goalVersion:Int?;let people:[String];let status:String;let approvals:[Approval];var id:String{proposalId}}
  let accessRevision:Int;let members:[Person];let goals:[Goal];let goalProposals:[Transition];let mandates:[Mandate];let acts:[Act]
  func name(_ id:String)->String {members.first{$0.id==id}?.name ?? "Partecipante"}
}
struct ProjectGovernanceView:View {
  @Bindable var model:WorkspaceModel
  var handoff:ConversationHandoff?=nil
  @State private var snapshot:ProjectSnapshot?
  @State private var refreshRequest=UUID()
  var body:some View {
    List {
      Text("Goal, decisioni e mandati restano distinti. Ogni adozione richiede gli atti espliciti delle persone pertinenti.").font(.callout)
      if let state=snapshot {
        Section("Goal e continuità") {ForEach(state.goals) {goal in GoalLifecycleRow(model:model,state:state,goal:goal,refresh:refresh,handoff:handoff?.kind == .goalChange && handoff?.target?.id == goal.id ? handoff : nil)}}
        Section("Cambiamenti proposti") {ForEach(state.goalProposals) {proposal in
          DisclosureGroup(proposal.content) {
            Text("\(proposal.mode) · \(proposal.status)").font(.caption);Text(proposal.reason)
            Text("Richiesti: " + proposal.people.map(state.name).joined(separator:", "))
            ForEach(proposal.obligations,id:\.actId) {obligation in Text((obligation.blocking ? "Blocca: " : "Conservato: ") + (state.acts.first{$0.actId==obligation.actId}?.content ?? "Obbligo precedente"))}
            if proposal.status=="pending" {ProjectApprovals(model:model,state:state,people:proposal.people,approvals:proposal.approvals,scopeId:proposal.goalId,capability:["complete","abandon"].contains(proposal.mode) ? "goal.conclude" : proposal.mode=="subgoal" ? "goal.subgoal" : "goal.change",type:"goal.approve",idKey:"transitionId",proposalId:proposal.id,refresh:refresh)}
          }
        }}
        Section("Decisioni, vincoli e impegni") {
          ProjectActForm(model:model,state:state,refresh:refresh,handoff:handoff?.kind == .goalChange ? nil : handoff)
          ForEach(state.acts) {act in
            DisclosureGroup(act.content) {
              Text("\(kindLabel(act.kind)) · \(act.status)").font(.caption)
              Text("Persone: " + act.people.map(state.name).joined(separator:", "))
              if let old=act.replacesActId {Text("\(act.operation=="revoke" ? "Revoca" : "Sostituisce"): " + (state.acts.first{$0.actId==old}?.content ?? "atto precedente"))}
              ForEach(Array(act.approvals.enumerated()),id:\.offset) {_,approval in Text("\(state.name(approval.actorId)) per \(state.name(approval.personId)) · \(approval.createdAt)").font(.caption)}
              if act.status=="proposed" {ProjectApprovals(model:model,state:state,people:act.people,approvals:act.approvals,scopeId:act.replacesActId ?? act.goalId ?? "",capability:act.operation=="establish" ? "act.create" : act.operation=="revoke" ? "act.revoke" : "act.replace",type:"project.approve",idKey:"proposalId",proposalId:act.proposalId,refresh:refresh)}
            }
          }
        }
        Section("Mandati circoscritti") {
          MandateForm(model:model,state:state,refresh:refresh)
          ForEach(state.mandates) {mandate in MandateRow(model:model,state:state,mandate:mandate,refresh:refresh)}
        }
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Decisioni e authority").task{await refresh()}.refreshable{await refresh()}
  }
  func refresh() async {
    let request=UUID(),boundary=model.mediaBoundary
    refreshRequest=request
    let raw=await model.workspaceRead("project")
    guard refreshRequest == request,!Task.isCancelled else {return}
    guard boundary == model.mediaBoundary else {snapshot=nil;return}
    // Keep mounted drafts on a transient read failure; the model presents the error.
    if let next=try? JSONDecoder().decode(ProjectSnapshot.self,from:Data(raw.utf8)) {snapshot=next}
  }
}
private func kindLabel(_ kind:String)->String {["decision":"Decisione","constraint":"Vincolo","commitment":"Impegno"][kind] ?? kind}
private struct GoalLifecycleRow:View {
  @Bindable var model:WorkspaceModel;let state:ProjectSnapshot;let goal:ProjectSnapshot.Goal;let refresh:() async->Void
  var handoff:ConversationHandoff?=nil
  @State private var expanded=false
  @State private var mode="revise";@State private var content="";@State private var reason="";@State private var people:Set<String>=[];@State private var blockers:Set<String>=[];@State private var previousSubgoal=false
  @State private var baseVersion:Int?
  @State private var baseContent=""
  private var stale:Bool {baseVersion != nil && baseVersion != goal.version}
  var body:some View {
    DisclosureGroup(goal.content,isExpanded:Binding(get:{expanded},set:{expanded=$0;if $0 {prepareBase()}})) {
      Text("v\(goal.version) · \(goal.status)" + (goal.currentPrimary ? " · Goal principale" : "")).font(.caption)
      DisclosureGroup("Storia del Goal") {ForEach(goal.versions,id:\.version) {version in Text("v\(version.version) · \(state.name(version.actor)) · \(version.createdAt)").font(.caption);Text(version.content);Text(version.reason)}}
      if goal.status=="active" {
        if stale {
          Text("La bozza si riferisce alla versione \(baseVersion ?? 0). Il Goal è cambiato: rileggilo prima di continuare.").font(.caption).foregroundStyle(.orange)
          if handoff == nil {Button("Usa la versione attuale per questa bozza"){baseVersion=goal.version;baseContent=goal.content}}
        }
        Picker("Cambiamento",selection:$mode) {Text("Nuova versione, stessa iniziativa").tag("revise");Text("Nuovo Goal sostitutivo").tag("replace");Text("Risultato subordinato").tag("subgoal");Text("Completa").tag("complete");Text("Abbandona").tag("abandon")}
        if !["complete","abandon"].contains(mode) {TextField("Contenuto proposto",text:$content,axis:.vertical)}
        TextField("Motivazione",text:$reason,axis:.vertical)
        if mode=="replace" {Toggle("Il Goal precedente diventa un Sub-goal",isOn:$previousSubgoal)}
        Text("Altre persone il cui intento è interessato").font(.caption)
        ForEach(state.members.filter{$0.active && $0.eligible}) {person in Toggle(person.name,isOn:Binding(get:{people.contains(person.id)},set:{if $0 {people.insert(person.id)} else {people.remove(person.id)}}))}
        Text("Gli obblighi rimangono validi. Indica quelli incompatibili che impediscono questa transizione.").font(.caption)
        ForEach(state.acts.filter{$0.status=="effective" && $0.actId != nil}) {act in Toggle(act.content,isOn:Binding(get:{blockers.contains(act.actId!)},set:{if $0 {blockers.insert(act.actId!)} else {blockers.remove(act.actId!)}}))}
        Button("Proponi il cambiamento"){propose()}.disabled(model.busy || baseVersion == nil || stale || reason.isEmpty || (!["complete","abandon"].contains(mode) && content.isEmpty) || (handoff.map{!model.canApplyHandoff($0)} ?? false))
      }
    }.task(id:handoff?.id){if let handoff {prepareBase();expanded=true;content=handoff.suggestedText;reason=handoff.summary}}
  }
  private func prepareBase() {
    guard baseVersion == nil else {return}
    baseVersion=handoff?.target?.version ?? goal.version
    baseContent=goal.versions.first(where:{$0.version == baseVersion})?.content ?? goal.content
  }
  private func propose() {
    guard let baseVersion,!stale else {return}
    let boundary=model.mediaBoundary
    let body:[String:Any]=["type":"goal.propose","goalId":goal.id,"expectedVersion":baseVersion,"mode":mode,"content":["complete","abandon"].contains(mode) ? baseContent : content,"reason":reason,"previousBecomesSubgoal":mode=="replace" && previousSubgoal,"affectedPeople":Array(people).sorted(),"blockingActIds":Array(blockers).sorted(),"preserveExistingObligations":true]
    Task {guard boundary == model.mediaBoundary else {return};await model.handoffCommand(body,handoff:handoff,label:"Proposta sul Goal");if boundary == model.mediaBoundary {await refresh()}}
  }
}
private struct ProjectActForm:View {
  @Bindable var model:WorkspaceModel;let state:ProjectSnapshot;let refresh:() async->Void
  var handoff:ConversationHandoff?=nil
  @State private var expanded=false
  @State private var kind="decision";@State private var content="";@State private var reason="";@State private var goal="";@State private var operation="establish";@State private var previous="";@State private var people:Set<String>=[]
  @State private var goalVersion:Int?
  private var goalStale:Bool {!goal.isEmpty && !state.goals.contains(where:{$0.id == goal && $0.version == goalVersion})}
  var body:some View {
    DisclosureGroup("Prepara una proposta",isExpanded:$expanded) {
      Picker("Tipo",selection:$kind) {Text("Decisione").tag("decision");Text("Vincolo").tag("constraint");Text("Impegno").tag("commitment")}
      Picker("Operazione",selection:$operation) {Text("Stabilisci").tag("establish");Text("Sostituisci").tag("replace");Text("Revoca").tag("revoke")}.disabled(handoff != nil)
      if operation != "establish" {Picker("Atto precedente",selection:$previous) {Text("Scegli").tag("");ForEach(state.acts.filter{$0.status=="effective" && $0.actId != nil}) {Text($0.content).tag($0.actId!)}}.disabled(handoff != nil)}
      TextField("Contenuto esatto",text:$content,axis:.vertical);TextField("Motivazione",text:$reason,axis:.vertical)
      Picker("Goal collegato",selection:Binding(get:{goal},set:{selectGoal($0)})) {Text("Nessuno").tag("");ForEach(state.goals) {Text($0.content).tag($0.id)}}
      if let goalVersion,!goal.isEmpty {Text("Goal selezionato · v\(goalVersion)").font(.caption)}
      if goalStale {
        Text("Il Goal collegato è cambiato. La selezione conserva la versione precedente.").font(.caption).foregroundStyle(.orange)
        Button("Rileggi e usa il Goal attuale"){selectGoal(goal)}
      }
      ForEach(state.members.filter{$0.active && $0.eligible}) {person in Toggle(person.name,isOn:Binding(get:{people.contains(person.id)},set:{if $0 {people.insert(person.id)} else {people.remove(person.id)}}))}
      Button("Proponi, senza adottare"){propose()}.disabled(model.busy || goalStale || content.isEmpty || reason.isEmpty || people.isEmpty || (operation != "establish" && previous.isEmpty) || (handoff.map{!model.canApplyHandoff($0)} ?? false))
    }.task(id:handoff?.id){
      if let handoff {
        expanded=true;content=handoff.suggestedText;reason=handoff.summary
        operation=handoff.kind == .projectReplace ? "replace" : handoff.kind == .projectRevoke ? "revoke" : "establish"
        if let target=handoff.target,let old=state.acts.first(where:{$0.proposalId == target.id && $0.status == "effective"}) {previous=old.actId ?? "";kind=old.kind;goal=old.goalId ?? "";goalVersion=old.goalVersion}
      }
    }
  }
  private func selectGoal(_ id:String){goal=id;goalVersion=state.goals.first(where:{$0.id == id})?.version}
  private func propose() {
    guard !goalStale else {return}
    let boundary=model.mediaBoundary
    var body:[String:Any]=["type":"project.propose","kind":kind,"operation":operation,"content":content,"reason":reason,"people":Array(people).sorted(),"goal":NSNull()]
    if !goal.isEmpty,let goalVersion {body["goal"]=["id":goal,"version":goalVersion]}
    if operation != "establish" {body["replacesActId"]=previous}
    let label="Proposta: " + content
    Task {guard boundary == model.mediaBoundary else {return};await model.handoffCommand(body,handoff:handoff,label:label);if boundary == model.mediaBoundary {await refresh()}}
  }
}
private struct ProjectApprovals:View {
  @Bindable var model:WorkspaceModel;let state:ProjectSnapshot;let people:[String];let approvals:[ProjectSnapshot.Approval];let scopeId:String;let capability:String;let type:String;let idKey:String;let proposalId:String;let refresh:() async->Void
  var body:some View {
    ForEach(people,id:\.self) {person in
      if !approvals.contains(where:{$0.personId==person}) {
        if person==model.credential?.user.id {Button("Approvo il contenuto esatto per me") {approve(person,nil)}.disabled(model.busy)}
        ForEach(state.mandates.filter{$0.available && $0.holderId==model.credential?.user.id && $0.grantorId==person && $0.scope.id==scopeId && $0.capability==capability}) {mandate in
          Button("Approvo per \(state.name(person)) nel mandato v\(mandate.version)") {approve(person,mandate.id)}.disabled(model.busy)
        }
      }
    }
  }
  func approve(_ person:String,_ mandate:String?) {Task{var body:[String:Any]=["type":type,idKey:proposalId,"expectedAccessRevision":state.accessRevision,"representedPersonId":person,"confirmExactContent":true];if let mandate {body["mandateId"]=mandate};await model.workspaceCommand(body,label:"Approvazione esatta per " + state.name(person));await refresh()}}
}
private struct MandateForm:View {
  @Bindable var model:WorkspaceModel;let state:ProjectSnapshot;let refresh:() async->Void
  @State private var holder="";@State private var target="";@State private var capability="goal.change";@State private var reason=""
  @State private var targetVersion:Int?
  private var targetStale:Bool {
    let parts=target.split(separator:":").map(String.init)
    guard parts.count == 2 else {return !target.isEmpty}
    if parts[0] == "goal" {return !state.goals.contains(where:{$0.id == parts[1] && $0.version == targetVersion})}
    return !state.acts.contains(where:{$0.actId == parts[1] && $0.status == "effective"})
  }
  var body:some View {
    DisclosureGroup("Delega la tua posizione entro uno scope") {
      Picker("Destinatario",selection:$holder) {Text("Scegli persona").tag("");ForEach(state.members.filter{$0.active && $0.eligible}) {Text($0.name).tag($0.id)}}
      Picker("Scope esatto",selection:Binding(get:{target},set:{selectTarget($0)})) {Text("Scegli oggetto").tag("");ForEach(state.goals) {Text("Goal: " + $0.content).tag("goal:"+$0.id)};ForEach(state.acts.filter{$0.actId != nil && $0.status=="effective"}) {Text("Atto: " + $0.content).tag("act:"+$0.actId!)}}
      if let targetVersion {Text("Scope selezionato · v\(targetVersion)").font(.caption)}
      if targetStale {Text("Lo scope è cambiato. Rileggi l’oggetto prima di offrire il mandato.").font(.caption).foregroundStyle(.orange);Button("Usa lo scope attuale"){selectTarget(target)}}
      Picker("Capacità",selection:$capability) {ForEach(["goal.change","goal.conclude","goal.subgoal","act.create","act.replace","act.revoke"],id:\.self) {Text($0).tag($0)}}
      TextField("Motivazione",text:$reason,axis:.vertical)
      Text("La delega, senza scadenza, riguarda soltanto la tua rappresentanza sull’oggetto/versione indicati e richiede accettazione. Non concede poteri sul Workspace.").font(.caption)
      Button("Offri questo mandato"){offer()}.disabled(model.busy || targetStale || targetVersion == nil || holder.isEmpty || target.isEmpty || reason.isEmpty)
    }
  }
  private func selectTarget(_ value:String) {
    target=value
    let parts=value.split(separator:":").map(String.init)
    guard parts.count == 2 else {targetVersion=nil;return}
    targetVersion=parts[0] == "goal" ? state.goals.first(where:{$0.id == parts[1]})?.version : 1
  }
  private func offer() {
    let parts=target.split(separator:":").map(String.init)
    guard parts.count == 2,let targetVersion,!targetStale else {return}
    let boundary=model.mediaBoundary
    let body:[String:Any]=["type":"mandate.offer","holderId":holder,"scope":["kind":parts[0],"id":parts[1],"version":targetVersion],"capability":capability,"expiresAt":NSNull(),"reason":reason,"representSelf":true]
    Task {guard boundary == model.mediaBoundary else {return};await model.workspaceCommand(body,label:"Offerta di mandato");if boundary == model.mediaBoundary {await refresh()}}
  }
}
private struct MandateRow:View {
  @Bindable var model:WorkspaceModel;let state:ProjectSnapshot;let mandate:ProjectSnapshot.Mandate;let refresh:() async->Void
  @State private var reason=""
  var body:some View {
    DisclosureGroup("\(state.name(mandate.grantorId)) → \(state.name(mandate.holderId))") {
      Text(mandate.terms);Text("v\(mandate.version) · \(mandate.status)").font(.caption);Text(mandate.reason)
      ForEach(mandate.versions,id:\.version) {version in Text("v\(version.version) · \(state.name(version.actor)) · \(version.status) · \(version.reason)").font(.caption)}
      TextField("Motivazione dell’atto",text:$reason)
      let actor=model.credential?.user.id
      if actor==mandate.holderId && mandate.status=="offered" {Button("Accetto questi termini") {respond("accept")}.disabled(model.busy || reason.isEmpty);Button("Rifiuto") {respond("decline")}.disabled(model.busy || reason.isEmpty)}
      if actor==mandate.holderId && mandate.status=="accepted" {Button("Rinuncio al mandato") {respond("relinquish")}.disabled(model.busy || reason.isEmpty)}
      if actor==mandate.grantorId && ["offered","accepted","contested"].contains(mandate.status) {Button("Revoco il mio mandato") {respond("revoke")}.disabled(model.busy || reason.isEmpty)}
      if actor==mandate.grantorId && mandate.status=="accepted" {Button("Contesto la mia rappresentanza") {respond("contest")}.disabled(model.busy || reason.isEmpty)}
      if actor==mandate.grantorId && mandate.status=="contested" {Button("Confermo esplicitamente la rappresentanza") {respond("confirm")}.disabled(model.busy || reason.isEmpty)}
    }
  }
  func respond(_ response:String){Task{await model.workspaceCommand(["type":"mandate.respond","mandateId":mandate.id,"expectedVersion":mandate.version,"response":response,"reason":reason],label:"Atto sul mandato");await refresh()}}
}
