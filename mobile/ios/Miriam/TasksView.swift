import SwiftUI

struct WorkReference: Codable {
  let kind: String
  let id: String
  let version: Int
  var json: [String: Any] { ["kind": kind, "id": id, "version": version] }
}
struct WorkContent: Decodable {
  let title: String
  let description: String
  let dueAt: String?
  let timeZone: String
  let suggestedPerson: String?
  let references: [WorkReference]
}
struct WorkTask: Decodable, Identifiable {
  let id: String
  let version: Int
  let title: String
  let description: String
  let dueAt: String?
  let timeZone: String
  let suggestedPerson: String?
  let references: [WorkReference]
  let status: String
  let responsible: String?
  let acceptedVersion: Int?
  let responsibleAvailable: Bool
  let actor: String
  let reason: String
  let candidateId: String?
}
struct WorkFollowup: Decodable, Identifiable {
  let id: String
  let version: Int
  let owner: String
  let content: String
  let kind: String
  let remindAt: String
  let timeZone: String
  let reference: WorkReference?
  let status: String
  let needsReview: Bool
  let deliveredAt: String?
  let reason: String
}
struct WorkProposal: Decodable, Identifiable {
  let id: String
  let taskId: String
  let baseVersion: Int
  let content: WorkContent
  let actor: String
  let reason: String
}
struct WorkMember: Decodable, Identifiable {
  let id: String
  let name: String
}
struct WorkSuggestion: Decodable, Identifiable {
  let id: String
  let content: String
  let subject: String
  let origin: String
  let qualification: String
}
struct TasksSnapshot: Decodable {
  let tasks: [WorkTask]
  let followups: [WorkFollowup]
  let proposals: [WorkProposal]
  let members: [WorkMember]
  let suggestions: [WorkSuggestion]
  let next: String?
}
struct MiriamTasksView: View {
  @Bindable var model: WorkspaceModel
  var handoff:ConversationHandoff?=nil
  @Environment(\.scenePhase) private var phase
  @State private var title = ""
  @State private var detail = ""
  @State private var reason = ""
  @State private var suggested = ""
  @State private var candidate: String?
  @State private var due = Date()
  @State private var taskTimeZone=TimeZone.current.identifier
  @State private var hasDue = false
  @State private var editing: WorkTask?
  @State private var refs: [WorkReference] = []
  @State private var reminder = ""
  @State private var remindAt = Date().addingTimeInterval(600)
  @State private var followup: WorkFollowup?
  @State private var target: WorkReference?
  @State private var history = ""
  @State private var handoffLoaded=false
  @State private var handoffFailure=""
  private var actor: String { model.credential?.user.id ?? "" }
  private func name(_ id: String?) -> String {
    model.tasks?.members.first(where: { $0.id == id })?.name ?? id ?? "Non assegnato"
  }
  private func send(_ body: [String: Any]) {
    Task {
      await model.workspaceCommand(body, label: "Tasks / follow-up")
      await model.loadTasks()
    }
  }
  private func base(_ t: WorkTask, _ type: String) -> [String: Any] {
    [
      "type": type, "taskId": t.id, "expectedVersion": t.version,
      "reason": reason.isEmpty ? "Atto personale esplicito" : reason,
    ]
  }
  private func update(_ t: WorkTask, _ type: String, _ extra: [String: Any] = [:]) {
    send(base(t, type).merging(extra) { _, new in new })
  }
  private func reset() {
    editing = nil
    title = ""
    detail = ""
    reason = ""
    suggested = ""
    hasDue = false
    taskTimeZone=TimeZone.current.identifier
    refs = []
    candidate = nil
  }
  var body: some View {
    Form {
      Section {
        Text("Task, responsabilità e impegno sono distinti. Un promemoria non autorizza azioni.")
          .font(.caption)
        if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        if !handoffFailure.isEmpty {Text(handoffFailure).foregroundStyle(.red);Button("Riprova il Task di origine"){Task{await prepareHandoff()}}}
      }
      if let view = model.tasks {
        Section(editing == nil ? "Nuovo Task non assegnato" : "Modifica / proposta") {
          TextField("Attività", text: $title).accessibilityIdentifier("task-title")
          TextField("Perimetro e aspettative", text: $detail, axis: .vertical)
          Toggle("Scadenza", isOn: $hasDue)
          if hasDue { DatePicker("Entro", selection: $due) }
          Picker("Possibile referente — non assegnato", selection: $suggested) {
            Text("Nessuno").tag("")
            ForEach(view.members) { Text($0.name).tag($0.id) }
          }
          TextField("Motivo", text: $reason)
          Button(editing?.responsible != nil ? "Proponi modifica da accettare" : "Salva Task") {
            let c: [String: Any] = [
              "title": title, "description": detail,
              "dueAt": hasDue ? due.ISO8601Format() as Any : NSNull(),
              "timeZone": taskTimeZone,
              "suggestedPerson": suggested.isEmpty ? NSNull() : suggested as Any,
              "references": refs.map(\.json),
            ]
            saveTask(c)
          }.disabled(model.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (handoff.map{!model.canApplyHandoff($0) || !handoffLoaded} ?? false))
            .accessibilityIdentifier("task-save")
          if editing != nil { Button("Annulla modifica", action: reset) }
        }
        if !view.suggestions.isEmpty {
          Section {
            DisclosureGroup("Proposte Miriam — non sono Task") {
              ForEach(view.suggestions) { s in
                Text(s.content)
                Text(s.qualification).font(.caption)
                Button("Prepara Task") {
                  reset()
                  title = s.subject
                  detail = s.content
                  candidate = s.id
                }
              }
            }
          }
        }
        ForEach(view.tasks) { t in taskSection(t, view) }
        Section(followup == nil ? "Nuovo follow-up per me" : "Rivedi follow-up") {
          TextField("Cosa verificare", text: $reminder).accessibilityIdentifier("followup-content")
          DatePicker("Ricordamelo", selection: $remindAt)
          if let target { Text("Riferimento \(target.kind) · v\(target.version)").font(.caption) }
          Button("Salva follow-up") {
            var b: [String: Any] = [
              "type": followup == nil ? "followup.create" : "followup.revise", "content": reminder,
              "kind": "check", "remindAt": remindAt.ISO8601Format(),
              "timeZone": TimeZone.current.identifier, "reference": target?.json ?? NSNull() as Any,
            ]
            if let f = followup {
              b["followupId"] = f.id
              b["expectedVersion"] = f.version
              b["reason"] = "Riprogrammazione esplicita"
            }
            send(b)
            followup = nil
            target = nil
            reminder = ""
          }.disabled(model.busy || reminder.isEmpty).accessibilityIdentifier("followup-save")
        }
        ForEach(view.followups) { f in followupSection(f, view) }
        Section {
          if let next = view.next {
            Button("Altri elementi") { Task { await model.loadTasks(before: next) } }
          }
          Button("Primi elementi") { Task { await model.loadTasks(before: "") } }
        }
        if !history.isEmpty {
          Section("Storia e provenance") { Text(history).font(.caption).textSelection(.enabled) }
        }
      } else {
        ProgressView()
      }
    }.navigationTitle("Lavoro e follow-up").accessibilityIdentifier("tasks-content")
      .task(id:handoff?.id){await prepareHandoff()}
      .task(id: phase) {
        guard phase == .active else { return }
        while !Task.isCancelled {
          await model.loadTasks()
          try? await Task.sleep(for: .seconds(2))
        }
      }
  }
  private func saveTask(_ content:[String:Any]) {
    var body:[String:Any]
    if let task=editing {body=base(task,task.responsible == nil ? "task.revise" : "task.propose_revision");body["content"]=content}
    else {body=["type":"task.create","content":content];if let candidate {body["candidateId"]=candidate}}
    let boundary=model.mediaBoundary,sentTitle=title,sentDetail=detail,sentReason=reason,sentTask=editing?.id
    Task {
      guard boundary == model.mediaBoundary else {return}
      let saved=await model.handoffCommand(body,handoff:handoff,label:"Tasks / follow-up")
      guard boundary == model.mediaBoundary else {return}
      if saved,title == sentTitle,detail == sentDetail,reason == sentReason,editing?.id == sentTask {reset()}
      await model.loadTasks()
    }
  }
  private func prepareHandoff() async {
    guard let handoff,!handoffLoaded else {return}
    let boundary=model.mediaBoundary
    handoffFailure=""
    if handoff.kind == .taskChange,let target=handoff.target {
      await model.loadTasks(before:"")
      var seen=Set<String>()
      while boundary == model.mediaBoundary,!Task.isCancelled,let view=model.tasks,!view.tasks.contains(where:{$0.id == target.id}),let next=view.next,seen.insert(next).inserted {await model.loadTasks(before:next)}
      guard boundary == model.mediaBoundary,!Task.isCancelled else {return}
      guard let task=model.tasks?.tasks.first(where:{$0.id == target.id}),task.version == target.version else {handoffFailure="Il Task di origine non è disponibile in questa versione. Rileggi l’indicazione prima di proseguire.";return}
      editing=task;title=task.title;detail=handoff.suggestedText;refs=task.references
      suggested=task.suggestedPerson ?? "";hasDue=task.dueAt != nil;taskTimeZone=task.timeZone
      if let raw=task.dueAt {
        guard let date=taskDate(raw) else {handoffFailure="La scadenza originale non è leggibile. Riprova prima di modificare il Task.";return}
        due=date
      }
    } else {
      title=handoff.summary;detail=handoff.suggestedText;candidate=handoff.candidateId
    }
    reason=handoff.summary;handoffLoaded=true
  }
  private func taskDate(_ raw:String)->Date? {
    let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
    return formatter.date(from:raw) ?? ISO8601DateFormatter().date(from:raw)
  }
  @ViewBuilder private func taskSection(_ t: WorkTask, _ view: TasksSnapshot) -> some View {
    Section(t.title) {
      Text(t.description)
      Text("\(t.status) · v\(t.version) · \(t.dueAt ?? "Senza scadenza")").font(.caption)
      Text("Responsabilità: \(name(t.responsible))")
      if t.responsible != nil {
        Text(
          "Accettata su v\(t.acceptedVersion ?? 0)\(t.responsibleAvailable ? "":" · accesso non disponibile")"
        ).font(.caption)
      }
      if t.suggestedPerson != nil {
        Text("Suggerito: \(name(t.suggestedPerson)); nessuna assegnazione implicita").font(.caption)
      }
      Text("\(name(t.actor)) · \(t.reason)").font(.caption)
      ForEach(Array(t.references.enumerated()), id: \.offset) { _, r in
        Text("\(r.kind) · \(r.id) · v\(r.version)").font(.caption)
      }
      if t.responsible == nil && !["completed", "cancelled"].contains(t.status) {
        Button("Me ne occupo") { update(t, "task.accept", ["representSelf": true]) }.disabled(
          model.busy)
      }
      if t.responsible == actor {
        Button("Lascio la responsabilità") { update(t, "task.relinquish", ["representSelf": true]) }
          .disabled(model.busy)
      }
      if t.responsible == nil || t.responsible == actor {
        Button("Segna completato — solo Task") {
          update(t, "task.status", ["status": "completed", "noNormativeEffect": true])
        }.disabled(model.busy || t.status == "completed")
        Button("Annulla Task — conserva obblighi") {
          update(t, "task.status", ["status": "cancelled", "noNormativeEffect": true])
        }.disabled(model.busy || t.status == "cancelled")
      }
      if !["completed", "cancelled"].contains(t.status) {
        Button("Modifica / proponi") {
          editing = t
          title = t.title
          detail = t.description
          suggested = t.suggestedPerson ?? ""
          refs = t.references
          hasDue = t.dueAt != nil
          due = t.dueAt.flatMap {taskDate($0)} ?? Date()
          taskTimeZone=t.timeZone
        }
      }
      Button("Prepara follow-up") {
        reminder = "Verificare: \(t.title)"
        target = WorkReference(kind: "task", id: t.id, version: t.version)
        followup = nil
      }
      Button("Storia Task") { Task { history = await model.workHistory(t.id, kind: "task") } }
      ForEach(view.proposals.filter { $0.taskId == t.id }) { p in
        Text("Proposta: \(p.content.title) · \(p.content.dueAt ?? "senza scadenza")")
        Text(p.content.description)
        if t.responsible == actor {
          Button("Accetto il nuovo perimetro") {
            update(t, "task.adopt_revision", ["proposalId": p.id, "acceptResponsibility": true])
          }.disabled(model.busy)
        }
      }
    }
  }
  @ViewBuilder private func followupSection(_ f: WorkFollowup, _ view: TasksSnapshot) -> some View {
    Section(f.content) {
      Text("\(name(f.owner)) · \(f.status) · v\(f.version) · \(f.remindAt)").font(.caption)
      Text(
        f.needsReview
          ? "Da rivedere: accesso o riferimento cambiato"
          : f.deliveredAt != nil ? "Promemoria disponibile — nessuna azione eseguita" : "In attesa")
      if f.owner == actor {
        Button("Rivedi / riprogramma") {
          followup = f
          reminder = f.content
          target = f.reference
          if let r = f.reference, r.kind == "task",
            let t = view.tasks.first(where: { $0.id == r.id })
          {
            target = WorkReference(kind: "task", id: t.id, version: t.version)
          }
        }
        Button("Verifica fatta") {
          send([
            "type": "followup.close", "followupId": f.id, "expectedVersion": f.version,
            "reason": "Verifica conclusa", "status": "done",
          ])
        }.disabled(model.busy)
        Button("Annulla follow-up") {
          send([
            "type": "followup.close", "followupId": f.id, "expectedVersion": f.version,
            "reason": "Non serve più", "status": "cancelled",
          ])
        }.disabled(model.busy)
      }
      Button("Storia follow-up") {
        Task { history = await model.workHistory(f.id, kind: "followup") }
      }
    }
  }
}
