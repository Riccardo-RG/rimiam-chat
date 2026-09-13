import Foundation
import Security

struct Credential: Codable {
  let base: String
  let user: Person
  let token: String
  var logoutPending = false
}
struct PendingCommand: Codable, Identifiable {
  let id: String
  let base: String
  let actor: String
  let workspace: String
  let type: String
  let content: String
  var commandJSON: String? = nil
}
struct VaultState: Codable {
  var credential: Credential?
  var pending: [PendingCommand] = []
}

// Small session/unsent-command journal, not a local copy of canonical Workspace history.
final class Vault {
  private let service: String
  init(service: String = "it.miriam.local.session.v1") { self.service = service }
  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "state",
    ]
  }
  func load() throws -> VaultState {
    var query = query
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return VaultState() }
    guard status == errSecSuccess, let data = result as? Data else {
      throw APIError(code: "SECURE_STORAGE_UNAVAILABLE", status: 0)
    }
    return try JSONDecoder().decode(VaultState.self, from: data)
  }
  func save(_ state: VaultState) throws {
    let attributes: [String: Any] = [
      kSecValueData as String: try JSONEncoder().encode(state),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      guard
        SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
          == errSecSuccess
      else { throw APIError(code: "SECURE_STORAGE_UNAVAILABLE", status: 0) }
    } else if status != errSecSuccess {
      throw APIError(code: "SECURE_STORAGE_UNAVAILABLE", status: 0)
    }
  }
}
