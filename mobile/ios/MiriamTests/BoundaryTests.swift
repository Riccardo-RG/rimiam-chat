import XCTest

@testable import Miriam

@MainActor final class BoundaryTests: XCTestCase {
  func testRealSessionConversationPaginationRecoveryAndRevocation() async throws {
    let api = try API(base: "http://127.0.0.1:3102")
    let login = try JSONDecoder().decode(
      LoginResponse.self,
      from: await api.data(
        "native/session", method: "POST",
        body: ["email": "native-ios@example.test", "password": "Native-test-only-2026!"]))
    let list = try await api.get("workspaces", token: login.token, as: WorkspaceList.self)
    let w = try XCTUnwrap(
      list.workspaces.first(where: { $0.name == "Native shared verification" })?.id)
    let vault = Vault(service: "it.miriam.tests.\(UUID().uuidString)")
    let id = UUID().uuidString.lowercased()
    let pending = PendingCommand(
      id: id, base: api.base, actor: login.user.id, workspace: w, type: "message.send",
      content: "iOS native recovery \(id)")
    try vault.save(
      VaultState(
        credential: Credential(base: api.base, user: login.user, token: login.token),
        pending: [pending]))
    // Commit succeeds, but the app never applies the response to its durable journal.
    _ = try await api.data(
      "workspaces/\(w)/commands", method: "POST", token: login.token,
      body: ["commandId": id, "command": ["type": pending.type, "content": pending.content]])
    let restarted = WorkspaceModel(vault: vault)
    XCTAssertEqual(restarted.pending.first?.id, id)
    try await restarted.refreshSession()
    restarted.select(w)
    try await restarted.sync(force: true)
    try await restarted.recover(pending)
    XCTAssertTrue(restarted.pending.isEmpty)
    XCTAssertTrue(try vault.load().pending.isEmpty)
    XCTAssertEqual(restarted.messages.filter { $0.content == pending.content }.count, 1)
    let current = try XCTUnwrap(restarted.state)
    let page = try await api.get(
      "workspaces/\(w)/messages?after=0&through=\(current.messageSequence)&limit=1",
      token: login.token, as: MessagePage.self)
    XCTAssertEqual(page.messages.count, 1)
    XCTAssertEqual(page.through, current.messageSequence)
    // A suspended client catches up to an independently committed message.
    restarted.setForeground(false)
    let nextId = UUID().uuidString.lowercased()
    _ = try await api.data(
      "workspaces/\(w)/commands", method: "POST", token: login.token,
      body: [
        "commandId": nextId,
        "command": ["type": "message.send", "content": "While iOS inactive \(nextId)"],
      ])
    try await restarted.sync(force: true)
    XCTAssertGreaterThanOrEqual(restarted.state?.messageSequence ?? 0, current.messageSequence + 1)
    await restarted.logout()
    XCTAssertNil(restarted.credential)
    XCTAssertNil(try vault.load().credential)
    do {
      let _: SessionResponse = try await api.get(
        "native/session", token: login.token, as: SessionResponse.self)
      XCTFail("Revoked session accepted")
    } catch let error as APIError { XCTAssertEqual(error.status, 401) }
  }
  func testVoicePersistenceAndUnavailableCallingBoundary() async throws {
    let api=try API(base:"http://127.0.0.1:3102")
    let login=try JSONDecoder().decode(LoginResponse.self,from:await api.data("native/session",method:"POST",body:["email":"native-ios@example.test","password":"Native-test-only-2026!"]))
    let list=try await api.get("workspaces",token:login.token,as:WorkspaceList.self)
    let w=try XCTUnwrap(list.workspaces.first(where:{$0.name=="Native shared verification"})?.id)
    let audio=Data("RIFF....WAVE native iOS fixture".utf8),id=UUID().uuidString.lowercased()
    let body:[String:Any]=["commandId":id,"command":["type":"voice.send","filename":"voice.wav","bytesBase64":audio.base64EncodedString(),"mode":"miriam","allowModelProcessing":true]]
    let result=try await api.data("workspaces/\(w)/commands",method:"POST",token:login.token,body:body)
    _ = try await api.data("workspaces/\(w)/commands",method:"POST",token:login.token,body:body)
    let object=try XCTUnwrap(try JSONSerialization.jsonObject(with:result) as? [String:Any]);let source=try XCTUnwrap((object["result"] as? [String:Any])?["sourceId"] as? String)
    let voices=try await api.get("workspaces/\(w)/voice",token:login.token,as:ConversationVoiceSnapshot.self)
    XCTAssertEqual(voices.messages.filter{$0.sourceId==source}.count,1)
    let original=try await api.data("workspaces/\(w)/source-file?id=\(source)",token:login.token);XCTAssertEqual(original,audio)
    let calls=try await api.get("workspaces/\(w)/calls",token:login.token,as:AudioCallSnapshot.self);XCTAssertFalse(calls.configured);XCTAssertTrue(calls.consentText.contains("ADR-0009"))
    _ = try await api.data("native/session",method:"DELETE",token:login.token)
    do {_ = try await api.get("workspaces/\(w)/voice",token:login.token,as:ConversationVoiceSnapshot.self);XCTFail("Revoked session must not read voice history")}catch let error as APIError{XCTAssertEqual(error.status,401)}
  }
  func testPreDesignIntroductionLifecycleAndProvenance() async throws {
    let api = try API(base:"http://127.0.0.1:3102")
    let login = try JSONDecoder().decode(LoginResponse.self,from:await api.data("native/session",method:"POST",body:["email":"native-ios@example.test","password":"Native-test-only-2026!"]))
    let vault = Vault(service:"it.miriam.predesign.\(UUID().uuidString)")
    let w = UUID().uuidString.lowercased()
    let pending = PendingCommand(id:w,base:api.base,actor:login.user.id,workspace:w,type:"workspace.create",content:"Creazione iOS",commandJSON:"{\"name\":\"Creazione iOS\",\"description\":\"Descrizione conservata nel journal\"}")
    try vault.save(VaultState(credential:Credential(base:api.base,user:login.user,token:login.token),pending:[pending]))
    let restarted = WorkspaceModel(vault:vault)
    try await restarted.refreshSession()
    await restarted.retry(pending)
    XCTAssertTrue(restarted.error.isEmpty,restarted.error)
    XCTAssertTrue(try vault.load().pending.isEmpty)
    await restarted.retry(pending)
    let page = try await api.get("workspaces/\(w)/messages?after=0&through=2",token:login.token,as:MessagePage.self)
    XCTAssertEqual(page.messages.count,2)
    XCTAssertEqual(page.messages[0].purpose,"workspace_introduction")
    XCTAssertEqual(page.messages[0].content,"Descrizione conservata nel journal")
    XCTAssertEqual(page.messages[1].purpose,"workspace_welcome")
    XCTAssertEqual(page.messages[1].replyToSourceId,page.messages[0].id)
    let state = try await api.get("workspaces/\(w)/state",token:login.token,as:WorkspaceState.self)
    XCTAssertTrue(state.goals.isEmpty)
    func command(_ c:[String:Any]) async throws -> [String:Any] {
      let raw = try await api.data("workspaces/\(w)/commands",method:"POST",token:login.token,body:["commandId":UUID().uuidString.lowercased(),"command":c])
      return (try JSONSerialization.jsonObject(with:raw) as! [String:Any])["result"] as! [String:Any]
    }
    let stream = try await command(["type":"workstream.save","title":"Locale","description":""])
    for (index,action) in ["resolve","archive","reopen"].enumerated() {
      _ = try await command(["type":"workstream.transition","workstreamId":stream["id"]!,"expectedVersion":index+1,"action":action])
    }
    let attention = try await api.get("workspaces/\(w)/attention",token:login.token,as:AttentionSnapshot.self)
    XCTAssertEqual(attention.workstreams.first?.state,"active")
    XCTAssertEqual(attention.workstreams.first?.version,4)
    let spaces = try await api.get("workspaces",token:login.token,as:WorkspaceList.self)
    let fixture = try XCTUnwrap(spaces.workspaces.first{$0.name=="Pre-design provenance fixture"}?.id)
    let detail = try await api.get("workspaces/\(fixture)/workspace",token:login.token,as:WorkspaceDetail.self)
    XCTAssertEqual(detail.versions.count,2)
    XCTAssertTrue(detail.versions.allSatisfy{$0.qualification.contains("Ipotesi di test non verificata")})
    XCTAssertTrue(detail.candidates.allSatisfy{$0.origin=="inferred" && !$0.source_ids.isEmpty && $0.uses.isUsed})
    XCTAssertTrue(detail.candidates.contains{$0.uses.information.contains{!$0.current && $0.version==1}})
    await restarted.logout()
  }
  func testOriginPinningAndSecureJournal() throws {
    XCTAssertThrowsError(try API(base: "http://untrusted.example"))
    XCTAssertThrowsError(try API(base: "https://person:secret@example.test"))
    XCTAssertThrowsError(try API(base: "https://example.test/?token=unsafe"))
    let vault = Vault(service: "it.miriam.tests.\(UUID().uuidString)")
    XCTAssertNil(try vault.load().credential)
    let pending = PendingCommand(
      id: UUID().uuidString, base: "https://example.test", actor: "a", workspace: "w",
      type: "message.send", content: "Draft only")
    try vault.save(VaultState(pending: [pending]))
    XCTAssertEqual(try vault.load().pending.first?.content, "Draft only")
    try vault.save(VaultState())
    XCTAssertTrue(try vault.load().pending.isEmpty)
  }
  func testCreationRequiresReceiptAndPreservesRejectedDescription() async throws {
    let api = try API(base: "http://127.0.0.1:3102")
    let login = try JSONDecoder().decode(
      LoginResponse.self,
      from: await api.data(
        "native/session", method: "POST",
        body: ["email": "native-ios@example.test", "password": "Native-test-only-2026!"]))
    let vault = Vault(service: "it.miriam.creation.\(UUID().uuidString)")
    defer {try? vault.save(VaultState())}
    try vault.save(VaultState(credential:Credential(base:api.base,user:login.user,token:login.token)))
    let model = WorkspaceModel(vault:vault)
    let name = "Creazione con ricevuta iOS"
    // Zod counts Unicode code points; supplementary scalars use two UTF-16 units.
    let rejectedDescription = String(repeating:"🧭",count:2001)
    let rejected = await model.create(name,description:rejectedDescription)
    XCTAssertFalse(rejected,"A journal entry must not acknowledge an uncommitted creation")
    let pending = try XCTUnwrap(model.pending.first)
    let body = try XCTUnwrap(try JSONSerialization.jsonObject(with:Data(try XCTUnwrap(pending.commandJSON).utf8)) as? [String:String])
    XCTAssertEqual(body["description"],rejectedDescription,"Over-limit content must not be silently truncated")
    XCTAssertNil(model.selected)
    let duplicate = await model.create(name,description:rejectedDescription)
    XCTAssertFalse(duplicate)
    XCTAssertEqual(model.pending.map(\.id),[pending.id],"Retry must reuse the existing operation")

    let description = String(repeating:"🧭",count:2000)
    let committed = await model.create(name,description:description)
    XCTAssertTrue(committed,model.error)
    XCTAssertEqual(model.messages.first?.purpose,"workspace_introduction")
    XCTAssertEqual(model.messages.first?.content,description)
    XCTAssertTrue(try XCTUnwrap(model.state).goals.isEmpty)
    XCTAssertEqual(try vault.load().pending.map(\.id),[pending.id])
    await model.logout()
  }
  func testCreationUnknownOutcomeRecoveryAndConfirmedReceiptBeforeRefresh() async throws {
    let vault = Vault(service:"it.miriam.creation.transport.\(UUID().uuidString)")
    defer {try? vault.save(VaultState()); CreationURLProtocol.handler=nil}
    let model = try creationModel(vault:vault)
    CreationURLProtocol.handler = {$0.fail(URLError(.networkConnectionLost))}
    let description = "Introduzione conservata\nanche senza risposta"
    let unknown = await model.create("Rimiam",description:description)
    XCTAssertFalse(unknown)
    let pending = try XCTUnwrap(model.pending.first)
    XCTAssertNil(model.confirmedCreation)
    XCTAssertTrue(try XCTUnwrap(pending.commandJSON).contains("Introduzione conservata"))

    CreationURLProtocol.handler = {transport in
      transport.respond(status:200,body:["commandId":pending.id,"status":"committed","result":[:]])
    }
    try await model.recover(pending)
    XCTAssertTrue(model.pending.isEmpty)
    XCTAssertEqual(model.confirmedCreation?.id,pending.id,"Background recovery must notify the form of this exact receipt")
    XCTAssertEqual(model.confirmedCreation?.commandJSON,pending.commandJSON)

    CreationURLProtocol.handler = {transport in
      if transport.request.httpMethod == "POST" {
        transport.respond(status:200,body:["id":transport.body["commandId"] ?? ""])
      } else {
        transport.respond(status:503,body:["error":["code":"TEMPORARY_FAILURE"]])
      }
    }
    let committed = await model.create("Confermato",description:"Il successivo refresh può fallire")
    XCTAssertTrue(committed,"A later read failure must not turn a verified creation into a fresh retry")
    XCTAssertTrue(model.pending.isEmpty)
    XCTAssertEqual(model.confirmedCreation?.content,"Confermato")
    XCTAssertTrue(model.error.hasPrefix("Operazione registrata."),"A refresh failure must be qualified separately from the committed operation")
  }
  func testLateCreationResponseCannotPublishAfterLogout() async throws {
    for status in [200,401] {
      let vault = Vault(service:"it.miriam.creation.late.\(UUID().uuidString)")
      defer {try? vault.save(VaultState()); CreationURLProtocol.handler=nil}
      let model = try creationModel(vault:vault)
      let session = model.sessionGeneration
      let arrived = expectation(description:"Creation is waiting for its response")
      var held: CreationURLProtocol?
      CreationURLProtocol.handler = {transport in
        if transport.request.httpMethod == "POST" {
          held=transport;arrived.fulfill()
        } else {
          transport.respond(status:200,body:[:])
        }
      }
      let creation = Task {await model.create("Vecchia sessione",description:"Non pubblicare dopo l’uscita")}
      let result = await XCTWaiter.fulfillment(of:[arrived],timeout:3)
      XCTAssertEqual(result,.completed)
      let transport = try XCTUnwrap(held)
      let pending = try XCTUnwrap(model.pending.first)
      await model.logout()
      XCTAssertGreaterThan(model.sessionGeneration,session)
      let errorAfterLogout = model.error
      transport.respond(status:status,body:status == 200 ? ["id":pending.id] : ["error":["code":"AUTHENTICATION_REQUIRED"]])
      let accepted = await creation.value
      XCTAssertFalse(accepted)
      XCTAssertNil(model.credential)
      XCTAssertNil(model.selected)
      XCTAssertNil(model.confirmedCreation)
      XCTAssertEqual(model.error,errorAfterLogout,"Late errors belong to the ended session")
      XCTAssertEqual(try vault.load().pending.map(\.id),[pending.id],"Unknown old-session outcome must retain its exact recovery command")
    }
  }
  func testFocusedConversationUsesCurrentLinksAndRejectsStaleSelection() async throws {
    let api=try API(base:"http://127.0.0.1:3102")
    let login=try JSONDecoder().decode(LoginResponse.self,from:await api.data("native/session",method:"POST",body:["email":"native-ios@example.test","password":"Native-test-only-2026!"]))
    let vault=Vault(service:"it.miriam.focus.\(UUID().uuidString)")
    defer {try? vault.save(VaultState())}
    try vault.save(VaultState(credential:Credential(base:api.base,user:login.user,token:login.token)))
    let model=WorkspaceModel(vault:vault)
    let created=await model.create("Focus iOS",description:"La stessa conversazione condivisa")
    XCTAssertTrue(created,model.error)
    let workspace=try XCTUnwrap(model.selected)
    func command(_ body:[String:Any]) async throws -> [String:Any] {
      let data=try await api.data("workspaces/\(workspace)/commands",method:"POST",token:login.token,body:["commandId":UUID().uuidString.lowercased(),"command":body])
      return try XCTUnwrap((try JSONSerialization.jsonObject(with:data) as? [String:Any])?["result"] as? [String:Any])
    }
    let result=try await command(["type":"workstream.save","title":"Un filone","description":"Un focus, non un altro spazio"])
    let streamID=try XCTUnwrap(result["id"] as? String)
    await model.loadAttention()
    let stream=try XCTUnwrap(model.attention?.workstreams.first(where:{$0.id == streamID}))
    model.selectWorkstream(stream)
    try await model.sync(force:true)
    XCTAssertTrue(model.messages.isEmpty)
    let sent=await model.send("Messaggio nel filone")
    XCTAssertTrue(sent,model.error)
    XCTAssertEqual(model.messages.first?.workstreamFocus,WorkstreamFocus(workstreamId:streamID,version:1))
    _ = try await command(["type":"message.send","content":"Messaggio generale successivo"])
    try await model.sync(force:true)
    XCTAssertEqual(model.messages.map(\.content),["Messaggio nel filone"],"A sparse focused window must not become an incomplete sync")
    let head=try XCTUnwrap(model.state)
    let all=try await api.get("workspaces/\(workspace)/history?through=\(head.messageSequence)&limit=50",token:login.token,as:HistoryPage.self)
    let general=try XCTUnwrap(all.messages.first(where:{$0.content == "Messaggio generale successivo"}))
    _ = try await command(["type":"workstream.link","workstreamId":streamID,"sourceId":general.id,"expectedVersion":0,"included":true])
    try await model.sync(force:true)
    XCTAssertTrue(model.messages.contains(where:{$0.id == general.id && $0.workstreamFocus == nil}),"Current membership must not rewrite immutable original focus")
    _ = try await command(["type":"workstream.link","workstreamId":streamID,"sourceId":general.id,"expectedVersion":1,"included":false])
    try await model.sync(force:true)
    XCTAssertFalse(model.messages.contains(where:{$0.id == general.id}),"An excluded historical row must disappear from the focused window")
    for index in 0..<52 {_ = try await command(["type":"message.send","content":"Storia del filone \(index)","workstreamFocus":["workstreamId":streamID,"version":1]])}
    try await model.sync(force:true)
    XCTAssertEqual(model.messages.count,53,"A refresh must retain the already loaded historical message")
    model.selectWorkstream(nil)
    try await model.sync(force:true)
    model.selectWorkstream(stream)
    try await model.sync(force:true)
    XCTAssertEqual(model.messages.count,53,"Returning to a focus rereads the full previously loaded window")
    model.select(workspace)
    try await model.sync(force:true)
    model.selectWorkstream(stream)
    try await model.sync(force:true)
    XCTAssertEqual(model.messages.first?.content,"Messaggio nel filone")
    _ = try await command(["type":"workstream.transition","workstreamId":streamID,"expectedVersion":1,"action":"resolve"])
    try await model.sync(force:true)
    await model.loadAttention()
    XCTAssertTrue(model.focusIsStale)
    let staleSend=await model.send("Non deve essere inviato")
    XCTAssertFalse(staleSend)
    XCTAssertTrue(model.pending.isEmpty)
    model.selectWorkstream(nil)
    try await model.sync(force:true)
    XCTAssertTrue(model.messages.contains(where:{$0.id == general.id}))
    XCTAssertTrue(try XCTUnwrap(model.state).goals.isEmpty)
    await model.logout()
  }
  func testActivityReferencesRemainExactThroughFocusAndHistory() async throws {
    let api=try API(base:"http://127.0.0.1:3102")
    let login=try JSONDecoder().decode(LoginResponse.self,from:await api.data("native/session",method:"POST",body:["email":"native-ios@example.test","password":"Native-test-only-2026!"]))
    let vault=Vault(service:"it.miriam.reference.\(UUID().uuidString)")
    defer {try? vault.save(VaultState())}
    try vault.save(VaultState(credential:Credential(base:api.base,user:login.user,token:login.token)))
    let model=WorkspaceModel(vault:vault)
    let created=await model.create("Activity iOS",description:"Passaggi condivisi")
    XCTAssertTrue(created,model.error)
    let workspace=try XCTUnwrap(model.selected)
    func command(_ body:[String:Any]) async throws -> [String:Any] {
      let data=try await api.data("workspaces/\(workspace)/commands",method:"POST",token:login.token,body:["commandId":UUID().uuidString.lowercased(),"command":body])
      return try XCTUnwrap((try JSONSerialization.jsonObject(with:data) as? [String:Any])?["result"] as? [String:Any])
    }
    let result=try await command(["type":"workstream.save","title":"Passaggio originale","description":"Versione da poter discutere"])
    let streamID=try XCTUnwrap(result["id"] as? String)
    await model.loadActivity(force:true)
    let event=try XCTUnwrap(model.activity?.events.first(where:{$0.reference.kind == .workstream && $0.reference.id == streamID}))
    XCTAssertEqual(event.reference.eventId,event.eventId)
    await model.loadAttention()
    let stream=try XCTUnwrap(model.attention?.workstreams.first(where:{$0.id == streamID}))
    model.selectWorkstream(stream)
    try await model.sync(force:true)
    let sent=await model.send("Discussione del passaggio preciso",reference:event.reference)
    XCTAssertTrue(sent,model.error)
    let message=try XCTUnwrap(model.messages.first(where:{$0.content == "Discussione del passaggio preciso"}))
    XCTAssertEqual(message.reference,event.reference)
    XCTAssertEqual(message.workstreamFocus,WorkstreamFocus(workstreamId:streamID,version:1))
    _ = try await command(["type":"workstream.transition","workstreamId":streamID,"expectedVersion":1,"action":"resolve"])
    model.selectWorkstream(nil)
    try await model.sync(force:true)
    XCTAssertEqual(model.messages.first(where:{$0.id == message.id})?.reference,event.reference)
    let detail=try await api.get("workspaces/\(workspace)/" + event.reference.resource,token:login.token,as:ReferenceDetail.self)
    XCTAssertEqual(detail.reference,event.reference)
    XCTAssertEqual(detail.event?.eventId,event.eventId)
    XCTAssertFalse(detail.current,"The original reference must not rebase to the new stream version")
    XCTAssertEqual(detail.actor,login.user.id)
    XCTAssertEqual(detail.provenance["recordedLifecycle"]?.text,"active")
    let introduction=try XCTUnwrap(model.messages.first(where:{$0.purpose == "workspace_introduction"}))
    let sourceReference=ConversationReference(kind:.source,id:introduction.id,version:1,eventId:nil)
    let source=try await api.get("workspaces/\(workspace)/" + sourceReference.resource,token:login.token,as:ReferenceDetail.self)
    XCTAssertEqual(source.content,"Passaggi condivisi")
    XCTAssertEqual(source.sourceIds,[introduction.id])
    let voice=try await command(["type":"voice.send","filename":"reference.wav","bytesBase64":Data("RIFF....WAVE iOS reference".utf8).base64EncodedString(),"mode":"message","allowModelProcessing":true,"reference":event.reference.json])
    let voiceID=try XCTUnwrap(voice["messageId"] as? String)
    try await model.sync(force:true)
    XCTAssertEqual(model.messages.first(where:{$0.id == voiceID})?.reference,event.reference)
    XCTAssertTrue(try XCTUnwrap(model.state).goals.isEmpty)
    await model.logout()
  }
  func testReferenceJournalPreservesOpaqueEventAndUnknownOutcome() async throws {
    let vault=Vault(service:"it.miriam.reference.unknown.\(UUID().uuidString)")
    defer {try? vault.save(VaultState());CreationURLProtocol.handler=nil}
    let model=try creationModel(vault:vault)
    model.select(UUID().uuidString.lowercased())
    let reference=ConversationReference(kind:.artifact,id:UUID().uuidString.lowercased(),version:7,eventId:"artifact:event:7:adopted:opaque+&=à")
    let query=URLComponents(string:reference.resource)?.queryItems
    XCTAssertEqual(query?.first(where:{$0.name == "eventId"})?.value,reference.eventId)
    CreationURLProtocol.handler={$0.fail(URLError(.networkConnectionLost))}
    let saved=await model.send("Conserva la domanda originale",reference:reference)
    XCTAssertTrue(saved,"Generic contributions keep their durable-journal acknowledgement")
    let pending=try XCTUnwrap(model.pending.first)
    let raw=try XCTUnwrap(pending.commandJSON)
    let body=try XCTUnwrap(try JSONSerialization.jsonObject(with:Data(raw.utf8)) as? [String:Any])
    let payload=try XCTUnwrap(body["reference"] as? [String:Any])
    let captured=try JSONDecoder().decode(ConversationReference.self,from:JSONSerialization.data(withJSONObject:payload))
    XCTAssertEqual(captured,reference)
    XCTAssertTrue(model.messages.isEmpty)
  }
  func testLateActivityResponseCannotPublishAfterLogout() async throws {
    for status in [200,401] {
      let vault=Vault(service:"it.miriam.activity.late.\(UUID().uuidString)")
      defer {try? vault.save(VaultState());CreationURLProtocol.handler=nil}
      let model=try creationModel(vault:vault)
      model.select(UUID().uuidString.lowercased())
      let arrived=expectation(description:"Activity is waiting for its response")
      var held:CreationURLProtocol?
      CreationURLProtocol.handler={transport in
        if transport.request.url?.path.hasSuffix("/activity") == true {held=transport;arrived.fulfill()}
        else {transport.respond(status:200,body:[:])}
      }
      let request=Task {await model.loadActivity(force:true)}
      let result=await XCTWaiter.fulfillment(of:[arrived],timeout:3)
      XCTAssertEqual(result,.completed)
      let transport=try XCTUnwrap(held)
      await model.logout()
      let errorAfterLogout=model.error
      transport.respond(status:status,body:status == 200 ? ["events":[],"next":NSNull()] : ["error":["code":"AUTHENTICATION_REQUIRED"]])
      await request.value
      XCTAssertNil(model.activity)
      XCTAssertFalse(model.activityLoading)
      XCTAssertTrue(model.activityError.isEmpty)
      XCTAssertEqual(model.error,errorAfterLogout)
      XCTAssertNil(model.credential)
    }
  }
  func testOlderWorkDetailAndGlobalAttentionDoNotDependOnFirstPage() async throws {
    let vault=Vault(service:"it.miriam.work.lookup.\(UUID().uuidString)")
    defer {try? vault.save(VaultState());CreationURLProtocol.handler=nil}
    let model=try creationModel(vault:vault)
    model.select(UUID().uuidString.lowercased())
    let id=UUID().uuidString.lowercased(),cursor=UUID().uuidString.lowercased()
    var workPages=0
    CreationURLProtocol.handler={transport in
      if transport.request.url?.path.hasSuffix("/attention") == true {
        let items=(0..<22).map{["kind":"work","id":"work-\($0)","text":"Lavoro \($0)","reason":"Miriam ha bisogno di un chiarimento"]}
        transport.respond(status:200,body:["revision":1,"alignedRevision":0,"nextBefore":NSNull(),"changes":[],"attention":items,"preference":["version":0,"mode":"discreet","actor":NSNull()],"workstreams":[]])
      } else {
        workPages += 1
        let before=URLComponents(url:transport.request.url!,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name == "before"})?.value
        let work:[String:Any]=["id":id,"revision":4,"phase":"needs_input","validity":"valid","error":NSNull(),"contract":["version":2,"objective":"Lavoro precedente","scope":"Condiviso","expectedOutput":"Un risultato","anchors":[],"origin":"human","actor":NSNull(),"createdAt":"2026-09-14T08:00:00Z"],"issues":[],"contribution":NSNull()]
        transport.respond(status:200,body:["works":before == cursor ? [work] : [],"events":[],"next":before == cursor ? NSNull() : cursor as Any,"canControl":true,"suggestions":[]])
      }
    }
    await model.loadAttention()
    XCTAssertEqual(model.workAttentionCount,22)
    let detail=try await model.activeWorkDetail(id)
    XCTAssertEqual(detail.works.first?.id,id)
    XCTAssertEqual(workPages,2)
    XCTAssertNil(model.activeWork,"An exact detail must not replace the shared list page")
  }
  func testLateSharedSourceAndWorkHistoryErrorsDoNotReplaceLogoutState() async throws {
    for sourceRead in [true,false] {
      let vault=Vault(service:"it.miriam.history.late.\(UUID().uuidString)")
      defer {try? vault.save(VaultState());CreationURLProtocol.handler=nil}
      let model=try creationModel(vault:vault)
      model.select(UUID().uuidString.lowercased())
      let arrived=expectation(description:"Shared historical read awaits its response")
      var held:CreationURLProtocol?
      CreationURLProtocol.handler={transport in
        if transport.request.httpMethod == "GET" {held=transport;arrived.fulfill()}
        else {transport.respond(status:200,body:[:])}
      }
      let request=Task {
        if sourceRead {_ = await model.sourceBytes(UUID().uuidString.lowercased())}
        else {_ = await model.activeWorkHistory(UUID().uuidString.lowercased())}
      }
      let result=await XCTWaiter.fulfillment(of:[arrived],timeout:3)
      XCTAssertEqual(result,.completed)
      let transport=try XCTUnwrap(held)
      await model.logout()
      let errorAfterLogout=model.error
      transport.respond(status:401,body:["error":["code":"AUTHENTICATION_REQUIRED"]])
      await request.value
      XCTAssertEqual(model.error,errorAfterLogout)
      XCTAssertNil(model.credential)
    }
  }
  func testHandoffUnknownOutcomePreservesExactOriginAndRejectsFreshDuplicate() async throws {
    let vault=Vault(service:"it.miriam.handoff.unknown.\(UUID().uuidString)")
    defer {try? vault.save(VaultState());CreationURLProtocol.handler=nil}
    let model=try creationModel(vault:vault)
    model.select(UUID().uuidString.lowercased())
    let id=UUID().uuidString.lowercased(),source=UUID().uuidString.lowercased()
    let fixture=handoffFixture(id:id,source:source)
    var posts=0
    CreationURLProtocol.handler={transport in
      if transport.request.url?.path.hasSuffix("/handoffs") == true {transport.respond(status:200,body:["handoffs":[fixture]])}
      else {posts += 1;transport.fail(URLError(.networkConnectionLost))}
    }
    let loaded=await model.loadHandoffs(sourceID:source)
    XCTAssertTrue(loaded)
    let handoff=try XCTUnwrap(model.handoffs.first)
    let content="Testo rivisto dalla persona prima dell’atto"
    let committed=await model.handoffCommand(["type":"goal.establish","content":content],handoff:handoff,label:content)
    XCTAssertFalse(committed)
    let pending=try XCTUnwrap(model.pendingHandoff(id))
    let body=try XCTUnwrap(try JSONSerialization.jsonObject(with:Data(try XCTUnwrap(pending.commandJSON).utf8)) as? [String:Any])
    XCTAssertEqual((body["conversationOrigin"] as? [String:String])?["handoffId"],id)
    XCTAssertEqual(body["content"] as? String,content)
    let duplicate=await model.handoffCommand(["type":"goal.establish","content":"Nuovo testo"],handoff:handoff,label:"Nuovo testo")
    XCTAssertFalse(duplicate)
    XCTAssertEqual(posts,1)
    XCTAssertEqual(model.pending.map(\.id),[pending.id])
    XCTAssertNil(model.state)
  }
  func testHandoffSourceLookupPreservesHistoryAndNewerStatus() async throws {
    let vault=Vault(service:"it.miriam.handoff.history.\(UUID().uuidString)")
    defer {try? vault.save(VaultState());CreationURLProtocol.handler=nil}
    let model=try creationModel(vault:vault)
    model.select(UUID().uuidString.lowercased())
    let id=UUID().uuidString.lowercased(),source=UUID().uuidString.lowercased()
    let ready=handoffFixture(id:id,source:source)
    var applied=ready;applied["status"]="applied"
    applied["application"]=["actor":"creation-user","commandId":UUID().uuidString.lowercased(),"commandType":"goal.establish","createdAt":"2026-09-14T08:00:00Z","resultReference":["kind":"goal","id":UUID().uuidString.lowercased(),"version":1],"prepared":NSNull()]
    CreationURLProtocol.handler={transport in transport.respond(status:200,body:["handoffs":transport.request.url?.query == nil ? [] : [ready]])}
    _ = await model.loadHandoffs()
    XCTAssertTrue(model.handoffs.isEmpty)
    _ = await model.loadHandoffs(sourceID:source)
    XCTAssertEqual(model.handoffs.first?.id,id,"The default window is not a boundary on history")
    _ = await model.loadHandoffs()
    XCTAssertEqual(model.handoffs.first?.id,id)
    let arrived=expectation(description:"Earlier handoff read is held")
    var held:CreationURLProtocol?
    CreationURLProtocol.handler={transport in held=transport;arrived.fulfill()}
    let older=Task {await model.loadHandoffs(sourceID:source)}
    let waitResult=await XCTWaiter.fulfillment(of:[arrived],timeout:3)
    XCTAssertEqual(waitResult,.completed)
    let transport=try XCTUnwrap(held)
    CreationURLProtocol.handler={$0.respond(status:200,body:["handoffs":[applied]])}
    _ = await model.loadHandoffs(sourceID:source)
    transport.respond(status:200,body:["handoffs":[ready]])
    _ = await older.value
    XCTAssertEqual(model.handoffs.first?.status,"applied")
    XCTAssertFalse(model.canApplyHandoff(try XCTUnwrap(model.handoffs.first)))
  }
  func testConversationHandoffEstablishesOnlyExplicitEditedGoal() async throws {
    let api=try API(base:"http://127.0.0.1:3102")
    let login=try JSONDecoder().decode(LoginResponse.self,from:await api.data("native/session",method:"POST",body:["email":"native-ios@example.test","password":"Native-test-only-2026!"]))
    let vault=Vault(service:"it.miriam.handoff.real.\(UUID().uuidString)")
    defer {try? vault.save(VaultState())}
    try vault.save(VaultState(credential:Credential(base:api.base,user:login.user,token:login.token)))
    let model=WorkspaceModel(vault:vault)
    let created=await model.create("Handoff iOS",description:"La proposta resta distinta dall’atto")
    XCTAssertTrue(created,model.error)
    let sent=await model.send("@Miriam Native handoff goal iOS " + UUID().uuidString.lowercased())
    XCTAssertTrue(sent,model.error)
    let source=try XCTUnwrap(model.messages.last(where:{$0.actorKind != "miriam"}))
    for _ in 0..<30 {
      _ = await model.loadHandoffs(sourceID:source.id)
      if !model.handoffs.isEmpty {break}
      try await Task.sleep(for:.milliseconds(300))
    }
    let handoff=try XCTUnwrap(model.handoffs.first(where:{$0.sourceMessageId == source.id}))
    XCTAssertEqual(handoff.kind,.goalEstablish)
    XCTAssertEqual(handoff.status,"ready")
    XCTAssertTrue(try XCTUnwrap(model.state).goals.isEmpty)
    let edited="Goal esplicito rivisto su iOS " + UUID().uuidString.lowercased()
    let committed=await model.handoffCommand(["type":"goal.establish","content":edited],handoff:handoff,label:edited)
    XCTAssertTrue(committed,model.error)
    let goal=try XCTUnwrap(model.state?.goals.first)
    XCTAssertEqual(goal.content,edited)
    let applied=try XCTUnwrap(model.handoffs.first(where:{$0.id == handoff.id}))
    XCTAssertEqual(applied.status,"applied")
    XCTAssertEqual(applied.application?.actor,login.user.id)
    XCTAssertEqual(applied.application?.resultReference,ConversationReference(kind:.goal,id:goal.id,version:1,eventId:nil))
    XCTAssertFalse(model.canApplyHandoff(applied))
    await model.logout()
  }
  private func handoffFixture(id:String,source:String)->[String:Any] {
    ["id":id,"sourceId":source,"sourceMessageId":source,"kind":"goal.establish","summary":"Prepara il Goal","suggestedText":"Indicazione da modificare","target":NSNull(),"candidateId":NSNull(),"sourceIds":[source],"status":"ready","createdAt":"2026-09-14T08:00:00Z","application":NSNull()]
  }
  private func creationModel(vault:Vault) throws -> WorkspaceModel {
    let base = "https://creation.example.test"
    try vault.save(VaultState(credential:Credential(base:base,user:Person(id:"creation-user",name:"Persona",email:"creation@example.test"),token:"test-session")))
    return WorkspaceModel(vault:vault,apiFactory:{base in
      let configuration = URLSessionConfiguration.ephemeral
      configuration.protocolClasses = [CreationURLProtocol.self]
      return try API(base:base,configuration:configuration)
    })
  }
}

