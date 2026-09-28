import SwiftUI

struct ConversationHandoff:Decodable,Identifiable {
  enum Kind:String,Decodable {
    case goalEstablish="goal.establish",goalChange="goal.change"
    case informationAccept="information.accept",informationCorrect="information.correct"
    case projectPropose="project.propose",projectReplace="project.replace",projectRevoke="project.revoke"
    case taskCreate="task.create",taskChange="task.change",artifactPrepare="artifact.prepare"
    case emailPrepare="email.prepare",calendarPrepare="calendar.prepare"
    var label:String {
      switch self {
      case .goalEstablish:return "Prepara il Goal iniziale"
      case .goalChange:return "Prepara un cambiamento del Goal"
      case .informationAccept:return "Valuta il riferimento descrittivo"
      case .informationCorrect:return "Valuta la correzione del riferimento"
      case .projectPropose:return "Prepara una proposta"
      case .projectReplace:return "Prepara una sostituzione"
      case .projectRevoke:return "Prepara una revoca"
      case .taskCreate:return "Prepara un Task"
      case .taskChange:return "Prepara una modifica al Task"
      case .artifactPrepare:return "Prepara una bozza di Artifact"
      case .emailPrepare:return "Apri le tue email"
      case .calendarPrepare:return "Apri il calendario"
      }
    }
  }
  struct Application:Decodable {
    struct Prepared:Decodable {let kind:String;let id:String}
    let actor:String;let commandId:String;let commandType:String;let createdAt:String
    let resultReference:ConversationReference?;let prepared:Prepared?
  }
  let id:String;let sourceId:String;let sourceMessageId:String
  let kind:Kind;let summary:String;let suggestedText:String
  let target:ConversationReference?;let candidateId:String?;let sourceIds:[String]
  let status:String;let createdAt:String;let application:Application?
  var statusLabel:String {
    switch status {
    case "ready":return "Da valutare · nessuna operazione eseguita"
    case "stale":return "Il contesto è cambiato · indicazione da rivalutare"
    case "applied":return "Passaggio registrato · consulta il risultato"
    case "navigation":return "Accesso ai tuoi strumenti · nessuna azione esterna"
    default:return "Stato da verificare"
    }
  }
}
struct ConversationHandoffs:Decodable {let handoffs:[ConversationHandoff]}

struct ConversationHandoffLinks:View {
  @Bindable var model:WorkspaceModel
  let sourceID:String
  let onAsk:(ConversationReference,String)->Void
  @State private var expanded=false
  @State private var loaded=false
  @State private var loading=false
  @State private var failure=""
  private var items:[ConversationHandoff] {model.handoffs.filter{$0.sourceId == sourceID || $0.sourceMessageId == sourceID}}
  var body:some View {
    DisclosureGroup(isExpanded:$expanded) {
      ForEach(items) {handoff in
        NavigationLink {ConversationHandoffDestination(model:model,handoff:handoff,onAsk:onAsk)} label:{
          VStack(alignment:.leading,spacing:5) {Text(handoff.summary).font(.subheadline.weight(.semibold));Text(handoff.statusLabel).font(.caption).foregroundStyle(.secondary)}.padding(.vertical,5)
        }
      }
      if loading {ProgressView("Recupero dei passi proposti…")}
      if loaded && items.isEmpty {Text("Nessun passo proposto registrato per questo messaggio.").font(.caption).foregroundStyle(.secondary)}
      if !failure.isEmpty {Text(failure).font(.caption).foregroundStyle(.red)}
      Button(loaded ? "Aggiorna questi passi" : "Recupera i passi per questo messaggio"){Task{await load()}}.font(.caption).disabled(loading)
    } label:{Label(items.isEmpty ? "Passi proposti per questo messaggio" : "Passi proposti · \(items.count)",systemImage:"arrow.turn.down.right").font(.caption)}
      .onChange(of:expanded){_,value in if value {Task{await load()}}}
  }
  private func load() async {
    let scope=model.mediaBoundary
    loading=true;failure=""
    let success=await model.loadHandoffs(sourceID:sourceID)
    guard scope == model.mediaBoundary,!Task.isCancelled else {return}
    loading=false;loaded=success
    if !success {failure=model.handoffError}
  }
}

