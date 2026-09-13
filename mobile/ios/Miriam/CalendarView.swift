import Foundation
import SwiftUI

struct CalendarPayload: Codable {
  let title: String
  let start: String
  let end: String
  let timeZone: String
  var json: [String: Any] { ["title": title, "start": start, "end": end, "timeZone": timeZone] }
}
struct TemporalReference: Codable {
  let kind: String
  let id: String
  let version: Int
  var json: [String: Any] { ["kind": kind, "id": id, "version": version] }
}
struct TemporalEntry: Decodable, Identifiable {
  let id: String
  let kind: String
  let version: Int
  let personId: String
  let payload: CalendarPayload
  let reason: String
  var reference: TemporalReference { TemporalReference(kind: kind, id: id, version: version) }
}
struct CalendarResource: Decodable, Identifiable {
  let id: String
  let label: String
  let canRead: Bool
  let canWriteSelf: Bool
}
struct CalendarConnection: Decodable, Identifiable {
  let id: String
  let version: Int
  let label: String
  let active: Bool
  let resources: [CalendarResource]
}
struct CalendarAction: Decodable, Identifiable {
  let proposedBy:String?
  let connectionId:String?
  let resourceId:String?
  let temporal:TemporalReference?
  let id: String
  let version: Int
  let status: String
  let personId: String
  let personName: String?
  let target: String
  let operation: String
  let payload: CalendarPayload
  let reason: String
  let error: String?
  let canAuthorize: Bool
  let canReject: Bool
  let canRetry: Bool
  let canReconcile: Bool
}
struct CalendarPublication: Decodable, Identifiable {
  let id: String
  let connectionId: String
  let resourceId: String
  let externalId: String
  let temporal: TemporalReference?
}
struct CalendarObservation: Decodable, Identifiable {
  struct Data: Decodable {
    struct Event: Decodable, Identifiable {
      let id: String
      let payload: CalendarPayload
      let deleted: Bool
    }
    struct Busy: Decodable {
      let start: String
      let end: String
    }
    let events: [Event]
    let busy: [Busy]
    let complete: Bool
    let nextCursor: String?
  }
  let id: String
  let resourceId: String
  let mode: String
  let start: String
  let end: String
  let observedAt: String
  let data: Data
}
struct CalendarRead: Decodable, Identifiable {
  let id: String
  let status: String
  let error: String?
}
struct CalendarAlert: Decodable {
  let kind: String
  let first: String
  let second: String
  let detail: String
}
struct OwnDatedCommitment:Decodable,Identifiable {let id:String;let content:String;let version:Int}
struct CalendarSnapshot: Decodable {
  let ownCommitments:[OwnDatedCommitment]?
  let workspaceId: String
  let revision: Int
  let contextRevision: Int
  let accessRevision: Int
  let providerConfigured: Bool
  let temporal: [TemporalEntry]
  let connections: [CalendarConnection]
  var actions: [CalendarAction]
  let nextActions: String?
  let observations: [CalendarObservation]
  let publications: [CalendarPublication]
  let reads: [CalendarRead]
  let alerts: [CalendarAlert]
}
struct MiriamCalendarView: View {
  @Bindable var model: WorkspaceModel
  @State private var title = ""
  @State private var starts = Date().addingTimeInterval(3600)
  @State private var ends = Date().addingTimeInterval(7200)
  @State private var reason = ""
  @State private var selfOnly = false
  @State private var editing: TemporalEntry?
  @State private var sourceObservation: String?
  @State private var observedPayload: CalendarPayload?
  var body: some View {
    Form {
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
      DatePicker(
        "Mostra 30 giorni dal", selection: $model.calendarStart, displayedComponents: .date
      )
      .onChange(of: model.calendarStart) { _, _ in Task { await model.refreshCalendar() } }
      if let c = model.calendar, c.workspaceId == model.selected {
        Text(
          "Le proposte condividono con lo spazio contenuto preciso, azione e nome della risorsa esterna."
        ).font(.footnote)
        if !c.providerConfigured {
          Text("Provider esterno non configurato. Gli appuntamenti interni sono disponibili.").font(
            .footnote)
        }
        editor(c)
        CommitmentTimeSection(model:model,calendar:c)
        temporalSection(c)
        actionSection(c)
        observationSection(c)
        Section("Confronto") {
          ForEach(Array(c.alerts.enumerated()), id: \.offset) { _, a in Text(a.detail) }
        }
      } else {
        ProgressView("Caricamento calendario…")
      }
    }.navigationTitle("Calendario").refreshable { await model.refreshCalendar() }
  }
  @ViewBuilder private func editor(_ c: CalendarSnapshot) -> some View {
    Section(editing == nil ? "Appuntamento personale" : "Modifica interna") {
      TextField("Titolo appuntamento", text: $title).accessibilityIdentifier("calendar-title")
        .disabled(sourceObservation != nil)
      DatePicker("Inizio", selection: $starts).disabled(sourceObservation != nil)
      DatePicker("Fine", selection: $ends).disabled(sourceObservation != nil)
      if sourceObservation != nil, let observedPayload {
        Text(
          "Modifica proposta dall’osservazione. Salvando, condividi solo questi dati e li stabilisci per te."
        )
        schedule(observedPayload)
      }
      TextField("Motivo", text: $reason).accessibilityIdentifier("calendar-reason")
      Toggle("Rappresento soltanto me", isOn: $selfOnly).accessibilityIdentifier("calendar-self")
      Text("Non modifica vincoli o impegni altrui e non scrive su calendari esterni.").font(
        .caption)
      Button("Salva appuntamento interno") {
        var body: [String: Any] = [
          "type": editing == nil ? "temporal.create" : "temporal.revise",
          "payload": [
            "title": title, "start": starts.ISO8601Format(), "end": ends.ISO8601Format(),
            "timeZone": TimeZone.current.identifier,
          ], "reason": reason, "representSelf": true, "expectedContextRevision": c.contextRevision,
        ]
        if let editing {
          body["eventId"] = editing.id
          body["expectedVersion"] = editing.version
        }
        if let sourceObservation, let observedPayload {
          body["sourceObservationId"] = sourceObservation
          body["shareObservedContent"] = true
          body["payload"] = observedPayload.json
        }
        Task {
          await model.workspaceCommand(body, label: title)
          if model.error.isEmpty {
            title = ""
            reason = ""
            editing = nil
            sourceObservation = nil
            observedPayload = nil
            selfOnly = false
          }
        }
      }.disabled(model.busy || !selfOnly || title.isEmpty || reason.isEmpty || ends <= starts)
        .accessibilityIdentifier("calendar-save")
      if editing != nil {
        Button("Annulla modifica") {
          editing = nil
          sourceObservation = nil
          observedPayload = nil
          title = ""
          reason = ""
        }
      }
    }
  }
  @ViewBuilder private func temporalSection(_ c: CalendarSnapshot) -> some View {
    Section("Stato temporale dello spazio") {
      if c.temporal.isEmpty { Text("Nessun appuntamento in questo periodo.") }
      ForEach(c.temporal) { t in
        VStack(alignment: .leading) {
          Text(t.payload.title).bold()
          Text("\(t.kind == "commitment" ? "Data dell’impegno":"Appuntamento") · v\(t.version)")
          schedule(t.payload)
          Text(t.reason)
          CalendarHistoryControl(model:model,id:t.id,kind:t.kind).font(.caption)
        }
        if t.personId == model.credential?.user.id {
          if t.kind == "scheduled_event" {
            Button("Modifica solo nello spazio") {
              editing = t
              sourceObservation = nil
              observedPayload = nil
              title = t.payload.title
              reason = ""
              starts = date(t.payload.start)
              ends = date(t.payload.end)
            }
          }
          ForEach(c.connections.filter(\.active)) { connection in
      Button("Disconnetti " + connection.label,role:.destructive){Task{await model.workspaceCommand(["type":"calendar.disconnect","connectionId":connection.id,"expectedVersion":connection.version],label:"Disconnessione Calendar")}}.disabled(model.busy)

            ForEach(connection.resources.filter(\.canWriteSelf)) { resource in
              Button("Proponi pubblicazione su \(resource.label)") {
                let p = c.publications.first {
                  $0.resourceId == resource.id && $0.temporal?.id == t.id
                    && $0.temporal?.kind == t.kind
                }
                var body: [String: Any] = [
                  "type": "calendar.propose", "connectionId": connection.id,
                  "resourceId": resource.id, "operation": p == nil ? "create" : "update",
                  "payload": t.payload.json, "temporal": t.reference.json,
                  "reason": "Pubblicazione proposta dall’appuntamento interno",
                  "shareWithWorkspace": true,
                ]
                if let p { body["publicationId"] = p.id }
                Task {
                  await model.workspaceCommand(body, label: "Proposta Calendar: \(t.payload.title)")
                }
              }.disabled(model.busy)
            }
          }
        }
      }
    }
  }
  @ViewBuilder private func actionSection(_ c: CalendarSnapshot) -> some View {
    Section("Proposte e risultati") {
      ForEach(c.actions) { a in
        VStack(alignment: .leading) {
          Text(a.payload.title).bold()
          Text("\(a.status) · v\(a.version)")
          Text("\(a.operation == "create" ? "Crea":"Aggiorna") su \(a.target)")
          schedule(a.payload)
          Text(a.reason)
          Text(
            "Rappresenta soltanto \(a.personName ?? a.personId), senza inviti o notifiche esterne. Autorizzare non certifica il successo."
          ).font(.caption)
          if let error = a.error { Text(error) }
          if a.status == "OUTCOME_UNKNOWN" {
            Text("L’effetto potrebbe essere già avvenuto. Verifica prima di riprovare.")
          }
        }
        CalendarHistoryControl(model:model,id:a.id,kind:"action")
        CalendarRevisionControl(model:model,calendar:c,action:a)
        if a.canAuthorize {
          Button("Autorizzo questa azione per me") { perform("calendar.authorize", a, c) }.disabled(
            model.busy
          ).accessibilityIdentifier("calendar-authorize-\(a.id)")
        }
        if a.canReject {
          Button("Rifiuta proposta") { perform("calendar.reject", a, c) }.disabled(model.busy)
        }
        if a.canRetry {
          Button("Riprova azione invariata") { perform("calendar.retry", a, c) }.disabled(
            model.busy)
        }
        if a.canReconcile {
          Button("Verifica esito esterno") { perform("calendar.reconcile", a, c) }.disabled(
            model.busy)
        }
      }
      if c.nextActions != nil {
        Button("Altre proposte Calendar") { Task { await model.moreCalendar() } }
      }
    }
  }
  @ViewBuilder private func observationSection(_ c: CalendarSnapshot) -> some View {
    Section("Osservazioni esterne riservate") {
      observationControls(c)
      ForEach(c.observations) { o in observationRow(o, c) }
      ForEach(c.reads.filter { $0.status != "COMPLETED" }) { r in
        Text("\(r.status) · \(r.error ?? "")")
      }
    }
  }
  @ViewBuilder private func observationControls(_ c: CalendarSnapshot) -> some View {
    ForEach(c.connections.filter(\.active)) { connection in
      ForEach(connection.resources.filter(\.canRead)) { resource in
        Button("Leggi eventi · " + resource.label) { readResource(connection, resource, "events") }
          .disabled(model.busy)
        Button("Leggi disponibilità · " + resource.label) {
          readResource(connection, resource, "availability")
        }.disabled(model.busy)
      }
    }
  }
  private func readResource(
    _ connection: CalendarConnection, _ resource: CalendarResource, _ mode: String
  ) {
    let start = model.calendarStart.ISO8601Format()
    let end = model.calendarStart.addingTimeInterval(2_592_000).ISO8601Format()
    let body: [String: Any] = [
      "type": "calendar.read", "connectionId": connection.id, "resourceId": resource.id,
      "mode": mode, "start": start, "end": end,
    ]
    Task { await model.workspaceCommand(body, label: "Lettura Calendar") }
  }
  @ViewBuilder private func observationRow(_ o: CalendarObservation, _ c: CalendarSnapshot)
    -> some View
  {

    Text("Fonte esterna · \(o.observedAt). Non è informazione accettata né impegno.").font(
      .caption)
    ForEach(o.data.events) { e in
      Text("\(e.payload.title) · \(e.payload.start)\(e.deleted ? " · non più presente":"")")
      if !e.deleted,
        let p = c.publications.first(where: {
          $0.resourceId == o.resourceId && $0.externalId == e.id
        }),
        let t = c.temporal.first(where: {
          $0.kind == "scheduled_event" && $0.id == p.temporal?.id
            && $0.personId == model.credential?.user.id
        })
      {
        Button("Proponi modifica interna da questa osservazione") {
          editing = t
          sourceObservation = o.id
          observedPayload = e.payload
          title = e.payload.title
          starts = date(e.payload.start)
          ends = date(e.payload.end)
          reason = ""
          selfOnly = false
        }
      }
    }
    ForEach(Array(o.data.busy.enumerated()), id: \.offset) { _, b in
      Text("Occupato: \(b.start) → \(b.end)")
    }
    if !o.data.complete { Text("Lettura parziale: occorre altro contesto.") }
    if let cursor = o.data.nextCursor,
      let connection = c.connections.first(where: {
        $0.resources.contains(where: { $0.id == o.resourceId })
      })
    {
      Button("Continua lettura") {
        Task {
          await model.workspaceCommand(
            [
              "type": "calendar.read", "connectionId": connection.id,
              "resourceId": o.resourceId, "mode": o.mode, "start": o.start, "end": o.end,
              "cursor": cursor,
            ], label: "Altra pagina Calendar")
        }
      }
    }
  }
  private func date(_ s: String) -> Date {
    ISO8601DateFormatter().date(from: s)
      ?? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? Date()
      }()
  }
  private func schedule(_ p: CalendarPayload) -> some View {
    Text("\(date(p.start).formatted()) → \(date(p.end).formatted()) · \(p.timeZone)").font(
      .subheadline)
  }
  private func perform(_ type: String, _ a: CalendarAction, _ c: CalendarSnapshot) {
    var body: [String: Any] = ["type": type, "actionId": a.id, "version": a.version]
    if type == "calendar.authorize" {
      body["expectedContextRevision"] = c.contextRevision
      body["expectedAccessRevision"] = c.accessRevision
      body["representSelf"] = true
    }
    if type == "calendar.reject" {
      body["reason"] = "Rifiutata esplicitamente dalla persona rappresentata"
    }
    Task { await model.workspaceCommand(body, label: "\(type): \(a.payload.title)") }
  }
}

