import Foundation

struct Person: Codable, Sendable {
  let id: String
  let name: String
  let email: String
}
struct LoginResponse: Decodable {
  let user: Person
  let token: String
  let expiresAt: String
}
struct SessionResponse: Decodable {
  let user: Person
  let expiresAt: String
}
struct Workspace: Codable, Identifiable, Sendable {
  let id: String
  let name: String
}
struct WorkspaceList: Decodable { let workspaces: [Workspace] }
struct WorkspaceHead: Decodable {
  let id: String
  let name: String
  let revision: Int
  let contextRevision: Int
  let accessRevision: Int
}
struct Goal: Decodable, Identifiable {
  let id: String
  let version: Int
  let content: String
  let currentPrimary: Bool
  let establishedBy: String
}
struct Information: Decodable, Identifiable {
  let id: String
  let version: Int
  let subject: String
  let content: String
  let qualification: String
  let acceptedBy: String
  let candidateId: String
}
struct Commitment: Decodable, Identifiable {
  let id: String
  let content: String
  let candidateId: String?
  let people: [String]
  let adoptedAt: String?
  let status:String?
  let kind:String?
}
struct WorkspaceState: Decodable {
  let workspace: WorkspaceHead
  let messageSequence: Int
  let goals: [Goal]
  let information: [Information]
  let commitments: [Commitment]
}
struct WorkstreamFocus:Codable,Equatable,Sendable {
  let workstreamId:String
  let version:Int
  var json:[String:Any] {["workstreamId":workstreamId,"version":version]}
}
struct Message: Decodable, Identifiable {
  let id: String
  let sequence: Int
  let content: String
  let authorId: String?
  let actorKind: String?
  let purpose: String?
  let replyToSourceId:String?
  let citationSourceIds:[String]?
  let authorName: String
  let createdAt: String
  let workstreamFocus:WorkstreamFocus?
  let reference:ConversationReference?
}
struct MessagePage: Decodable {
  let messages: [Message]
  let nextAfter: Int
  let through: Int
  let hasMore: Bool
}
struct HistoryPage: Decodable {
  let messages: [Message]
  let nextBefore: Int
  let through: Int
  let hasMore: Bool
}
struct Changes: Decodable {
  let nextAfter: Int
  let headRevision: Int
  let hasMore: Bool
}
struct CreatedWorkspace: Decodable { let id: String }
struct Receipt: Decodable {
  let commandId: String
  let status: String
}
func aiFailureMessage(_ code: String) -> String? {
  switch code {
  case "AI_CONFIGURATION_REQUIRED": return "Le risposte AI non sono disponibili: il modello non è ancora collegato."
  case "AI_OUTPUT_PARSE_ERROR": return "La risposta del modello è incompleta o non valida. Nessun nuovo risultato pubblicato; puoi riprovare."
  case "AI_TIMEOUT": return "Il modello non ha risposto in tempo. Il lavoro è conservato; puoi riprovare."
  case "AI_RATE_LIMITED": return "Il servizio AI ha raggiunto il limite d’uso. Attendi prima di riprovare."
  case "AI_PROVIDER_UNAVAILABLE": return "Il servizio AI non è raggiungibile in questo momento. Puoi riprovare più tardi."
  case "AI_REQUEST_REJECTED": return "Il servizio AI non può elaborare questa richiesta. Occorre verificarne dimensioni e configurazione prima di riprovare."
  case "MORE_CONTEXT_REQUIRED": return "Manca contesto sufficiente. Aggiungi le informazioni pertinenti e riprova la lettura."
  case "INVALID_SOURCE_REFERENCE", "INVALID_ANALYSIS_CITATION": return "La risposta citava una fonte non disponibile. Nessun nuovo risultato pubblicato; puoi riprovare."
  case "WORK_CAPABILITY_UNAVAILABLE": return "L’analisi non può proseguire con i permessi attualmente disponibili."
  default: return nil
  }
}
struct APIError: Error, LocalizedError {
  let code: String
  let status: Int
  var errorDescription: String? {
    if let explanation = aiFailureMessage(code) { return explanation }
    switch code {
    case "WORKSTREAM_NOT_FOUND":return "Questo filone non è disponibile nello spazio corrente. Torna alla conversazione completa o scegli un altro filone."
    case "WORKSTREAM_NOT_ACTIVE":return "Il filone non è attivo. Puoi leggere la storia; per nuovi messaggi scegli un filone attivo o riaprilo."
    case "WORKSTREAM_TRANSITION_INVALID":return "Lo stato del filone è cambiato. Rileggilo prima di scegliere come proseguire."
    case "STATE_STALE":return "Lo stato è cambiato. Rileggi la versione corrente prima di confermare l’operazione."
    case "GOAL_VERSION_STALE":return "Il Goal è cambiato. La bozza conserva la versione iniziale: rileggi il Goal prima di continuare."
    case "INVALID_RECEIPT":return "La conferma ricevuta non permette di verificare l’esito. La stessa operazione resta recuperabile."
    case "REFERENCE_NOT_FOUND":return "Questo riferimento non è disponibile nello spazio corrente. Il messaggio originale rimane nella storia."
    case "REFERENCE_EVENT_MISMATCH":return "L’evento non corrisponde al riferimento richiesto. Riapri il passaggio dall’attività prima di continuare."
    case "HANDOFF_NOT_FOUND":return "Il passo proposto non è disponibile nello spazio corrente."
    case "HANDOFF_TARGET_STALE":return "Il riferimento o il candidato è cambiato. Rileggi il passo e chiedi a Miriam di rivalutarlo."
    case "HANDOFF_ALREADY_APPLIED":return "Questo passo ha già un risultato registrato. Aggiorna per consultarlo."
    case "HANDOFF_COMMAND_MISMATCH":return "L’operazione non corrisponde al passo proposto. Riapri i controlli dal riferimento corretto."
    case "WORK_STATE_STALE":
      return "Il lavoro è cambiato. Rileggi lo stato prima di inviare nuovamente l’istruzione."
    case "WORK_NOT_FOUND":return "Questo lavoro non è disponibile nello spazio corrente."
    case "SYNC_INCOMPLETE":return "L’aggiornamento non è completo. I dati già caricati restano disponibili; riprova."
    case "WORK_INSTRUCTION_UNCLEAR":
      return "Istruzione non applicata. Apri il lavoro e specifica come vuoi contribuire, oppure chiarisci la richiesta a Miriam."
    case "AUTHENTICATION_REQUIRED": return "Sessione scaduta o revocata. Accedi di nuovo."
    case "EMAIL_NOT_VERIFIED", "ACCOUNT_INELIGIBLE":
      return "Verifica l’account prima di continuare."
    case "WORKSPACE_ACCESS_DENIED": return "Non hai più accesso a questo Workspace."
    case "RECEIPT_NOT_FOUND":
      return "Esito non ancora disponibile. Puoi riprovare la stessa operazione."
    case "INVALID_EMAIL_OR_PASSWORD": return "Email o password non corrette."
    default: return "Operazione non completata: \(code)"
    }
  }
}
private struct ErrorEnvelope: Decodable {
  struct Detail: Decodable { let code: String }
  let error: Detail
}

