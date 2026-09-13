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
  @Environment(\.scenePhase) private var phase
  @State private var title = ""
  @State private var detail = ""
  @State private var reason = ""
  @State private var suggested = ""
  @State private var candidate: String?
  @State private var due = Date()
  @State private var hasDue = false
  @State private var editing: WorkTask?
  @State private var refs: [WorkReference] = []
  @State private var reminder = ""
  @State private var remindAt = Date().addingTimeInterval(600)
  @State private var followup: WorkFollowup?
  @State private var target: WorkReference?
  @State private var history = ""
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
    refs = []
    candidate = nil
  }
  var body: some View {
    Form {
      Section {
        Text("Task, responsabilità e impegno sono distinti. Un promemoria non autorizza azioni.")
          .font(.caption)
        if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
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
              "timeZone": TimeZone.current.identifier,
              "suggestedPerson": suggested.isEmpty ? NSNull() : suggested as Any,
              "references": refs.map(\.json),
            ]
            if let t = editing {
              update(
                t, t.responsible == nil ? "task.revise" : "task.propose_revision", ["content": c])
            } else {
              var b: [String: Any] = ["type": "task.create", "content": c]
              if let candidate { b["candidateId"] = candidate }
              send(b)
            }
            reset()
          }.disabled(model.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
      .task(id: phase) {
        guard phase == .active else { return }
        while !Task.isCancelled {
          await model.loadTasks()
          try? await Task.sleep(for: .seconds(2))
        }
      }
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
          due = t.dueAt.flatMap { ISO8601DateFormatter().date(from: $0) } ?? Date()
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
