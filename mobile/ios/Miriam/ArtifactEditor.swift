import SwiftUI
struct ArtifactBlock:Codable {
  struct Item:Codable {var text:String;var checked:Bool}
  var type:String;var text:String?;var items:[Item]?;var columns:[String]?;var rows:[[String]]?;var sourceId:String?;var alt:String?;var caption:String?
}
private struct DraftBlock:Identifiable {let id=UUID();var value:ArtifactBlock}
struct ArtifactEditor:View {
  @Bindable var model:WorkspaceModel
  var existing:WorkspaceDetail.ArtifactVersion?
  var handoff:ConversationHandoff?=nil
  @Environment(\.dismiss) private var dismiss
  @State private var title="";@State private var purpose="";@State private var reason="";@State private var blocks:[DraftBlock]=[];@State private var remove:UUID?
  @State private var initialized=false
  @State private var baseArtifact:WorkspaceDetail.ArtifactVersion?
  @State private var expectedVersion:Int?
  @State private var information:[WorkspaceDetail.ArtifactInformation]=[]
  @State private var originalSources:[String]=[]
  private var currentVersion:Int? {guard let baseArtifact else {return nil};return model.detail?.artifacts.first(where:{$0.id == baseArtifact.artifact_id})?.current_draft_version}
  private var stale:Bool {baseArtifact != nil && currentVersion != expectedVersion}
  var body:some View {
    Form {
      if stale {
        Section {
          Text("La bozza è stata preparata dalla versione \(expectedVersion ?? 0). L’Artifact è cambiato; testo e riferimenti selezionati sono conservati.").foregroundStyle(.orange)
          if let currentVersion {Button("Usa questo testo sulla versione \(currentVersion)"){expectedVersion=currentVersion}}
        }
      }
      Section {TextField("Titolo",text:$title);TextField("A cosa serve?",text:$purpose,axis:.vertical);TextField("Motivo della versione",text:$reason,axis:.vertical)}
      ForEach($blocks) {$block in Section {
        ArtifactBlockEditor(block:$block.value,sources:model.detail?.sources ?? [])
        Button("Rimuovi blocco",role:.destructive){remove=block.id}
      }}
      Section("Aggiungi contenuto") {Menu("Nuovo blocco") {
        Button("Paragrafo"){blocks.append(DraftBlock(value:ArtifactBlock(type:"paragraph",text:"")))}
        Button("Titolo"){blocks.append(DraftBlock(value:ArtifactBlock(type:"heading",text:"")))}
        Button("Checklist"){blocks.append(DraftBlock(value:ArtifactBlock(type:"checklist",items:[.init(text:"",checked:false)])))}
        Button("Tabella"){blocks.append(DraftBlock(value:ArtifactBlock(type:"table",columns:["Voce","Dettaglio"],rows:[["",""]])))}
        Button("Immagine condivisa"){blocks.append(DraftBlock(value:ArtifactBlock(type:"image",sourceId:"",alt:"",caption:"")))}
      }}
      Section {Text("Salva una bozza versionata non operativa. Conserva le versioni dei riferimenti originali, anche storiche; non adotta contenuti né modifica obblighi.").font(.caption);Button("Salva bozza") {save()}.disabled(model.busy || !initialized || stale || title.isEmpty || purpose.isEmpty || reason.isEmpty || blocks.isEmpty || (handoff.map{!model.canApplyHandoff($0)} ?? false))}
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle(existing==nil ? "Nuovo Artifact" : "Modifica bozza").onAppear {prepare()}
      .confirmationDialog("Rimuovere questo blocco dalla nuova bozza? Le versioni precedenti restano consultabili.",isPresented:Binding(get:{remove != nil},set:{if !$0 {remove=nil}})){Button("Rimuovi dalla bozza",role:.destructive){blocks.removeAll{$0.id==remove};remove=nil}}
  }
  private func prepare() {
    guard !initialized else {return}
    initialized=true;baseArtifact=existing;expectedVersion=existing?.version
    title=existing?.title ?? handoff?.summary ?? "";purpose=existing?.purpose ?? handoff?.summary ?? "";reason=handoff?.summary ?? ""
    blocks=(existing?.blocks ?? [ArtifactBlock(type:"paragraph",text:existing?.body ?? handoff?.suggestedText ?? "")]).map{DraftBlock(value:$0)}
    if let existing {
      information=(model.detail?.artifactInformation ?? []).filter{$0.artifact_id == existing.artifact_id && $0.artifact_version == existing.version}
      originalSources=(model.detail?.artifactSources ?? []).filter{$0.artifact_id == existing.artifact_id && $0.artifact_version == existing.version}.map(\.source_id)
    }
  }
  func save(){guard initialized,!stale else {return};let boundary=model.mediaBoundary;do {
    let values=blocks.map(\.value);let raw=try JSONSerialization.jsonObject(with:JSONEncoder().encode(values))
    var body:[String:Any]=["type":"artifact.compose","title":title,"purpose":purpose,"reason":reason,"blocks":raw,"information":[Any](),"sourceIds":values.compactMap(\.sourceId).filter{!$0.isEmpty},"nonOperative":true]
    if let baseArtifact,let expectedVersion {body["artifactId"]=baseArtifact.artifact_id;body["expectedVersion"]=expectedVersion
      body["information"]=information.map{["id":$0.information_id,"version":$0.information_version] as [String:Any]}
      body["sourceIds"]=Array(Set(originalSources+values.compactMap(\.sourceId).filter{!$0.isEmpty})).sorted()
      if let contribution=baseArtifact.contribution_id {body["contributionId"]=contribution}
    }
    let label="Bozza: " + title
    Task {guard boundary == model.mediaBoundary else {return};if await model.handoffCommand(body,handoff:handoff,label:label),boundary == model.mediaBoundary {dismiss()}}
  } catch {if boundary == model.mediaBoundary {model.error=error.localizedDescription}}}
}
private struct ArtifactBlockEditor:View {
  @Binding var block:ArtifactBlock
  let sources:[WorkspaceDetail.Source]
  var body:some View {
    switch block.type {
    case "paragraph","heading":TextField(block.type=="heading" ? "Titolo della sezione" : "Testo",text:Binding(get:{block.text ?? ""},set:{block.text=$0}),axis:.vertical)
    case "checklist":
      ForEach(Array((block.items ?? []).indices),id:\.self){index in HStack {Toggle("Completata",isOn:Binding(get:{block.items?[index].checked ?? false},set:{block.items?[index].checked=$0})).labelsHidden();TextField("Voce",text:Binding(get:{block.items?[index].text ?? ""},set:{block.items?[index].text=$0}))}}
      Button("Aggiungi voce"){block.items?.append(.init(text:"",checked:false))}
    case "table":
      ScrollView(.horizontal) {
        VStack(alignment:.leading) {
          HStack {ForEach(Array((block.columns ?? []).indices),id:\.self){c in TextField("Colonna \(c+1)",text:Binding(get:{block.columns?[c] ?? ""},set:{block.columns?[c]=$0})).frame(width:150)}}
          ForEach(Array((block.rows ?? []).indices),id:\.self){r in HStack {ForEach(Array((block.columns ?? []).indices),id:\.self){c in TextField("Cella",text:Binding(get:{guard let row=block.rows?[r],c<row.count else{return ""};return row[c]},set:{value in guard let row=block.rows?[r],c<row.count else{return};block.rows?[r][c]=value})).frame(width:150)}}}
        }.textFieldStyle(.roundedBorder)
      }
      Button("Aggiungi riga"){block.rows?.append(Array(repeating:"",count:block.columns?.count ?? 0))}
      Button("Aggiungi colonna"){block.columns?.append("Colonna");for r in (block.rows ?? []).indices {block.rows?[r].append("")}}
    case "image":
      Picker("Immagine già condivisa",selection:Binding(get:{block.sourceId ?? ""},set:{block.sourceId=$0})){Text("Scegli").tag("");ForEach(sources.filter{($0.media_type ?? "").hasPrefix("image/")}){Text($0.title).tag($0.id)}}
      TextField("Descrizione accessibile",text:Binding(get:{block.alt ?? ""},set:{block.alt=$0}));TextField("Didascalia",text:Binding(get:{block.caption ?? ""},set:{block.caption=$0}))
    default:Text("Blocco non supportato")
    }
  }
}
