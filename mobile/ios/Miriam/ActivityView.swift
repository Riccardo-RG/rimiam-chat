import SwiftUI

struct ConversationReference:Codable,Equatable,Hashable,Sendable {
  enum Kind:String,Codable,Sendable {
    case goal,information,commitment,task,artifact,question,workstream,active_work,scheduled_event,source
    var label:String {
      switch self {
      case .goal:return "Goal"
      case .information:return "Informazione"
      case .commitment:return "Impegno o proposta"
      case .task:return "Task"
      case .artifact:return "Artifact"
      case .question:return "Domanda"
      case .workstream:return "Filone"
      case .active_work:return "Lavoro di Miriam"
      case .scheduled_event:return "Evento condiviso"
      case .source:return "Fonte"
      }
    }
  }
  let kind:Kind
  let id:String
  let version:Int
  let eventId:String?
  var versionLabel:String {kind == .active_work ? "Revisione evento \(version)" : "Versione \(version)"}
  var json:[String:Any] {
    var value:[String:Any]=["kind":kind.rawValue,"id":id,"version":version]
    if let eventId {value["eventId"]=eventId}
    return value
  }
  var resource:String {
    var query=URLComponents()
    query.queryItems=[URLQueryItem(name:"kind",value:kind.rawValue),URLQueryItem(name:"id",value:id),URLQueryItem(name:"version",value:String(version))]
    if let eventId {query.queryItems?.append(URLQueryItem(name:"eventId",value:eventId))}
    return "reference?" + (query.percentEncodedQuery ?? "")
  }
}
struct ComposerReference:Equatable {
  let reference:ConversationReference
  let title:String
}
struct WorkspaceActivity:Decodable {
  struct Event:Decodable,Identifiable {
    let eventId:String
    let occurredAt:String
    let actor:String?
    let actorName:String
    let kind:String
    let title:String
    let summary:String
    let qualification:String
    let reference:ConversationReference
    var id:String {eventId}
  }
  let events:[Event]
  let next:String?
}
struct ReferenceDetail:Decodable {
  let reference:ConversationReference
  let title:String
  let content:String
  let qualification:String
  let actor:String?
  let createdAt:String
  let current:Bool
  let sourceIds:[String]
  let provenance:[String:ReferenceValue]
  let event:WorkspaceActivity.Event?
}
indirect enum ReferenceValue:Codable {
  case string(String),number(Double),bool(Bool),object([String:ReferenceValue]),array([ReferenceValue]),null
  init(from decoder:Decoder) throws {
    let value=try decoder.singleValueContainer()
    if value.decodeNil() {self = .null}
    else if let decoded=try? value.decode(Bool.self) {self = .bool(decoded)}
    else if let decoded=try? value.decode(String.self) {self = .string(decoded)}
    else if let decoded=try? value.decode(Double.self) {self = .number(decoded)}
    else if let decoded=try? value.decode([String:ReferenceValue].self) {self = .object(decoded)}
    else {self = .array(try value.decode([ReferenceValue].self))}
  }
  func encode(to encoder:Encoder) throws {
    var value=encoder.singleValueContainer()
    switch self {
    case .string(let item):try value.encode(item)
    case .number(let item):try value.encode(item)
    case .bool(let item):try value.encode(item)
    case .object(let item):try value.encode(item)
    case .array(let item):try value.encode(item)
    case .null:try value.encodeNil()
    }
  }
  var text:String {
    switch self {
    case .string(let value):return value
    case .bool(let value):return value ? "Sì" : "No"
    case .null:return "Non indicato"
    case .number(let value):return value.formatted(.number.grouping(.never))
    default:
      let encoder=JSONEncoder();encoder.outputFormatting=[.prettyPrinted,.sortedKeys,.withoutEscapingSlashes]
      return (try? encoder.encode(self)).flatMap{String(data:$0,encoding:.utf8)} ?? ""
    }
  }
}