private final class CreationURLProtocol: URLProtocol, @unchecked Sendable {
  // URLSession enters on its own queue. Transfer only the immutable transport
  // handle; fixture state and all response delivery stay on the main actor.
  private struct Delivery: @unchecked Sendable {
    let transport:CreationURLProtocol
    @MainActor func deliver() {CreationURLProtocol.handler?(transport)}
  }
  @MainActor static var handler: ((CreationURLProtocol) -> Void)?
  override class func canInit(with request:URLRequest) -> Bool {request.url?.host == "creation.example.test"}
  override class func canonicalRequest(for request:URLRequest) -> URLRequest {request}
  override func startLoading() {
    let delivery=Delivery(transport:self)
    Task {@MainActor in delivery.deliver()}
  }
  override func stopLoading() {}
  @MainActor var body: [String:Any] {
    var data = request.httpBody ?? Data()
    if data.isEmpty, let stream=request.httpBodyStream {
      stream.open();defer {stream.close()}
      var buffer=[UInt8](repeating:0,count:1024)
      while stream.hasBytesAvailable {
        let count=stream.read(&buffer,maxLength:buffer.count)
        guard count > 0 else {break}
        data.append(contentsOf:buffer.prefix(count))
      }
    }
    return (try? JSONSerialization.jsonObject(with:data) as? [String:Any]) ?? [:]
  }
  @MainActor func respond(status:Int,body:[String:Any]) {
    let response=HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["X-Miriam-API-Version":"1","Content-Type":"application/json"])!
    client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
    client?.urlProtocol(self,didLoad:try! JSONSerialization.data(withJSONObject:body))
    client?.urlProtocolDidFinishLoading(self)
  }
  @MainActor func fail(_ error:Error) {client?.urlProtocol(self,didFailWithError:error)}
}
