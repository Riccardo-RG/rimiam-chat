import XCTest

@MainActor final class ScreenTests: XCTestCase {
  func testLoginMessageColdRelaunchAndLogout() {
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
    // Isolate this UI scenario from historical Calendar/Email records of earlier runs.
    let workspaceField = app.textFields["Nome del nuovo Workspace"]
    for _ in 0..<10 {
      if workspaceField.isHittable { break }
      app.swipeUp()
    }
    let workspaceName = "SwiftUI smoke \(UUID().uuidString)"
    workspaceField.tap()
    workspaceField.typeText(workspaceName)
    app.buttons["Crea Workspace"].tap()
    XCTAssertTrue(app.staticTexts[workspaceName].waitForExistence(timeout: 10))
    app.exploreWorkspace()
    let calendar = app.buttons["calendar-open"]
    for _ in 0..<10 {
      if calendar.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(calendar.waitForExistence(timeout: 10))
    calendar.tap()
    let calendarTitle = "SwiftUI Calendar \(UUID().uuidString)"
    let titleField = app.textFields["calendar-title"]
    XCTAssertTrue(titleField.waitForExistence(timeout: 10))
    titleField.tap()
    titleField.typeText(calendarTitle)
    let reason = app.textFields["calendar-reason"]
    if !reason.isHittable { app.swipeUp() }
    reason.tap()
    reason.typeText("Appuntamento personale di test")
    let own = app.switches["calendar-self"]
    if !own.isHittable { app.swipeUp() }
    own.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
    XCTAssertEqual(own.value as? String, "1")
    let save = app.buttons["calendar-save"]
    if !save.isHittable { app.swipeUp() }
    XCTAssertTrue(save.isEnabled)
    save.tap()
    for _ in 0..<10 {
      if app.staticTexts[calendarTitle].exists { break }
      app.swipeUp()
    }
    XCTAssertTrue(app.staticTexts[calendarTitle].waitForExistence(timeout: 10))
    app.navigationBars["Calendario"].buttons.element(boundBy: 0).tap()
    let emailOpen = app.buttons["email-open"]
    for _ in 0..<10 {
      if emailOpen.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(emailOpen.waitForExistence(timeout: 10))
    emailOpen.tap()
    let emailTitle = "SwiftUI Email \(UUID().uuidString)"
    let emailTo = app.textFields["email-to"]
    XCTAssertTrue(emailTo.waitForExistence(timeout: 10))
    emailTo.tap()
    emailTo.typeText("guest@example.test")
    let emailSubject = app.textFields["email-subject"]
    emailSubject.tap()
    emailSubject.typeText(emailTitle)
    let emailReason = app.textFields["email-reason"]
    for _ in 0..<10 {
      if emailReason.isHittable { break }
      app.swipeUp()
    }
    emailReason.tap()
    emailReason.typeText("Bozza personale senza invio")
    let emailSave = app.buttons["email-save"]
    if !emailSave.isHittable { app.swipeUp() }
    emailSave.tap()
    let savedEmail = app.staticTexts[emailTitle + " · v1"]
    for _ in 0..<20 {
      if savedEmail.exists { break }
      app.swipeUp()
    }
    XCTAssertTrue(savedEmail.waitForExistence(timeout: 10))
    app.navigationBars["Workspace Email"].buttons.element(boundBy: 0).tap()
    app.buttons["Chiudi"].tap()
    let field = app.textFields["message"]
    for _ in 0..<15 {
      if field.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    let content = "SwiftUI screen \(UUID().uuidString)"
    field.tap()
    field.typeText(content)
    let send = app.buttons["send"]
    if !send.isHittable { app.swipeUp() }
    send.tap()
    XCTAssertTrue(app.staticTexts[content].waitForExistence(timeout: 10))
    // A real process termination/relaunch, not just a recreated model.
    app.terminate()
    app.launch()
    XCTAssertTrue(app.buttons["logout"].waitForExistence(timeout: 10))
    // Workspace selection is read state, deliberately not persisted with credentials.
    let reopenedSpace = app.buttons.matching(
      NSPredicate(format: "label CONTAINS %@", workspaceName)
    ).firstMatch
    for _ in 0..<20 {
      if reopenedSpace.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(reopenedSpace.waitForExistence(timeout: 10))
    reopenedSpace.tap()
    for _ in 0..<15 {
      if app.staticTexts[content].exists { break }
      app.swipeUp()
    }
    XCTAssertTrue(app.staticTexts[content].waitForExistence(timeout: 10))
    app.buttons["home-open"].tap()
    app.buttons["logout"].tap()
    XCTAssertTrue(app.textFields["email"].waitForExistence(timeout: 10))
  }
}