private struct CommitmentTimeSection:View {
 @Bindable var model:WorkspaceModel
 let calendar:CalendarSnapshot
 @State private var selected=""
 @State private var starts=Date().addingTimeInterval(3600)
 @State private var ends=Date().addingTimeInterval(7200)
 @State private var reason=""
 @State private var accepted=false
 var body:some View {
  if let commitments=calendar.ownCommitments,!commitments.isEmpty {
   Section("Data di un tuo impegno già adottato") {
    Picker("Impegno",selection:$selected){Text("Scegli un impegno").tag("");ForEach(commitments){c in Text(c.content).tag(c.id)}}
    DatePicker("Inizio",selection:$starts);DatePicker("Fine",selection:$ends);TextField("Motivazione",text:$reason)
    Toggle("Stabilisco la data soltanto per me",isOn:$accepted)
    Text("Non modifica il contenuto dell’impegno né calendari esterni.").font(.caption)
    Button("Stabilisci la data dell’impegno"){if let c=commitments.first(where:{$0.id==selected}){Task{await model.workspaceCommand(["type":"commitment.time.set","commitmentId":c.id,"expectedVersion":c.version,"expectedContextRevision":calendar.contextRevision,"representSelf":true,"time":["start":starts.ISO8601Format(),"end":ends.ISO8601Format(),"timeZone":TimeZone.current.identifier],"reason":reason],label:"Data dell’impegno")}}}.disabled(model.busy || !accepted || reason.isEmpty || selected.isEmpty || ends<=starts)
   }
  }
 }
}

