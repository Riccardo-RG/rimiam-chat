import SwiftUI

struct AttentionSnapshot:Decodable {
  struct Item:Decodable,Identifiable {let kind:String;let id:String;let text:String;let reason:String}
  struct Change:Decodable {let revision:Int;let kind:String;let createdAt:String}
  struct Preference:Decodable {let version:Int;let mode:String;let actor:String?}
  struct Source:Decodable,Identifiable {let id:String;let version:Int;let included:Bool;let content:String;let kind:String;let actor:String?;let origin:String?}
  struct Stream:Decodable,Identifiable {
    struct Version:Decodable {let version:Int;let title:String;let description:String;let actor:String?;let origin:String;let createdAt:String;let lifecycleState:String?;let lifecycleAction:String?}
    let state:String;let id:String;let version:Int;let title:String;let description:String;let sources:[Source];let actor:String?;let origin:String?;let history:[Version]?
    var status:String {["active":"Attivo","proposed":"Proposto","resolved":"Risolto","archived":"Archiviato"][state] ?? state}
  }
  let revision:Int;let alignedRevision:Int;let nextBefore:Int?;let changes:[Change];let attention:[Item];let preference:Preference;let workstreams:[Stream]
}

struct WorkspaceAttentionView:View {
  @Bindable var model:WorkspaceModel
  let onAsk:(ConversationReference,String)->Void
  var body:some View {
    List {
      Section {
        VStack(alignment:.leading,spacing:12) {
          Text("Cosa si muove.").font(.system(.title,design:.serif).weight(.bold))
          Text("Lavori, richieste e cambiamenti dello spazio. Ogni voce parte dallo stato condiviso.").font(.subheadline).foregroundStyle(.secondary)
          RIMIAMRule(strong:true)
        }.padding(.vertical,8).listRowBackground(RIMIAMStyle.page)
      }
      let needingInput=(model.activeWork?.works ?? []).filter{$0.phase == "needs_input" || !$0.issues.isEmpty}
      if !needingInput.isEmpty {
        Section("Richiedono attenzione · \(needingInput.count)") {
          ForEach(needingInput) {work in
            NavigationLink {MiriamWorkDetailView(model:model,workID:work.id)} label:{
              VStack(alignment:.leading,spacing:6) {
                Label(work.contract.objective,systemImage:"exclamationmark.circle").font(.headline)
                Text(work.status).font(.caption).foregroundStyle(.secondary)
                ForEach(work.issues){issue in Text(issue.content).font(.subheadline)}
              }.padding(.vertical,6)
            }
          }
        }
      }
      Section {
        NavigationLink {MiriamWorkView(model:model)} label:{RIMIAMNavigationLabel(title:"Il lavoro di Miriam",subtitle:"Stato, risultati, istruzioni e storia del lavoro.",symbol:"arrow.up.right")}
      }
      WorkspaceActivityFeed(model:model,onAsk:onAsk)
      if let state=model.attention {
        if !state.attention.isEmpty {
          Section("Da seguire nello spazio") {
            ForEach(state.attention) {item in
              NavigationLink {attentionDestination(item)} label:{VStack(alignment:.leading,spacing:6){Text(item.text).font(.headline);Text(item.reason).font(.subheadline).foregroundStyle(.secondary)}.padding(.vertical,6)}
            }
          }
        }
        Section("Allineamento personale") {
          Text("Dal tuo ultimo allineamento esplicito. Allinearsi non esprime consenso né accetta informazioni.").font(.caption).foregroundStyle(.secondary)
          if state.changes.isEmpty {Text("Nessun nuovo cambiamento in questo intervallo.").foregroundStyle(.secondary)}
          Button("Sono allineato con questo stato") {Task{await model.workspaceCommand(["type":"attention.aligned","revision":state.revision],label:"Allineamento personale con lo stato")}}.disabled(model.busy)
          DisclosureGroup("Registro degli aggiornamenti") {
            ForEach(state.changes,id:\.revision) {change in
              VStack(alignment:.leading,spacing:6) {
                Text(changeTitle(change.kind)).font(.subheadline)
                Text("Revisione \(change.revision) · \(change.createdAt)").font(.caption).foregroundStyle(.secondary)
              }.padding(.vertical,6)
            }
            if let before=state.nextBefore {Button("Aggiornamenti precedenti") {Task{await model.loadAttention(before:before)}}}
          }
        }
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Attività").navigationBarTitleDisplayMode(.inline).rimiamList()
      .task{await model.loadAttention();await model.loadActiveWork();await model.loadActivity()}
      .refreshable{await model.loadAttention();await model.loadActiveWork();await model.loadActivity(force:true)}
  }
  @ViewBuilder private func attentionDestination(_ item:AttentionSnapshot.Item) -> some View {
    switch item.kind {
    case "work":MiriamWorkDetailView(model:model,workID:item.id)
    case "question":WorkspaceQuestionsView(model:model).rimiamList()
    case "task":MiriamTasksView(model:model).rimiamList()
    case "artifact":WorkspaceArtifactsView(model:model).rimiamList()
    default:WorkspaceContextView(model:model)
    }
  }
  private func changeTitle(_ kind:String) -> String {
    if kind.hasPrefix("work.") {return "Il lavoro di Miriam è cambiato"}
    if kind.hasPrefix("workstream.") {return "Un filone è stato aggiornato"}
    if kind.hasPrefix("goal.") {return "Un atto sul Goal è stato registrato"}
    if kind.hasPrefix("information.") {return "Un riferimento del Context è cambiato"}
    if kind.hasPrefix("artifact.") {return "Un Artifact è stato aggiornato"}
    if kind.hasPrefix("task.") || kind.hasPrefix("followup.") {return "Lavoro e follow-up aggiornati"}
    if kind.hasPrefix("message.") {return "La conversazione continua"}
    if kind.hasPrefix("source.") || kind.hasPrefix("research.") {return "Fonti e ricerca aggiornate"}
    if kind.hasPrefix("call.") || kind.hasPrefix("voice.") {return "Voce e chiamate aggiornate"}
    if kind.hasPrefix("commitment.") {return "Un atto o una proposta è cambiata"}
    if kind.hasPrefix("question.") {return "Una domanda è stata aggiornata"}
    if kind.hasPrefix("member.") || kind.hasPrefix("invitation.") || kind.hasPrefix("access.") {return "Partecipazione e accesso aggiornati"}
    if kind.hasPrefix("attention.") {return "Collaborazione nello spazio aggiornata"}
    return "Aggiornamento dello spazio"
  }
}

struct WorkspaceCollaborationView:View {
  @Bindable var model:WorkspaceModel
  var body:some View {
    List {
      if let state=model.attention {
        Section {
          Text("Una presenza, con misura.").font(.system(.title,design:.serif).weight(.bold))
          Text("Scegli come collabora Miriam. Lo stile non cambia authority, consenso o permessi.").font(.subheadline).foregroundStyle(.secondary)
        }
        Section("Stile corrente") {
          ForEach([("discreet","Solo quando chiamata"),("collaborative","Collaborativa"),("proactive","Proattiva")],id:\.0) {mode,label in
            Button {Task{await model.workspaceCommand(["type":"attention.preference","mode":mode,"expectedVersion":state.preference.version],label:"Preferenza di collaborazione: " + label)}} label:{HStack{Text(label);Spacer();if state.preference.mode == mode {Image(systemName:"checkmark.circle.fill")}}.padding(.vertical,8)}.disabled(model.busy)
          }
          Text("Preferenza v\(state.preference.version)").font(.caption).foregroundStyle(.secondary)
        }
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Miriam nello spazio").rimiamList().task{await model.loadAttention()}
  }
}

struct WorkspaceWorkstreamsView:View {
  @Bindable var model:WorkspaceModel
  @State private var showInactive=false
  @State private var title=""
  @State private var description=""
  private var canContribute:Bool {model.detail?.contributes(model.credential?.user.id) == true}
  var body:some View {
    List {
      Section {
        Text("Seguire un filo.").font(.system(.title,design:.serif).weight(.bold))
        Text("I filoni organizzano la stessa conversazione. Persone, visibilità e authority restano quelle dello spazio.").font(.subheadline).foregroundStyle(.secondary)
        Toggle("Mostra anche proposte e filoni conclusi",isOn:$showInactive)
      }
      if let state=model.attention {
        Section("Filoni") {
          let streams=state.workstreams.filter{showInactive || $0.state == "active"}
          if streams.isEmpty {Text("Nessun filone in questa vista.").foregroundStyle(.secondary)}
          ForEach(streams) {stream in
            NavigationLink {WorkspaceWorkstreamDetailView(model:model,streamID:stream.id)} label:{VStack(alignment:.leading,spacing:6){Text(stream.title).font(.headline);Text(stream.status + " · v\(stream.version)").font(.caption).foregroundStyle(.secondary);if !stream.description.isEmpty {Text(stream.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)}}.padding(.vertical,8)}
          }
        }
      }
      Section {
        DisclosureGroup("Organizza un nuovo filone") {
          TextField("Titolo",text:$title)
          TextField("Descrizione",text:$description,axis:.vertical).lineLimit(2...6)
          Button("Crea filone") {
            let sentTitle=title,sentDescription=description,session=model.sessionGeneration,workspace=model.selected
            Task {
              if await model.workspaceCommand(["type":"workstream.save","title":sentTitle,"description":sentDescription],label:sentTitle),session == model.sessionGeneration,workspace == model.selected,title == sentTitle,description == sentDescription {title="";description=""}
            }
          }.disabled(model.busy || title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || !canContribute)
        }
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Filoni").rimiamList().task{await model.loadAttention()}
  }
}

struct WorkspaceWorkstreamDetailView:View {
  @Bindable var model:WorkspaceModel
  let streamID:String
  @State private var source=""
  @State private var transition:Transition?
  private struct Transition {let action:String;let label:String;let version:Int}
  private var canContribute:Bool {model.detail?.contributes(model.credential?.user.id) == true}
  var body:some View {
    List {
      if let stream=model.attention?.workstreams.first(where:{$0.id == streamID}) {
        Section {
          Text(stream.title).font(.system(.title,design:.serif).weight(.bold))
          Text(stream.status + " · v\(stream.version)").font(.caption.weight(.semibold))
          Text(stream.description)
          if let actor=stream.actor {Text("Organizzato da \(model.detail?.name(actor) ?? actor)").font(.caption).foregroundStyle(.secondary)}
          if stream.origin == "miriam" {Text("Organizzazione proposta da Miriam").font(.caption).foregroundStyle(.secondary)}
          if stream.state == "active" {Button("Segui questo filone in Conversation"){model.selectWorkstream(stream)}.buttonStyle(RIMIAMPrimaryButtonStyle())}
          if ["resolved","archived"].contains(stream.state) {Button("Leggi la conversazione di questo filone"){model.selectWorkstream(stream)}.buttonStyle(RIMIAMPrimaryButtonStyle())}
        }
        Section("Fonti collegate") {
          if !stream.sources.contains(where:\.included) {Text("Nessuna fonte collegata.").foregroundStyle(.secondary)}
          ForEach(stream.sources.filter(\.included)) {item in
            VStack(alignment:.leading,spacing:8) {
              Text(item.content)
              NavigationLink("Apri fonte"){List {SourceReferenceView(model:model,sourceId:item.id)}.navigationTitle("Fonte").rimiamList()}
              Button("Rimuovi solo questo collegamento") {Task{await model.workspaceCommand(["type":"workstream.link","workstreamId":stream.id,"sourceId":item.id,"expectedVersion":item.version,"included":false],label:"Rimuovi collegamento semantico")}}.disabled(model.busy || !canContribute)
            }.padding(.vertical,6)
          }
          DisclosureGroup("Collega un messaggio") {
            Picker("Messaggio",selection:$source) {Text("Scegli").tag("");ForEach(model.messages) {Text($0.content).tag($0.id)}}
            Button("Collega al filone") {Task{let old=stream.sources.first{$0.id==source};await model.workspaceCommand(["type":"workstream.link","workstreamId":stream.id,"sourceId":source,"expectedVersion":old?.version ?? 0,"included":true],label:"Collegamento semantico")}}.disabled(model.busy || source.isEmpty || !canContribute)
          }
        }
        Section("Stato del filone") {
          Text("Questi atti organizzano il filone e conservano la storia. Non adottano contenuti, chiudono il Goal o riavviano lavori.").font(.caption).foregroundStyle(.secondary)
          if stream.state == "proposed" {transitionButton("Attiva il filone",action:"activate",stream:stream)}
          if stream.state == "active" {transitionButton("Segna come risolto",action:"resolve",stream:stream)}
          if stream.state == "resolved" {transitionButton("Archivia il filone",action:"archive",stream:stream)}
          if ["resolved","archived"].contains(stream.state) {transitionButton("Riapri il filone",action:"reopen",stream:stream)}
        }
        if let history=stream.history,!history.isEmpty {
          Section {DisclosureGroup("Storia del filone") {ForEach(history,id:\.version) {version in VStack(alignment:.leading,spacing:5){Text("v\(version.version) · \(version.title)").font(.headline);Text(version.description);Text((version.lifecycleAction ?? "Aggiornamento") + " · " + version.createdAt).font(.caption).foregroundStyle(.secondary);if let actor=version.actor {Text(model.detail?.name(actor) ?? actor).font(.caption)}}.padding(.vertical,6)}}}
        }
      } else {Text("Questo filone non è disponibile nello stato corrente.").foregroundStyle(.secondary)}
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Il filone").rimiamList()
      .confirmationDialog(transition?.label ?? "Aggiorna il filone",isPresented:Binding(get:{transition != nil},set:{if !$0 {transition=nil}}),titleVisibility:.visible) {
        if let target=transition {Button(target.label){transition=nil;Task {await model.workspaceCommand(["type":"workstream.transition","workstreamId":streamID,"expectedVersion":target.version,"action":target.action],label:target.label)}}}
        Button("Annulla",role:.cancel){transition=nil}
      } message:{Text("La conversazione e le fonti restano nello stesso spazio, con la loro storia.")}
  }
  private func transitionButton(_ label:String,action:String,stream:AttentionSnapshot.Stream) -> some View {
    Button(label){transition=Transition(action:action,label:label,version:stream.version)}.disabled(model.busy || !canContribute)
  }
}
