import SwiftUI

struct ActiveContract: Decodable {
  let version: Int
  let objective: String
  let scope: String
  let expectedOutput: String
  let anchors: [String]
  let origin: String
  let actor: String?
  let createdAt: String
}
struct ActiveIssue: Decodable, Identifiable {
  let id: String
  let kind: String
  let content: String
  let actor: String?
  let requiredPeople: [String]
  let acknowledgedBy: [String]
}
struct AnalysisContribution: Decodable {
  let id:String?
  let contractVersion: Int
  let body: String
  let qualification: String
  let citations: [String]
}
struct ActiveWork: Decodable, Identifiable {
  let id: String
  let revision: Int
  let phase: String
  let validity: String
  let error: String?
  let contract: ActiveContract
  let issues: [ActiveIssue]
  let contribution: AnalysisContribution?
  var status: String {
    [
      "queued": "In attesa", "working": "In corso", "needs_input": "Serve un chiarimento",
      "paused": "In pausa", "stopped": "Fermato", "completed": "Completato",
    ][phase] ?? phase
  }
}
struct ActiveEvent: Decodable, Identifiable {
  let id: String
  let workId: String
  let content: String
  let createdAt: String
}
struct ActiveWorkControlSuggestion:Decodable,Identifiable {let id:String;let workId:String;let operation:String;let text:String;let sourceId:String;let status:String}
struct ActiveWorkSnapshot: Decodable {
  let suggestions:[ActiveWorkControlSuggestion]?
  let works: [ActiveWork]
  let events: [ActiveEvent]
  let next: String?
  let canControl: Bool
}
struct MiriamActiveWorkView: View {
  @Bindable var model: WorkspaceModel
  @State private var showingAll=false
  var body: some View {
    Text("Il lavoro di Miriam").font(.headline)
    Text("Analisi e risultati restano consultabili. Preparare lavoro non significa adottarlo.")
      .font(.caption)
    if let view = model.activeWork {
      if view.works.isEmpty { Text("Nessun lavoro avviato.").font(.caption) }
      ForEach(Array(view.works.prefix(showingAll ? view.works.count : 2))) { work in
        ActiveWorkRow(model: model, work: work, view: view)
      }
      if view.works.count > 2 {Button(showingAll ? "Mostra meno" : "Tutti i lavori (\(view.works.count))") {showingAll.toggle()}}
      if let next = view.next {
        Button("Altri lavori") { Task { await model.loadActiveWork(before: next) } }
      }
      Button("Lavori recenti") { Task { await model.loadActiveWork(before: "") } }
    }
  }
}
private struct ActiveWorkRow: View {
  @Bindable var model: WorkspaceModel
  let work: ActiveWork
  let view: ActiveWorkSnapshot
  @State private var instruction = ""
  @State private var instructionKind="input"
  @State private var format="sintesi"
  @State private var history = ""
  @State private var nextBefore: Int?
  func send(_ text: String, kind:String?=nil) {
    Task {
      var body:[String:Any]=["type":"work.converse","workId":work.id,"expectedRevision":work.revision,"text":text]
      if let kind {body["instruction"]=kind}
      await model.workspaceCommand(body, label: text)
      await model.loadActiveWork()
    }
  }
  func inspect(_ before: Int? = nil) {
    Task {
      history = await model.activeWorkHistory(work.id, before: before)
      nextBefore =
        (try? JSONSerialization.jsonObject(with: Data(history.utf8)) as? [String: Any])?[
          "nextBefore"] as? Int
    }
  }
  var body: some View {
    DisclosureGroup {
      Text(work.contract.scope).font(.caption)
      Text("Output: \(work.contract.expectedOutput) · Contratto v\(work.contract.version)").font(
        .caption)
      Text(
        "\(work.contract.origin == "miriam" ? "Iniziativa di Miriam" : "Avviato da " + (model.detail?.name(work.contract.actor ?? "") ?? "un partecipante")) · \(work.contract.createdAt)"
      ).font(.caption)
      ForEach(Array(work.contract.anchors.enumerated()), id: \.offset) { _, anchor in
        Text("Ipotesi: \(anchor)")
      }
      if let error = work.error {
        Text(
          aiFailureMessage(error) ?? "Analisi non completata. Il lavoro è conservato; verifica gli input prima di riprendere."
        ).font(.caption)
      }
      ForEach((view.suggestions ?? []).filter{$0.workId==work.id && $0.status != "applied"}) {suggestion in
        VStack(alignment:.leading){Text("Miriam propone: " + suggestion.operation).font(.headline);Text(suggestion.text);Text("Interpretazione del messaggio \(suggestion.sourceId); non ancora applicata.").font(.caption)
          if suggestion.status=="stale" {Text("Il lavoro è cambiato: questa proposta va rivalutata.").font(.caption)}
          if suggestion.status=="pending" && view.canControl {Button("Applica questa istruzione al lavoro"){Task{await model.workspaceCommand(["type":"work.apply_suggestion","suggestionId":suggestion.id,"confirmExactInstruction":true],label:suggestion.text)}}.disabled(model.busy)}
        }
      }
      ForEach(work.issues) { issue in
        Text(issue.content)
        
        if view.canControl {
          if issue.kind == "revision", let actor = model.credential?.user.id,
            issue.requiredPeople.contains(actor), !issue.acknowledgedBy.contains(actor)
          {
            Button("Conferma questa direzione") { send("confermo: \(issue.id)") }.disabled(
              model.busy)
          }
          if issue.actor == model.credential?.user.id {
            Button("Ritira la tua richiesta") { send("ritiro: \(issue.id)") }.disabled(model.busy)
          }
          if issue.kind == "context" {
            Button("Usa il contesto aggiornato per l’analisi") { send("usa contesto aggiornato") }
              .disabled(model.busy)
          }
        }
      }
      if let result = work.contribution {
        Text("Contributo non adottato · contratto v\(result.contractVersion)").bold()
        Text(result.body).textSelection(.enabled)
        Text(result.qualification).font(.caption)
        if let contribution=result.id {Button("Prepara un Artifact da questo contributo") {Task{await model.workspaceCommand(["type":"artifact.from_contribution","contributionId":contribution,"title":String(work.contract.objective.prefix(160)),"purpose":String(work.contract.expectedOutput.prefix(2000)),"nonOperative":true],label:"Bozza dal contributo")}}.disabled(model.busy)}
        DisclosureGroup("Riferimenti citati") {
          ForEach(result.citations, id: \.self) { Text($0).font(.caption).textSelection(.enabled) }
        }
      }
      if view.canControl {
        Button("Pausa") { send("pausa") }.disabled(model.busy).accessibilityIdentifier("work-pause")
        Button("Riprendi") { send("riprendi") }.disabled(model.busy || !work.issues.isEmpty)
          .accessibilityIdentifier("work-resume")
        Button("Ferma") { send("ferma") }.disabled(model.busy).accessibilityIdentifier("work-stop")
        Picker("Come vuoi contribuire?",selection:$instructionKind) {Text("Aggiungi informazioni").tag("input");Text("Fissa un’ipotesi").tag("assumption");Text("Segnala un’obiezione").tag("objection");Text("Proponi una direzione").tag("redirect");Text("Cambia formato").tag("format")}
        if instructionKind=="format" {Picker("Formato",selection:$format) {Text("Sintesi").tag("sintesi");Text("Elenco").tag("elenco");Text("Dettagli").tag("dettagli")}}
        TextField("Istruzione per questo lavoro", text: $instruction, axis: .vertical)
          .accessibilityIdentifier("work-instruction")
        Text(
          "Spiega cosa vuoi cambiare o chiarire. Le restrizioni ancora aperte restano valide."
        ).font(.caption)
        Button("Invia istruzione") {
          send(instructionKind=="format" ? format : instruction,kind:instructionKind)
          instruction = ""
        }.disabled(
          model.busy || (instructionKind != "format" && instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
      }
      ForEach(view.events.filter { $0.workId == work.id }.suffix(5)) { event in
        Text("\(event.content) · \(event.createdAt)").font(.caption)
      }
      Button("Storia e provenance") { inspect() }
      if !history.isEmpty {
        DisclosureGroup("Storia del lavoro") {
          WorkHistoryView(raw:history).textSelection(.enabled)
        }
        if let nextBefore { Button("Eventi precedenti") { inspect(nextBefore) } }
      }
    } label: {
      VStack(alignment: .leading) {
        Text(work.contract.objective)
        Text(
          work.status
            + (work.validity == "potentially_outdated" ? " · Potenzialmente superato" : "")
        ).font(.caption)
      }
    }.buttonStyle(.borderless)
  }
}