private struct CalendarRevisionControl:View {
 @Bindable var model:WorkspaceModel
 let calendar:CalendarSnapshot;let action:CalendarAction
 var body:some View {
  if action.proposedBy==model.credential?.user.id,action.personId==model.credential?.user.id,["PROPOSED","AUTHORIZED","FAILED"].contains(action.status),let connection=action.connectionId,let resource=action.resourceId,let temporal=calendar.temporal.first(where:{$0.id==action.temporal?.id && $0.kind==action.temporal?.kind}) {
   let publication=calendar.publications.first(where:{$0.connectionId==connection && $0.resourceId==resource && $0.temporal?.id==temporal.id && $0.temporal?.kind==temporal.kind})
   if action.operation=="create" || publication != nil {
    DisclosureGroup("Rivedi la proposta Calendar"){
     Text(temporal.payload.title);Text("\(temporal.payload.start) → \(temporal.payload.end) · \(temporal.payload.timeZone)")
     Text("Nuova versione dalla situazione interna corrente; le autorizzazioni precedenti decadono. Nessuna scrittura esterna.").font(.caption)
     Button("Riallinea questa proposta alla versione interna"){
      var body:[String:Any]=["type":"calendar.revise","actionId":action.id,"expectedVersion":action.version,"connectionId":connection,"resourceId":resource,"operation":action.operation,"temporal":temporal.reference.json,"payload":temporal.payload.json,"reason":"Riallineamento esplicito alla versione interna corrente","shareWithWorkspace":true]
      if action.operation=="update",let publication {body["publicationId"]=publication.id}
      Task{await model.workspaceCommand(body,label:"Rivedi proposta Calendar")}
     }.disabled(model.busy)
    }
   }
  }
 }
}

private struct CalendarHistoryControl:View {
 @Bindable var model:WorkspaceModel;let id:String;let kind:String
 @State private var history=""
 var body:some View {
  DisclosureGroup("Versioni, origine e transizioni") {
   Button("Carica storia"){Task{let raw=await model.calendarHistory(id,kind:kind);if let data=raw.data(using:.utf8),let json=try? JSONSerialization.jsonObject(with:data),let formatted=try? JSONSerialization.data(withJSONObject:json,options:[.prettyPrinted,.sortedKeys]) {history=String(data:formatted,encoding:.utf8) ?? raw} else {history=raw}}}
   if !history.isEmpty {Text(history).font(.caption).textSelection(.enabled)}
  }
 }
}
