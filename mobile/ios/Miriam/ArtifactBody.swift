import SwiftUI
struct ArtifactBody:View {
  @Bindable var model:WorkspaceModel
  let version:WorkspaceDetail.ArtifactVersion
  var body:some View {
    if let blocks=version.blocks,!blocks.isEmpty {
      ForEach(Array(blocks.enumerated()),id:\.offset){_,block in
        switch block.type {
        case "heading":Text(block.text ?? "").font(.headline)
        case "paragraph":Text(block.text ?? "").textSelection(.enabled)
        case "checklist":ForEach(Array((block.items ?? []).enumerated()),id:\.offset){_,item in Label(item.text,systemImage:item.checked ? "checkmark.square" : "square")}
        case "table":ScrollView(.horizontal){VStack(alignment:.leading){HStack{ForEach(Array((block.columns ?? []).enumerated()),id:\.offset){_,text in Text(text).bold().frame(width:140,alignment:.leading)}};ForEach(Array((block.rows ?? []).enumerated()),id:\.offset){_,row in HStack{ForEach(Array(row.enumerated()),id:\.offset){_,text in Text(text).frame(width:140,alignment:.leading)}}}}}
        case "image":if let id=block.sourceId {SharedArtifactImage(model:model,id:id,alt:block.alt ?? "Immagine condivisa");if let caption=block.caption,!caption.isEmpty{Text(caption).font(.caption)};SourceReferenceView(model:model,sourceId:id)}
        default:Text("Contenuto non supportato da questa versione dell’app")
        }
      }
    } else {Text(version.body).textSelection(.enabled)}
  }
}
private struct SharedArtifactImage:View {
  @Bindable var model:WorkspaceModel;let id:String;let alt:String
  @State private var data:Data?
  var body:some View {Group{if let data,let image=UIImage(data:data){Image(uiImage:image).resizable().scaledToFit().accessibilityLabel(alt)}else{Text(alt).font(.caption)}}.task(id:id){data=await model.sourceBytes(id)}}
}