struct ActivityEventRow:View {
  let event:WorkspaceActivity.Event
  var compact=false
  var body:some View {
    VStack(alignment:.leading,spacing:7) {
      Text(event.reference.kind.label.uppercased()).font(.system(.caption2,design:.monospaced).weight(.bold)).tracking(0.8).foregroundStyle(.secondary)
      Text(event.title).font(compact ? .subheadline.weight(.semibold) : .headline).lineLimit(compact ? 2 : nil)
      Text(event.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(compact ? 2 : nil)
      if !compact {Text(event.qualification).font(.caption).foregroundStyle(.secondary)}
      Text(event.actorName + " · " + activityDate(event.occurredAt)).font(.caption2).foregroundStyle(.secondary)
    }.padding(.vertical,6)
  }
}

struct WorkspaceActivityFeed:View {
  @Bindable var model:WorkspaceModel
  let onAsk:(ConversationReference,String)->Void
  var body:some View {
    Section("Passaggi nello spazio") {
      if let activity=model.activity {
        if activity.events.isEmpty {Text("Nessun passaggio registrato in questo intervallo.").foregroundStyle(.secondary)}
        ForEach(activity.events) {event in
          NavigationLink {WorkspaceReferenceView(model:model,reference:event.reference,onAsk:onAsk)} label:{ActivityEventRow(event:event)}
        }
        if let next=activity.next {
          Button("Passaggi precedenti"){Task{await model.loadActivity(before:next)}}.disabled(model.activityLoading)
        }
      } else if !model.activityLoading && model.activityError.isEmpty {
        Text("L’attività sarà disponibile al prossimo aggiornamento.").foregroundStyle(.secondary)
      }
      if model.activityLoading {ProgressView("Caricamento dei passaggi…")}
      if !model.activityError.isEmpty {
        Text(model.activityError).font(.subheadline).foregroundStyle(.red)
        Button("Riprova attività"){Task{await model.loadActivity(force:true)}}
      }
    }
  }
}

struct WorkspaceReferenceView:View {
  @Bindable var model:WorkspaceModel
  @Environment(\.dismiss) private var dismiss
  let reference:ConversationReference
  let onAsk:(ConversationReference,String)->Void
  @State private var detail:ReferenceDetail?
  @State private var failure=""
  @State private var loading=false
  private var scope:String {model.mediaBoundary + "|" + reference.resource + "|" + String(model.state?.workspace.revision ?? 0)}
  var body:some View {
    List {
      if let detail {
        referenceHeader(detail)
        Section("Il passaggio") {Text(detail.content).textSelection(.enabled)}
        referenceActions(detail)
        if let event=detail.event {Section("Evento originale") {ActivityEventRow(event:event)}}
        ReferenceSourcesSection(model:model,detail:detail,onAsk:onAsk)
        referenceProvenance(detail)
      }
      if loading {ProgressView("Caricamento del riferimento…")}
      if !failure.isEmpty {Section {Text(failure).foregroundStyle(.red);Button("Riprova"){Task{await load()}}}}
    }.navigationTitle("Riferimento").navigationBarTitleDisplayMode(.inline).rimiamList()
      .task(id:scope){await load()}
  }
  private func referenceHeader(_ detail:ReferenceDetail)->some View {
    Group {
    Section {
      Text(detail.event?.title ?? detail.title).font(.system(.title,design:.serif).weight(.bold))
      Text(reference.kind.label + " · " + reference.versionLabel).font(.caption.weight(.semibold))
      if let event=detail.event {Text(event.qualification).font(.subheadline).fixedSize(horizontal:false,vertical:true)}
      RIMIAMRule(strong:true)
    }
    Section("Rapporto con lo stato di oggi") {
      Text(detail.current ? "Questa versione è ancora presente nello stato corrente." : "Questa versione appartiene alla storia dello spazio.").font(.subheadline).foregroundStyle(.secondary)
      Text(detail.qualification).font(.subheadline).fixedSize(horizontal:false,vertical:true)
    }
    }
  }
  private func referenceActions(_ detail:ReferenceDetail)->some View {
    Section {
      Button {dismiss();onAsk(detail.reference,detail.title)} label:{Label("Chiedi a Miriam su questo passaggio",systemImage:"sparkle")}.frame(minHeight:44).accessibilityIdentifier("reference-ask")
      Text("La domanda mantiene questo riferimento preciso. Le operazioni sullo stato seguono i controlli della loro area.").font(.caption).foregroundStyle(.secondary)
      NavigationLink {referenceDestination} label:{Label("Apri i controlli di questa area",systemImage:"arrow.up.right")}
    }
  }
  private func referenceProvenance(_ detail:ReferenceDetail)->some View {
    Section("Provenienza") {
      Text(activityDate(detail.createdAt)).font(.subheadline)
      if let actor=detail.actor {Text("Attribuito a: " + (model.detail?.name(actor) ?? actor)).font(.subheadline)}
      DisclosureGroup("Dati e identità del riferimento") {
        Text("Identità: " + reference.id).font(.caption).textSelection(.enabled)
        if let eventId=reference.eventId {Text("Evento: " + eventId).font(.caption).textSelection(.enabled)}
        ForEach(detail.provenance.keys.sorted(),id:\.self) {key in
          VStack(alignment:.leading,spacing:4) {Text(key).font(.caption.weight(.semibold));Text(detail.provenance[key]?.text ?? "").font(.caption).textSelection(.enabled)}.padding(.vertical,4)
        }
      }
    }
  }
  @ViewBuilder private var referenceDestination:some View {
    switch reference.kind {
    case .goal:WorkspaceGoalView(model:model)
    case .information,.commitment:WorkspaceContextView(model:model)
    case .task:MiriamTasksView(model:model)
    case .artifact:WorkspaceArtifactsView(model:model)
    case .question:WorkspaceQuestionsView(model:model)
    case .workstream:WorkspaceWorkstreamDetailView(model:model,streamID:reference.id)
    case .active_work:MiriamWorkDetailView(model:model,workID:reference.id)
    case .scheduled_event:MiriamCalendarView(model:model)
    case .source:WorkspaceSourcesView(model:model)
    }
  }
  private func load() async {
    let captured=scope
    loading=true;detail=nil;failure=""
    let raw=await model.workspaceRead(reference.resource)
    guard captured == scope,!Task.isCancelled else {return}
    loading=false
    guard !raw.isEmpty else {failure=model.error.isEmpty ? "Il riferimento non è disponibile. Riprova quando la connessione è attiva." : model.error;return}
    do {
      let value=try JSONDecoder().decode(ReferenceDetail.self,from:Data(raw.utf8))
      guard value.reference == reference else {throw APIError(code:"REFERENCE_EVENT_MISMATCH",status:0)}
      detail=value
    } catch {failure=(error as? APIError)?.localizedDescription ?? "Il riferimento ricevuto è incompleto. Riprova per verificarlo."}
  }
}

private struct ReferenceSourcesSection:View {
  let model:WorkspaceModel
  let detail:ReferenceDetail
  let onAsk:(ConversationReference,String)->Void
  private var ids:[String] {detail.sourceIds.filter{detail.reference.kind != .source || $0 != detail.reference.id}}
  var body:some View {
    if !ids.isEmpty {
      Section("Fonti condivise") {
        ForEach(ids,id:\.self) {id in
          NavigationLink {
            WorkspaceReferenceView(model:model,reference:ConversationReference(kind:.source,id:id,version:1,eventId:nil),onAsk:onAsk)
          } label:{Label("Apri fonte · " + String(id.prefix(8)),systemImage:"doc.text.magnifyingglass")}
        }
      }
    }
    if detail.reference.kind == .source,let source=model.detail?.sources.first(where:{$0.id == detail.reference.id}),source.media_type != nil {
      Section("Originale condiviso") {SourceOriginalButton(model:model,source:source)}
    }
  }
}

private func activityDate(_ raw:String)->String {
  let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
  let date=formatter.date(from:raw) ?? ISO8601DateFormatter().date(from:raw)
  return date?.formatted(date:.abbreviated,time:.shortened) ?? raw
}
