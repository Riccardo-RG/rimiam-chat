import SwiftUI

struct WorkspaceQuestionsView: View {
  @Bindable var model: WorkspaceModel
  @State private var content=""
  @State private var source=""
  var body: some View {
    List {
      Section("Nuova domanda") {
        TextField("Cosa resta da chiarire?",text:$content,axis:.vertical)
        Picker("Messaggio di origine",selection:$source) { Text("Scegli la fonte").tag("");ForEach(model.messages) { Text($0.content).tag($0.id) } }
        Button("Registra domanda") { Task { if await model.workspaceCommand(["type":"question.open","content":content,"sourceId":source],label:content) { content="" } } }.disabled(model.busy || content.isEmpty || source.isEmpty)
      }
      ForEach(model.detail?.questions ?? []) { question in QuestionRow(model:model,question:question) }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
    }.navigationTitle("Domande aperte")
  }
}
private struct QuestionRow: View {
  @Bindable var model: WorkspaceModel
  let question: WorkspaceDetail.Question
  @State private var answer=""
  @State private var reason=""
  var body: some View {
    DisclosureGroup(question.content) {
      Text("\(question.status == "answered" ? "Risposta registrata" : "Aperta") · v\(question.version)")
      Text(question.reason).font(.caption)
      if question.status == "open" {
        Picker("Informazione che risponde",selection:$answer) { Text("Scegli riferimento").tag("");ForEach(model.state?.information ?? []) { Text($0.content).tag($0.id) } }
      }
      TextField("Motivazione",text:$reason)
      Button(question.status == "open" ? "Collega la risposta" : "Riapri domanda") {
        Task {
          if question.status == "open", let info=model.state?.information.first(where:{$0.id==answer}) {
            await model.workspaceCommand(["type":"question.answer","questionId":question.id,"expectedVersion":question.version,"informationId":info.id,"informationVersion":info.version,"reason":reason],label:"Risposta alla domanda")
          } else if question.status == "answered" { await model.workspaceCommand(["type":"question.reopen","questionId":question.id,"expectedVersion":question.version,"reason":reason],label:"Riapertura domanda") }
        }
      }.disabled(model.busy || reason.isEmpty || (question.status == "open" && answer.isEmpty))
    }
  }
}
struct WorkspaceArtifactsView: View {
  @Bindable var model: WorkspaceModel
  @State private var title=""
  @State private var notes=""
  @State private var question=""
  @State private var selected: Set<String> = []
  var body: some View {
    List {
      Section {
        NavigationLink("Scrivi un nuovo Artifact") {ArtifactEditor(model:model)}
        DisclosureGroup("Prepara un documento dai riferimenti") {
          TextField("Titolo",text:$title)
          TextField("Istruzioni e note",text:$notes,axis:.vertical)
          Picker("Domanda a cui risponde",selection:$question) { Text("Scegli domanda").tag("");ForEach(model.detail?.questions ?? []) { Text($0.content).tag($0.id) } }
          Text("Riferimenti accettati da utilizzare").font(.caption)
          ForEach(model.state?.information ?? []) { info in Toggle(info.subject,isOn:Binding(get:{selected.contains(info.id)},set:{if $0 { selected.insert(info.id) } else { selected.remove(info.id) }})) }
          Button("Prepara la bozza") { draft() }.disabled(model.busy || title.isEmpty || question.isEmpty || selected.isEmpty)
          Text("La bozza non è adottata e non autorizza azioni esterne.").font(.caption)
        }
      }
      if let detail=model.detail {
        ForEach(detail.artifacts) { artifact in
          if let version=detail.artifactVersions.first(where:{$0.artifact_id==artifact.id && $0.version==artifact.current_draft_version}) {
            ArtifactRow(model:model,detail:detail,artifact:artifact,version:version)
          }
        }
      }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
    }.navigationTitle("Artifacts").textSelection(.enabled)
  }
  func draft() {
    guard let q=model.detail?.questions.first(where:{$0.id==question}) else { return }
    let information=(model.state?.information ?? []).filter{selected.contains($0.id)}.map{["id":$0.id,"version":$0.version] as [String:Any]}
    Task { if await model.workspaceCommand(["type":"artifact.draft","title":title,"notes":notes,"questionId":q.id,"questionVersion":q.version,"information":information,"sourceIds":[String]()],label:"Prepara " + title) { title=""; notes=""; selected=[] } }
  }
}
private struct ArtifactRow: View {
  @Bindable var model: WorkspaceModel
  let detail: WorkspaceDetail
  let artifact: WorkspaceDetail.Artifact
  let version: WorkspaceDetail.ArtifactVersion
  @State private var people: Set<String> = []
  var body: some View {
    DisclosureGroup(version.title) {
      Text("Bozza v\(version.version)" + (artifact.current_adoption_id == nil ? " · non adottata" : " · esiste una versione adottata"))
      ArtifactBody(model:model,version:version)
      NavigationLink("Modifica la bozza") {ArtifactEditor(model:model,existing:version)}
      if !version.outdated_reasons.isEmpty { Text("Potenzialmente superata: " + version.outdated_reasons.joined(separator:"; ")).foregroundStyle(.orange) }
      Text("\(detail.name(version.authored_by)) · \(version.created_at)").font(.caption)
      DisclosureGroup("Storia") { ForEach(detail.artifactVersions.filter{$0.artifact_id==artifact.id},id:\.version) { old in Text("v\(old.version) · \(old.reason)"); ArtifactBody(model:model,version:old) } }
      Text("Chi deve approvare questa versione?").font(.caption)
      ForEach(detail.members.filter(\.active)) { person in Toggle(person.name,isOn:Binding(get:{people.contains(person.id)},set:{if $0 { people.insert(person.id) } else { people.remove(person.id) }})) }
      Button("Proponi adozione non operativa") { Task { await model.workspaceCommand(["type":"artifact.review","artifactId":artifact.id,"version":version.version,"people":Array(people).sorted(),"nonOperative":true],label:"Revisione di " + version.title) } }.disabled(model.busy || people.isEmpty)
      ForEach(detail.artifactReviews.filter{$0.artifact_id==artifact.id && $0.artifact_version==version.version}) { review in
        Text("Approvazioni richieste: " + review.people.map(detail.name).joined(separator:", ")).font(.caption)
        if review.people.contains(model.credential?.user.id ?? "") && !detail.artifactApprovals.contains(where:{$0.review_id==review.id && $0.person_id==model.credential?.user.id}) {
          Button("Approvo questa versione per me") { Task { await model.workspaceCommand(["type":"artifact.approve","reviewId":review.id,"expectedAccessRevision":detail.workspace.access_revision,"representSelf":true,"nonOperative":true],label:"Approvazione personale dell’Artifact") } }.disabled(model.busy)
        }
      }
    }
  }
}
struct WorkspacePeopleView: View {
  @Bindable var model: WorkspaceModel
  @State private var email=""
  @State private var historyAccepted=false
  @State private var sendEmail=false
  @State private var linkedSpace=""
  @State private var leave=false
  @State private var relinquish=false
  @State private var removePerson:String?
  var body: some View {
    List {
      if let detail=model.detail {
        Section("Persone") { ForEach(detail.members) { person in Text(person.name + (person.active ? " · membro" : " · partecipazione terminata")); if person.active { Text(person.contributes ? "Può contribuire; questo non conferisce project authority." : "Partecipazione senza contribuzione").font(.caption) } } }
        if detail.access.contains(where:{$0.holder_id==model.credential?.user.id && $0.active && $0.remove_members}) {
          Section("Gestisci partecipazione"){ForEach(detail.members.filter{$0.active && $0.id != model.credential?.user.id}) {person in Button("Rimuovi accesso: " + person.name,role:.destructive){removePerson=person.id}}}
        }
        if detail.access.contains(where:{$0.holder_id==model.credential?.user.id && $0.active && $0.invitations}) {
          Section("Invita una persona") {
            TextField("Email",text:$email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
            Toggle("L’invito dichiara l’accesso alla storia condivisa conservata",isOn:$historyAccepted)
            Toggle("Invia anche un’email al destinatario",isOn:$sendEmail)
            Button("Crea invito") { Task { if await model.workspaceCommand(["type":"invitation.create","email":email,"fullHistoryDisclosed":true,"sendEmail":sendEmail],label:"Invito a " + email) { email="";historyAccepted=false } } }.disabled(model.busy || email.isEmpty || !historyAccepted)
            if let link=model.invitationLink { ShareLink("Condividi invito",item:link);Text(link).font(.caption).textSelection(.enabled) }
          }
          Section("Inviti") { ForEach(detail.invitations) { invite in Text(invite.recipient_email);Text(invitationDeliveryLabel(invite.delivery_status)).font(.caption);Text(invite.accepted_at != nil ? "Accettato" : invite.revoked_at != nil ? "Revocato" : "Scade: " + invite.expires_at).font(.caption);if invite.accepted_at == nil && invite.revoked_at == nil { Button("Revoca invito") { Task { await model.workspaceCommand(["type":"invitation.revoke","invitationId":invite.id],label:"Revoca invito") } }.disabled(model.busy) } } }
        }
        Section("Spazi collegati") {
          Text("Visibili solo a chi accede a entrambi. Nessun contenuto o permesso viene ereditato.").font(.caption)
          ForEach((detail.links ?? []).filter{$0.active}) {link in
            Button(link.name + " ↗"){model.select(link.id)}
            Button("Scollega"){Task{await model.workspaceCommand(["type":"workspace.link","otherWorkspaceId":link.id,"expectedVersion":link.version,"linked":false],label:"Scollega spazio")}}.disabled(model.busy)
            DisclosureGroup("Origine del collegamento"){ForEach(link.history,id:\.version){v in Text("v\(v.version) · \(v.active ? "Collegato" : "Scollegato") · \(detail.name(v.actor_id)) · \(v.created_at)").font(.caption)}}
          }
          Picker("Altro spazio a cui partecipi",selection:$linkedSpace){Text("Scegli uno spazio").tag("");ForEach(model.spaces.filter{space in space.id != model.selected && !(detail.links ?? []).contains(where:{link in link.id==space.id && link.active})}) {space in Text(space.name).tag(space.id)}}
          Button("Collega gli spazi"){Task{if await model.workspaceCommand(["type":"workspace.link","otherWorkspaceId":linkedSpace,"expectedVersion":detail.links?.first(where:{$0.id==linkedSpace})?.version ?? 0,"linked":true],label:"Collega spazi"){linkedSpace=""}}}.disabled(model.busy || linkedSpace.isEmpty)
        }
        Section {NavigationLink("Accordi e governance dell’accesso") {AccessGovernanceView(model:model)}}
        Section("La tua partecipazione") {
          Button("Rinuncia alla tua governance",role:.destructive) { relinquish=true }
          Button("Lascia il Workspace",role:.destructive) { leave=true }
          Text("Uscire o rinunciare non cancella storia e obblighi, né nomina automaticamente un successore.").font(.caption)
        }
      }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
    }.navigationTitle("Persone e accesso")
      .confirmationDialog("Rimuovere l’accesso? Storia e obblighi restano; le relazioni protette richiedono i loro accordi.",isPresented:Binding(get:{removePerson != nil},set:{if !$0 {removePerson=nil}})){Button("Rimuovi accesso",role:.destructive){if let person=removePerson,let detail=model.detail {Task{await model.workspaceCommand(["type":"member.remove","personId":person,"expectedAccessRevision":detail.workspace.access_revision,"confirmed":true],label:"Rimozione accesso")}};removePerson=nil}}

      .confirmationDialog("Lasciare il Workspace termina il tuo accesso. Storia e obblighi restano.",isPresented:$leave) { Button("Lascia",role:.destructive) { Task { await model.workspaceCommand(["type":"member.leave","confirmed":true],label:"Uscita volontaria") } } }
      .confirmationDialog("Rinunciare termina la tua partecipazione alla governance senza modificare quella degli altri.",isPresented:$relinquish) { Button("Rinuncia",role:.destructive) { Task { await model.workspaceCommand(["type":"access.relinquish","confirmed":true],label:"Rinuncia personale") } } }
  }
}

func invitationDeliveryLabel(_ status: String?) -> String {
 switch status {
 case "queued": return "Email in coda"
 case "needs_configuration": return "Invio email da configurare; puoi condividere il link"
 case "running": return "Invio email in corso"
 case "submitted": return "Email affidata al servizio di invio; recapito non ancora verificato"
 case "unknown": return "Esito email incerto; non creare un nuovo invio senza verifica"
 case "cancelled": return "Invio annullato: invito non più valido"
 case "expired": return "Invio scaduto"
 default: return "Solo link, nessuna email richiesta"
 }
}
