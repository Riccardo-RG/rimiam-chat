import Foundation
import SwiftUI

struct EmailFile: Codable, Identifiable {
  let kind: String
  let id: String
  let version: Int
  let hash: String
  let filename: String
}
struct EmailTarget: Codable {
  let observationId: String
  let messageId: String
}
struct EmailEnvelope: Codable {
  var sender: String
  var to: [String]
  var cc: [String]
  var bcc: [String]
  var subject: String
  var body: String
  var attachments: [EmailFile]
  var kind: String
  var target: EmailTarget?
  var json: [String: Any] {
    var value =
      (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) as? [String: Any] ?? [:]
    if target == nil { value["target"] = NSNull() }
    return value
  }
  static func empty(_ sender: String) -> Self {
    Self(
      sender: sender, to: [], cc: [], bcc: [], subject: "", body: "", attachments: [], kind: "new",
      target: nil)
  }
}
struct MailboxConnection: Decodable, Identifiable {
  let id: String
  let version: Int
  let sender: String
  let label: String
  let active: Bool
  let canRead: Bool
  let canSend: Bool
}
struct EmailDraft: Decodable, Identifiable {
  let id: String
  let version: Int
  let connectionId: String?
  let envelope: EmailEnvelope
  let reason: String
}
struct EmailAction: Decodable, Identifiable {
  struct Receipt: Decodable {
    let providerMessageId: String
    let evidence: String
  }
  let id: String
  let draftId: String
  let version: Int
  let status: String
  let envelope: EmailEnvelope
  let error: String?
  let receipt: Receipt?
  let canAuthorize: Bool
  let canReject: Bool
  let canRetry: Bool
  let canReconcile: Bool
}
struct EmailObservation: Decodable, Identifiable {
  struct Message: Decodable, Identifiable {
    struct Attachment: Decodable, Identifiable {
      let id: String
      let filename: String
    }
    let id: String
    let threadId: String?
    let from: String
    let replyTo: [String]
    let subject: String
    let body: String
    let attachments: [Attachment]
  }
  struct Contents: Decodable {
    let messages: [Message]
    let complete: Bool
    let nextCursor: String?
  }
  struct Request: Decodable {
    let mode: String
    let query: String?
    let targetId: String?
  }
  let id: String
  let connectionId: String
  let observedAt: String
  let data: Contents
  let request: Request
}
struct EmailComposition: Decodable {
  struct Suggestion: Decodable {
    let subject: String
    let body: String
    let needsClarification: String?
  }
  let id: String
  let draftId: String
  let version: Int
  let suggestion: Suggestion
}
struct EmailSnapshot: Decodable {
  struct Disclosure: Decodable, Identifiable {
    let id: String
    let sourceId: String
    let personId: String
    let createdAt: String
  }
  let workspaceId: String
  let contextRevision: Int
  let accessRevision: Int
  let providerConfigured: Bool
  let connections: [MailboxConnection]
  let drafts: [EmailDraft]
  let actions: [EmailAction]
  let observations: [EmailObservation]
  let attachments: [EmailFile]
  let workspaceAttachments: [EmailFile]
  let disclosures: [Disclosure]
  let reads: [CalendarRead]
  let nextDrafts: String?
}
struct MiriamEmailView: View {
  @Bindable var model: WorkspaceModel
  @Environment(\.scenePhase) private var scenePhase
  @State private var envelope = EmailEnvelope.empty("")
  @State private var connection = ""
  @State private var editing: EmailDraft?
  @State private var to = ""
  @State private var cc = ""
  @State private var bcc = ""
  @State private var reason = ""
  @State private var query = ""
  @State private var instruction = ""
  @State private var composition: EmailComposition?
  @State private var compositionId: String?
  @FocusState private var focusedField: String?
  @State private var excerpts: [String: String] = [:]
  var body: some View {
    Form {
      Text(
        "Mailbox, bozze e invii sono riservati a te. Solo la condivisione esplicita porta contenuti nello spazio."
      ).font(.footnote)
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
      if let c = model.email, c.workspaceId == model.selected {
        if !c.providerConfigured {
          Text("Provider Email non configurato. Le bozze interne sono disponibili.").font(.footnote)
        }
        editor(c)
        Section("Preparazione con Miriam") {
          Text(
            "Invia al modello soltanto il testo della bozza salvata e questa istruzione. Controlla e salva esplicitamente il risultato; non invia email."
          ).font(.caption)
          TextField("Istruzione per Miriam", text: $instruction)
          if let result = composition {
            if let needs = result.suggestion.needsClarification {
              Text(needs)
            } else {
              Text(result.suggestion.subject)
              Text(result.suggestion.body)
              Button("Usa come revisione da controllare") {
                guard
                  let d = c.drafts.first(where: {
                    $0.id == result.draftId && $0.version == result.version
                  })
                else {
                  model.error = "EMAIL_DRAFT_STALE"
                  return
                }
                editing = d
                connection = d.connectionId ?? ""
                envelope = d.envelope
                envelope.subject = result.suggestion.subject
                envelope.body = result.suggestion.body
                to = envelope.to.joined(separator: ", ")
                cc = envelope.cc.joined(separator: ", ")
                bcc = envelope.bcc.joined(separator: ", ")
                compositionId = result.id
                reason = ""
              }
            }
          }
        }
        Section("Bozze interne private") {
          ForEach(c.drafts) { d in draftRow(d, c) }
          if let next = c.nextDrafts {
            Button("Bozze precedenti") { Task { await model.loadEmail(before: next) } }
          }
          Button("Bozze recenti") { Task { await model.loadEmail(before: "") } }
        }
        Section("Proposte e risultati privati") { ForEach(c.actions) { a in actionRow(a, c) } }
        observations(c)
        Section("Disclosure condivise") {
          ForEach(c.disclosures) { d in
            Text("Fonte condivisa esplicitamente: \(d.sourceId) · \(d.createdAt)").font(.caption)
          }
        }
      } else {
        ProgressView("Caricamento email…")
      }
    }.scrollDismissesKeyboard(.interactively).navigationTitle("Workspace Email")
      .task(id: scenePhase) {
        if envelope.sender.isEmpty { envelope.sender = model.credential?.user.email ?? "" }
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
          await model.loadEmail()
          do { try await Task.sleep(for: .seconds(2)) } catch { return }
        }
      }
  }
  @ViewBuilder private func editor(_ c: EmailSnapshot) -> some View {
    Section(editing == nil ? "Nuova bozza" : "Modifica bozza") {
      Picker("Mailbox verificata", selection: $connection) {
        Text("Non collegata — solo bozza").tag("")
        ForEach(c.connections.filter(\.active)) { m in Text(m.sender).tag(m.id) }
      }.onChange(of: connection) { _, value in
        envelope.sender =
          c.connections.first(where: { $0.id == value })?.sender ?? model.credential?.user.email
          ?? ""
      }
      Text("Da: \(envelope.sender) · \(envelope.kind)")
      TextField("To, separati da virgole", text: $to).textInputAutocapitalization(.never)
        .focused($focusedField, equals: "to").accessibilityIdentifier("email-to")
      TextField("CC", text: $cc).focused($focusedField, equals: "cc").textInputAutocapitalization(
        .never)
      TextField("BCC", text: $bcc).focused($focusedField, equals: "bcc")
        .textInputAutocapitalization(.never)
      TextField("Oggetto email", text: $envelope.subject).focused($focusedField, equals: "subject")
        .accessibilityIdentifier("email-subject")
      TextField("Corpo email", text: $envelope.body, axis: .vertical).lineLimit(3...10)
        .focused($focusedField, equals: "body").accessibilityIdentifier("email-body")
      ForEach(c.workspaceAttachments + c.attachments) { a in
        Toggle(
          "\(a.filename) · v\(a.version) · \(a.kind == "mailbox_attachment" ? "privato" : "Workspace")",
          isOn: Binding(
            get: { envelope.attachments.contains { $0.id == a.id } },
            set: { included in
              envelope.attachments.removeAll { $0.id == a.id }
              if included { envelope.attachments.append(a) }
            }))
      }
      TextField("Motivo bozza", text: $reason).focused($focusedField, equals: "reason")
        .accessibilityIdentifier("email-reason")
      Button("Salva bozza interna") {
        focusedField = nil
        envelope.to = addresses(to)
        envelope.cc = addresses(cc)
        envelope.bcc = addresses(bcc)
        var body: [String: Any] = [
          "type": editing == nil ? "email.draft.create" : "email.draft.revise",
          "connectionId": connection.isEmpty ? NSNull() : connection as Any,
          "envelope": envelope.json, "reason": reason,
        ]
        if let editing {
          body["draftId"] = editing.id
          body["expectedVersion"] = editing.version
          if let compositionId { body["compositionId"] = compositionId }
        }
        Task {
          await model.workspaceCommand(body, label: "Bozza email: \(envelope.subject)")
          if model.error.isEmpty { reset() }
          await model.loadEmail()
        }
      }.disabled(model.busy || reason.isEmpty).accessibilityIdentifier("email-save")
      Button("Nuova bozza") { reset() }
    }
  }
  @ViewBuilder private func draftRow(_ d: EmailDraft, _ c: EmailSnapshot) -> some View {
    Text("\(d.envelope.subject) · v\(d.version)").bold()
    contents(d.envelope)
    Button("Suggerisci testo con Miriam") {
      Task { composition = await model.composeEmail(d, instruction: instruction) }
    }.disabled(model.busy || instruction.isEmpty)
    Button("Modifica bozza") {
      compositionId = nil
      editing = d
      connection = d.connectionId ?? ""
      envelope = d.envelope
      to = envelope.to.joined(separator: ", ")
      cc = envelope.cc.joined(separator: ", ")
      bcc = envelope.bcc.joined(separator: ", ")
      reason = ""
    }
    if d.connectionId != nil
      && !c.actions.contains(where: { $0.draftId == d.id && $0.version == d.version })
    {
      Button("Prepara proposta di invio esatta") {
        perform([
          "type": "email.propose", "draftId": d.id, "version": d.version,
          "discloseToRecipients": true,
        ])
      }.disabled(model.busy)
    }
  }
  @ViewBuilder private func contents(_ e: EmailEnvelope) -> some View {
    Text(
      "Da: \(e.sender)\nTo: \(e.to.joined(separator: ", "))\nCC: \(e.cc.joined(separator: ", "))\nBCC: \(e.bcc.joined(separator: ", "))"
    )
    Text("\(e.kind) · \(e.target?.messageId ?? "nuovo messaggio")").font(.caption)
    Text(e.body)
    ForEach(e.attachments) { a in
      Text("Allegato: \(a.filename) · v\(a.version) · SHA256 \(a.hash)").font(.caption)
    }
  }
  @ViewBuilder private func actionRow(_ a: EmailAction, _ c: EmailSnapshot) -> some View {
    Text("\(a.envelope.subject) · \(a.status) · v\(a.version)").bold()
    contents(a.envelope)
    Text(
      "L’invio divulga esattamente contenuto e allegati ai destinatari, inclusi CC/BCC. Rappresenti soltanto te."
    ).font(.caption)
    if let error = a.error { Text(error) }
    if a.status == "OUTCOME_UNKNOWN" {
      Text("Potrebbe essere già inviata. Non reinviare senza prova sufficiente.")
    }
    if let receipt = a.receipt {
      Text(
        "Accettata dal provider: \(receipt.providerMessageId). Non prova lettura o consegna finale."
      )
    }
    if a.canAuthorize {
      Button("Autorizzo invio e disclosure per me") {
        perform([
          "type": "email.authorize", "actionId": a.id, "version": a.version,
          "expectedContextRevision": c.contextRevision, "expectedAccessRevision": c.accessRevision,
          "representSelf": true, "discloseToRecipients": true,
        ])
      }.disabled(model.busy)
    }
    if a.canReject { Button("Rifiuta invio") { control("email.reject", a) }.disabled(model.busy) }
    if a.canRetry {
      Button("Riprova stesso invio") { control("email.retry", a) }.disabled(model.busy)
    }
    if a.canReconcile {
      Button("Verifica esito email") { control("email.reconcile", a) }.disabled(model.busy)
    }
  }
  @ViewBuilder private func observations(_ c: EmailSnapshot) -> some View {
    Section("Mailbox privata") {
      TextField("Ricerca nella mailbox", text: $query)
      ForEach(c.connections.filter(\.active)) { m in
        Text(
          "\(m.sender) · lettura \(m.canRead ? "disponibile" : "non disponibile") · invio \(m.canSend ? "personale" : "non disponibile")"
        )
        if m.canRead {
          Button("Cerca privatamente · \(m.label)") {
            read(m.id, ["mode": "search", "query": query])
          }.disabled(model.busy || query.isEmpty)
        }
        Button("Disconnetti mailbox") {
          perform(["type": "email.disconnect", "connectionId": m.id, "expectedVersion": m.version])
        }
      }
      ForEach(c.observations) { o in
        Text("Osservazione privata · \(o.observedAt)").font(.caption)
        ForEach(o.data.messages) { m in messageRow(m, o, c) }
        if !o.data.complete { Text("Lettura parziale: serve altro contesto.") }
        if let cursor = o.data.nextCursor {
          Button("Continua lettura privata") {
            var r: [String: Any] = ["mode": o.request.mode, "cursor": cursor]
            if let q = o.request.query { r["query"] = q }
            if let t = o.request.targetId { r["targetId"] = t }
            read(o.connectionId, r)
          }
        }
      }
      ForEach(c.attachments) { a in
        Text("Allegato privato: \(a.filename) · v\(a.version)")
        Text(
          "Condividere rende il file visibile ai membri attuali e futuri ammessi alla storia conservata."
        ).font(.caption)
        Button("Condividi allegato nello spazio") {
          perform([
            "type": "email.attachment.disclose", "attachmentId": a.id, "fullHistoryDisclosed": true,
          ])
        }.disabled(model.busy)
      }
      ForEach(c.reads.filter { $0.status != "COMPLETED" }) { r in
        Text("\(r.status) · \(r.error ?? "")")
      }
    }
  }
  @ViewBuilder private func messageRow(
    _ m: EmailObservation.Message, _ o: EmailObservation, _ c: EmailSnapshot
  ) -> some View {
    Text(m.subject).bold()
    Text("Da \(m.from) · thread \(m.threadId ?? "non disponibile")").font(.caption)
    Text(m.body)
    Button("Rileggi messaggio privato") {
      read(o.connectionId, ["mode": "message", "targetId": m.id])
    }
    if let thread = m.threadId {
      Button("Leggi thread privato") {
        read(o.connectionId, ["mode": "thread", "targetId": thread])
      }
    }
    Button("Prepara reply") { prepare(m, o, c, "reply") }
    Button("Prepara forward") { prepare(m, o, c, "forward") }
    let key = o.id + ":" + m.id
    TextField(
      "Estratto da condividere",
      text: Binding(get: { excerpts[key] ?? "" }, set: { excerpts[key] = $0 }), axis: .vertical)
    Text(
      "Solo questo estratto entra nella storia visibile ai membri attuali e futuri ammessi. Non diventa informazione accettata."
    ).font(.caption)
    Button("Condividi questo estratto nello spazio") {
      perform([
        "type": "email.disclose", "observationId": o.id, "messageId": m.id,
        "text": excerpts[key] ?? "", "fullHistoryDisclosed": true,
      ])
    }.disabled(model.busy || (excerpts[key] ?? "").isEmpty)
    ForEach(m.attachments) { a in
      Button("Leggi allegato privato: \(a.filename)") {
        read(
          o.connectionId,
          ["mode": "attachment", "observationId": o.id, "messageId": m.id, "attachmentId": a.id])
      }
    }
  }
  private func prepare(
    _ m: EmailObservation.Message, _ o: EmailObservation, _ c: EmailSnapshot, _ kind: String
  ) {
    reset()
    connection = o.connectionId
    envelope.sender = c.connections.first { $0.id == o.connectionId }?.sender ?? ""
    envelope.kind = kind
    envelope.target = EmailTarget(observationId: o.id, messageId: m.id)
    envelope.subject = "\(kind == "reply" ? "Re" : "Fwd"): \(m.subject)"
    envelope.body = kind == "forward" ? m.body : ""
    to = kind == "reply" ? (m.replyTo.isEmpty ? [m.from] : m.replyTo).joined(separator: ", ") : ""
  }
  private func addresses(_ s: String) -> [String] {
    s.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter {
      !$0.isEmpty
    }
  }
  private func reset() {
    compositionId = nil
    editing = nil
    connection = ""
    envelope = .empty(model.credential?.user.email ?? "")
    to = ""
    cc = ""
    bcc = ""
    reason = ""
  }
  private func perform(_ body: [String: Any]) {
    Task {
      await model.workspaceCommand(body, label: "Operazione email privata")
      await model.loadEmail()
    }
  }
  private func read(_ connection: String, _ request: [String: Any]) {
    perform(["type": "email.read", "connectionId": connection, "request": request])
  }
  private func control(_ type: String, _ a: EmailAction) {
    var b: [String: Any] = ["type": type, "actionId": a.id, "version": a.version]
    if type == "email.reject" { b["reason"] = "Rifiuto esplicito" }
    perform(b)
  }
}
