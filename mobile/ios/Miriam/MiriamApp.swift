import SwiftUI

@main struct MiriamApp: App {
  @State private var model = WorkspaceModel()
  @Environment(\.scenePhase) private var scenePhase
  var body: some Scene {
    WindowGroup { VStack(spacing:0){CallStatusBanner(model:model);MiriamView(model:model)}.tint(RIMIAMStyle.accent).background(RIMIAMStyle.page).task { model.setForeground(true) }.task(id:model.mediaBoundary){await model.media.run(model)}.onChange(of:scenePhase) { _,phase in model.setForeground(phase == .active);if phase != .active {model.media.endDialog();model.media.note.stop();model.media.stopPlayback()} } }
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
  @State private var conversationNavigation=UUID()
  @State private var workspaceName=""
  @State private var workspaceDescription=""
  @State private var home=true
  @State private var invitation=""
  @State private var admission=false
  @State private var spacesOpen=false
  @State private var toolsOpen=false
  @State private var activityOpen=false
  @State private var mediaOpen=false
  @State private var focusOpen=false
  @State private var draftFocus:WorkstreamFocus?
  @State private var draftHasAnchor=false
  @State private var lensPaths:[String:[RIMIAMLensRoute]]=[:]
  @State private var invitationPromptWorkspace:String?
  @FocusState private var messageFocused:Bool
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
      .navigationTitle(home ? "RIMIAM" : model.state?.workspace.name ?? "RIMIAM")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if model.credential != nil && model.credential?.logoutPending != true {
          ToolbarItem(placement:.topBarLeading) { Button { home=true;messageFocused=false;conversationNavigation=UUID() } label:{Image(systemName:home ? "square.stack" : "arrow.left")}.frame(minWidth:44,minHeight:44).accessibilityLabel("I tuoi spazi").accessibilityIdentifier("home-open") }
          ToolbarItem(placement:.topBarTrailing) {
            Button {messageFocused=false;if home {spacesOpen=true} else {toolsOpen=true}} label:{Label(home ? "Spazi" : "Lo spazio",systemImage:"square.stack.3d.up")}
              .font(.subheadline.weight(.semibold)).frame(minHeight:44).accessibilityIdentifier("tools-open")
          }
        }
      }
      .sheet(isPresented:$spacesOpen) {workspaceSheet}
      .sheet(isPresented:$toolsOpen) {lensSheet}
      .sheet(isPresented:$activityOpen) {activitySheet}
      .sheet(isPresented:$mediaOpen) {voiceSheet}
      .sheet(isPresented:$focusOpen) {NavigationStack {focusPicker}.presentationDetents([.medium,.large]).presentationDragIndicator(.visible)}
      .confirmationDialog("Rimuovere il promemoria non annulla un’operazione già ricevuta dal server.",isPresented:Binding(get:{discard != nil && !spacesOpen},set:{if !$0 {discard=nil}})) {
        Button("Rimuovi promemoria",role:.destructive) { if let discard { model.discardReminder(discard) };discard=nil }
      }
    }.id(conversationNavigation).onChange(of:workspaceDraftScope){_,_ in conversationNavigation=UUID();home=true;spacesOpen=false;toolsOpen=false;activityOpen=false;mediaOpen=false;focusOpen=false;lensPaths=[:];invitationPromptWorkspace=nil;draft="";workspaceName="";workspaceDescription="";invitation="";admission=false;discard=nil}
     .onChange(of:model.sessionGeneration){_,_ in conversationNavigation=UUID();lensPaths=[:];toolsOpen=false;activityOpen=false;mediaOpen=false}
     .onChange(of:model.selected){_,_ in conversationNavigation=UUID();toolsOpen=false;activityOpen=false;mediaOpen=false;draft="";messageFocused=false}
     .onChange(of:model.workstreamFocus){_,_ in conversationNavigation=UUID();toolsOpen=false;focusOpen=false}
     .onChange(of:draft){_,value in
       if value.isEmpty {draftHasAnchor=false;draftFocus=nil}
     }
     .onChange(of:model.confirmedCreation?.id){_,_ in
       if let command=model.confirmedCreation {
         let body=command.commandJSON.flatMap {try? JSONSerialization.jsonObject(with:Data($0.utf8)) as? [String:String]}
         clearWorkspaceDraft(name:body?["name"] ?? command.content,description:body?["description"] ?? "")
       }
     }
  }
  private var workspaceSheet:some View {
    NavigationStack {workspacePicker.navigationTitle("I tuoi spazi").navigationBarTitleDisplayMode(.inline).toolbar {
      ToolbarItem(placement:.cancellationAction){Button("Esci"){Task{await model.logout();spacesOpen=false}}.accessibilityIdentifier("logout")}
      ToolbarItem(placement:.confirmationAction){Button("Chiudi"){spacesOpen=false}}
    }}
      .presentationDragIndicator(.visible)
  }
  private var lensSheet:some View {
    NavigationStack(path:lensPath) {
      tools.navigationTitle("Lo spazio").navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for:RIMIAMLensRoute.self){lensDestination($0)}
        .toolbar {ToolbarItem(placement:.confirmationAction){Button("Chiudi"){toolsOpen=false}}}
    }.id(workspaceNavigationScope).presentationDetents([.large]).presentationDragIndicator(.visible)
      .task {try? await model.sync();await model.loadAttention();await model.loadActiveWork()}
  }
  private var activitySheet:some View {
    NavigationStack {WorkspaceAttentionView(model:model,onAsk:prepareReferenceQuestion).toolbar {ToolbarItem(placement:.confirmationAction){Button("Chiudi"){activityOpen=false}}}}
      .presentationDetents([.large]).presentationDragIndicator(.visible)
  }
  private var voiceSheet:some View {
    NavigationStack {
      List {Section {ConversationVoiceView(model:model)};Section {WorkspaceCallView(model:model)}}
        .rimiamList().navigationTitle("Voce e chiamate").navigationBarTitleDisplayMode(.inline)
        .toolbar {ToolbarItem(placement:.confirmationAction){Button("Chiudi"){mediaOpen=false}.disabled(model.media.note.recording || model.media.dialog)}}
    }.presentationDetents([.large]).presentationDragIndicator(.visible)
      .interactiveDismissDisabled(model.media.note.recording || model.media.dialog)
  }
  var appHome: some View {
    List {
      Section {
        VStack(alignment:.leading,spacing:18) {
          HStack(spacing:16) {
            RIMIAMBrandMark()
            Text("IL TUO SPAZIO, INSIEME").font(.system(.caption,design:.monospaced).weight(.bold)).tracking(1.5).foregroundStyle(RIMIAMStyle.muted)
          }
          Text("Il prossimo passo,\ninsieme.").font(.system(.largeTitle,design:.serif).weight(.bold)).foregroundStyle(RIMIAMStyle.ink).fixedSize(horizontal:false,vertical:true)
          RIMIAMRule(strong:true)
          Text("Riprendi una conversazione. Dai spazio a qualcosa di nuovo.").font(.body).foregroundStyle(RIMIAMStyle.muted)
        }.padding(.vertical,12).listRowBackground(RIMIAMStyle.page).listRowInsets(EdgeInsets(top:8,leading:0,bottom:8,trailing:0))
      }
      Section("I tuoi spazi · \(model.spaces.count)") {
        ForEach(model.spaces) { space in
          Button {model.select(space.id);home=false} label:{RIMIAMNavigationLabel(title:space.name,subtitle:"Riprendi la conversazione",symbol:"arrow.up.right")}.accessibilityIdentifier("workspace-\(space.id)")
        }
        if model.spaces.isEmpty {Text("Il primo spazio può iniziare da una semplice idea.").padding(.vertical,12)}
      }.listRowBackground(RIMIAMStyle.surface)
      Section("Qualcosa di nuovo") {DisclosureGroup("Crea uno spazio") {workspaceCreationFields}}.listRowBackground(RIMIAMStyle.surface)
      pendingCommands
      Section {DisclosureGroup("Hai ricevuto un invito?") {
        TextField("Link o codice d’invito",text:$invitation).textInputAutocapitalization(.never).autocorrectionDisabled()
        Text("L’ammissione permette di leggere la storia condivisa conservata. Non implica adesione al Goal o authority.").font(.caption)
        Toggle("Accetto questa conseguenza dell’ammissione",isOn:$admission)
        Button("Accetta invito") {Task{if await model.acceptInvitation(invitation) {invitation="";admission=false}}}.disabled(model.busy || invitation.isEmpty || !admission)
      }}.listRowBackground(RIMIAMStyle.surface)
      Section {Text(model.credential?.user.email ?? "").font(.caption).foregroundStyle(RIMIAMStyle.muted);Button("Esci") {Task{await model.logout()}}.accessibilityIdentifier("logout")}.listRowBackground(RIMIAMStyle.surface)
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.rimiamList()
  }
  var login: some View {
    Form {
      Section {
        HStack(alignment:.top,spacing:16) {
          RIMIAMBrandMark()
          Text("Un luogo per capire, ricordare e costruire insieme.").font(.title3).foregroundStyle(RIMIAMStyle.ink).fixedSize(horizontal:false,vertical:true)
        }.padding(.vertical,8).listRowBackground(RIMIAMStyle.page)
      }
      Section {
        Picker("Accesso",selection:$accountMode) {Text("Accedi").tag("login");Text("Registrati").tag("register");Text("Recupera").tag("request-password-reset")}.pickerStyle(.segmented)
        if accountMode=="register" {TextField("Nome",text:$accountName)}
        TextField("Email",text:$email).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress).accessibilityIdentifier("email")
        if accountMode != "request-password-reset" {SecureField("Password",text:$password).accessibilityIdentifier("password")}
        Button(accountMode=="login" ? "Accedi" : accountMode=="register" ? "Crea account" : "Richiedi recupero") {
          let secret=password;password="";Task {if accountMode=="login" {await model.login(base:server,email:email,password:secret)} else {await model.requestAccount(base:server,action:accountMode,email:email,name:accountName,password:secret)}}
        }.buttonStyle(RIMIAMPrimaryButtonStyle()).disabled(model.busy || email.isEmpty || (accountMode != "request-password-reset" && password.isEmpty) || (accountMode=="register" && (password.count<12 || accountName.isEmpty))).accessibilityIdentifier("login")
        if accountMode=="register" {Text("Usa almeno 12 caratteri per la password.").font(.caption)}
        if accountMode=="login" {Button("Richiedi nuova verifica email") {Task{await model.requestAccount(base:server,action:"send-verification",email:email)}}.disabled(model.busy || email.isEmpty)}
        if !model.accountNotice.isEmpty {Text(model.accountNotice).font(.caption)}
        if let url=webURL(server) { Link("Crea account, verifica email o recupera password",destination:url) }
        Text("L’accesso al tuo account non crea adesioni al Goal o authority.").font(.caption)
      }
      .listRowBackground(RIMIAMStyle.surface)
      Section("Connessione") { TextField("Server HTTPS",text:$server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).accessibilityIdentifier("server") }.listRowBackground(RIMIAMStyle.surface)
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
    }.rimiamList()
  }
  var conversation: some View {
    ScrollViewReader { proxy in
      List {
        Section {
          VStack(alignment:.leading,spacing:12) {
            HStack {
              Text("CONVERSAZIONE").font(.system(.caption,design:.monospaced).weight(.bold)).tracking(1.3)
              Spacer()
              if model.busy {ProgressView().controlSize(.small)}
              Text(model.connection).font(.caption2).foregroundStyle(.secondary).accessibilityIdentifier("connection")
            }
            if let goal=model.state?.goals.first(where:\.currentPrimary) {
              Button {openLens(.goal)} label:{HStack(alignment:.top){Text("Goal").font(.caption.weight(.bold));Text(goal.content).font(.subheadline).lineLimit(2);Spacer(minLength:0);Image(systemName:"arrow.up.right").font(.caption)}}.buttonStyle(.plain)
            }
            Button {messageFocused=false;focusOpen=true} label:{HStack {
              Label(model.focusedTitle ?? (model.workstreamFocus == nil ? "Tutta la conversazione" : "Filone selezionato"),systemImage:"line.3.horizontal.decrease").font(.subheadline.weight(.semibold))
              Spacer();if let focus=model.workstreamFocus {Text("v\(focus.version)").font(.caption.monospacedDigit())};Image(systemName:"chevron.down").font(.caption)
            }}.frame(minHeight:44).accessibilityIdentifier("workstream-focus")
            if model.focusIsStale {Text(model.focusIsReadOnly ? "Filone concluso: puoi leggere la storia. Riaprilo o scegli un filone attivo per nuovi messaggi." : "Il filone è cambiato. La selezione precedente resta visibile; scegli di nuovo un filone attivo prima di inviare.").font(.caption).foregroundStyle(.red)}
            RIMIAMRule(strong:true)
          }.padding(.vertical,4)
        }.listRowSeparator(.hidden)
        Section {activityPreview}.listRowSeparator(.hidden)
        if invitationPromptWorkspace == model.selected {
          Section {
            VStack(alignment:.leading,spacing:8) {
              Text("Lo spazio è pronto.").font(.system(.title3,design:.serif).weight(.bold))
              Text("Puoi iniziare qui e invitare altre persone quando vuoi.").font(.subheadline).foregroundStyle(.secondary)
              HStack {Button("Invita una persona"){invitationPromptWorkspace=nil;openLens(.people)};Spacer();Button("Più tardi"){invitationPromptWorkspace=nil}.foregroundStyle(.secondary)}.font(.subheadline.weight(.semibold)).frame(minHeight:44).buttonStyle(.borderless)
            }.padding(.vertical,8)
          }
        }
        if !model.error.isEmpty {Section {Text(model.error).font(.subheadline).foregroundStyle(.red)}}
        if let reads=model.detail?.interpretations,reads.contains(where:{["failed","stale"].contains($0.status)}) {
          Section {Button {openLens(.context)} label:{Label("Una lettura richiede attenzione",systemImage:"exclamationmark.circle")}}
        }
        Section {
          if model.hasOlder {Button("Carica messaggi precedenti"){Task {await model.loadOlder()}}.frame(maxWidth:.infinity,minHeight:44)}
          if model.messages.isEmpty {
            if !model.conversationLoaded {ProgressView("Caricamento della conversazione…")}
            else if model.workstreamFocus != nil {Text("Nessun messaggio collegato a questo filone nella vista corrente.").foregroundStyle(.secondary)}
            else {VStack(alignment:.leading,spacing:12) {
              Text("Cominciamo da qui.").font(.system(.title,design:.serif).weight(.bold))
              Text("Raccontate cosa avete in mente. Miriam seguirà il filo della conversazione.").foregroundStyle(.secondary)
            }.padding(.vertical,24)}
          }
          ForEach(model.messages) {message in
            conversationMessage(message).id(message.id).listRowSeparator(.hidden)
          }
          Color.clear.frame(height:1).id("latest").listRowSeparator(.hidden)
        }
        pendingCommands
      }.listStyle(.plain).scrollContentBackground(.hidden).background(RIMIAMStyle.page)
        .listRowBackground(RIMIAMStyle.page).scrollDismissesKeyboard(.interactively)
        .refreshable {model.setForeground(true)}
        .safeAreaInset(edge:.bottom,spacing:0) {conversationComposer(proxy)}
    }
  }
  private func conversationComposer(_ proxy:ScrollViewProxy) -> some View {
          VStack(spacing:0) {
            RIMIAMRule(strong:true)
            VStack(spacing:8) {
              if let selection=model.composerReference {composerReference(selection)}
              if let status=voiceStatus {
                Button {messageFocused=false;mediaOpen=true} label:{Label(status,systemImage:"waveform").font(.caption.weight(.semibold)).frame(maxWidth:.infinity,alignment:.leading)}.frame(minHeight:32)
              }
              if draftNeedsFocusSelection {
                VStack(alignment:.leading,spacing:6) {
                  Text("Questa bozza appartiene alla selezione precedente.").font(.caption.weight(.semibold))
                  Button("Usa questa bozza nella selezione attuale"){draftFocus=model.workstreamFocus;draftHasAnchor=true}.font(.caption).disabled(model.focusIsStale).frame(minHeight:32)
                }.frame(maxWidth:.infinity,alignment:.leading)
              }
              TextField("Continuiamo da qui…",text:draftBinding,axis:.vertical).lineLimit(1...6)
                .font(.body).padding(12).focused($messageFocused)
                .background(RIMIAMStyle.surface,in:RoundedRectangle(cornerRadius:10))
                .overlay(RoundedRectangle(cornerRadius:10).stroke(RIMIAMStyle.line,lineWidth:1.5))
                .accessibilityLabel("Messaggio nella conversazione condivisa").accessibilityIdentifier("message")
              HStack(spacing:12) {
                Button {messageFocused=false;mediaOpen=true} label:{Label("Voce",systemImage:"waveform")}
                  .font(.subheadline.weight(.semibold)).frame(minWidth:44,minHeight:44).accessibilityIdentifier("voice-open")
                Spacer()
                Button {sendDraft(toMiriam:true,proxy:proxy)} label:{Label("Miriam",systemImage:"sparkle")}
                  .font(.subheadline.weight(.semibold)).tint(RIMIAMStyle.secondary).frame(minHeight:44).disabled(cannotSend).accessibilityLabel("Chiedi a Miriam")
                Button {sendDraft(toMiriam:false,proxy:proxy)} label:{Image(systemName:"arrow.up").font(.headline).frame(width:44,height:44).background(RIMIAMStyle.accent,in:RoundedRectangle(cornerRadius:10)).foregroundStyle(RIMIAMStyle.onAccent)}
                  .disabled(cannotSend).opacity(cannotSend ? 0.4 : 1).accessibilityLabel("Invia messaggio").accessibilityIdentifier("send")
              }
            }.padding(.horizontal,16).padding(.top,12).padding(.bottom,6)
          }.background(RIMIAMStyle.page)
  }
  private var voiceStatus:String? {
    if model.media.note.recording {return "Registrazione in corso · apri i controlli"}
    if model.media.dialog {return "Dialogo vocale attivo · apri i controlli"}
    if model.media.pendingVoice != nil {return "Invio vocale da verificare"}
    if !model.media.error.isEmpty || !model.media.note.error.isEmpty {return "La voce richiede attenzione"}
    return nil
  }
  private var draftNeedsFocusSelection:Bool {!draft.isEmpty && draftHasAnchor && draftFocus != model.workstreamFocus}
  private var draftBinding:Binding<String> {
    Binding(get:{draft},set:{value in
      if !value.isEmpty && !draftHasAnchor {draftFocus=model.workstreamFocus;draftHasAnchor=true}
      if value.isEmpty {draftFocus=nil;draftHasAnchor=false}
      draft=value
    })
  }
  private var cannotSend:Bool {model.busy || model.focusIsStale || draftNeedsFocusSelection || draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}
  private func composerReference(_ selection:ComposerReference)->some View {
    HStack(alignment:.top,spacing:10) {
      NavigationLink {WorkspaceReferenceView(model:model,reference:selection.reference,onAsk:prepareReferenceQuestion)} label:{
        VStack(alignment:.leading,spacing:4) {
          Label("Su questo passaggio",systemImage:"quote.bubble").font(.caption.weight(.semibold))
          Text(selection.title).font(.subheadline).lineLimit(2)
          Text(selection.reference.kind.label + " · " + selection.reference.versionLabel).font(.caption2).foregroundStyle(.secondary)
        }.frame(maxWidth:.infinity,alignment:.leading)
      }.buttonStyle(.plain)
      Button {model.selectConversationReference(nil)} label:{Image(systemName:"xmark.circle.fill").frame(width:44,height:44)}.accessibilityLabel("Rimuovi riferimento dalla bozza")
    }.padding(10).background(RIMIAMStyle.surface,in:RoundedRectangle(cornerRadius:10))
      .overlay(RoundedRectangle(cornerRadius:10).stroke(RIMIAMStyle.line,lineWidth:1))
  }
  private func prepareReferenceQuestion(_ reference:ConversationReference,_ title:String) {
    model.selectConversationReference(ComposerReference(reference:reference,title:title))
    if draft.isEmpty {draftBinding.wrappedValue="@Miriam "}
    conversationNavigation=UUID()
    home=false;toolsOpen=false;activityOpen=false;messageFocused=true
  }
  private func sendDraft(toMiriam:Bool,proxy:ScrollViewProxy) {
    let content=draft, session=model.sessionGeneration, workspace=model.selected,focus=model.workstreamFocus,reference=model.composerReference
    Task {
      guard session == model.sessionGeneration,workspace == model.selected,focus == model.workstreamFocus,reference == model.composerReference,!draftNeedsFocusSelection else {return}
      let addressed=toMiriam && !content.trimmingCharacters(in:.whitespacesAndNewlines).lowercased().hasPrefix("@miriam") ? "@Miriam " + content : content
      if await model.send(addressed,reference:reference?.reference),session == model.sessionGeneration,workspace == model.selected,focus == model.workstreamFocus {
        if draft == content,reference == model.composerReference {draft="";model.selectConversationReference(nil)}
        proxy.scrollTo("latest",anchor:.bottom)
      }
    }
  }
  @ViewBuilder private func conversationMessage(_ message:Message) -> some View {
    VStack(alignment:.leading,spacing:10) {
      HStack(alignment:.firstTextBaseline) {
        Text(message.purpose == "workspace_welcome" ? "Miriam · introduzione" : message.actorKind == "miriam" ? "Miriam · AI" : message.authorName + (message.purpose == "workspace_introduction" ? " · introduzione" : ""))
          .font(.subheadline.weight(.bold)).foregroundStyle(message.actorKind == "miriam" ? RIMIAMStyle.secondary : RIMIAMStyle.ink)
        Spacer(minLength:8)
        Text(messageTime(message.createdAt)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary).accessibilityLabel(message.createdAt)
      }
      Text(message.content).font(.body).lineSpacing(4).textSelection(.enabled).fixedSize(horizontal:false,vertical:true)
      if let focus=message.workstreamFocus {
        NavigationLink {WorkspaceWorkstreamDetailView(model:model,streamID:focus.workstreamId)} label:{Label("Filone di origine · v\(focus.version)",systemImage:"line.3.horizontal.decrease")}.font(.caption)
      }
      if let reference=message.reference {
        NavigationLink {WorkspaceReferenceView(model:model,reference:reference,onAsk:prepareReferenceQuestion)} label:{Label("Riferimento · " + reference.kind.label + " · " + reference.versionLabel,systemImage:"quote.bubble")}.font(.caption)
      }
      ConversationHandoffLinks(model:model,sourceID:message.replyToSourceId ?? message.id,onAsk:prepareReferenceQuestion)
      VoiceMessageView(model:model,messageID:message.id)
      if message.actorKind == "miriam" {SpokenReplyButton(id:message.id,text:message.content)}
      if let citations=message.citationSourceIds,!citations.isEmpty {DisclosureGroup("Fonti"){ForEach(citations,id:\.self){SourceReferenceView(model:model,sourceId:$0)}}.font(.subheadline)}
      RIMIAMRule()
    }.padding(.vertical,10)
  }
  private var focusPicker:some View {
    List {
      Section {
        Text("Scegli il filo da seguire.").font(.system(.title2,design:.serif).weight(.bold))
        Text("È sempre la stessa conversazione, con le stesse persone e gli stessi accessi. La selezione accompagna i nuovi messaggi.").font(.subheadline).foregroundStyle(.secondary)
        Button {model.selectWorkstream(nil);focusOpen=false} label:{HStack{Text("Tutta la conversazione");Spacer();if model.workstreamFocus == nil {Image(systemName:"checkmark")}}}.frame(minHeight:44)
      }
      Section("Filoni attivi") {
        let streams=(model.attention?.workstreams ?? []).filter{$0.state == "active"}
        if streams.isEmpty {Text("Nessun filone attivo. Puoi organizzarne uno da Lo spazio.").foregroundStyle(.secondary)}
        ForEach(streams) {stream in
          Button {model.selectWorkstream(stream);focusOpen=false} label:{HStack(alignment:.top){VStack(alignment:.leading,spacing:5){Text(stream.title).font(.headline);Text("Versione \(stream.version)").font(.caption).foregroundStyle(.secondary)};Spacer();if model.workstreamFocus == WorkstreamFocus(workstreamId:stream.id,version:stream.version){Image(systemName:"checkmark")}}}.padding(.vertical,6)
        }
      }
      let concluded=(model.attention?.workstreams ?? []).filter{["resolved","archived"].contains($0.state)}
      if !concluded.isEmpty {
        Section("Filoni conclusi · sola lettura") {
          ForEach(concluded) {stream in
            Button {model.selectWorkstream(stream);focusOpen=false} label:{VStack(alignment:.leading,spacing:5){Text(stream.title).font(.headline);Text(stream.status + " · v\(stream.version)").font(.caption).foregroundStyle(.secondary)}}.padding(.vertical,6)
          }
        }
      }
    }.navigationTitle("Focus della conversazione").navigationBarTitleDisplayMode(.inline).rimiamList()
      .toolbar {ToolbarItem(placement:.confirmationAction){Button("Chiudi"){focusOpen=false}}}
      .task {await model.loadAttention()}
  }
  private func messageTime(_ raw:String) -> String {
    let formatter=ISO8601DateFormatter()
    formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
    let date=formatter.date(from:raw) ?? ISO8601DateFormatter().date(from:raw)
    return date.map{$0.formatted(date:.abbreviated,time:.shortened)} ?? raw
  }
  private var activityWorks:[ActiveWork] {
    (model.activeWork?.works ?? []).sorted {lhs,rhs in
      let left=lhs.phase == "needs_input" || !lhs.issues.isEmpty
      let right=rhs.phase == "needs_input" || !rhs.issues.isEmpty
      return left && !right
    }
  }
  private var activityPreview:some View {
    VStack(alignment:.leading,spacing:10) {
      HStack {
        Text("ATTIVITÀ").font(.system(.caption,design:.monospaced).weight(.bold)).tracking(1.2)
        Spacer()
        Button("Tutta l’attività"){messageFocused=false;activityOpen=true}.font(.caption.weight(.semibold)).frame(minHeight:44)
      }
      let workCount=model.workAttentionCount
      if workCount > 0 {
        Button {messageFocused=false;activityOpen=true} label:{Label("\(workCount) lavori da seguire",systemImage:"exclamationmark.circle.fill").font(.subheadline.weight(.semibold))}.frame(minHeight:44)
      }
      ForEach(Array(activityWorks.prefix(2))) {work in
        Button {openLens(.work)} label:{
          HStack(alignment:.top,spacing:10) {
            Image(systemName:work.phase == "needs_input" || !work.issues.isEmpty ? "exclamationmark.circle" : work.phase == "completed" ? "checkmark.circle" : "circle.dotted").accessibilityHidden(true)
            VStack(alignment:.leading,spacing:4) {Text(work.contract.objective).font(.subheadline.weight(.semibold)).lineLimit(2);Text(work.status + (!work.issues.isEmpty ? " · indicazioni aperte" : "")).font(.caption).foregroundStyle(.secondary)}
            Spacer(minLength:0);Image(systemName:"arrow.up.right").font(.caption).accessibilityHidden(true)
          }.padding(12).frame(maxWidth:.infinity,alignment:.leading).background(RIMIAMStyle.surface,in:RoundedRectangle(cornerRadius:10)).overlay(RoundedRectangle(cornerRadius:10).stroke(RIMIAMStyle.line.opacity(0.7),lineWidth:1.5))
        }.buttonStyle(.plain)
      }
      if let event=model.activity?.events.first {
        NavigationLink {WorkspaceReferenceView(model:model,reference:event.reference,onAsk:prepareReferenceQuestion)} label:{ActivityEventRow(event:event,compact:true)}.buttonStyle(.plain)
      } else if !model.activityError.isEmpty {
        Button {activityOpen=true} label:{Label("L’attività richiede un aggiornamento",systemImage:"arrow.clockwise")}.font(.caption).frame(minHeight:44)
      }
      if let reads=model.detail?.interpretations,reads.contains(where:{["queued","running"].contains($0.status)}) {
        Text("Miriam sta leggendo il contesto pertinente…").font(.caption).foregroundStyle(.secondary)
      }
    }
  }
  var workspacePicker: some View {
    List {
      Section { ForEach(model.spaces) { space in Button {model.select(space.id);spacesOpen=false;home=false} label:{HStack{Text(space.name);if model.selected==space.id {Image(systemName:"checkmark")}}} } }
      Section("Nuovo Workspace") { workspaceCreationFields }
      pendingCommands
      Section { Text(model.credential?.user.email ?? "").font(.caption) }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.confirmationDialog("Rimuovere il promemoria non annulla un’operazione già ricevuta dal server.",isPresented:Binding(get:{discard != nil && spacesOpen},set:{if !$0 {discard=nil}})) {
      Button("Rimuovi promemoria",role:.destructive) {if let discard {model.discardReminder(discard)};discard=nil}
    }
  }
  private var workspaceDraftScope: [String] {
    [model.credential?.base ?? "", model.credential?.user.id ?? ""]
  }
  private var workspaceNameLength: Int {
    workspaceName.trimmingCharacters(in:.whitespacesAndNewlines).unicodeScalars.count
  }
  private var workspaceDescriptionLength: Int {
    workspaceDescription.trimmingCharacters(in:.whitespacesAndNewlines).unicodeScalars.count
  }
  @ViewBuilder private var workspaceCreationFields: some View {
    TextField("Nome del Workspace, es. Rimiam",text:$workspaceName)
      .accessibilityLabel("Nome del nuovo Workspace").accessibilityIdentifier("workspace-name")
    TextField("Descrizione introduttiva (facoltativa)",text:$workspaceDescription,axis:.vertical)
      .lineLimit(3...8).accessibilityIdentifier("workspace-description")
      .accessibilityHint("Massimo 2000 caratteri. Sarà condivisa nella conversazione a tuo nome.")
    Text("La descrizione sarà condivisa nella conversazione a tuo nome. Il Goal si definisce separatamente.")
      .font(.caption).foregroundStyle(.secondary)
    if workspaceNameLength > 120 {Text("Il nome può contenere al massimo 120 caratteri.").font(.caption).foregroundStyle(.red)}
    Text("\(workspaceDescriptionLength)/2000")
      .font(.caption).foregroundStyle(workspaceDescriptionLength > 2000 ? .red : .secondary)
      .accessibilityLabel("Descrizione: \(workspaceDescriptionLength) su 2000 caratteri")
    if workspaceDescriptionLength > 2000 {Text("Accorcia la descrizione prima di creare il Workspace.").font(.caption).foregroundStyle(.red)}
    Button("Crea Workspace",action:createWorkspace)
      .buttonStyle(RIMIAMPrimaryButtonStyle())
      .disabled(model.busy || workspaceNameLength == 0 || workspaceNameLength > 120 || workspaceDescriptionLength > 2000 || model.hasPendingCreation(name:workspaceName,description:workspaceDescription))
      .accessibilityIdentifier("workspace-create")
  }
  private func createWorkspace() {
    let name=workspaceName, description=workspaceDescription, session=model.sessionGeneration
    Task {
      guard session == model.sessionGeneration else {return}
      guard await model.create(name,description:description), session == model.sessionGeneration else {return}
      finishWorkspaceCreation(name:name,description:description)
    }
  }
  private func finishWorkspaceCreation(name:String,description:String) {
    clearWorkspaceDraft(name:name,description:description)
    invitationPromptWorkspace=model.selected
    spacesOpen=false;home=false
  }
  private func clearWorkspaceDraft(name:String,description:String) {
    if workspaceName == name && workspaceDescription == description {
      workspaceName="";workspaceDescription=""
    }
  }
  @ViewBuilder private var pendingCommands: some View {
    if !model.pending.isEmpty {
      Section("Operazioni da verificare") {
        Text("Un esito incerto non significa che l’operazione sia fallita. Riprova la stessa operazione per verificarne l’esito.").font(.caption)
        ForEach(model.pending) { command in
          Text(command.content)
          if command.type == "workspace.create", let json=command.commandJSON,
             let body=(try? JSONSerialization.jsonObject(with:Data(json.utf8))) as? [String:String],
             let description=body["description"], !description.isEmpty {
            Text(description).font(.caption).foregroundStyle(.secondary)
          }
          Button("Riprova la stessa operazione") {
            let session=model.sessionGeneration
            Task {
              guard session == model.sessionGeneration,
                await model.retry(command), session == model.sessionGeneration,
                command.type == "workspace.create" else {return}
              let body=command.commandJSON.flatMap {try? JSONSerialization.jsonObject(with:Data($0.utf8)) as? [String:String]}
              finishWorkspaceCreation(name:body?["name"] ?? command.content,description:body?["description"] ?? "")
            }
          }.disabled(model.busy)
          Button("Rimuovi promemoria locale",role:.destructive) {discard=command}
        }
      }
    }
  }
  private var workspaceNavigationScope:[String] {workspaceDraftScope + [model.selected ?? ""]}
  private var lensPath:Binding<[RIMIAMLensRoute]> {
    let workspace=model.selected ?? ""
    return Binding(get:{lensPaths[workspace] ?? []},set:{lensPaths[workspace]=$0})
  }
  private func openLens(_ route:RIMIAMLensRoute) {
    messageFocused=false
    lensPaths[model.selected ?? ""]=[route]
    toolsOpen=true
  }
  var tools: some View {
    List {
      Section {
        VStack(alignment:.leading,spacing:12) {
          Text(model.state?.workspace.name ?? "Il tuo spazio").font(.system(.largeTitle,design:.serif).weight(.bold))
          if let detail=model.detail {Text("\(detail.members.filter(\.active).count) persone · una conversazione condivisa").font(.subheadline).foregroundStyle(.secondary)}
          RIMIAMRule(strong:true)
        }.padding(.vertical,8).listRowBackground(RIMIAMStyle.page)
      }
      Section {
        NavigationLink(value:RIMIAMLensRoute.goal){RIMIAMNavigationLabel(title:"Goal",subtitle:"La direzione, le adesioni e la sua storia.",symbol:"scope",index:"01")}
        NavigationLink(value:RIMIAMLensRoute.context){RIMIAMNavigationLabel(title:"Context",subtitle:"Riferimenti, ipotesi e decisioni leggibili.",symbol:"text.alignleft",index:"02")}.accessibilityIdentifier("context-open")
        NavigationLink(value:RIMIAMLensRoute.work){RIMIAMNavigationLabel(title:"Work",subtitle:"Il lavoro delle persone e di Miriam.",symbol:"arrow.triangle.branch",index:"03")}.accessibilityIdentifier("work-open")
        NavigationLink(value:RIMIAMLensRoute.outputs){RIMIAMNavigationLabel(title:"Outputs",subtitle:"Contributi, bozze e risultati persistenti.",symbol:"doc.richtext",index:"04")}
      }
      Section("Dentro lo spazio") {
        NavigationLink(value:RIMIAMLensRoute.streams){Label("Filoni della conversazione",systemImage:"line.3.horizontal.decrease")}
        NavigationLink(value:RIMIAMLensRoute.sources){Label("Fonti e ricerca",systemImage:"doc.text.magnifyingglass")}
        NavigationLink(value:RIMIAMLensRoute.people){Label("Persone e inviti",systemImage:"person.2")}
      }
      Section("Strumenti collegati") {
        NavigationLink(value:RIMIAMLensRoute.calendar){Label("Calendario",systemImage:"calendar")}.accessibilityIdentifier("calendar-open")
        NavigationLink(value:RIMIAMLensRoute.email){Label("Email",systemImage:"envelope")}.accessibilityIdentifier("email-open")
        NavigationLink(value:RIMIAMLensRoute.collaboration){Label("Come collabora Miriam",systemImage:"slider.horizontal.3")}
      }
      if !model.error.isEmpty {Text(model.error).foregroundStyle(.red)}
    }.rimiamList()
  }
  @ViewBuilder private func lensDestination(_ route:RIMIAMLensRoute) -> some View {
    switch route {
    case .goal:WorkspaceGoalView(model:model)
    case .context:WorkspaceContextView(model:model)
    case .work:MiriamWorkView(model:model)
    case .outputs:MiriamOutputsView(model:model)
    case .sources:WorkspaceSourcesView(model:model).rimiamList()
    case .people:WorkspacePeopleView(model:model).rimiamList()
    case .questions:WorkspaceQuestionsView(model:model).rimiamList()
    case .streams:WorkspaceWorkstreamsView(model:model)
    case .collaboration:WorkspaceCollaborationView(model:model)
    case .calendar:
      MiriamCalendarView(model:model).rimiamList().toolbar {ToolbarItem(placement:.secondaryAction){Button("Collega Google Calendar"){Task {if let url=await model.connectGoogle("calendar"){openURL(url)}}}}}
    case .email:
      MiriamEmailView(model:model).rimiamList().toolbar {ToolbarItem(placement:.secondaryAction){Button("Collega Gmail"){Task {if let url=await model.connectGoogle("email"){openURL(url)}}}}}
    }
  }
  func webURL(_ base:String) -> URL? {
    guard var url=URLComponents(string:base), ["https","http"].contains(url.scheme ?? ""), url.user==nil,url.password==nil else {return nil}
    if ["localhost","127.0.0.1"].contains(url.host ?? "") && url.port==3002 {url.port=3000}
    return url.url
  }
}
