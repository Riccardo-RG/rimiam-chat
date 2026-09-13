import Foundation
import Observation

@MainActor @Observable final class WorkspaceModel {
  var mediaBoundary:String { [credential?.user.id ?? "", selected ?? "", String(credential?.logoutPending ?? false)].joined(separator:":") }
  let media = WorkspaceMedia()
  private(set) var voiceReplySourceID: String?
  private let vault: Vault
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
  private(set) var hasOlder = false
  private(set) var busy = false
  private(set) var connection = "Non connesso"
  var error = ""
  var accountNotice = ""
  var credential: Credential? { stored.credential }
  var pending: [PendingCommand] {
    stored.pending.filter { $0.actor == credential?.user.id && $0.base == credential?.base }
  }
  init(vault: Vault = Vault()) {
    self.vault = vault
    do {
      stored = try vault.load()
      if let c = credential { api = try API(base: c.base) }
    } catch { self.error = error.localizedDescription }
  }
  private func persist(_ next: VaultState) throws {
    try vault.save(next)
    stored = next
  }
  private func forget(_ id: String) throws {
    var next = stored
    next.pending.removeAll { $0.id == id }
    try persist(next)
  }
  func requestAccount(base:String,action:String,email:String,name:String="",password:String="") async {
    guard !busy else{return};busy=true;error="";accountNotice="";defer{busy=false}
    do {let client=try API(base:base);var body:[String:Any]=["action":action,"email":email]
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
      let client = try API(base: base)
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
    let _: SessionResponse = try await api.get(
      "native/session", token: c.token, as: SessionResponse.self)
    let list = try await api.get("workspaces", token: c.token, as: WorkspaceList.self)
    guard epoch == generation, c.token == credential?.token, !Task.isCancelled else { return }
    spaces = list.workspaces
    if selected == nil || !spaces.contains(where: { $0.id == selected }) {
      selected = spaces.first?.id
      state = nil
      detail = nil
      attention = nil
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
  }
  func select(_ id: String) {
    selected = id
    state = nil
      detail = nil
      attention = nil
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
  func sync(force: Bool = false) async throws {
    guard !syncing, let api, let c = credential, let w = selected else { return }
    syncing = true
    defer { syncing = false }
    let epoch = generation
    var reset = false
    if !force, let current = state {
      do {
        let changes = try await api.get(
          "workspaces/\(w)/changes?after=\(current.workspace.revision)&limit=1", token: c.token,
          as: Changes.self)
        if changes.headRevision == current.workspace.revision && calendar != nil { return }
      } catch let error as APIError
        where ["CURSOR_AHEAD", "SYNC_RESET_REQUIRED"].contains(error.code)
      {
        reset = true
      }
    }
    let head = try await api.get("workspaces/\(w)/state", token: c.token, as: WorkspaceState.self)
    var merged = messages
    var older = hasOlder
    if state == nil || reset || (messages.last?.sequence ?? 0) > head.messageSequence {
      let page = try await api.get(
        "workspaces/\(w)/history?through=\(head.messageSequence)&limit=50", token: c.token,
        as: HistoryPage.self)
      merged = page.messages
      older = page.hasMore
    }
    var after = merged.last?.sequence ?? 0
    while after < head.messageSequence {
      let page = try await api.get(
        "workspaces/\(w)/messages?after=\(after)&through=\(head.messageSequence)&limit=50",
        token: c.token, as: MessagePage.self)
      guard page.nextAfter > after, page.through == head.messageSequence else {
        throw APIError(code: "SYNC_INCOMPLETE", status: 0)
      }
      merged.append(contentsOf: page.messages)
      after = page.nextAfter
    }
    let detailHead = try await api.get("workspaces/\(w)/workspace", token: c.token, as: WorkspaceDetail.self)
    let calendarHead = try await api.get(
      "workspaces/\(w)/calendar?\(calendarQuery)", token: c.token, as: CalendarSnapshot.self)
    guard epoch == generation, selected == w, credential?.token == c.token, !Task.isCancelled else {
      return
    }
    // Publish data and acknowledged revision together only after every required page arrived.
    messages = merged
    hasOlder = older
    state = head
    detail = detailHead
    calendar = calendarHead
    connection = "Aggiornato"
  }
  func loadOlder() async {
    guard !syncing, let api, let c = credential, let w = selected, let head = state,
      let first = messages.first
    else { return }
    syncing = true
    defer { syncing = false }
    let epoch = generation
    do {
      let page = try await api.get(
        "workspaces/\(w)/history?before=\(first.sequence)&through=\(head.messageSequence)&limit=50",
        token: c.token, as: HistoryPage.self)
      guard epoch == generation, selected == w, credential?.token == c.token else { return }
      messages = page.messages + messages
      hasOlder = page.hasMore
    } catch { handle(error) }
  }
  @discardableResult func send(_ content: String) async -> Bool {
    guard let w = selected else { return false }
    return await prepare(type: "message.send", workspace: w, content: content)
  }
  @discardableResult func create(_ name: String) async -> Bool {
    await prepare(
      type: "workspace.create", workspace: UUID().uuidString.lowercased(), content: name)
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
  func activeWorkHistory(_ id: String, before: Int? = nil) async -> String {
    guard let api, let c = credential, !c.logoutPending, let w = selected else { return "" }
    let epoch = generation
    do {
      let data = try await api.data(
        "workspaces/\(w)/active-work-history?id=\(id)" + (before.map { "&before=\($0)" } ?? ""),
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
  @discardableResult func workspaceCommand(_ body: [String: Any], label: String) async -> Bool {
    guard !busy, let c = credential, let w = selected else { return false }
    busy = true
    error = ""
    defer { busy = false }
    var saved = false
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
      try await transmit(command)
    } catch { handle(error) }
    return saved
  }
  private func prepare(type: String, workspace: String, content: String) async -> Bool {
    guard !busy, let c = credential,
      !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return false }
    busy = true
    defer { busy = false }
    error = ""
    var saved = false
    do {
      let id = type == "workspace.create" ? workspace : UUID().uuidString.lowercased()
      let command = PendingCommand(
        id: id, base: c.base, actor: c.user.id, workspace: workspace, type: type, content: content)
      var next = stored
      next.pending.append(command)
      try persist(next)
      saved = true
      try await transmit(command)
    } catch { handle(error) }
    return saved
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
    if let data=try? JSONDecoder().decode(AttentionSnapshot.self,from:Data(raw.utf8)) {attention=data}
  }
  func sourceBytes(_ id:String) async -> Data? {
    guard let api,let c=credential,!c.logoutPending,let w=selected else{return nil};let epoch=generation
    do {let bytes=try await api.data("workspaces/\(w)/source-file?id=\(id)",token:c.token)
      guard epoch==generation,selected==w,credential?.token==c.token,credential?.logoutPending != true,!Task.isCancelled else{return nil}
      return bytes
    } catch {handle(error);return nil}
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
    guard let api,let c=credential,let w=selected else{return ""};let epoch=generation
    do {let data=try await api.data("workspaces/\(w)/\(resource)",token:c.token)
      guard epoch==generation,selected==w,credential?.token==c.token,!Task.isCancelled else{return ""}
      return String(data:data,encoding:.utf8) ?? ""
    } catch {handle(error);return ""}
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
  private func transmit(_ command: PendingCommand) async throws {
    guard let api, let c = credential, c.user.id == command.actor, c.base == command.base,
      !c.logoutPending
    else { throw APIError(code: "AUTHENTICATION_REQUIRED", status: 401) }
    if command.type == "workspace.create" {
      let result = try JSONDecoder().decode(
        CreatedWorkspace.self,
        from: await api.data(
          "workspaces", method: "POST", token: c.token,
          body: ["commandId": command.id, "name": command.content]))
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
    if command.type == "workspace.create" {
      selected = command.workspace
      state = nil
      detail = nil
      attention = nil
      invitationLink = nil
      messages = []
    }
    try await refreshSession()
    try await sync(force: true)
  }
  func retry(_ command: PendingCommand) async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    do {
      try await transmit(command)
      error = ""
    } catch { handle(error) }
  }
  func recover(_ command: PendingCommand) async throws {
    guard let api, let c = credential, command.actor == c.user.id, command.base == c.base else {
      return
    }
    let receipt = try await api.get(
      "workspaces/\(command.workspace)/receipts/\(command.id)", token: c.token, as: Receipt.self)
    guard receipt.commandId == command.id, receipt.status == "committed" else {
      throw APIError(code: "INVALID_RECEIPT", status: 0)
    }
    try forget(command.id)
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
