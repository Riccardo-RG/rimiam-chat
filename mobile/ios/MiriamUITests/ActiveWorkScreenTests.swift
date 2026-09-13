import XCTest

@MainActor final class ActiveWorkScreenTests: XCTestCase {
  func testVisibleSharedWorkControlsAndColdRelaunch() async throws {
    try await Task.sleep(for: .seconds(10.1))
    func request(_ path: String, _ body: [String: Any]? = nil, _ token: String? = nil) async throws
      -> [String: Any]
    {
      var r = URLRequest(url: URL(string: "http://127.0.0.1:3102/api/v1/" + path)!)
      if let body {
        r.httpMethod = "POST"
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
      }
      if let token { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
      let (data, response) = try await URLSession.shared.data(for: r)
      XCTAssertTrue(
        (200..<300).contains((response as! HTTPURLResponse).statusCode),
        String(data: data, encoding: .utf8) ?? "")
      return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    let login = try await request(
      "native/session", ["email": "native-ios@example.test", "password": "Native-test-only-2026!"])
    let token = login["token"] as! String
    let actor = (login["user"] as! [String: Any])["id"] as! String
    let list = try await request("workspaces", nil, token)
    let w = (list["workspaces"] as! [[String: Any]])[0]["id"] as! String
    let topic = "MilanoUI" + UUID().uuidString.prefix(6)
    func command(_ c: [String: Any]) async throws -> [String: Any] {
      try await request(
        "workspaces/\(w)/commands",
        ["commandId": UUID().uuidString.lowercased(), "expectedActorId": actor, "command": c], token
      )
    }
    _ = try await command([
      "type": "message.send", "content": "Il locale \(topic) costa 3000 euro al mese.",
    ])
    _ = try await command(["type": "message.send", "content": "Analizza: \(topic)"])
    let app = XCUIApplication()
    app.launch()
    if app.buttons["logout"].waitForExistence(timeout: 2) { app.buttons["logout"].tap() }
    let email = app.textFields["email"]
    XCTAssertTrue(email.waitForExistence(timeout: 10))
    let server = app.textFields["server"]
    server.tap()
    server.typeText(
      String(
        repeating: XCUIKeyboardKey.delete.rawValue, count: ((server.value as? String) ?? "").count)
        + "http://127.0.0.1:3102")
    email.tap()
    email.typeText("native-ios@example.test")
    app.secureTextFields["password"].tap()
    app.secureTextFields["password"].typeText("Native-test-only-2026!")
    app.buttons["login"].tap()
    XCTAssertTrue(app.buttons["logout"].waitForExistence(timeout: 10))
    app.enterWorkspace()
    func reveal(_ element: XCUIElement) {
      for _ in 0..<18 {
        if element.isHittable { break }
        app.swipeUp()
      }
      XCTAssertTrue(element.waitForExistence(timeout: 10))
    }
    let work = app.staticTexts[String(topic)]
    reveal(work)
    work.tap()
    let pause = app.buttons["work-pause"].firstMatch
    reveal(pause)
    pause.tap()
    try await Task.sleep(for: .seconds(2.5))
    let result = try await request("workspaces/\(w)/active-work", nil, token)
    let row = (result["works"] as! [[String: Any]]).first {
      ($0["contract"] as! [String: Any])["objective"] as? String == topic
    }!
    XCTAssertEqual(row["phase"] as? String, "paused")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.buttons["logout"].waitForExistence(timeout: 10))
    app.enterWorkspace()
    reveal(work)
    work.tap()
    let resume = app.buttons["work-resume"].firstMatch
    reveal(resume)
    resume.tap()
    try await Task.sleep(for: .seconds(2.5))
    let stop = app.buttons["work-stop"].firstMatch
    reveal(stop)
    stop.tap()
    try await Task.sleep(for: .seconds(2.5))
    let end = try await request("workspaces/\(w)/active-work", nil, token)
    let final = (end["works"] as! [[String: Any]]).first {
      $0["id"] as? String == row["id"] as? String
    }!
    XCTAssertEqual(final["phase"] as? String, "stopped")
    XCTAssertNotNil(final["contribution"] as? [String: Any])
  }
}
