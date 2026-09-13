import XCTest

@testable import Miriam

@MainActor final class TasksTests: XCTestCase {
  func testResponsibilityReminderAndRestartThroughCommonAPI() async throws {
    // Better Auth's real sign-in rule permits three attempts per ten seconds.
    // Earlier boundary/Calendar/Email tests share the simulator IP; preserve the limit.
    try await Task.sleep(for: .seconds(10.1))
    let vault = Vault(service: "it.miriam.tasks.tests.\(UUID().uuidString)")
    let model = WorkspaceModel(vault: vault)
    await model.login(
      base: "http://127.0.0.1:3102", email: "native-ios@example.test",
      password: "Native-test-only-2026!")
    model.setForeground(false)
    XCTAssertNotNil(model.credential, model.error)
    let w = try XCTUnwrap(model.spaces.first { $0.name == "Workspace ios di verifica" })
    model.select(w.id)
    let title = "Swift Tasks \(UUID().uuidString)"
    await model.workspaceCommand(
      [
        "type": "task.create",
        "content": [
          "title": title, "description": "Raccogliere informazioni, nessun acquisto",
          "dueAt": NSNull(), "timeZone": "Europe/Rome", "suggestedPerson": NSNull(),
          "references": [],
        ] as [String: Any],
      ], label: "Task senza impegno")
    await model.loadTasks()
    var t = try XCTUnwrap(model.tasks?.tasks.first { $0.title == title })
    XCTAssertNil(t.responsible)
    await model.workspaceCommand(
      [
        "type": "task.accept", "taskId": t.id, "expectedVersion": t.version,
        "reason": "Me ne occupo", "representSelf": true,
      ], label: "Responsabilità personale")
    await model.loadTasks()
    t = try XCTUnwrap(model.tasks?.tasks.first { $0.id == t.id })
    XCTAssertEqual(t.responsible, model.credential?.user.id)
    XCTAssertEqual(t.acceptedVersion, 1)
    await model.workspaceCommand(
      [
        "type": "followup.create", "content": title, "kind": "check",
        "remindAt": Date(timeIntervalSince1970: 0).ISO8601Format(), "timeZone": "Europe/Rome",
        "reference": ["kind": "task", "id": t.id, "version": t.version],
      ], label: "Promemoria")
    for _ in 0..<40 {
      await model.loadTasks()
      if model.tasks?.followups.first(where: { $0.content == title })?.deliveredAt != nil { break }
      try await Task.sleep(for: .milliseconds(250))
    }
    XCTAssertNotNil(model.tasks?.followups.first { $0.content == title }?.deliveredAt)
    let restored = WorkspaceModel(vault: vault)
    restored.select(w.id)
    await restored.loadTasks()
    XCTAssertEqual(restored.tasks?.tasks.first { $0.id == t.id }?.responsible, t.responsible)
    XCTAssertTrue(restored.pending.isEmpty)
    await restored.workspaceCommand(
      [
        "type": "task.relinquish", "taskId": t.id, "expectedVersion": t.version,
        "reason": "Non posso più seguirlo", "representSelf": true,
      ], label: "Rinuncia")
    await restored.loadTasks()
    XCTAssertNil(restored.tasks?.tasks.first { $0.id == t.id }?.responsible)
    let history = await restored.workHistory(t.id, kind: "task")
    XCTAssertTrue(history.contains("accepted_at"))
    await restored.logout()
    XCTAssertNil(restored.tasks)
  }
}
