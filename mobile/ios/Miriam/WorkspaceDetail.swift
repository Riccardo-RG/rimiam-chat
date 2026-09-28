import SwiftUI
import UniformTypeIdentifiers

struct GoogleConnectResponse: Decodable { let authorizationUrl: String }
struct WorkspaceDetail: Decodable {
  struct Head: Decodable { let id: String; let name: String; let revision: Int; let context_revision: Int; let access_revision: Int }
  struct Member: Decodable, Identifiable { let user_id: String; let name: String; let active: Bool; let contributes: Bool; var id: String { user_id } }
  struct Access: Decodable { let holder_id: String; let active: Bool; let invitations: Bool; let remove_members: Bool; let change_access: Bool }
  struct Adherence: Decodable { let goal_id: String; let goal_version: Int; let user_id: String }
  struct CandidateUse: Decodable { let id:String;let version:Int;let current:Bool;var reference:String {"\(id):\(version)"} }
  struct ProposalUse:Decodable {let id:String;let status:String}
  struct CandidateUses:Decodable {
    let information:[CandidateUse];let questions:[CandidateUse];let proposals:[ProposalUse]
    var isUsed:Bool {!information.isEmpty || !questions.isEmpty || !proposals.isEmpty}
  }
  struct Candidate: Decodable, Identifiable { let origin:String;let source_ids:[String];let uses:CandidateUses;let created_at:String;let id: String; let source_id: String; let subject: String; let content: String; let classification: String; let qualification: String; let context_revision: Int; let author_name: String; let source_content: String }
  struct InformationVersion: Decodable { let candidate_id:String;let accepted_by:String;let information_id: String; let version: Int; let content: String; let qualification: String; let accepted_by_name: String; let reason: String; let created_at: String }
  struct Question: Decodable, Identifiable { let id: String; let version: Int; let content: String; let status: String; let source_id: String; let reason: String }
  struct ProcessingEvent:Decodable,Identifiable {let id:String;let kind:String;let actor_id:String?;let error_code:String?;let created_at:String}
  struct Source: Decodable, Identifiable { let id: String; let kind: String; let title: String; let content: String; let qualification: String; let contributed_by: String; let created_at: String; let url: String?; let processing_status:String?; let processing_error:String?; let media_type:String?; let extraction_provider:String?; let extracted_at:String?;let processing_history:[ProcessingEvent]? }
  struct Research: Decodable, Identifiable { let id: String; let query: String; let status: String; let error_code: String? }
  struct Interpretation: Decodable, Identifiable {
    let id: String
    let source_id: String
    let status: String
    let error_code: String?
  }
  struct Artifact: Decodable, Identifiable { let id: String; let current_draft_version: Int; let current_adoption_id: String? }
  struct ArtifactVersion: Decodable { let artifact_id: String; let version: Int; let title: String; let notes: String; let body: String; let authored_by: String; let created_at: String; let reason: String; let outdated_reasons: [String]; let blocks:[ArtifactBlock]?; let purpose:String?; let contribution_id:String? }
  struct Review: Decodable, Identifiable { let id: String; let artifact_id: String; let artifact_version: Int; let people: [String] }
  struct ArtifactApproval: Decodable { let review_id: String; let person_id: String }
  struct Invitation: Decodable, Identifiable { let id: String; let recipient_email: String; let revoked_at: String?; let accepted_at: String?; let expires_at: String; let delivery_status: String?; let delivery_error: String? }
  let workspace: Head
  let members: [Member]
  let access: [Access]
  let adherences: [Adherence]
  let candidates: [Candidate]
  let versions: [InformationVersion]
  let questions: [Question]
  let sources: [Source]
  let research: [Research]
  let interpretations: [Interpretation]?
  let artifacts: [Artifact]
  let artifactVersions: [ArtifactVersion]
  struct ArtifactInformation:Decodable {let artifact_id:String;let artifact_version:Int;let information_id:String;let information_version:Int}
  struct ArtifactSource:Decodable {let artifact_id:String;let artifact_version:Int;let source_id:String}
  let artifactInformation:[ArtifactInformation]
  let artifactSources:[ArtifactSource]
  let artifactReviews: [Review]
  let artifactApprovals: [ArtifactApproval]
  struct Link:Decodable,Identifiable {struct Version:Decodable {let version:Int;let active:Bool;let actor_id:String;let created_at:String};let id:String;let name:String;let version:Int;let active:Bool;let history:[Version]}
  let links:[Link]?
  let invitations: [Invitation]
  func name(_ id: String) -> String { members.first { $0.id == id }?.name ?? "Partecipante" }
  func contributes(_ id: String?) -> Bool { members.contains { $0.id == id && $0.active && $0.contributes } }
}

