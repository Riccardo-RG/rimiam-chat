import Foundation
import Observation

@MainActor @Observable final class WorkspaceModel {
  var mediaBoundary:String { [credential?.base ?? "",credential?.user.id ?? "",String(sessionGeneration),selected ?? "",String(credential?.logoutPending ?? false)].joined(separator:"|") }
  let media = WorkspaceMedia()
  private(set) var voiceReplySourceID: String?
  private let vault: Vault
  private let apiFactory: @MainActor (String) throws -> API
  private(set) var stored = VaultState()
  private var api: API?
  private var loop: Task<Void, Never>?
  private var generation = 0
  private var syncing = false
  private var foreground = false
  private(set) var spaces: [Workspace] = []
  private(set) var selected: String?
  private(set) var state: WorkspaceState?
  private(set) var detail: WorkspaceDetail?
  private(set) var attention: AttentionSnapshot?
  private(set) var activity:WorkspaceActivity?
  private(set) var activityLoading=false
  private(set) var activityError=""
  private var activityRevision:Int?
  private var activityRequest:UUID?
  private(set) var composerReference:ComposerReference?
  private(set) var handoffs:[ConversationHandoff]=[]
  private(set) var handoffError=""
  private var handoffRevision:Int?
  private var handoffReadSequence=0
  private var handoffReadVersions:[String:Int]=[:]
  private(set) var invitationLink: String?
  private(set) var activeWork: ActiveWorkSnapshot?
  private var activeWorkBefore = ""
  private(set) var tasks: TasksSnapshot?
  private var tasksBefore = ""
  private(set) var email: EmailSnapshot?
  private var emailBefore = ""
  private(set) var calendar: CalendarSnapshot?
  var calendarStart = Calendar.current.startOfDay(for: Date())
  private(set) var messages: [Message] = []
  private(set) var workstreamFocus:WorkstreamFocus?
  private var messagesThrough=0
  private(set) var conversationLoaded=false
  // Only navigation cursors, never an alternate cache of shared history.
  private var historyStarts:[String:Int]=[:]
  private func historyKey(_ workspace:String,_ focus:WorkstreamFocus?) -> String {
    workspace + "|" + (focus.map{"\($0.workstreamId):\($0.version)"} ?? "")
  }
  private func rememberHistoryWindow() {
    if conversationLoaded,let workspace=selected,let first=messages.first {historyStarts[historyKey(workspace,workstreamFocus)]=first.sequence}
  }
  private(set) var hasOlder = false
  private(set) var busy = false
  private(set) var sessionGeneration = 0
  private(set) var confirmedCreation: PendingCommand?
  private(set) var connection = "Non connesso"
  var error = ""
  var accountNotice = ""
  var credential: Credential? { stored.credential }
  var pending: [PendingCommand] {
    stored.pending.filter { $0.actor == credential?.user.id && $0.base == credential?.base }
  }
  init(vault: Vault = Vault(), apiFactory: @escaping @MainActor (String) throws -> API = {try API(base:$0)}) {
    self.vault = vault
    self.apiFactory = apiFactory
    do {
      stored = try vault.load()
      if let c = credential { api = try apiFactory(c.base) }
    } catch { self.error = error.localizedDescription }
  }
  private func persist(_ next: VaultState) throws {
    try vault.save(next)
    if stored.credential?.base != next.credential?.base
      || stored.credential?.user.id != next.credential?.user.id
      || stored.credential?.token != next.credential?.token
      || stored.credential?.logoutPending != next.credential?.logoutPending {
      sessionGeneration += 1
      historyStarts=[:]
      confirmedCreation = nil
      resetActivityAndReference()
      workstreamFocus = nil
      messagesThrough = 0
      conversationLoaded = false
    }
    stored = next
  }
  private func forget(_ id: String) throws {
    var next = stored
    next.pending.removeAll { $0.id == id }
    try persist(next)
  }
  func requestAccount(base:String,action:String,email:String,name:String="",password:String="") async {
    guard !busy else{return};busy=true;error="";accountNotice="";defer{busy=false}
    do {let client=try apiFactory(base);var body:[String:Any]=["action":action,"email":email]
      if action=="register" {body["name"]=name;body["password"]=password}
      _ = try await client.data("native/account",method:"POST",body:body)
      accountNotice="Richiesta ricevuta. Se applicabile, controlla l’email e segui il link per completare l’operazione."
    } catch {handle(error)}
  }
  func login(base: String, email: String, password: String) async {
    guard !busy else { return }
    busy = true
    error = ""
    defer { busy = false }
    do {
      let client = try apiFactory(base)
      let result = try JSONDecoder().decode(
        LoginResponse.self,
        from: await client.data(
          "native/session", method: "POST", body: ["email": email, "password": password]))
      var next = stored
      next.credential = Credential(base: client.base, user: result.user, token: result.token)
      try persist(next)
      api = client
      try await refreshSession()
      setForeground(true)
    } catch { handle(error) }
  }
  func setForeground(_ active: Bool) {
    foreground = active
    generation += 1
    loop?.cancel()
    loop = nil
    if !active {
      connection = "In pausa"
      return
    }
    guard credential != nil else { return }
    loop = Task { [weak self] in
      guard let self else { return }
      var delay = 2
      while !Task.isCancelled && self.foreground && self.credential != nil {
        do {
          if self.credential?.logoutPending == true {
            await self.logout()
            return
          }
          try await self.refreshSession()
          try await self.sync()
          await self.loadActiveWork()
          await self.loadAttention()
          await self.loadActivity()
          await self.loadHandoffs()
          try await self.recoverKnownReceipts()
          self.connection = "Aggiornato"
          delay = 2
        } catch {
          if Task.isCancelled { return }
          self.handle(error)
          self.connection = "Connessione da ripristinare · dati dell’ultimo aggiornamento"
          delay = min(delay * 2, 30)
        }
        do { try await Task.sleep(for: .seconds(delay)) } catch { return }
      }
    }
  }
  func refreshSession() async throws {
    guard let api, let c = credential else { return }
    let epoch = generation
    let session = sessionGeneration
    do {
    let _: SessionResponse = try await api.get(
      "native/session", token: c.token, as: SessionResponse.self)
    let list = try await api.get("workspaces", token: c.token, as: WorkspaceList.self)
    guard epoch == generation, session == sessionGeneration, c.token == credential?.token, !Task.isCancelled else { throw CancellationError() }
    spaces = list.workspaces
    historyStarts=historyStarts.filter {entry in spaces.contains {entry.key.hasPrefix($0.id + "|")}}
    if selected == nil || !spaces.contains(where: { $0.id == selected }) {
      selected = spaces.first?.id
      workstreamFocus = nil
      messagesThrough = 0
      conversationLoaded = false
      state = nil
      detail = nil
      attention = nil
      resetActivityAndReference()
      invitationLink = nil
      calendar = nil
      activeWork = nil
      activeWorkBefore = ""
      tasks = nil
      tasksBefore = ""
      email = nil
      emailBefore = ""
      messages = []
    }
    } catch {
      guard epoch == generation, session == sessionGeneration, !Task.isCancelled else {throw CancellationError()}
      throw error
    }
  }
  func select(_ id: String) {
    rememberHistoryWindow()
    selected = id
    workstreamFocus = nil
    messagesThrough = 0
    conversationLoaded = false
    state = nil
      detail = nil
      attention = nil
      resetActivityAndReference()
      invitationLink = nil
    calendar = nil
    activeWork = nil
    activeWorkBefore = ""
    tasks = nil
    tasksBefore = ""
    email = nil
    emailBefore = ""
    messages = []
    setForeground(foreground)
  }
  var focusIsStale:Bool {
    guard let focus=workstreamFocus else {return false}
    guard let current=attention?.workstreams.first(where:{$0.id == focus.workstreamId}) else {return true}
    return current.state != "active" || current.version != focus.version
  }
  var focusedStream:AttentionSnapshot.Stream? {
    guard let focus=workstreamFocus else {return nil}
    return attention?.workstreams.first(where:{$0.id == focus.workstreamId})
  }
  var focusIsReadOnly:Bool {
    guard let stream=focusedStream else {return false}
    return stream.state != "active"
  }
  var focusedTitle:String? {
    guard let focus=workstreamFocus,let stream=focusedStream else {return nil}
    return stream.version == focus.version ? stream.title : stream.history?.first(where:{$0.version == focus.version})?.title
  }
  func selectWorkstream(_ stream:AttentionSnapshot.Stream?) {
    if let stream,!["active","resolved","archived"].contains(stream.state) {return}
    let next=stream.map{WorkstreamFocus(workstreamId:$0.id,version:$0.version)}
    guard next != workstreamFocus else {return}
    rememberHistoryWindow()
    workstreamFocus=next
    messages=[];messagesThrough=0;conversationLoaded=false;hasOlder=false
    // Workspace state and authority stay shared; only the Conversation window changes.
    media.focusChanged(self)
    setForeground(foreground)
  }
  func sync(force: Bool = false) async throws {
    guard !syncing, let api, let c = credential, let w = selected else { return }
    syncing = true
    defer { syncing = false }
    let epoch = generation
    let session = sessionGeneration
    let focus = workstreamFocus
    let filter = focus.map{"&workstreamId=\($0.workstreamId)"} ?? ""
    do {
    var reset = false
    if !force, let current = state {
      do {
        let changes = try await api.get(
          "workspaces/\(w)/changes?after=\(current.workspace.revision)&limit=1", token: c.token,
          as: Changes.self)
        if changes.headRevision == current.workspace.revision && calendar != nil && conversationLoaded { return }
      } catch let error as APIError
        where ["CURSOR_AHEAD", "SYNC_RESET_REQUIRED"].contains(error.code)
      {
        reset = true
      }
    }
    let head = try await api.get("workspaces/\(w)/state", token: c.token, as: WorkspaceState.self)
    var merged = messages
    var older = hasOlder
    var after=messagesThrough
    if state == nil || reset || !conversationLoaded || messagesThrough > head.messageSequence
      || (focus != nil && state?.workspace.revision != head.workspace.revision) {
      let oldestLoaded=messages.first?.sequence ?? historyStarts[historyKey(w,focus)]
      let page = try await api.get(
        "workspaces/\(w)/history?through=\(head.messageSequence)&limit=50\(filter)", token: c.token,
        as: HistoryPage.self)
      guard page.through == head.messageSequence else {throw APIError(code:"SYNC_INCOMPLETE",status:0)}
      merged = page.messages
      older = page.hasMore
      while let oldestLoaded,older,let first=merged.first,first.sequence>oldestLoaded {
        let previous=try await api.get("workspaces/\(w)/history?before=\(first.sequence)&through=\(head.messageSequence)&limit=50\(filter)",token:c.token,as:HistoryPage.self)
        guard previous.through == head.messageSequence,!previous.hasMore || (previous.messages.first.map{$0.sequence<first.sequence} ?? false) else {throw APIError(code:"SYNC_INCOMPLETE",status:0)}
        merged.insert(contentsOf:previous.messages,at:0);older=previous.hasMore
      }
      after=head.messageSequence
    }
    while after < head.messageSequence {
      let page = try await api.get(
        "workspaces/\(w)/messages?after=\(after)&through=\(head.messageSequence)&limit=50\(filter)",
        token: c.token, as: MessagePage.self)
      guard page.through == head.messageSequence, page.nextAfter >= after,
        !page.hasMore || page.nextAfter > after else {
        throw APIError(code: "SYNC_INCOMPLETE", status: 0)
      }
      merged.append(contentsOf: page.messages)
      after = page.hasMore ? page.nextAfter : page.through
    }
    let detailHead = try await api.get("workspaces/\(w)/workspace", token: c.token, as: WorkspaceDetail.self)
    let calendarHead = try await api.get(
      "workspaces/\(w)/calendar?\(calendarQuery)", token: c.token, as: CalendarSnapshot.self)
    guard epoch == generation, session == sessionGeneration, selected == w, credential?.token == c.token,workstreamFocus == focus,!Task.isCancelled else {
      throw CancellationError()
    }
    // Publish data and acknowledged revision together only after every required page arrived.
    messages = merged
    messagesThrough=head.messageSequence
    conversationLoaded=true
    hasOlder = older
    state = head
    detail = detailHead
    calendar = calendarHead
    connection = "Aggiornato"
    } catch {
      guard epoch == generation, session == sessionGeneration, selected == w,workstreamFocus == focus,!Task.isCancelled else {throw CancellationError()}
      throw error
    }
  }
  func loadOlder() async {
    guard !syncing, let api, let c = credential, let w = selected, let head = state,
      let first = messages.first
    else { return }
    syncing = true
    defer { syncing = false }
    let epoch = generation
    let session = sessionGeneration
    let focus=workstreamFocus
    let filter=focus.map{"&workstreamId=\($0.workstreamId)"} ?? ""
    do {
      let page = try await api.get(
        "workspaces/\(w)/history?before=\(first.sequence)&through=\(head.messageSequence)&limit=50\(filter)",
        token: c.token, as: HistoryPage.self)
      guard epoch == generation, session == sessionGeneration, selected == w, credential?.token == c.token,workstreamFocus == focus,!Task.isCancelled else { return }
      messages = page.messages + messages
      hasOlder = page.hasMore
    } catch {if epoch == generation,session == sessionGeneration,selected == w,credential?.token == c.token,workstreamFocus == focus,!Task.isCancelled {handle(error)}}
  }
  @discardableResult func send(_ content: String,reference:ConversationReference? = nil) async -> Bool {
    guard let w = selected else { return false }
    guard !focusIsStale else {error="Il filone è cambiato. Seleziona di nuovo un filone attivo prima di inviare.";return false}
    return await prepare(type: "message.send", workspace: w, content: content,messageFocus:workstreamFocus,messageReference:reference)
  }
  @discardableResult func create(_ name: String, description: String = "") async -> Bool {
    guard !hasPendingCreation(name:name,description:description) else {return false}
    return await prepare(
      type: "workspace.create", workspace: UUID().uuidString.lowercased(), content: name, creationDescription: description)
  }
  func hasPendingCreation(name: String, description: String) -> Bool {
    pending.contains { command in
      guard command.type == "workspace.create" else {return false}
      let body=command.commandJSON.flatMap {try? JSONSerialization.jsonObject(with:Data($0.utf8)) as? [String:String]}
      return (body?["name"] ?? command.content).trimmingCharacters(in:.whitespacesAndNewlines) == name.trimmingCharacters(in:.whitespacesAndNewlines)
        && (body?["description"] ?? "").trimmingCharacters(in:.whitespacesAndNewlines) == description.trimmingCharacters(in:.whitespacesAndNewlines)
    }
  }
  var calendarQuery: String {
    var parts = URLComponents()
    parts.queryItems = [
      URLQueryItem(name: "start", value: calendarStart.ISO8601Format()),
      URLQueryItem(
        name: "end", value: calendarStart.addingTimeInterval(30 * 86400).ISO8601Format()),
    ]
    return parts.percentEncodedQuery!
  }
  func refreshCalendar() async {
    generation += 1
    calendar = nil
    activeWork = nil
    activeWorkBefore = ""
    tasks = nil
    tasksBefore = ""
    email = nil
    emailBefore = ""
    do { try await sync(force: true) } catch { handle(error) }
  }
  func moreCalendar() async {
    guard let current = calendar, let after = current.nextActions, let api, let c = credential,
      let w = selected
    else { return }
    let epoch = generation
    do {
      var next = try await api.get(
        "workspaces/\(w)/calendar?\(calendarQuery)&afterAction=\(after)", token: c.token,
        as: CalendarSnapshot.self)
      guard epoch == generation, selected == w, credential?.token == c.token else { return }
      next.actions = current.actions + next.actions
      calendar = next
    } catch { handle(error) }
  }
  func loadTasks(before: String? = nil) async {
    guard let api, let c = credential, c.logoutPending != true, let w = selected else { return }
    if let before { tasksBefore = before }
    let page = tasksBefore
    let epoch = generation
    do {
      let next = try await api.get(
        "workspaces/\(w)/tasks" + (page.isEmpty ? "" : "?before=\(page)"), token: c.token,
        as: TasksSnapshot.self)
      guard epoch == generation, selected == w, credential?.token == c.token,
        credential?.logoutPending != true, tasksBefore == page, !Task.isCancelled
      else { return }
      tasks = next
    } catch {
      if epoch == generation, credential?.token == c.token {
        activeWork = nil
        activeWorkBefore = ""
        tasks = nil
        handle(error)
      }
    }
  }
  func workHistory(_ id: String, kind: String) async -> String {
    guard let api, let c = credential, c.logoutPending != true, let w = selected else { return "" }
    let epoch = generation
    do {
      let data = try await api.data(
        "workspaces/\(w)/tasks-history?id=\(id)&kind=\(kind)", token: c.token)
      guard epoch == generation, selected == w, credential?.token == c.token,
        credential?.logoutPending != true
      else { return "" }
      return String(data: data, encoding: .utf8) ?? ""
    } catch {
      handle(error)
      return ""
    }
  }
  func loadEmail(before: String? = nil) async {
    guard let api, let c = credential, c.logoutPending != true, let w = selected else { return }
    if let before { emailBefore = before }
    let page = emailBefore
    let epoch = generation
    do {
      let next = try await api.get(
        "workspaces/\(w)/email" + (page.isEmpty ? "" : "?before=\(page)"), token: c.token,
        as: EmailSnapshot.self)
      guard epoch == generation, selected == w, credential?.token == c.token,
        credential?.logoutPending != true, emailBefore == page, !Task.isCancelled
      else { return }
      email = next
    } catch {
      if epoch == generation && credential?.token == c.token {
        activeWork = nil
        activeWorkBefore = ""
        tasks = nil
        tasksBefore = ""
        email = nil
        handle(error)
      }
    }
  }
  func composeEmail(_ draft: EmailDraft, instruction: String) async -> EmailComposition? {
    guard !busy, let api, let c = credential, let w = selected else { return nil }
    let epoch = generation
    busy = true
    error = ""
    defer { busy = false }
    do {
      let data = try await api.data(
        "workspaces/\(w)/email-compose", method: "POST", token: c.token,
        body: ["draftId": draft.id, "version": draft.version, "instruction": instruction])
      guard epoch == generation, selected == w, credential?.token == c.token,
        credential?.logoutPending != true, !Task.isCancelled
      else { return nil }
      return try JSONDecoder().decode(EmailComposition.self, from: data)
    } catch {
      if epoch == generation && credential?.token == c.token { handle(error) }
      return nil
    }
  }
  func loadActiveWork(before: String? = nil) async {
    guard let api, let c = credential, !c.logoutPending, let w = selected else { return }
    if let before { activeWorkBefore = before }
    let page = activeWorkBefore
    let epoch = generation
    do {
      let next = try await api.get(
        "workspaces/\(w)/active-work" + (page.isEmpty ? "" : "?before=\(page)"), token: c.token,
        as: ActiveWorkSnapshot.self)
      guard epoch == generation, selected == w, credential?.token == c.token,
        credential?.logoutPending != true, activeWorkBefore == page, !Task.isCancelled
      else { return }
      activeWork = next
    } catch {
      if epoch == generation, credential?.token == c.token {
        activeWork = nil
        handle(error)
      }
    }
  }
  var workAttentionCount:Int {
    let shared=(attention?.attention ?? []).filter{$0.kind == "work"}.map(\.id)
    let restricted=(activeWork?.works ?? []).filter{$0.phase == "needs_input" || !$0.issues.isEmpty}.map(\.id)
    return Set(shared + restricted).count
  }
  func activeWorkDetail(_ id:String) async throws -> ActiveWorkSnapshot {
    guard let api,let c=credential,!c.logoutPending,let w=selected else {throw CancellationError()}
    let session=sessionGeneration,epoch=generation
    var before:String?
    var seen=Set<String>()
    do {
      while true {
        let page=try await api.get("workspaces/\(w)/active-work" + (before.map{"?before=\($0)"} ?? ""),token:c.token,as:ActiveWorkSnapshot.self)
        guard session == sessionGeneration,epoch == generation,selected == w,!Task.isCancelled else {throw CancellationError()}
        if page.works.contains(where:{$0.id == id}) {return page}
        guard let next=page.next else {throw APIError(code:"WORK_NOT_FOUND",status:404)}
        guard seen.insert(next).inserted else {throw APIError(code:"SYNC_INCOMPLETE",status:0)}
        before=next
      }
    } catch {
      guard session == sessionGeneration,epoch == generation,selected == w,!Task.isCancelled else {throw CancellationError()}
      throw error
    }
  }
  func activeWorkHistory(_ id: String, before: Int? = nil) async -> String {
    guard let api, let c = credential, !c.logoutPending, let w = selected else { return "" }
    let epoch = generation,session=sessionGeneration
    do {
      let data = try await api.data(
        "workspaces/\(w)/active-work-history?id=\(id)" + (before.map { "&before=\($0)" } ?? ""),
        token: c.token)
      guard epoch == generation, session == sessionGeneration, selected == w, credential?.token == c.token,
        credential?.logoutPending != true, !Task.isCancelled
      else { return "" }
      return String(data: data, encoding: .utf8) ?? ""
    } catch {
      if epoch == generation,session == sessionGeneration,selected == w,!Task.isCancelled {handle(error)}
      return ""
    }
  }
  func calendarHistory(_ id: String, kind: String) async -> String {
    guard let api, let c = credential, !c.logoutPending, let w = selected else { return "" }
    let epoch = generation
    do {
      let data = try await api.data(
        "workspaces/\(w)/calendar-history?id=\(id)&kind=\(kind)",
        token: c.token)
      guard epoch == generation, selected == w, credential?.token == c.token,
        credential?.logoutPending != true, !Task.isCancelled
      else { return "" }
      return String(data: data, encoding: .utf8) ?? ""
    } catch {
      handle(error)
      return ""
    }
  }
  @discardableResult func workspaceCommand(_ body: [String: Any], label: String, requireReceipt:Bool=false) async -> Bool {
    guard !busy, let c = credential, !c.logoutPending, let w = selected else { return false }
    busy = true
    error = ""
    defer { busy = false }
    var saved = false
    var committed=false
    let session=sessionGeneration
    do {
      let json = String(
        data: try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]),
        encoding: .utf8)!
      let command = PendingCommand(
        id: UUID().uuidString.lowercased(), base: c.base, actor: c.user.id, workspace: w,
        type: body["type"] as! String, content: label, commandJSON: json)
      var next = stored
      next.pending.append(command)
      try persist(next)
      saved = true
      try await transmit(command) {committed=true}
    } catch {if session == sessionGeneration {handle(error)}}
    return requireReceipt ? committed && session == sessionGeneration : saved
  }
  private func prepare(type: String, workspace: String, content: String, creationDescription: String = "",messageFocus:WorkstreamFocus? = nil,messageReference:ConversationReference? = nil) async -> Bool {
    guard !busy, let c = credential, !c.logoutPending,
      !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return false }
    busy = true
    defer { busy = false }
    error = ""
    let session = sessionGeneration
    var saved = false
    var committed = false
    do {
      let id = type == "workspace.create" ? workspace : UUID().uuidString.lowercased()
      var commandBody:[String:Any]?
      if type == "workspace.create" {commandBody=["name":content,"description":creationDescription]}
      else if messageFocus != nil || messageReference != nil {
        commandBody=["type":type,"content":content]
        if let messageFocus {commandBody?["workstreamFocus"]=messageFocus.json}
        if let messageReference {commandBody?["reference"]=messageReference.json}
      }
      let command = PendingCommand(
        id: id, base: c.base, actor: c.user.id, workspace: workspace, type: type, content: content, commandJSON: try commandBody.map{String(data:try JSONSerialization.data(withJSONObject:$0),encoding:.utf8)!})
      var next = stored
      next.pending.append(command)
      try persist(next)
      saved = true
      try await transmit(command) {committed=true}
    } catch { if session == sessionGeneration {handle(error)} }
    // Creation navigates and clears its form only after a verified receipt; other
    // contributions retain their existing durable-journal acknowledgement.
    return type == "workspace.create" ? committed && session == sessionGeneration : saved
  }
  func connectGoogle(_ capability: String) async -> URL? {
    guard let api, let c = credential, let w = selected else { return nil }
    let epoch = generation
    do {
      let data = try await api.data("workspaces/\(w)/google-connect", method: "POST", token: c.token, body: ["capability": capability])
      guard epoch == generation, selected == w, credential?.token == c.token else { return nil }
      let response = try JSONDecoder().decode(GoogleConnectResponse.self, from: data)
      return URL(string: response.authorizationUrl)
    } catch { handle(error); return nil }
  }
  func loadAttention(before:Int?=nil) async {
    if before==nil, let attention, attention.revision==state?.workspace.revision {return}
    let raw=await workspaceRead("attention" + (before.map{"?before=\($0)"} ?? ""))
    if let data=try? JSONDecoder().decode(AttentionSnapshot.self,from:Data(raw.utf8)) {attention=data;media.focusChanged(self)}
  }
  func selectConversationReference(_ selection:ComposerReference?) {
    composerReference=selection
    media.focusChanged(self)
  }
  private func resetActivityAndReference() {
    activity=nil;activityRevision=nil;activityRequest=nil;activityLoading=false;activityError="";composerReference=nil
    handoffs=[];handoffRevision=nil;handoffError="";handoffReadVersions=[:]
  }
  @discardableResult func loadHandoffs(sourceID:String?=nil) async -> Bool {
    guard selected != nil,credential?.logoutPending == false else {return false}
    if sourceID == nil,handoffRevision == state?.workspace.revision,handoffRevision != nil {return true}
    let boundary=mediaBoundary,revision=state?.workspace.revision
    handoffReadSequence += 1
    let read=handoffReadSequence
    var query=URLComponents()
    if let sourceID {query.queryItems=[URLQueryItem(name:"sourceId",value:sourceID)]}
    let raw=await workspaceRead("handoffs" + (query.percentEncodedQuery.map{"?" + $0} ?? ""))
    guard boundary == mediaBoundary,!Task.isCancelled else {return false}
    guard !raw.isEmpty else {handoffError=error.isEmpty ? "Non è stato possibile recuperare i passi proposti. Riprova." : error;return false}
    do {
      let page=try JSONDecoder().decode(ConversationHandoffs.self,from:Data(raw.utf8))
      let updates=page.handoffs.filter{read >= (handoffReadVersions[$0.id] ?? 0)}
      let ids=Set(updates.map(\.id))
      for item in updates {handoffReadVersions[item.id]=read}
      handoffs=updates + handoffs.filter{!ids.contains($0.id)}
      handoffError=""
      if sourceID == nil {handoffRevision=revision}
      return true
    } catch {handoffError="I passi proposti ricevuti sono incompleti. Riprova per verificarli.";return false}
  }
  func pendingHandoff(_ id:String)->PendingCommand? {
    pending.first {command in
      guard let raw=command.commandJSON,let body=(try? JSONSerialization.jsonObject(with:Data(raw.utf8))) as? [String:Any] else {return false}
      return (body["conversationOrigin"] as? [String:String])?["handoffId"] == id
    }
  }
  func canApplyHandoff(_ handoff:ConversationHandoff)->Bool {
    handoffs.first(where:{$0.id == handoff.id})?.status == "ready" && pendingHandoff(handoff.id) == nil
  }
  @discardableResult func handoffCommand(_ body:[String:Any],handoff:ConversationHandoff?,label:String) async -> Bool {
    guard let handoff else {return await workspaceCommand(body,label:label)}
    guard canApplyHandoff(handoff) else {error="Il passo proposto è cambiato o ha un invio da verificare. Rileggilo prima di continuare.";return false}
    var command=body;command["conversationOrigin"]=["handoffId":handoff.id]
    let boundary=mediaBoundary
    let committed=await workspaceCommand(command,label:label,requireReceipt:true)
    guard boundary == mediaBoundary else {return false}
    await loadHandoffs(sourceID:handoff.sourceId)
    return committed
  }
  func loadActivity(before:String?=nil,force:Bool=false) async {
    guard !activityLoading,selected != nil,credential?.logoutPending == false else {return}
    if before == nil,!force,activity != nil,activityRevision == state?.workspace.revision {return}
    if let before,activity?.next != before {return}
    let request=UUID(),boundary=mediaBoundary,revision=state?.workspace.revision
    activityRequest=request;activityLoading=true;activityError=""
    var query=URLComponents();query.queryItems=[URLQueryItem(name:"limit",value:"30")]
    if let before {query.queryItems?.append(URLQueryItem(name:"before",value:before))}
    let raw=await workspaceRead("activity?" + (query.percentEncodedQuery ?? ""))
    guard activityRequest == request,boundary == mediaBoundary else {return}
    activityLoading=false;activityRequest=nil
    guard !Task.isCancelled else {return}
    guard !raw.isEmpty else {activityError=error.isEmpty ? "Non è stato possibile aggiornare l’attività. Riprova quando la connessione è attiva." : error;return}
    do {
      let page=try JSONDecoder().decode(WorkspaceActivity.self,from:Data(raw.utf8))
      if before != nil {
        var seen=Set<String>()
        let events=((activity?.events ?? []) + page.events).filter{seen.insert($0.id).inserted}
        activity=WorkspaceActivity(events:events,next:page.next)
      } else {activity=page;activityRevision=revision}
    } catch {activityError="L’attività ricevuta è incompleta. Riprova per verificarla."}
  }
  func sourceBytes(_ id:String) async -> Data? {
    guard let api,let c=credential,!c.logoutPending,let w=selected else{return nil};let epoch=generation,session=sessionGeneration
    do {let bytes=try await api.data("workspaces/\(w)/source-file?id=\(id)",token:c.token)
      guard epoch==generation,session==sessionGeneration,selected==w,credential?.token==c.token,credential?.logoutPending != true,!Task.isCancelled else{return nil}
      return bytes
    } catch {if epoch==generation,session==sessionGeneration,selected==w,!Task.isCancelled {handle(error)};return nil}
  }
  func mediaConnection(_ id:String) async throws -> CallCredentials {
    guard let api,let c=credential,!c.logoutPending,let w=selected else{throw APIError(code:"AUTHENTICATION_REQUIRED",status:401)};let epoch=generation
    let data=try await api.data("workspaces/\(w)/call-connect",method:"POST",token:c.token,body:["callId":id])
    guard epoch==generation,selected==w,credential?.token==c.token,!Task.isCancelled else{throw CancellationError()}
    return try JSONDecoder().decode(CallCredentials.self,from:data)
  }
  func mediaRecording(_ id:String) async throws -> URL {
    guard let api,let c=credential,!c.logoutPending,let w=selected else{throw APIError(code:"AUTHENTICATION_REQUIRED",status:401)};let epoch=generation
    let url=try await api.download("workspaces/\(w)/call-audio?id=\(id)",token:c.token)
    guard epoch==generation,selected==w,credential?.token==c.token,!Task.isCancelled else{try? FileManager.default.removeItem(at:url);throw CancellationError()}
    return url
  }
  func workspaceRead(_ resource:String) async -> String {
    guard let api,let c=credential,!c.logoutPending,let w=selected else{return ""};let epoch=generation,session=sessionGeneration
    do {let data=try await api.data("workspaces/\(w)/\(resource)",token:c.token)
      guard epoch==generation,session==sessionGeneration,selected==w,credential?.token==c.token,!Task.isCancelled else{return ""}
      return String(data:data,encoding:.utf8) ?? ""
    } catch {if epoch==generation,session==sessionGeneration,selected==w,!Task.isCancelled {handle(error)};return ""}
  }
  func acceptInvitation(_ text: String) async -> Bool {
    guard !busy, let api, let c=credential else { return false }
    let token=URLComponents(string:text)?.queryItems?.first(where:{$0.name=="invite"})?.value ?? text
    guard token.range(of:"^[A-Za-z0-9_-]+$",options:.regularExpression) != nil else { error="Link d’invito non valido.";return false }
    busy=true; defer { busy=false };let epoch=generation
    do {
      _ = try await api.data("invitations/\(token)",method:"POST",token:c.token,body:["fullHistoryAccepted":true])
      guard epoch==generation, credential?.token==c.token else { return false }
      try await refreshSession();return true
    } catch { handle(error);return false }
  }
  private func transmit(_ command: PendingCommand, onCommitted: (() -> Void)? = nil) async throws {
    guard let api, let c = credential, c.user.id == command.actor, c.base == command.base,
      !c.logoutPending
    else { throw APIError(code: "AUTHENTICATION_REQUIRED", status: 401) }
    let session = sessionGeneration
    var committed=false
    func requireCurrentSession() throws {
      guard session == sessionGeneration, credential?.base == c.base,
        credential?.user.id == c.user.id, credential?.token == c.token,
        credential?.logoutPending == false, !Task.isCancelled
      else {throw CancellationError()}
    }
    do {
    if command.type == "workspace.create" {
      var body: [String: Any] = ["name": command.content]
      if let json = command.commandJSON {
        guard let storedBody = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw APIError(code:"INVALID_COMMAND",status:0) }
        body = storedBody
      }
      body["commandId"] = command.id
      body["expectedActorId"] = c.user.id
      let result = try JSONDecoder().decode(
        CreatedWorkspace.self,
        from: await api.data(
          "workspaces", method: "POST", token: c.token,
          body: body))
      try requireCurrentSession()
      guard result.id == command.workspace else {
        throw APIError(code: "INVALID_RECEIPT", status: 0)
      }
    } else {
      let response = try await api.data(
          "workspaces/\(command.workspace)/commands", method: "POST", token: c.token,
          body: [
            "commandId": command.id, "expectedActorId": c.user.id,
            "command": try command.commandJSON.map {
              try JSONSerialization.jsonObject(with: Data($0.utf8))
            } ?? ["type": command.type, "content": command.content],
          ])
      try requireCurrentSession()
      let result = try JSONDecoder().decode(Receipt.self, from: response)
      if command.type == "invitation.create", command.actor==credential?.user.id, command.workspace==selected,
        let value=try JSONSerialization.jsonObject(with:response) as? [String:Any],
        let token=(value["result"] as? [String:Any])?["token"] as? String { invitationLink=(value["result"] as? [String:Any])?["invitationUrl"] as? String ?? token }
      if command.type == "voice.send", command.actor==credential?.user.id, command.workspace==selected,
        let value=try JSONSerialization.jsonObject(with:response) as? [String:Any], let source=(value["result"] as? [String:Any])?["sourceId"] as? String { voiceReplySourceID=source }
      guard result.commandId == command.id, result.status == "committed" else {
        throw APIError(code: "INVALID_RECEIPT", status: 0)
      }
    }
    try forget(command.id)
    committed=true
    if command.type == "workspace.create" {confirmedCreation=command}
    if command.type == "voice.send" {media.voiceCommitted(command,self)}
    onCommitted?()
    if command.type == "workspace.create" {
      selected = command.workspace
      workstreamFocus = nil
      messagesThrough = 0
      conversationLoaded = false
      state = nil
      detail = nil
      attention = nil
      resetActivityAndReference()
      invitationLink = nil
      messages = []
    }
    try await refreshSession()
    try requireCurrentSession()
    try await sync(force: true)
    } catch {
      // A response from an ended session cannot publish state or invalidate a
      // later login, including when the old response itself is an auth error.
      try requireCurrentSession()
      if committed {
        handle(error)
        self.error="Operazione registrata. L’aggiornamento dello spazio non è riuscito: " + self.error
        return
      }
      throw error
    }
  }
  @discardableResult func retry(_ command: PendingCommand) async -> Bool {
    guard !busy else { return false }
    busy = true
    defer { busy = false }
    let session = sessionGeneration
    var committed = false
    error = ""
    do {
      try await transmit(command) {committed=true}
    } catch { handle(error) }
    return committed && session == sessionGeneration
  }
  func recover(_ command: PendingCommand) async throws {
    guard let api, let c = credential, !c.logoutPending, command.actor == c.user.id, command.base == c.base else {
      return
    }
    let session = sessionGeneration
    do {
    let receipt = try await api.get(
      "workspaces/\(command.workspace)/receipts/\(command.id)", token: c.token, as: Receipt.self)
    guard session == sessionGeneration, !Task.isCancelled else {throw CancellationError()}
    guard receipt.commandId == command.id, receipt.status == "committed" else {
      throw APIError(code: "INVALID_RECEIPT", status: 0)
    }
    try forget(command.id)
    if command.type == "workspace.create" {confirmedCreation=command}
    if command.type == "voice.send" {media.voiceCommitted(command,self)}
    } catch {
      guard session == sessionGeneration, !Task.isCancelled else {throw CancellationError()}
      throw error
    }
  }
  private func recoverKnownReceipts() async throws {
    for command in pending {
      do { try await recover(command) } catch let error as APIError
        where [403, 404].contains(error.status)
      { continue }
    }
  }
  func discardReminder(_ command: PendingCommand) {
    do { try forget(command.id) } catch { handle(error) }
  }
  func logout() async {
    guard let api, var c = credential else { return }
    generation += 1
    state = nil
      detail = nil
      attention = nil
      resetActivityAndReference()
      invitationLink = nil
    calendar = nil
    activeWork = nil
    activeWorkBefore = ""
    tasks = nil
    tasksBefore = ""
    email = nil
    emailBefore = ""
    messages = []
    spaces = []
    selected = nil
    do {
      c.logoutPending = true
      var next = stored
      next.credential = c
      try persist(next)
      do { _ = try await api.data("native/session", method: "DELETE", token: c.token) } catch let
        error as APIError where error.status == 401
      { /* already revoked */  }
      next.credential = nil
      try persist(next)
      connection = "Disconnesso"
      loop?.cancel()
    } catch {
      self.error =
        "Logout da completare online. La sessione resta custodita per richiederne la revoca."
    }
  }
  private func handle(_ error: Error) {
    if error is CancellationError {return}
    self.error = error.localizedDescription
    if let e = error as? APIError {
      if e.status == 401 || e.code == "ACCOUNT_INELIGIBLE" {
        generation += 1
        var next = stored
        next.credential = nil
        do { try persist(next) } catch { self.error = "Impossibile aggiornare lo storage sicuro." }
        state = nil
      detail = nil
      attention = nil
      resetActivityAndReference()
      invitationLink = nil
        calendar = nil
        activeWork = nil
        activeWorkBefore = ""
        tasks = nil
        tasksBefore = ""
        email = nil
        emailBefore = ""
        messages = []
        spaces = []
        selected = nil
      } else if e.code == "WORKSPACE_ACCESS_DENIED" {
        generation += 1
        state = nil
      detail = nil
      attention = nil
      resetActivityAndReference()
      invitationLink = nil
        calendar = nil
        activeWork = nil
        activeWorkBefore = ""
        tasks = nil
        tasksBefore = ""
        email = nil
        emailBefore = ""
        messages = []
        selected = nil
      }
    }
  }
}
