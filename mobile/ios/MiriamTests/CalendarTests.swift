import XCTest

@testable import Miriam

@MainActor final class CalendarTests: XCTestCase {
  func testCalendarApprovalUnknownRecoveryAndReconciliation() async throws {
    let vault = Vault(service: "it.miriam.calendar.tests.\(UUID().uuidString)")
    let model = WorkspaceModel(vault: vault)
    await model.login(
      base: "http://127.0.0.1:3102", email: "native-ios@example.test",
      password: "Native-test-only-2026!")
    model.setForeground(false)
    let workspace = try XCTUnwrap(
      model.spaces.first(where: { $0.name == "Workspace ios di verifica" }))
    model.select(workspace.id)
    try await model.sync(force: true)
    let initial = try XCTUnwrap(model.calendar)
    let connection = try XCTUnwrap(initial.connections.first(where: { $0.active }))
    let resource = try XCTUnwrap(connection.resources.first(where: { $0.canWriteSelf }))
    let title = "iOS Calendar \(UUID().uuidString) [response-loss]"
    let start = Date().addingTimeInterval(86400)
    let end = start.addingTimeInterval(3600)
    let payload: [String: Any] = [
      "title": title, "start": start.ISO8601Format(), "end": end.ISO8601Format(),
      "timeZone": "Europe/Rome",
    ]
    await model.workspaceCommand(
      [
        "type": "temporal.create", "payload": payload, "reason": "Test personale",
        "representSelf": true, "expectedContextRevision": initial.contextRevision,
      ], label: title)
    XCTAssertEqual(model.error, "")
    let temporal = try XCTUnwrap(
      model.calendar?.temporal.first(where: { $0.payload.title == title }))
    await model.workspaceCommand(
      [
        "type": "calendar.propose", "connectionId": connection.id, "resourceId": resource.id,
        "operation": "create", "payload": payload, "temporal": temporal.reference.json,
        "reason": "Test pubblicazione precisa", "shareWithWorkspace": true,
      ], label: "Proposta")
    let proposal = try XCTUnwrap(
      model.calendar?.actions.first(where: { $0.payload.title == title }))
    XCTAssertEqual(proposal.status, "PROPOSED")
    let current = try XCTUnwrap(model.calendar)
    let credential = try XCTUnwrap(model.credential)
    let id = UUID().uuidString.lowercased()
    let body: [String: Any] = [
      "type": "calendar.authorize", "actionId": proposal.id, "version": proposal.version,
      "expectedContextRevision": current.contextRevision,
      "expectedAccessRevision": current.accessRevision, "representSelf": true,
    ]
    let json = String(data: try JSONSerialization.data(withJSONObject: body), encoding: .utf8)!
    let pending = PendingCommand(
      id: id, base: credential.base, actor: credential.user.id, workspace: workspace.id,
      type: "calendar.authorize", content: "Autorizzazione Calendar", commandJSON: json)
    try vault.save(VaultState(credential: credential, pending: [pending]))
    let api = try API(base: credential.base)
    _ = try await api.data(
      "workspaces/\(workspace.id)/commands", method: "POST", token: credential.token,
      body: ["commandId": id, "command": body])
    // Receipt response is deliberately discarded; only the persisted journal survives.
    let restarted = WorkspaceModel(vault: vault)
    XCTAssertEqual(restarted.pending.first?.commandJSON, json)
    try await restarted.refreshSession()
    restarted.select(workspace.id)
    try await restarted.recover(pending)
    XCTAssertTrue(restarted.pending.isEmpty)
    for _ in 0..<40 {
      try await restarted.sync(force: true)
      if restarted.calendar?.actions.first(where: { $0.id == proposal.id })?.status
        == "OUTCOME_UNKNOWN"
      {
        break
      }
      try await Task.sleep(for: .milliseconds(250))
    }
    let unknown = try XCTUnwrap(restarted.calendar?.actions.first(where: { $0.id == proposal.id }))
    XCTAssertEqual(unknown.status, "OUTCOME_UNKNOWN")
    XCTAssertFalse(unknown.canRetry)
    await restarted.workspaceCommand(
      ["type": "calendar.reconcile", "actionId": proposal.id, "version": proposal.version],
      label: "Verifica esito")
    for _ in 0..<40 {
      try await restarted.sync(force: true)
      if restarted.calendar?.actions.first(where: { $0.id == proposal.id })?.status == "SUCCEEDED" {
        break
      }
      try await Task.sleep(for: .milliseconds(250))
    }
    XCTAssertEqual(
      restarted.calendar?.actions.first(where: { $0.id == proposal.id })?.status, "SUCCEEDED")
    XCTAssertEqual(restarted.calendar?.temporal.filter { $0.id == temporal.id }.count, 1)
    await restarted.logout()
    XCTAssertNil(restarted.calendar)
  }
}
