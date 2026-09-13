import XCTest
@testable import Miriam
@MainActor final class WorkspaceSurfaceTests:XCTestCase {
  func testExtendedProjectionStructuredDraftAndSourceRemainScoped()async throws {
    try await Task.sleep(for:.seconds(10.1))
    let api=try API(base:"http://127.0.0.1:3102")
    let login=try JSONDecoder().decode(LoginResponse.self,from:await api.data("native/session",method:"POST",body:["email":"native-ios@example.test","password":"Native-test-only-2026!"]))
    let w=UUID().uuidString.lowercased()
    func command(_ value:[String:Any])async throws { _ = try await api.data("workspaces/\(w)/commands",method:"POST",token:login.token,body:["commandId":UUID().uuidString.lowercased(),"expectedActorId":login.user.id,"command":value]) }
    _ = try await api.data("workspaces",method:"POST",token:login.token,body:["commandId":w,"expectedActorId":login.user.id,"name":"Native surfaces iOS \(w)"])
    try await command(["type":"goal.establish","content":"Preparare insieme il locale"])
    let original=Data("Preventivo attribuito: affitto da verificare".utf8)
    try await command(["type":"document.upload","filename":"preventivo.txt","bytesBase64":original.base64EncodedString()])
    var detail=try await api.get("workspaces/\(w)/workspace",token:login.token,as:WorkspaceDetail.self)
    let source=try XCTUnwrap(detail.sources.first)
    let returned=try await api.data("workspaces/\(w)/source-file?id=\(source.id)",token:login.token)
    XCTAssertEqual(original,returned)
    try await command(["type":"artifact.compose","title":"Brief nativo","purpose":"Valutare il locale","reason":"Prima bozza personale","blocks":[["type":"paragraph","text":"Analisi da discutere"],["type":"table","columns":["Voce","Stato"],"rows":[["Affitto","Da verificare"]]]],"information":[],"sourceIds":[source.id],"nonOperative":true])
    detail=try await api.get("workspaces/\(w)/workspace",token:login.token,as:WorkspaceDetail.self)
    XCTAssertEqual(detail.artifactVersions.first?.blocks?.count,2)
    XCTAssertNil(detail.artifacts.first?.current_adoption_id)
    XCTAssertTrue(detail.versions.isEmpty)
    let project=try await api.get("workspaces/\(w)/project",token:login.token,as:ProjectSnapshot.self)
    XCTAssertEqual(project.goals.count,1)
    let access=try await api.get("workspaces/\(w)/access",token:login.token,as:AccessSnapshot.self)
    XCTAssertEqual(access.relationships.count,1)
    let attention=try await api.get("workspaces/\(w)/attention",token:login.token,as:AttentionSnapshot.self)
    XCTAssertGreaterThan(attention.revision,0)
    let other=try JSONDecoder().decode(LoginResponse.self,from:await api.data("native/session",method:"POST",body:["email":"native-android@example.test","password":"Native-test-only-2026!"]))
    do {_ = try await api.data("workspaces/\(w)/source-file?id=\(source.id)",token:other.token);XCTFail("Private Workspace source crossed membership boundary")}catch let e as APIError {XCTAssertEqual(e.status,403)}
    _ = try await api.data("native/session",method:"DELETE",token:login.token)
    _ = try await api.data("native/session",method:"DELETE",token:other.token)
  }
}
