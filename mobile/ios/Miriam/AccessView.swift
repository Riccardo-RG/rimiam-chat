import SwiftUI
struct AccessSnapshot: Decodable {
  struct Person: Decodable, Identifiable {let id:String;let name:String;let active:Bool}
  struct Condition: Decodable {let participationId:String;let holderId:String;let available:Bool}
  struct Relationship: Decodable, Identifiable {let id:String;let holderId:String;let holderName:String;let version:Int;let active:Bool;let available:Bool;let kind:String;let invitations:Bool;let removeMembers:Bool;let changeAccess:Bool;let protected:Bool;let basis:String;let conditions:[Condition]}
  struct Required: Decodable {let role:String;let personId:String}
  struct Approval: Decodable {let role:String;let personId:String;let createdAt:String}
  struct Proposal: Decodable, Identifiable {let id:String;let kind:String;let reason:String;let proposedBy:String;let baseAccessRevision:Int;let termsVersion:Int;let terms:[String];let status:String;let required:[Required];let approvals:[Approval]}
  let accessRevision:Int;let members:[Person];let relationships:[Relationship];let proposals:[Proposal];let next:String?
}
struct AccessGovernanceView: View {
  @Bindable var model:WorkspaceModel
  @State private var snapshot:AccessSnapshot?
  @State private var people:Set<String>=[]
  @State private var kind="stewardship"
  @State private var reason=""
  @State private var history=""
  var body:some View {
    List {
      Text("Amministrare l’accesso non conferisce authority sulle decisioni del progetto.").font(.callout)
      if let state=snapshot {
        Section("Relazioni attuali") {ForEach(state.relationships) {relation in
          DisclosureGroup(relation.holderName + (relation.active ? "" : " · terminata")) {
            Text(relation.kind == "stewardship" ? "Governance dell’accesso" : "Delega per gli inviti")
            Text("v\(relation.version) · \(relation.available ? "esercitabile" : "non esercitabile")").font(.caption)
            Text(relation.protected ? "Relazione protetta: le condizioni richieste restano vincolanti." : "Relazione revocabile alle condizioni indicate.").font(.caption)
            ForEach(relation.conditions,id:\.participationId) {condition in Text((state.members.first{$0.id==condition.holderId}?.name ?? "Partecipante") + (condition.available ? " · condizione disponibile" : " · condizione non disponibile"))}
            Button("Storia della relazione") {Task{history=await model.workspaceRead("access-history?id=\(relation.id)")}}
            if relation.active {Button("Proponi revoca") {propose(["kind":"revoke","relationshipId":relation.id])}.disabled(model.busy || reason.isEmpty)}
          }
        }}
        Section("Nuovo accordo") {
          Picker("Operazione",selection:$kind) {Text("Governance protetta").tag("stewardship");Text("Delega inviti").tag("delegation")}
          ForEach(state.members.filter(\.active)) {person in Toggle(person.name,isOn:Binding(get:{people.contains(person.id)},set:{if $0 {people.insert(person.id)} else {people.remove(person.id)}}))}
          TextField("Motivazione (anche per le revoche)",text:$reason,axis:.vertical)
          Button("Prepara accordo da approvare") {if kind=="stewardship" {propose(["kind":kind,"people":Array(people).sorted()])} else if let person=people.first {propose(["kind":kind,"personId":person])}}.disabled(model.busy || reason.isEmpty || people.isEmpty || (kind=="delegation" && people.count != 1))
        }
        Section("Accordi proposti") {ForEach(state.proposals) {proposal in
          DisclosureGroup(proposal.reason) {
            Text(proposal.status == "pending" ? "In attesa degli atti richiesti" : proposal.status == "adopted" ? "Accordo adottato" : "Proposta superata")
            ForEach(Array(proposal.terms.enumerated()),id:\.offset) {_,term in Text(term)}
            Text("Termini v\(proposal.termsVersion)").font(.caption)
            ForEach(Array(proposal.required.enumerated()),id:\.offset) {_,required in
              Text((state.members.first{$0.id==required.personId}?.name ?? "Partecipante") + " · " + (required.role=="holder" ? "accettazione personale" : "autorizzazione della modifica")).font(.caption)
              if proposal.status=="pending" && required.personId==model.credential?.user.id && !proposal.approvals.contains(where:{$0.personId==required.personId && $0.role==required.role}) {
                Button(required.role=="holder" ? "Accetto questi termini per la mia partecipazione" : "Autorizzo questa modifica ai termini indicati") {Task{await model.workspaceCommand(["type":"access.approve","proposalId":proposal.id,"expectedAccessRevision":state.accessRevision,"role":required.role,"acceptTerms":true],label:"Atto esplicito sui termini di accesso");await refresh()}}.disabled(model.busy)
              }
            }
          }
        }}
      }
      if !history.isEmpty {DisclosureGroup("Storia attribuita") {Text(readableAccessHistory(history)).font(.caption).textSelection(.enabled)}}
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.navigationTitle("Governance accesso").task {await refresh()}.refreshable{await refresh()}
  }
  func refresh() async {let raw=await model.workspaceRead("access");snapshot=try? JSONDecoder().decode(AccessSnapshot.self,from:Data(raw.utf8))}
  func propose(_ change:[String:Any]) {guard let state=snapshot else{return};Task{await model.workspaceCommand(["type":"access.propose","expectedAccessRevision":state.accessRevision,"change":change,"reason":reason],label:"Proposta: " + reason);await refresh()}}
  func readableAccessHistory(_ raw:String)->String {guard let value=(try? JSONSerialization.jsonObject(with:Data(raw.utf8))) as? [String:Any],let rows=value["versions"] as? [[String:Any]] else{return "Storia non disponibile"};return rows.map {"v\($0["version"] ?? "") · \($0["createdAt"] ?? "")\nAtto di \(model.detail?.name($0["actor"] as? String ?? "") ?? "partecipante") · \($0["basis"] ?? "")\nAttiva: \($0["active"] ?? "") · protetta: \($0["protected"] ?? "")"}.joined(separator:"\n\n")}
}
