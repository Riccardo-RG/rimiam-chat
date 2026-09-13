import XCTest

@testable import Miriam

@MainActor final class ActiveWorkTests: XCTestCase {
  func testConversationWorkControlProvenanceAndRestart() async throws {
    try await Task.sleep(for: .seconds(10.1))
    let vault = Vault(service: "it.miriam.activework.tests.\(UUID().uuidString)")
    let model = WorkspaceModel(vault: vault)
    await model.login(
      base: "http://127.0.0.1:3102", email: "native-ios@example.test",
      password: "Native-test-only-2026!")
    model.setForeground(false)
    XCTAssertNotNil(model.credential, model.error)
    let w = try XCTUnwrap(model.spaces.first { $0.name == "Workspace ios di verifica" })
    model.select(w.id)
    let topic = "MilanoSwift\(UUID().uuidString.prefix(8))"
    await model.send("Il locale \(topic) costa 3000 euro al mese, dato da verificare.")
    await model.send("Analizza: \(topic)")
    var work: ActiveWork?
    for _ in 0..<50 {
      await model.loadActiveWork()
      work = model.activeWork?.works.first { $0.contract.objective == topic }
      if work?.phase == "completed" { break }
      try await Task.sleep(for: .milliseconds(300))
    }
    var item = try XCTUnwrap(work)
    XCTAssertEqual(item.phase, "completed", model.error)
    XCTAssertNotNil(item.contribution)
    func control(_ text: String) async throws {
      await model.loadActiveWork()
      item = try XCTUnwrap(model.activeWork?.works.first { $0.id == item.id })
      await model.workspaceCommand(
        [
          "type": "work.converse", "workId": item.id, "expectedRevision": item.revision,
          "text": text,
        ], label: text)
      await model.loadActiveWork()
      item = try XCTUnwrap(model.activeWork?.works.first { $0.id == item.id })
    }
    try await control("pausa")
    XCTAssertEqual(item.phase, "paused")
    try await control("obiezione: verificare i costi")
    XCTAssertEqual(item.phase, "needs_input")
    let issue = try XCTUnwrap(item.issues.first)
    try await control("riprendi")
    XCTAssertEqual(item.phase, "needs_input")
    let restored = WorkspaceModel(vault: vault)
    restored.select(w.id)
    await restored.loadActiveWork()
    XCTAssertEqual(
      restored.activeWork?.works.first { $0.id == item.id }?.issues.first?.id, issue.id)
    try await control("ritiro: \(issue.id)")
    XCTAssertTrue(item.issues.isEmpty)
    try await control("riprendi")
    for _ in 0..<50 {
      await model.loadActiveWork()
      if model.activeWork?.works.first(where: { $0.id == item.id })?.phase == "completed" { break }
      try await Task.sleep(for: .milliseconds(300))
    }
    try await control("ferma")
    XCTAssertEqual(item.phase, "stopped")
    let history = await model.activeWorkHistory(item.id)
    XCTAssertTrue(history.contains("non adottata"))
    XCTAssertTrue(history.contains("source"))
    await restored.loadActiveWork()
    XCTAssertEqual(restored.activeWork?.works.first { $0.id == item.id }?.phase, "stopped")
    await model.logout()
    XCTAssertNil(model.activeWork)
  }
}
