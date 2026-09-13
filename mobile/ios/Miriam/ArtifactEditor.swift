import SwiftUI
struct ArtifactBlock:Codable {
  struct Item:Codable {var text:String;var checked:Bool}
  var type:String;var text:String?;var items:[Item]?;var columns:[String]?;var rows:[[String]]?;var sourceId:String?;var alt:String?;var caption:String?
}
private struct DraftBlock:Identifiable {let id=UUID();var value:ArtifactBlock}
struct ArtifactEditor:View {
  @Bindable var model:WorkspaceModel
  var existing:WorkspaceDetail.ArtifactVersion?
  @Environment(\.dismiss) private var dismiss
  @State private var title="";@State private var purpose="";@State private var reason="";@State private var blocks:[DraftBlock]=[];@State private var remove:UUID?
  var body:some View {
    Form {
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
      Section {Text("Salva una bozza versionata non operativa. Non adotta contenuti né modifica obblighi.").font(.caption);Button("Salva bozza") {save()}.disabled(model.busy || title.isEmpty || purpose.isEmpty || reason.isEmpty || blocks.isEmpty)}
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle(existing==nil ? "Nuovo Artifact" : "Modifica bozza").onAppear {guard blocks.isEmpty else{return};title=existing?.title ?? "";purpose=existing?.purpose ?? "";blocks=(existing?.blocks ?? [ArtifactBlock(type:"paragraph",text:existing?.body ?? "")]).map{DraftBlock(value:$0)}}
      .confirmationDialog("Rimuovere questo blocco dalla nuova bozza? Le versioni precedenti restano consultabili.",isPresented:Binding(get:{remove != nil},set:{if !$0 {remove=nil}})){Button("Rimuovi dalla bozza",role:.destructive){blocks.removeAll{$0.id==remove};remove=nil}}
  }
  func save(){Task{do {
    let values=blocks.map(\.value);let raw=try JSONSerialization.jsonObject(with:JSONEncoder().encode(values))
    var body:[String:Any]=["type":"artifact.compose","title":title,"purpose":purpose,"reason":reason,"blocks":raw,"information":[Any](),"sourceIds":values.compactMap(\.sourceId).filter{!$0.isEmpty},"nonOperative":true]
    if let existing {body["artifactId"]=existing.artifact_id;body["expectedVersion"]=existing.version
      body["information"]=(model.detail?.artifactInformation ?? []).filter{$0.artifact_id==existing.artifact_id && $0.artifact_version==existing.version}.map{["id":$0.information_id,"version":$0.information_version] as [String:Any]}
      let prior=(model.detail?.artifactSources ?? []).filter{$0.artifact_id==existing.artifact_id && $0.artifact_version==existing.version}.map(\.source_id)
      body["sourceIds"]=Array(Set(prior+values.compactMap(\.sourceId).filter{!$0.isEmpty})).sorted()
      if let contribution=existing.contribution_id {body["contributionId"]=contribution}
    }
    if await model.workspaceCommand(body,label:"Bozza: " + title) {dismiss()}
  } catch {model.error=error.localizedDescription}}}
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
