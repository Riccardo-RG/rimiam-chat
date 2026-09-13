import XCTest

@MainActor final class TasksScreenTests: XCTestCase {
  func testTaskCreationAndColdRelaunch() {
    let app = XCUIApplication()
    app.launch()
    if app.buttons["logout"].waitForExistence(timeout: 2) { app.buttons["logout"].tap() }
    let email = app.textFields["email"]
    XCTAssertTrue(email.waitForExistence(timeout: 10))
    let server = app.textFields["server"]
    server.tap()
    let old = (server.value as? String) ?? ""
    server.typeText(
      String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + "http://127.0.0.1:3102"
    )
    email.tap()
    email.typeText("native-ios@example.test")
    let password = app.secureTextFields["password"]
    password.tap()
    password.typeText("Native-test-only-2026!")
    app.buttons["login"].tap()
    XCTAssertTrue(app.buttons["logout"].waitForExistence(timeout: 10))
    app.enterWorkspace()
    app.exploreWorkspace()
    let open = app.buttons["tasks-open"]
    for _ in 0..<10 {
      if open.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(open.exists)
    open.tap()
    let title = "SwiftUI Task \(UUID().uuidString)"
    let field = app.textFields["task-title"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText(title)
    let save = app.buttons["task-save"]
    for _ in 0..<8 {
      if save.isHittable { break }
      app.swipeUp()
    }
    save.tap()
    let task = app.staticTexts[title]
    for _ in 0..<20 {
      if task.exists { break }
      app.swipeUp()
    }
    XCTAssertTrue(task.waitForExistence(timeout: 10))
    app.terminate()
    app.launch()
    XCTAssertTrue(app.buttons["logout"].waitForExistence(timeout: 10))
    app.enterWorkspace()
    app.exploreWorkspace()
    for _ in 0..<10 {
      if open.isHittable { break }
      app.swipeUp()
    }
    open.tap()
    for _ in 0..<20 {
      if task.exists { break }
      app.swipeUp()
    }
    XCTAssertTrue(task.waitForExistence(timeout: 10))
  }
}
