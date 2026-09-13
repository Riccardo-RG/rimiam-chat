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
}
