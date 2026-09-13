import XCTest

@testable import Miriam

@MainActor final class EmailTests: XCTestCase {
  func testPrivateReadExactSendJournalRecoveryAndReconciliation() async throws {
    // Respect the real shared-IP sign-in limiter when the model suite runs together.
    try await Task.sleep(for: .seconds(10.1))
    let vault = Vault(service: "it.miriam.email.tests.\(UUID().uuidString)")
    let model = WorkspaceModel(vault: vault)
    await model.login(
      base: "http://127.0.0.1:3102", email: "native-ios@example.test",
      password: "Native-test-only-2026!")
    model.setForeground(false)
    let workspace = try XCTUnwrap(model.spaces.first { $0.name == "Workspace ios di verifica" })
    model.select(workspace.id)
    await model.loadEmail()
    let initial = try XCTUnwrap(model.email)
    let mailbox = try XCTUnwrap(initial.connections.first { $0.active })
    await model.workspaceCommand(
      [
        "type": "email.read", "connectionId": mailbox.id,
        "request": ["mode": "search", "query": "locale"],
      ], label: "Lettura privata")
    for _ in 0..<40 {
      await model.loadEmail()
      if model.email?.observations.isEmpty == false { break }
      try await Task.sleep(for: .milliseconds(250))
    }
    XCTAssertEqual(model.email?.observations.first?.data.messages.first?.id, "message-1")
    var envelope = EmailEnvelope.empty(mailbox.sender)
    envelope.to = ["guest@example.test"]
    envelope.bcc = ["hidden@example.test"]
    envelope.subject = "iOS Email \(UUID().uuidString) [response-loss]"
    envelope.body = "Solo questo contenuto esplicito."
    await model.workspaceCommand(
      [
        "type": "email.draft.create", "connectionId": mailbox.id, "envelope": envelope.json,
        "reason": "Test invio personale",
      ], label: "Bozza")
    await model.loadEmail()
    XCTAssertEqual(model.error, "")
    let draft = try XCTUnwrap(model.email?.drafts.first { $0.envelope.subject == envelope.subject })
    XCTAssertFalse(model.email!.actions.contains { $0.draftId == draft.id })
    await model.workspaceCommand(
      [
        "type": "email.propose", "draftId": draft.id, "version": draft.version,
        "discloseToRecipients": true,
      ], label: "Proposta")
    await model.loadEmail()
    let proposal = try XCTUnwrap(model.email?.actions.first { $0.draftId == draft.id })
    XCTAssertEqual(proposal.status, "PROPOSED")
    let current = try XCTUnwrap(model.email)
    let credential = try XCTUnwrap(model.credential)
    let id = UUID().uuidString.lowercased()
    let body: [String: Any] = [
      "type": "email.authorize", "actionId": proposal.id, "version": proposal.version,
      "expectedContextRevision": current.contextRevision,
      "expectedAccessRevision": current.accessRevision, "representSelf": true,
      "discloseToRecipients": true,
    ]
    let json = String(data: try JSONSerialization.data(withJSONObject: body), encoding: .utf8)!
    let pending = PendingCommand(
      id: id, base: credential.base, actor: credential.user.id, workspace: workspace.id,
      type: "email.authorize", content: "Invio esatto", commandJSON: json)
    try vault.save(VaultState(credential: credential, pending: [pending]))
    let api = try API(base: credential.base)
    _ = try await api.data(
      "workspaces/\(workspace.id)/commands", method: "POST", token: credential.token,
      body: ["commandId": id, "command": body])
    // Drop the HTTP receipt and reconstruct the client using only its Keychain journal.
    let restarted = WorkspaceModel(vault: vault)
    XCTAssertEqual(restarted.pending.first?.commandJSON, json)
    try await restarted.refreshSession()
    restarted.select(workspace.id)
    try await restarted.recover(pending)
    XCTAssertTrue(restarted.pending.isEmpty)
    for _ in 0..<40 {
      await restarted.loadEmail()
      if restarted.email?.actions.first(where: { $0.id == proposal.id })?.status
        == "OUTCOME_UNKNOWN"
      {
        break
      }
      try await Task.sleep(for: .milliseconds(250))
    }
    let unknown = try XCTUnwrap(restarted.email?.actions.first { $0.id == proposal.id })
    XCTAssertEqual(unknown.status, "OUTCOME_UNKNOWN")
    XCTAssertFalse(unknown.canRetry)
    await restarted.workspaceCommand(
      ["type": "email.reconcile", "actionId": proposal.id, "version": proposal.version],
      label: "Verifica esito")
    for _ in 0..<40 {
      await restarted.loadEmail()
      if restarted.email?.actions.first(where: { $0.id == proposal.id })?.status == "SUCCEEDED" {
        break
      }
      try await Task.sleep(for: .milliseconds(250))
    }
    let result = try XCTUnwrap(restarted.email?.actions.first { $0.id == proposal.id })
    XCTAssertEqual(result.status, "SUCCEEDED")
    XCTAssertEqual(result.receipt?.evidence, "provider_accepted")
    XCTAssertEqual(result.envelope.bcc, ["hidden@example.test"])
    await restarted.logout()
    XCTAssertNil(restarted.email)
  }
}
