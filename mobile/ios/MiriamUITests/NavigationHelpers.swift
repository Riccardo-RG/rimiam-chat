import XCTest
@MainActor extension XCUIApplication {
  func enterWorkspace() {
    let space=buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@", "workspace-")).firstMatch
    XCTAssertTrue(space.waitForExistence(timeout:15))
    if !space.isHittable {swipeUp()}
    space.tap()
    XCTAssertTrue(buttons["tools-open"].waitForExistence(timeout:10))
  }
  func exploreWorkspace() {buttons["tools-open"].tap()}
}
