import SwiftUI

@main struct MiriamApp: App {
  @State private var model = WorkspaceModel()
  @Environment(\.scenePhase) private var scenePhase
  var body: some Scene {
    WindowGroup { VStack(spacing:0){CallStatusBanner(model:model);MiriamView(model:model)}.tint(Color(red:0.09,green:0.42,blue:0.38)).task { model.setForeground(true) }.task(id:model.mediaBoundary){await model.media.run(model)}.onChange(of:scenePhase) { _,phase in model.setForeground(phase == .active);if phase != .active {model.media.endDialog();model.media.note.discard();model.media.stopPlayback()} } }
  }
}
struct MiriamView: View {
  @Bindable var model: WorkspaceModel
  @Environment(\.openURL) private var openURL
  @State private var accountMode="login"
  @State private var accountName=""
  @State private var email=""
  @State private var password=""
  @State private var server={
    #if DEBUG
    "http://127.0.0.1:3002"
    #else
    ""
    #endif
  }()
  @State private var draft=""
  @State private var workspaceName=""
  @State private var home=true
  @State private var invitation=""
  @State private var admission=false
  @State private var spacesOpen=false
  @State private var toolsOpen=false
  @State private var discard: PendingCommand?
  var body: some View {
    NavigationStack {
      Group {
        if model.credential?.logoutPending == true {
          ContentUnavailableView { Label("Logout da completare",systemImage:"network") } description:{Text(model.error)} actions:{Button("Riprova revoca") { Task { await model.logout() } }}
        } else if model.credential == nil { login }
        else if home || model.selected == nil {
          appHome
        } else { conversation }
      }
      .navigationTitle(home ? "MIRIAM" : model.state?.workspace.name ?? "MIRIAM")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if model.credential != nil && model.credential?.logoutPending != true {
          ToolbarItem(placement:.topBarLeading) { Button { home=true } label:{Image(systemName:"square.stack")}.accessibilityLabel("Workspace").accessibilityIdentifier("home-open") }
          ToolbarItem(placement:.topBarTrailing) { Button { if home {spacesOpen=true} else {toolsOpen=true} } label:{Image(systemName:"sidebar.right")}.accessibilityLabel("Apri strumenti").accessibilityIdentifier("tools-open") }
        }
      }
      .sheet(isPresented:$spacesOpen) { NavigationStack { workspacePicker.navigationTitle("I tuoi Workspace").toolbar { Button("Chiudi") { spacesOpen=false } } } }
      .sheet(isPresented:$toolsOpen) { NavigationStack { tools.id((model.credential?.user.id ?? "") + ":" + (model.selected ?? "")).navigationTitle("Il Workspace").toolbar { Button("Chiudi") { toolsOpen=false } } } }
      .confirmationDialog("Rimuovere il promemoria non annulla un’operazione già ricevuta dal server.",isPresented:Binding(get:{discard != nil},set:{if !$0 {discard=nil}})) {
        Button("Rimuovi promemoria",role:.destructive) { if let discard { model.discardReminder(discard) };discard=nil }
      }
    }.onChange(of:model.credential?.user.id){_,_ in home=true;spacesOpen=false;toolsOpen=false;draft="";invitation="";admission=false}
     .onChange(of:model.selected){_,_ in toolsOpen=false;draft=""}
  }
  var appHome: some View {
    List {
      Section {
        Text("Cosa costruiamo oggi?").font(.largeTitle).fontWeight(.semibold)
        Text("Persone e Miriam, insieme. La conversazione diventa comprensione condivisa e lavoro che continua.").font(.body).foregroundStyle(.secondary)
      }
      Section("I tuoi Workspace") {
        ForEach(model.spaces) { space in
          Button {model.select(space.id);home=false} label:{VStack(alignment:.leading,spacing:6){Text(space.name).font(.headline);Text("Apri la conversazione →").font(.caption).foregroundStyle(.secondary)}}.padding(.vertical,8).accessibilityIdentifier("workspace-\(space.id)")
        }
        if model.spaces.isEmpty {Text("Il primo spazio può iniziare da una semplice idea.")}
        TextField("Nome del nuovo Workspace",text:$workspaceName)
        Button("Crea Workspace") {let name=workspaceName;Task{if await model.create(name){if workspaceName==name {workspaceName=""};home=false}}}.disabled(model.busy || workspaceName.isEmpty)
      }
      Section {DisclosureGroup("Hai ricevuto un invito?") {
        TextField("Link o codice d’invito",text:$invitation).textInputAutocapitalization(.never).autocorrectionDisabled()
        Text("L’ammissione permette di leggere la storia condivisa conservata. Non implica adesione al Goal o authority.").font(.caption)
        Toggle("Accetto questa conseguenza dell’ammissione",isOn:$admission)
        Button("Accetta invito") {Task{if await model.acceptInvitation(invitation) {invitation="";admission=false}}}.disabled(model.busy || invitation.isEmpty || !admission)
      }}
      Section {Text(model.credential?.user.email ?? "").font(.caption);Button("Esci") {Task{await model.logout()}}.accessibilityIdentifier("logout")}
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.listStyle(.insetGrouped)
  }
  var login: some View {
    Form {
      Section { Text("Un luogo per capire, ricordare e costruire insieme.").font(.title3) }
      Section {
        Picker("Accesso",selection:$accountMode) {Text("Accedi").tag("login");Text("Registrati").tag("register");Text("Recupera").tag("request-password-reset")}.pickerStyle(.segmented)
        if accountMode=="register" {TextField("Nome",text:$accountName)}
        TextField("Email",text:$email).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress).accessibilityIdentifier("email")
        if accountMode != "request-password-reset" {SecureField("Password",text:$password).accessibilityIdentifier("password")}
        Button(accountMode=="login" ? "Accedi" : accountMode=="register" ? "Crea account" : "Richiedi recupero") {
          let secret=password;password="";Task {if accountMode=="login" {await model.login(base:server,email:email,password:secret)} else {await model.requestAccount(base:server,action:accountMode,email:email,name:accountName,password:secret)}}
        }.disabled(model.busy || email.isEmpty || (accountMode != "request-password-reset" && password.isEmpty) || (accountMode=="register" && (password.count<12 || accountName.isEmpty))).accessibilityIdentifier("login")
        if accountMode=="register" {Text("Usa almeno 12 caratteri per la password.").font(.caption)}
        if accountMode=="login" {Button("Richiedi nuova verifica email") {Task{await model.requestAccount(base:server,action:"send-verification",email:email)}}.disabled(model.busy || email.isEmpty)}
        if !model.accountNotice.isEmpty {Text(model.accountNotice).font(.caption)}
        if let url=webURL(server) { Link("Crea account, verifica email o recupera password",destination:url) }
        Text("L’accesso al tuo account non crea adesioni al Goal o authority.").font(.caption)
      }
      Section("Connessione") { TextField("Server HTTPS",text:$server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).accessibilityIdentifier("server") }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
    }
  }
  var conversation: some View {
    ScrollViewReader { proxy in
      List {
        Section {
          if let goal=model.state?.goals.first(where:\.currentPrimary) { NavigationLink { WorkspaceContextView(model:model) } label:{VStack(alignment:.leading){Text("IL NOSTRO GOAL").font(.caption2).foregroundStyle(.secondary);Text(goal.content).font(.headline)}} }
          else { NavigationLink("Dove volete arrivare?") { WorkspaceContextView(model:model) } }
          if let item=model.attention?.attention.first {NavigationLink {WorkspaceAttentionView(model:model)} label:{VStack(alignment:.leading){Text("ADESSO").font(.caption2).foregroundStyle(.secondary);Text(item.text).font(.subheadline)}}}
          HStack { Text(model.connection).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("connection"); Spacer(); if model.busy { ProgressView() } }
          if !model.error.isEmpty { Text(model.error).font(.caption).foregroundStyle(.red) }
          if let reads = model.detail?.interpretations {
            if reads.contains(where: { ["queued", "running"].contains($0.status) }) {
              Text("Miriam sta leggendo il contesto pertinente…").font(.caption).foregroundStyle(.secondary)
            } else if reads.contains(where: { ["failed", "stale"].contains($0.status) }) {
              NavigationLink("Una lettura di Miriam richiede attenzione") { WorkspaceContextView(model: model) }
            }
          }
        }
        if let work=model.activeWork, !work.works.isEmpty {
          Section { MiriamActiveWorkView(model:model).id((model.credential?.user.id ?? "") + ":" + (model.selected ?? "")) }
        }
        Section {WorkspaceCallView(model:model);ConversationVoiceView(model:model)}
        Section("Conversazione") {
          if model.hasOlder { Button("Carica messaggi precedenti") { Task { await model.loadOlder() } } }
          if model.messages.isEmpty { Text("Raccontate cosa avete in mente. Miriam seguirà il filo del progetto.").foregroundStyle(.secondary) }
          ForEach(model.messages) { message in
            VStack(alignment:.leading,spacing:6) {
              Text(message.actorKind == "miriam" ? "Miriam · AI" : message.authorName + " · persona").font(.caption).fontWeight(.semibold).foregroundStyle(message.actorKind == "miriam" ? .teal : .secondary)
              Text(message.content).textSelection(.enabled)
              VoiceMessageView(model:model,messageID:message.id)
              if message.actorKind == "miriam" {SpokenReplyButton(id:message.id,text:message.content)}
              if let citations=message.citationSourceIds,!citations.isEmpty {DisclosureGroup("Fonti"){ForEach(citations,id:\.self){SourceReferenceView(model:model,sourceId:$0)}}}
            }.padding(.vertical,4).id(message.id)
          }
          Color.clear.frame(height:1).id("latest")
        }
        if !model.pending.isEmpty {
          Section("Operazioni da verificare") {
            Text("Un esito incerto non significa che l’operazione sia fallita.").font(.caption)
            ForEach(model.pending) { command in
              Text(command.content)
              Button("Riprova la stessa operazione") { Task { await model.retry(command) } }.disabled(model.busy)
              Button("Rimuovi promemoria locale",role:.destructive) { discard=command }
            }
          }
        }
      }.listStyle(.plain).refreshable { model.setForeground(true) }
        .safeAreaInset(edge:.bottom) {
          HStack(alignment:.bottom,spacing:12) {
            TextField("Scrivi al gruppo e a Miriam",text:$draft,axis:.vertical).lineLimit(1...5).padding(10).background(.quaternary,in:RoundedRectangle(cornerRadius:14)).accessibilityIdentifier("message")
            Button("Miriam") {let content=draft;Task{if await model.send("@Miriam " + content){if draft==content {draft=""};proxy.scrollTo("latest",anchor:.bottom)}}}.accessibilityLabel("Chiedi a Miriam").disabled(model.busy || draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
            Button { let content=draft;Task { if await model.send(content) { if draft == content { draft="" };proxy.scrollTo("latest",anchor:.bottom) } } } label:{Image(systemName:"arrow.up.circle.fill").font(.largeTitle)}.accessibilityLabel("Invia").accessibilityIdentifier("send").disabled(model.busy || draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
          }.padding().background(.regularMaterial)
        }
    }
  }
  var workspacePicker: some View {
    List {
      Section { ForEach(model.spaces) { space in Button {model.select(space.id);spacesOpen=false;home=false} label:{HStack{Text(space.name);if model.selected==space.id {Image(systemName:"checkmark")}}} } }
      Section("Nuovo Workspace") { TextField("Nome",text:$workspaceName);Button("Crea") {let name=workspaceName;Task {if await model.create(name) {if workspaceName==name {workspaceName=""};spacesOpen=false;home=false}}}.disabled(model.busy || workspaceName.isEmpty) }
      Section { Text(model.credential?.user.email ?? "").font(.caption);Button("Esci") {Task {await model.logout();spacesOpen=false}}.accessibilityIdentifier("logout") }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }
  }
  var tools: some View {
    List {
      Section("Comprendere e costruire") {
        NavigationLink("Adesso e cosa è cambiato") {WorkspaceAttentionView(model:model)}
        NavigationLink("Context e Goal") {WorkspaceContextView(model:model)}.accessibilityIdentifier("context-open")
        NavigationLink("Domande aperte") {WorkspaceQuestionsView(model:model)}
        NavigationLink("Artifacts") {WorkspaceArtifactsView(model:model)}
        NavigationLink("Fonti e ricerca") {WorkspaceSourcesView(model:model)}
      }
      Section("Organizzare il lavoro") {
        NavigationLink("Lavoro e follow-up") {MiriamTasksView(model:model).id(model.selected)}.accessibilityIdentifier("tasks-open")
        NavigationLink("Calendario") {MiriamCalendarView(model:model)}.accessibilityIdentifier("calendar-open")
        NavigationLink("Workspace Email") {MiriamEmailView(model:model).id(model.selected)}.accessibilityIdentifier("email-open")
      }
      Section("Persone e collegamenti") {
        NavigationLink("Persone e accesso") {WorkspacePeopleView(model:model)}
        Button("Collega Google Calendar") {Task {if let url=await model.connectGoogle("calendar") {openURL(url)}}}
        Button("Collega Gmail") {Task {if let url=await model.connectGoogle("email") {openURL(url)}}}
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }
  }
  func webURL(_ base:String) -> URL? {
    guard var url=URLComponents(string:base), ["https","http"].contains(url.scheme ?? ""), url.user==nil,url.password==nil else {return nil}
    if ["localhost","127.0.0.1"].contains(url.host ?? "") && url.port==3002 {url.port=3000}
    return url.url
  }
}
