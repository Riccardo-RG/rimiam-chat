import SwiftUI
struct AttentionSnapshot:Decodable {
  struct Item:Decodable,Identifiable {let kind:String;let id:String;let text:String;let reason:String}
  struct Change:Decodable {let revision:Int;let kind:String;let createdAt:String}
  struct Preference:Decodable {let version:Int;let mode:String;let actor:String?}
  struct Source:Decodable,Identifiable {let id:String;let version:Int;let included:Bool;let content:String;let kind:String}
  struct Stream:Decodable,Identifiable {let id:String;let version:Int;let title:String;let description:String;let sources:[Source]}
  let revision:Int;let alignedRevision:Int;let nextBefore:Int?;let changes:[Change];let attention:[Item];let preference:Preference;let workstreams:[Stream]
}
struct WorkspaceAttentionView:View {
  @Bindable var model:WorkspaceModel
  @State private var title="";@State private var description="";@State private var source=""
  var body:some View {
    List {
      if let state=model.attention {
        Section("Merita attenzione") {ForEach(state.attention) {item in Text(item.text).font(.headline);Text(item.reason).font(.caption)}}
        Section("Cosa è cambiato") {
          Text("Dal tuo ultimo allineamento esplicito. Questo non è consenso o una ricevuta di lettura.").font(.caption)
          ForEach(state.changes,id:\.revision) {change in Text("\(change.kind) · \(change.createdAt)").font(.caption)}
          Button("Sono allineato con questo stato") {Task{await model.workspaceCommand(["type":"attention.aligned","revision":state.revision],label:"Allineamento personale con lo stato")}}.disabled(model.busy)
          if let before=state.nextBefore {Button("Cambiamenti precedenti") {Task{await model.loadAttention(before:before)}}}
        }
        Section("Come collabora Miriam") {
          ForEach([("discreet","Solo quando chiamata"),("collaborative","Collaborativa"),("proactive","Proattiva")],id:\.0) {mode,label in
            Button((state.preference.mode==mode ? "✓ " : "")+label) {Task{await model.workspaceCommand(["type":"attention.preference","mode":mode,"expectedVersion":state.preference.version],label:"Preferenza di collaborazione: " + label)}}.disabled(model.busy)
          }
          Text("Lo stile non cambia authority, consenso o permessi.").font(.caption)
        }
        Section("Filoni di lavoro") {
          Text("Viste semantiche della stessa conversazione; non Sub-goal né nuove chat.").font(.caption)
          ForEach(state.workstreams) {stream in DisclosureGroup(stream.title) {
            Text(stream.description)
            ForEach(stream.sources.filter(\.included)) {item in Text(item.content);Button("Rimuovi solo questo collegamento") {Task{await model.workspaceCommand(["type":"workstream.link","workstreamId":stream.id,"sourceId":item.id,"expectedVersion":item.version,"included":false],label:"Rimuovi collegamento semantico")}}.disabled(model.busy)}
            Picker("Collega messaggio",selection:$source) {Text("Scegli").tag("");ForEach(model.messages) {Text($0.content).tag($0.id)}}
            Button("Collega al filone") {Task{let old=stream.sources.first{$0.id==source};await model.workspaceCommand(["type":"workstream.link","workstreamId":stream.id,"sourceId":source,"expectedVersion":old?.version ?? 0,"included":true],label:"Collegamento semantico")}}.disabled(model.busy || source.isEmpty)
          }}
          DisclosureGroup("Organizza un filone") {TextField("Titolo",text:$title);TextField("Descrizione",text:$description);Button("Crea vista semantica") {Task{await model.workspaceCommand(["type":"workstream.save","title":title,"description":description],label:title)}}.disabled(model.busy || title.isEmpty)}
        }
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Adesso").task{await model.loadAttention()}.refreshable{await model.loadAttention()}
  }
}