struct HandoffNotice:View {
  @Bindable var model:WorkspaceModel
  let handoff:ConversationHandoff
  let onAsk:(ConversationReference,String)->Void
  private var current:ConversationHandoff {model.handoffs.first(where:{$0.id == handoff.id}) ?? handoff}
  var body:some View {
    VStack(alignment:.leading,spacing:6) {
      Text(current.summary).font(.subheadline.weight(.semibold))
      Text(current.statusLabel).font(.caption).foregroundStyle(.secondary)
      DisclosureGroup("Indicazione dalla conversazione") {
        Text(current.suggestedText).font(.subheadline).textSelection(.enabled)
        NavigationLink("Leggi la fonte originale"){WorkspaceReferenceView(model:model,reference:ConversationReference(kind:.source,id:current.sourceId,version:1,eventId:nil),onAsk:onAsk)}
        if let target=current.target {NavigationLink("Riferimento di questo passo"){WorkspaceReferenceView(model:model,reference:target,onAsk:onAsk)}}
      }
      if let pending=model.pendingHandoff(handoff.id) {
        Text("L’invio resta da verificare. Recupera la stessa operazione.").font(.caption)
        Button("Verifica questo invio") {Task{await model.retry(pending);await model.loadHandoffs(sourceID:handoff.sourceId)}}.disabled(model.busy)
      }
    }.padding(12).frame(maxWidth:.infinity,alignment:.leading).background(RIMIAMStyle.surface)
  }
}

struct ConversationHandoffDestination:View {
  @Bindable var model:WorkspaceModel
  let handoff:ConversationHandoff
  let onAsk:(ConversationReference,String)->Void
  private var current:ConversationHandoff {model.handoffs.first(where:{$0.id == handoff.id}) ?? handoff}
  var body:some View {
    VStack(spacing:0) {
      HandoffNotice(model:model,handoff:current,onAsk:onAsk)
      if current.status == "applied" {outcome}
      else {form}
    }.task(id:model.mediaBoundary + "|" + String(model.state?.workspace.revision ?? 0)) {await model.loadHandoffs(sourceID:handoff.sourceId)}
  }
  @ViewBuilder private var form:some View {
    switch handoff.kind {
    case .goalEstablish:WorkspaceGoalView(model:model,handoff:handoff)
    case .goalChange,.projectPropose,.projectReplace,.projectRevoke:ProjectGovernanceView(model:model,handoff:handoff)
    case .informationAccept,.informationCorrect:WorkspaceContextView(model:model,handoff:handoff)
    case .taskCreate,.taskChange:MiriamTasksView(model:model,handoff:handoff)
    case .artifactPrepare:ArtifactEditor(model:model,handoff:handoff)
    case .emailPrepare:MiriamEmailView(model:model)
    case .calendarPrepare:MiriamCalendarView(model:model)
    }
  }
  private var outcome:some View {
    List {
      if let application=current.application {
        Section("Passaggio registrato") {
          Text("Da " + (model.detail?.name(application.actor) ?? application.actor)).font(.subheadline)
          Text(application.createdAt).font(.caption).foregroundStyle(.secondary)
          if let reference=application.resultReference {
            NavigationLink("Leggi il risultato preciso"){WorkspaceReferenceView(model:model,reference:reference,onAsk:onAsk)}
          }
          if let prepared=application.prepared {
            Text("La proposta è registrata; le approvazioni e l’efficacia restano separate.").font(.caption)
            Text("Proposta: " + prepared.id).font(.caption).textSelection(.enabled)
            if prepared.kind == "task_revision_proposal" {NavigationLink("Apri la proposta sul Task"){MiriamTasksView(model:model)}}
            else {NavigationLink("Apri le proposte e i loro controlli"){ProjectGovernanceView(model:model)}}
          }
        }
      }
      if let target=current.target {
        NavigationLink("Rileggi il riferimento originale"){WorkspaceReferenceView(model:model,reference:target,onAsk:onAsk)}
      }
      Section("Conversazione di origine") {
        NavigationLink("Leggi la fonte condivisa"){WorkspaceReferenceView(model:model,reference:ConversationReference(kind:.source,id:current.sourceId,version:1,eventId:nil),onAsk:onAsk)}
      }
      if !model.handoffError.isEmpty {Text(model.handoffError).foregroundStyle(.red)}
    }.rimiamList().navigationTitle("Passaggio proposto")
  }
}