struct WorkspaceGoalView: View {
  @Bindable var model:WorkspaceModel
  var handoff:ConversationHandoff?=nil
  @State private var goal=""
  var body:some View {
    List {
      Section {
        VStack(alignment:.leading,spacing:12) {
          Text("Dove vogliamo arrivare.").font(.system(.title,design:.serif).weight(.bold))
          Text("La direzione resta esplicita. Partecipare allo spazio, aderire al Goal e avere authority sono atti distinti.").font(.subheadline).foregroundStyle(.secondary)
          RIMIAMRule(strong:true)
        }.padding(.vertical,8).listRowBackground(RIMIAMStyle.page)
      }
      if let state=model.state,let detail=model.detail {
        Section("Goal") {
          if state.goals.isEmpty {
            Text("Possiamo iniziare a conversare anche senza un Goal.").font(.caption)
            TextField("Il tuo intento iniziale", text: $goal, axis: .vertical)
            Button("Stabilisci il tuo Goal") {
              let text=goal,boundary=model.mediaBoundary
              Task {guard boundary == model.mediaBoundary else {return};if await model.handoffCommand(["type":"goal.establish","content":text],handoff:handoff,label:text),boundary == model.mediaBoundary,goal == text {goal=""}}
            }.disabled(model.busy || goal.isEmpty || !detail.contributes(model.credential?.user.id) || (handoff.map{!model.canApplyHandoff($0)} ?? false))
          }
          ForEach(state.goals) { item in
            DisclosureGroup(item.content) {
              Text("Versione \(item.version) · \(item.currentPrimary ? "Goal corrente" : "Storico")")
              Text("Stabilito da \(detail.name(item.establishedBy))")
              let people = detail.adherences.filter { $0.goal_id == item.id && $0.goal_version == item.version }
              Text("Adesioni: " + (people.isEmpty ? "nessuna" : people.map { detail.name($0.user_id) }.joined(separator: ", ")))
              if item.currentPrimary && !people.contains(where: { $0.user_id == model.credential?.user.id }) {
                Button("Aderisco a questo Goal e a questa versione") { Task { await model.workspaceCommand(["type":"goal.adhere", "goalId":item.id, "version":item.version], label:"Adesione al Goal") } }.disabled(model.busy)
              }
              Text("Aderire non delega authority né approva decisioni future.").font(.caption)
            }
          }
        }
        Section {NavigationLink("Evoluzione del Goal, decisioni e mandati"){ProjectGovernanceView(model:model).rimiamList()}}
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Goal").rimiamList().textSelection(.enabled)
      .task(id:handoff?.id){if let handoff,goal.isEmpty {goal=handoff.suggestedText}}
  }
}
struct WorkspaceContextView: View {
  @Bindable var model: WorkspaceModel
  var handoff:ConversationHandoff?=nil
  var body: some View {
    List {
      if let state = model.state, let detail = model.detail {
        let pending = (detail.interpretations ?? []).filter { $0.status != "completed" }
        if !pending.isEmpty {
          Section("Letture di Miriam") {
            ForEach(pending) { item in
              DisclosureGroup(item.status == "queued" || item.status == "running" ? "Lettura in corso" : "Lettura da rivedere") {
                SourceReferenceView(model: model, sourceId: item.source_id)
                Text(item.status == "stale" ? "Il contesto è cambiato durante la lettura." : aiFailureMessage(item.error_code ?? "") ?? (item.status == "failed" ? "Lettura non completata. Verifica gli input e riprova." : "Miriam sta leggendo il contesto pertinente."))
                if ["failed", "stale"].contains(item.status) {
                  Button("Riprova lettura") {
                    Task { await model.workspaceCommand(["type": "interpretation.retry", "interpretationId": item.id], label: "Riprova lettura") }
                  }.disabled(model.busy || !detail.contributes(model.credential?.user.id))
                }
              }
            }
          }
        }
        Section {
          VStack(alignment:.leading,spacing:12) {
            Text("Quello che è emerso.").font(.system(.title,design:.serif).weight(.bold))
            Text("Informazioni accettate, ipotesi e atti mantengono le proprie qualificazioni e fonti.").font(.subheadline).foregroundStyle(.secondary)
            RIMIAMRule(strong:true)
          }.padding(.vertical,8).listRowBackground(RIMIAMStyle.page)
          NavigationLink("Domande aperte"){WorkspaceQuestionsView(model:model).rimiamList()}
          NavigationLink("Filoni della conversazione"){WorkspaceWorkstreamsView(model:model)}
          NavigationLink("Fonti e ricerca"){WorkspaceSourcesView(model:model).rimiamList()}
          NavigationLink("Decisioni e mandati"){ProjectGovernanceView(model:model).rimiamList()}
        }
        Section("Informazioni accettate") {
          if state.information.isEmpty { Text("Nessun riferimento di lavoro ancora accettato.").foregroundStyle(.secondary) }
          ForEach(state.information) { info in
            InformationRow(model: model, info: info, detail: detail,handoff:handoff?.target?.id == info.id ? handoff : nil)
          }
        }
        Section("Proposte e riferimenti alle adozioni") {
          ForEach(detail.candidates) { candidate in CandidateRow(model: model, candidate: candidate, detail: detail,handoff:handoff?.kind == .informationAccept && handoff?.candidateId == candidate.id ? handoff : nil) }
        }
        Section("Atti e proposte") {
          ForEach(state.commitments) { item in
            DisclosureGroup(item.content) {
              Text(item.status == "proposed" ? "Proposta, non ancora efficace" : item.status == "superseded" ? "Atto storico, superato" : item.status == "effective" ? "Atto attualmente efficace" : "Stato da verificare")
              Text("Persone rappresentate: " + item.people.map(detail.name).joined(separator: ", "))
              if item.status == "proposed" && item.people.contains(model.credential?.user.id ?? "") {
                Button("Approvo soltanto per me") { Task { await model.workspaceCommand(["type":"commitment.approve", "proposalId":item.id, "expectedContextRevision":detail.workspace.context_revision, "expectedAccessRevision":detail.workspace.access_revision, "representSelf":true], label:"Approvazione personale dell’impegno") } }.disabled(model.busy)
              }
            }
          }
        }
      }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
    }.navigationTitle("Context").textSelection(.enabled).rimiamList()
  }
}
private struct InformationRow: View {
  @Bindable var model: WorkspaceModel
  let info: Information
  let detail: WorkspaceDetail
  var handoff:ConversationHandoff?=nil
  @State private var expanded=false
  @State private var replacement = ""
  @State private var reason = ""
  var body: some View {
    DisclosureGroup(info.subject,isExpanded:$expanded) {
      Text(info.content)
      Text("\(info.qualification) · v\(info.version) · accettata da \(detail.name(info.acceptedBy))").font(.caption)
      Text("Riferimento di lavoro, non consenso collettivo né certezza garantita.").font(.caption)
      ForEach(detail.versions.filter { $0.information_id == info.id }, id: \.version) { version in
        VStack(alignment:.leading) { Text("v\(version.version) · \(version.accepted_by_name) · \(version.created_at)").font(.caption); Text(version.content); Text(version.qualification).font(.caption); Text(version.reason).font(.caption); if let candidate = detail.candidates.first(where: {$0.id == version.candidate_id}) { CandidateProvenance(model:model,candidate:candidate) } }
      }
      if detail.contributes(model.credential?.user.id) {
        Picker("Correzione proposta", selection:$replacement) { Text("Seleziona una fonte candidata").tag(""); ForEach(detail.candidates.filter { $0.classification == "descriptive" && $0.context_revision == detail.workspace.context_revision }) { Text($0.content).tag($0.id) } }.disabled(handoff != nil)
        TextField("Motivo della correzione", text:$reason)
        Button("Accetta la correzione versionata") { let boundary=model.mediaBoundary;Task {guard boundary == model.mediaBoundary else {return};await model.handoffCommand(["type":"information.correct", "informationId":info.id, "expectedVersion":handoff?.target?.version ?? info.version, "candidateId":replacement, "reason":reason, "descriptiveOnly":true],handoff:handoff,label:"Correzione: " + info.subject) } }.disabled(model.busy || replacement.isEmpty || reason.isEmpty || (handoff.map{!model.canApplyHandoff($0) || $0.target?.version != info.version} ?? false))
      }
    }.task(id:handoff?.id){if let handoff {expanded=true;replacement=handoff.candidateId ?? "";reason=handoff.summary}}
  }
}
private struct CandidateProvenance:View {
  @Bindable var model:WorkspaceModel
  let candidate:WorkspaceDetail.Candidate
  var body:some View {
    Text(candidate.origin == "inferred" ? "Deduzione proposta da Miriam, non dichiarazione esplicita." : "Interpretazione attribuita a \(candidate.author_name).").font(.caption)
    Text(candidate.qualification).font(.caption)
    Text(candidate.source_content).font(.callout)
    Text("Candidato \(candidate.id) · \(candidate.created_at)").font(.caption)
    ForEach(candidate.source_ids,id:\.self) {id in SourceReferenceView(model:model,sourceId:id)}
  }
}
private struct CandidateRow: View {
  @Bindable var model: WorkspaceModel
  let candidate: WorkspaceDetail.Candidate
  let detail: WorkspaceDetail
  var handoff:ConversationHandoff?=nil
  @State private var expanded=false
  @State private var people: Set<String> = []
  var body: some View {
    DisclosureGroup(candidate.content,isExpanded:$expanded) {
      CandidateProvenance(model:model,candidate:candidate)
      if !candidate.uses.isUsed { Text("Candidato non adottato").font(.caption) }
      ForEach(candidate.uses.information,id:\.reference) { use in Text("Usato nell’informazione \(use.id) · v\(use.version) · \(use.current ? "corrente" : "storica")").font(.caption) }
      ForEach(candidate.uses.questions,id:\.reference) { use in Text("Domanda \(use.id) · v\(use.version) · \(use.current ? "corrente" : "storica")").font(.caption) }
      ForEach(candidate.uses.proposals,id:\.id) { use in Text("Proposta normativa \(use.id) · \(use.status)").font(.caption) }
      if candidate.context_revision != detail.workspace.context_revision { Text("Lo stato è cambiato: questa proposta deve essere rivalutata.").font(.caption) }
      else if !candidate.uses.isUsed && detail.contributes(model.credential?.user.id) {
        if candidate.classification == "descriptive" {
          Button("Accetta come riferimento descrittivo") { let boundary=model.mediaBoundary;Task {guard boundary == model.mediaBoundary else {return};await model.handoffCommand(["type":"information.accept","candidateId":candidate.id,"descriptiveOnly":true],handoff:handoff,label:"Accettazione: " + candidate.subject) } }.disabled(model.busy || (handoff.map{!model.canApplyHandoff($0)} ?? false))
        }
        if candidate.classification == "normative" {
          Text("Proponi un impegno per le persone selezionate; ognuna dovrà approvare.").font(.caption)
          ForEach(detail.members.filter(\.active)) { member in Toggle(member.name, isOn:Binding(get:{people.contains(member.id)},set:{if $0 { people.insert(member.id) } else { people.remove(member.id) }})) }
          Button("Proponi impegno") { Task { await model.workspaceCommand(["type":"commitment.propose","candidateId":candidate.id,"people":Array(people).sorted()],label:"Proposta di impegno") } }.disabled(model.busy || people.isEmpty)
        }
        if candidate.classification == "question" {
          Button("Registra la domanda aperta") { Task { await model.workspaceCommand(["type":"question.open","candidateId":candidate.id,"sourceId":candidate.source_id,"content":candidate.content],label:candidate.content) } }.disabled(model.busy)
        }
      }
    }.task(id:handoff?.id){if handoff != nil {expanded=true}}
  }
}

struct WorkspaceSourcesView: View {
  @Bindable var model: WorkspaceModel
  @State private var previousSource=""
  @State private var voice=VoiceNote()
  @Environment(\.scenePhase) private var scenePhase
  @State private var processMedia=false
  @State private var importing = false
  @State private var file: URL?
  @State private var query = ""
  @State private var disclosure = false
  var body: some View {
    List {
      Section("Condividi materiale") {
        Text("Le fonti saranno visibili ai membri attuali e futuri del Workspace. Leggere una fonte non ne adotta il contenuto.").font(.caption)
        Button("Scegli file, immagine o audio") { importing = true }
        Picker("Versione precedente del documento",selection:$previousSource){Text("Nuovo documento").tag("");ForEach((model.detail?.sources ?? []).filter{$0.kind=="document"}){source in Text(source.title + " · " + source.created_at).tag(source.id)}}
        Button(voice.recording ? "Ferma registrazione" : "Registra nota vocale") {Task{if voice.recording {voice.stop();file=voice.file;processMedia=false} else {await voice.start()}}}
        if voice.recording {Text("Registrazione in corso · resta sul dispositivo finché non la condividi.").font(.caption)}
        if !voice.error.isEmpty {Text(voice.error).foregroundStyle(.red)}
        Toggle("Consento l’invio di immagini/audio al provider configurato per comprenderli",isOn:$processMedia)
        Text("Testi fino a 1 MB; PDF, DOCX, immagini e audio fino a 8 MB. Puoi condividere l’originale senza autorizzare l’elaborazione AI.").font(.caption)
        if let file { Text(file.lastPathComponent); Button("Condividi nel Workspace") { upload(file) }.disabled(model.busy) }
      }
      Section("Ricerca web") {
        TextField("Cosa vuoi cercare?",text:$query,axis:.vertical)
        Toggle("Autorizzo l’invio di questa query al servizio di ricerca",isOn:$disclosure)
        Button("Cerca") { Task { if await model.workspaceCommand(["type":"research.request","query":query,"discloseQuery":true],label:"Ricerca: " + query) { query=""; disclosure=false } } }.disabled(model.busy || query.isEmpty || !disclosure)
        ForEach(model.detail?.research ?? []) { research in
          DisclosureGroup(research.query) {
            Text(research.status == "needs_configuration" ? "Servizio di ricerca da collegare" : research.status)
            if let error = research.error_code { Text(error).font(.caption) }
            Button("Riprova") { Task { await model.workspaceCommand(["type":"research.retry","workId":research.id],label:"Riprendi ricerca") } }.disabled(model.busy)
            Button("Interrompi") { Task { await model.workspaceCommand(["type":"research.cancel","workId":research.id],label:"Interrompi ricerca") } }.disabled(model.busy)
          }
        }
      }
      Section("Fonti condivise") { ForEach(model.detail?.sources ?? []) { source in DisclosureGroup(source.title) { Text(source.qualification).font(.caption); Text(source.content.isEmpty ? "Originale condiviso; contenuto non ancora disponibile." : source.content); if source.media_type != nil {SourceOriginalButton(model:model,source:source)}; DisclosureGroup("Storia dell’elaborazione"){ForEach(source.processing_history ?? []){event in Text("\(event.created_at) · \(event.kind) · \(event.actor_id.map{model.detail?.name($0) ?? "Partecipante"} ?? "Miriam")").font(.caption);if let error=event.error_code {Text(error).font(.caption)}}}; Text(source.created_at).font(.caption);
          if let status=source.processing_status {Text(processingLabel(status)).font(.caption);if let error=source.processing_error {Text(error).font(.caption)};if ["needs_configuration","needs_input","failed"].contains(status) {Button("Richiedi elaborazione") {Task{var body:[String:Any]=["type":"document.retry","sourceId":source.id];if processMedia {body["allowModelProcessing"]=true};await model.workspaceCommand(body,label:"Elabora " + source.title)}}.disabled(model.busy)}}
          if let provider=source.extraction_provider {Text("Estratto tramite \(provider) · \(source.extracted_at ?? "")").font(.caption)}; if let url = source.url, let link = URL(string:url), ["http","https"].contains(link.scheme ?? "") { Link("Apri fonte", destination:link) } } } }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
    }.navigationTitle("Fonti e ricerca").textSelection(.enabled)
      .fileImporter(isPresented:$importing,allowedContentTypes:[.plainText,.commaSeparatedText,.pdf,.image,.audio,UTType(filenameExtension:"docx") ?? .data],allowsMultipleSelection:false) { result in
        switch result { case .success(let urls): file=urls.first;processMedia=false; case .failure(let error): model.error=error.localizedDescription }
      }.onDisappear{voice.discard()}
       .onChange(of:scenePhase){_,phase in if phase != .active {let wasRecording=voice.recording;voice.stop();if wasRecording {file=voice.file}}}
  }
  func upload(_ url: URL) {
    Task {
      let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
      do {
        let bytes = try Data(contentsOf:url)
        let limit=["txt","md","csv"].contains(url.pathExtension.lowercased()) ? 1_048_576 : 8_388_608
        guard bytes.count <= limit else {model.error="File troppo grande per questo formato.";return}
        var body:[String:Any]=["type":"document.upload","filename":url.lastPathComponent,"bytesBase64":bytes.base64EncodedString()]
        if processMedia {body["allowModelProcessing"]=true}
        if !previousSource.isEmpty {body["previousSourceId"]=previousSource}
        if await model.workspaceCommand(body,label:"Condividi " + url.lastPathComponent) {file=nil;previousSource="";processMedia=false;voice.discard()}
      } catch { model.error=error.localizedDescription }
    }
  }
}
