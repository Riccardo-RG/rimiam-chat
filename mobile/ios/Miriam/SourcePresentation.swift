import SwiftUI
import UniformTypeIdentifiers

struct OriginalDocument:FileDocument {
  static var readableContentTypes:[UTType]{[.data]}
  var data:Data
  init(data:Data){self.data=data}
  init(configuration:ReadConfiguration)throws{data=configuration.file.regularFileContents ?? Data()}
  func fileWrapper(configuration:WriteConfiguration)throws->FileWrapper{FileWrapper(regularFileWithContents:data)}
}
func processingLabel(_ status:String)->String {
  switch status {case "queued":return "In attesa";case "processing":return "Elaborazione in corso";case "ready":return "Contenuto disponibile";case "needs_configuration":return "Provider da collegare";case "needs_input":return "Serve un chiarimento o consenso";case "failed":return "Elaborazione non riuscita";default:return status}
}
struct SourceOriginalButton:View {
  @Bindable var model:WorkspaceModel
  let source:WorkspaceDetail.Source
  @State private var document:OriginalDocument?
  @State private var exporting=false
  @State private var loading=false
  var body:some View {
    Button(loading ? "Recupero originale…" : "Salva originale…") {Task{loading=true;defer{loading=false};if let bytes=await model.sourceBytes(source.id){document=OriginalDocument(data:bytes);exporting=true}}}.disabled(loading)
      .fileExporter(isPresented:$exporting,document:document,contentType:UTType(mimeType:source.media_type ?? "") ?? .data,defaultFilename:source.title){result in document=nil;if case .failure(let e)=result {model.error=e.localizedDescription}}
  }
}
struct SourceReferenceView:View {
  @Bindable var model:WorkspaceModel
  let sourceId:String
  var body:some View {
    if let source=model.detail?.sources.first(where:{$0.id==sourceId}) {
      DisclosureGroup(source.title) {Text(source.qualification).font(.caption);Text(source.content.isEmpty ? "L’originale è condiviso; il contenuto non è ancora disponibile." : source.content);if source.media_type != nil {SourceOriginalButton(model:model,source:source)}}
    } else if let message=model.messages.first(where:{$0.id==sourceId}) {DisclosureGroup("Messaggio di " + message.authorName){Text(message.content)}}
    else {Text("Fonte storica: consulta le fonti del Workspace.").font(.caption)}
  }
}