// API calls never follow redirects or share browser cookies. Credentials stay bound to this origin.
final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
@MainActor final class API {
  let base: String
  let session: URLSession
  init(base: String, configuration: URLSessionConfiguration = .ephemeral) throws {
    guard let url = URL(string: base), let host = url.host, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/"
    else { throw APIError(code: "INVALID_SERVER_URL", status: 0) }
    var allowed = url.scheme == "https"
    #if DEBUG
      allowed = allowed || (url.scheme == "http" && ["127.0.0.1", "localhost"].contains(host))
    #endif
    guard allowed else { throw APIError(code: "HTTPS_REQUIRED", status: 0) }
    self.base = base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 30
    session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
  }
  func data(
    _ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil
  ) async throws -> Data {
    var request = URLRequest(url: URL(string: base + "/api/v1/" + path)!)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw APIError(code: "INVALID_RESPONSE", status: 0)
    }
    guard http.value(forHTTPHeaderField: "X-Miriam-API-Version") == "1" else {
      throw APIError(code: "INCOMPATIBLE_SERVER", status: http.statusCode)
    }
    guard (200..<300).contains(http.statusCode) else {
      let code =
        (try? JSONDecoder().decode(ErrorEnvelope.self, from: data).error.code) ?? "REQUEST_FAILED"
      throw APIError(code: code, status: http.statusCode)
    }
    return data
  }
  func download(_ path:String,token:String) async throws -> URL {
    var request=URLRequest(url:URL(string:base+"/api/v1/"+path)!);request.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")
    let (temporary,response)=try await session.download(for:request)
    guard let http=response as? HTTPURLResponse,http.statusCode==200,http.value(forHTTPHeaderField:"X-Miriam-API-Version")=="1" else{throw APIError(code:"CALL_AUDIO_NOT_AVAILABLE",status:0)}
    let destination=FileManager.default.temporaryDirectory.appendingPathComponent("Call-\(UUID().uuidString).mp3")
    try FileManager.default.moveItem(at:temporary,to:destination);return destination
  }
  func get<T: Decodable>(_ path: String, token: String, as type: T.Type) async throws -> T {
    try JSONDecoder().decode(type, from: await data(path, token: token))
  }
}
