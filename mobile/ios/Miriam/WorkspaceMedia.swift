import AVFoundation
import Foundation
import LiveKit
import Observation
import SwiftUI

struct CallCredentials: Decodable {
  let url: String
  let token: String
  let participantId: String
  let callId: String
}
struct ConversationVoiceSnapshot: Decodable { let messages: [ConversationVoiceMessage] }
struct ConversationVoiceMessage: Decodable, Identifiable {
  var id: String { messageId }
  let messageId: String
  let sourceId: String
  let mode: String
  let status: String
  let transcript: String?
  let qualification: String
  let errorCode: String?
  let interpretationStatus: String?
  let researchQuery: String?
}
struct AudioCallSnapshot: Decodable {
  let configured: Bool
  let recordingConfigured: Bool
  let consentText: String
  let calls: [AudioCall]
}
struct AudioCall: Decodable, Identifiable {
  let id: String
  let version: Int
  let state: String
  let recordingRequested: Bool
  let epoch: Int
  let errorCode: String?
  let participants: [Participant]
  let recordings: [Recording]
  let events: [Event]
  let analysisRequested: Bool
  struct Participant: Decodable, Identifiable {
    let id: String
    let userId: String
    let name: String
    let state: String
    let consented: Bool
  }
  struct Recording: Decodable, Identifiable {
    let id: String
    let participantId: String
    let state: String
    let captureFenced: Bool
    let transcriptionStatus: String?
    let errorCode: String?
    let createdAt: String
    let endedAt: String?
    let segments: [Segment]
  }
  struct Segment: Decodable, Identifiable {
    let id: String
    let ordinal: Int
    let content: String
    let qualification: String
    let startSeconds: Int
  }
  struct Event: Decodable, Identifiable {
    var id: Int { version }
    let version: Int
    let kind: String
    let actorId: String?
    let consentText: String?
    let epoch: Int?
    let createdAt: String
  }
}

@MainActor @Observable final class WorkspaceMedia {
  static var callInProgress = false
  var voices: [ConversationVoiceMessage] = []
  var calls: AudioCallSnapshot?
  var error = ""
  var callStatus = ""
  var wantsCall = false
  var muted = false
  var voiceConsent = false
  var dialog = false
  var pendingVoice: String?
  var speaking = false
  let note = VoiceNote()
  private var room: Room?
  private var callID: String?
  private var boundary = ""
  private var callHeartbeat = Date.distantPast
  private var player: AVAudioPlayer?
  private var playbackEpoch = 0
  private var playbackFile: URL?
  private var voiceTimer: Task<Void, Never>?
  private var generation = 0
  private struct VoiceAnchor:Equatable {let boundary:String;let focus:WorkstreamFocus?;let reference:ConversationReference?}
  private var voiceAnchor:VoiceAnchor?
  var voiceReference:ConversationReference? {voiceAnchor?.reference}
  private var committedVoiceFilename:String?
  var inCall: Bool { wantsCall || room != nil }
  func run(_ model: WorkspaceModel) async {
    let key = model.mediaBoundary
    guard model.credential?.logoutPending != true else {
      await reset()
      return
    }
    if boundary != key {
      await reset()
      boundary = key
      voices = []
      calls = nil
    }
    while !Task.isCancelled && boundary == key && model.selected != nil {
      let v = await model.workspaceRead("voice")
      let c = await model.workspaceRead("calls")
      guard !Task.isCancelled, boundary == key else { break }
      if let value = try? JSONDecoder().decode(ConversationVoiceSnapshot.self, from: Data(v.utf8)) {
        voices = value.messages
      }
      if let value = try? JSONDecoder().decode(AudioCallSnapshot.self, from: Data(c.utf8)) {
        calls = value
      }
      if wantsCall { await updateCall(model) }
      if dialog { await updateDialog(model) }
      try? await Task.sleep(for: .seconds(2))
    }
    if boundary == key { await reset() }
  }
  func reset() async {
    generation += 1
    voiceConsent = false
    endDialog()
    note.discard()
    voiceAnchor=nil;committedVoiceFilename=nil
    stopPlayback()
    wantsCall = false
    Self.callInProgress = false
    await room?.disconnect()
    room = nil
    callID = nil
    callStatus = ""
  }
  func join(_ model: WorkspaceModel) async {
    let token = generation
    let originalBoundary = model.mediaBoundary
    guard !model.busy, await AVAudioApplication.requestRecordPermission() else {
      error = "Consenti l’accesso al microfono nelle impostazioni."
      return
    }
    guard token == generation, originalBoundary == model.mediaBoundary else { return }
    endDialog()
    note.discard()
    stopPlayback()
    SpeechPlayback.shared.stop()
    if await model.workspaceCommand(["type": "call.join"], label: "Entra nella chiamata audio") {
      guard token == generation, originalBoundary == model.mediaBoundary else { return }
      wantsCall = true
      Self.callInProgress = true
      error = ""
    }
  }
  private func updateCall(_ model: WorkspaceModel) async {
    guard let call = calls?.calls.first(where: { $0.state == "open" }),
      let person = call.participants.first(where: {
        $0.userId == model.credential?.user.id && $0.state != "left"
      })
    else {
      if room != nil {
        await room?.disconnect()
        room = nil
        wantsCall = false
        Self.callInProgress = false
      }
      return
    }
    guard person.state == "admitted" else {
      if room != nil {
        await room?.disconnect()
        room = nil
        wantsCall = false
        Self.callInProgress = false
      }
      callStatus = "Ingresso in attesa dell’arresto delle registrazioni"
      return
    }
    do {
      if room == nil {
        let token = generation
        let credentials = try await model.mediaConnection(call.id)
        guard wantsCall, token == generation else { return }
        let next = Room()
        room = next
        callID = call.id
        try await next.connect(url: credentials.url, token: credentials.token)
        guard wantsCall, token == generation else {
          await next.disconnect()
          return
        }
        try await next.localParticipant.setMicrophone(enabled: true)
        muted = false
        callHeartbeat = Date()
      } else if Date().timeIntervalSince(callHeartbeat) > 20 {
        _ = try await model.mediaConnection(call.id)
        callHeartbeat = Date()
      }
      callStatus =
        room?.connectionState == .connected ? "Chiamata connessa" : "Riconnessione alla chiamata…"
      if room?.connectionState == .disconnected {
        throw APIError(code: "CALL_DISCONNECTED", status: 0)
      }
    } catch {
      self.error = error.localizedDescription
      await room?.disconnect()
      room = nil
      wantsCall = false
      Self.callInProgress = false
      callStatus = "Disconnesso: puoi rientrare nella chiamata"
    }
  }
  func leave(_ model: WorkspaceModel) async {
    let id = callID ?? calls?.calls.first(where: { $0.state == "open" })?.id
    wantsCall = false
    Self.callInProgress = false
    generation += 1
    await room?.disconnect()
    room = nil
    callID = nil
    callStatus = ""
    if let id {
      _ = await model.workspaceCommand(
        ["type": "call.leave", "callId": id], label: "Lascia chiamata")
    }
  }
  func toggleMute() async {
    do {
      try await room?.localParticipant.setMicrophone(enabled: muted)
      muted.toggle()
    } catch { self.error = error.localizedDescription }
  }
  func withdraw(_ model: WorkspaceModel, _ id: String) async {
    // Disconnect this microphone identity before withdrawal; re-entry is unrecorded.
    wantsCall = false
    Self.callInProgress = false
    muted = true
    generation += 1
    await room?.disconnect()
    room = nil
    callID = nil
    _ = await model.workspaceCommand(
      ["type": "call.recording.withdraw", "callId": id], label: "Ritira consenso registrazione")
  }
  func stopPlayback() {
    playbackEpoch += 1
    player?.stop()
    player = nil
    if let playbackFile { try? FileManager.default.removeItem(at: playbackFile) }
    playbackFile = nil
  }
  func playSource(_ model: WorkspaceModel, _ source: String) async {
    guard !inCall else { return }
    endDialog()
    stopPlayback()
    let playback = playbackEpoch
    if let data = await model.sourceBytes(source) {
      guard playback == playbackEpoch, !inCall else { return }
      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try AVAudioSession.sharedInstance().setActive(true)
        player = try AVAudioPlayer(data: data)
        player?.play()
      } catch { self.error = error.localizedDescription }
    }
  }
  func playRecording(_ model: WorkspaceModel, _ id: String) async {
    guard !inCall else { return }
    endDialog()
    stopPlayback()
    let playback = playbackEpoch
    do {
      let url = try await model.mediaRecording(id)
      guard playback == playbackEpoch, !inCall else {
        try? FileManager.default.removeItem(at: url)
        return
      }
      playbackFile = url
      try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
      try AVAudioSession.sharedInstance().setActive(true)
      player = try AVAudioPlayer(contentsOf: url)
      player?.play()
    } catch { self.error = error.localizedDescription }
  }
  func endDialog() {
    dialog = false
    pendingVoice = nil
    speaking = false
    voiceTimer?.cancel()
    voiceTimer = nil
    note.stop()
    SpeechPlayback.shared.stop()
  }
  private func currentVoiceAnchor(_ model:WorkspaceModel) -> VoiceAnchor {
    VoiceAnchor(boundary:model.mediaBoundary,focus:model.workstreamFocus,reference:model.composerReference?.reference)
  }
  func voiceNeedsFocusSelection(_ model:WorkspaceModel) -> Bool {
    note.file != nil && (voiceAnchor != currentVoiceAnchor(model) || model.focusIsStale)
  }
  func focusChanged(_ model:WorkspaceModel) {
    guard note.file != nil || dialog else {return}
    if voiceAnchor != currentVoiceAnchor(model) || model.focusIsStale {
      generation += 1
      endDialog()
      error="Il filone o il riferimento è cambiato. L’audio è conservato: verifica la selezione e conferma dove inviarlo."
    }
  }
  func useCurrentVoiceFocus(_ model:WorkspaceModel) {
    guard !note.recording,!dialog,note.file != nil,!model.focusIsStale,
      voiceAnchor?.boundary == model.mediaBoundary else {return}
    voiceAnchor=currentVoiceAnchor(model);error=""
  }
  func discardNote() {note.discard();voiceAnchor=nil;committedVoiceFilename=nil}
  func voiceCommitted(_ command:PendingCommand,_ model:WorkspaceModel) {
    guard command.type == "voice.send",command.base == model.credential?.base,
      command.actor == model.credential?.user.id,command.workspace == model.selected,
      let file=note.file,let json=command.commandJSON,
      let body=(try? JSONSerialization.jsonObject(with:Data(json.utf8))) as? [String:Any],
      body["filename"] as? String == file.lastPathComponent else {return}
    committedVoiceFilename=file.lastPathComponent
    note.discard()
  }
  func startNote(_ model:WorkspaceModel) async {
    guard voiceConsent,!inCall,!model.focusIsStale else {return}
    endDialog()
    stopPlayback()
    let anchor=currentVoiceAnchor(model),token=generation
    voiceAnchor=anchor;committedVoiceFilename=nil
    await note.start()
    guard token == generation,anchor == currentVoiceAnchor(model),!model.focusIsStale else {note.stop();return}
  }
  func sendVoice(_ model: WorkspaceModel, _ mode: String) async {
    let token = generation
    guard voiceConsent, let file = note.file, !model.busy else { return }
    guard voiceAnchor == currentVoiceAnchor(model),!model.focusIsStale else {focusChanged(model);return}
    if model.pending.contains(where:{command in
      guard command.type == "voice.send",let json=command.commandJSON,
        let body=(try? JSONSerialization.jsonObject(with:Data(json.utf8))) as? [String:Any] else {return false}
      return body["filename"] as? String == file.lastPathComponent
    }) {error="Questo audio ha già un invio da verificare. Recupera la stessa operazione.";return}
    let anchor=voiceAnchor
    do {
      let data = try Data(contentsOf: file)
      guard data.count <= 8_388_608 else { throw APIError(code: "DOCUMENT_TOO_LARGE", status: 413) }
      let before = model.voiceReplySourceID
      var command:[String:Any] = [
          "type": "voice.send", "filename": file.lastPathComponent,
          "bytesBase64": data.base64EncodedString(), "mode": mode, "allowModelProcessing": true,
        ]
      if let focus=anchor?.focus {command["workstreamFocus"]=focus.json}
      if let reference=anchor?.reference {command["reference"]=reference.json}
      let saved=await model.workspaceCommand(command,label:mode == "miriam" ? "Messaggio vocale a RIMIAM" : "Messaggio vocale")
      if saved,token == generation,anchor == voiceAnchor,anchor == currentVoiceAnchor(model) {
        guard committedVoiceFilename == file.lastPathComponent else {endDialog();error="Invio da verificare. L’audio è conservato e la stessa operazione è recuperabile.";return}
        if mode == "miriam", model.voiceReplySourceID != before {
          pendingVoice = model.voiceReplySourceID
        } else if mode == "miriam" {
          endDialog()
        }
      }
    } catch {
      self.error = error.localizedDescription
      endDialog()
    }
  }
  func beginDialog(_ model: WorkspaceModel) async {
    guard voiceConsent,!inCall,!model.focusIsStale else {return}
    voiceAnchor=currentVoiceAnchor(model);committedVoiceFilename=nil
    dialog = true
    error = ""
    stopPlayback()
    await listen(model)
  }
  private func listen(_ model: WorkspaceModel) async {
    guard dialog,voiceAnchor == currentVoiceAnchor(model),!model.focusIsStale else {focusChanged(model);return}
    let anchor=voiceAnchor,token=generation
    await note.start()
    guard token == generation,anchor == voiceAnchor,anchor == currentVoiceAnchor(model),!model.focusIsStale else {note.stop();return}
    guard note.recording else {
      error = note.error
      endDialog()
      return
    }
    voiceTimer?.cancel()
    voiceTimer = Task {
      var heard = false
      var lastSpeech = Date()
      let started = Date()
      while !Task.isCancelled && dialog && note.recording {
        guard anchor == currentVoiceAnchor(model),!model.focusIsStale else {focusChanged(model);return}
        if note.power() > -36 {
          heard = true
          lastSpeech = Date()
        }
        if (heard && Date().timeIntervalSince(lastSpeech) > 1.6)
          || Date().timeIntervalSince(started) > 120
        {
          note.stop()
          await sendVoice(model, "miriam")
          break
        }
        try? await Task.sleep(for: .milliseconds(150))
      }
    }
  }
  private func updateDialog(_ model: WorkspaceModel) async {
    guard voiceAnchor == currentVoiceAnchor(model),!model.focusIsStale else {focusChanged(model);return}
    if let pendingVoice {
      if let voice = voices.first(where: { $0.sourceId == pendingVoice }),
        voice.errorCode != nil || ["failed", "stale"].contains(voice.interpretationStatus ?? "")
      {
        error = voice.errorCode ?? "La risposta richiede attenzione nel Context."
        endDialog()
        return
      }
      if let reply = model.messages.first(where: {
        $0.actorKind == "miriam" && $0.replyToSourceId == pendingVoice
      }) {
        self.pendingVoice = nil
        SpeechPlayback.shared.speak(id: reply.id, text: reply.content)
        speaking = true
      }
    } else if speaking && SpeechPlayback.shared.currentID == nil {
      speaking = false
      if !SpeechPlayback.shared.error.isEmpty {
        error = SpeechPlayback.shared.error
        endDialog()
      } else {
        await listen(model)
      }
    }
  }
}

struct ConversationVoiceView: View {
  let model: WorkspaceModel
  @Environment(\.scenePhase) private var phase
  @State private var discardAudio=false
  var body: some View {
    @Bindable var media = model.media
    DisclosureGroup("Voce e dialogo con RIMIAM") {
      if let reference=(media.note.file != nil || media.dialog) ? media.voiceReference : model.composerReference?.reference {
        Text("Riferimento per l’audio: " + reference.kind.label + " · " + reference.versionLabel).font(.caption.weight(.semibold))
      }
      Toggle(
        "Condivido l’audio nel Workspace e autorizzo la trascrizione con il servizio configurato",
        isOn: $media.voiceConsent
      ).disabled(media.note.recording || media.dialog)
      Button(media.note.recording ? "Ferma registrazione" : "Registra messaggio vocale") {
        Task { if media.note.recording { media.note.stop() } else { await media.startNote(model) } }
      }.disabled(!media.voiceConsent || media.inCall || media.dialog || model.focusIsStale || (media.note.file != nil && !media.note.recording))
      if media.note.file != nil && !media.note.recording {
        if media.voiceNeedsFocusSelection(model) {
          Text("L’audio è legato alla selezione precedente. Il testo e i dati condivisi non vengono spostati automaticamente.").font(.caption)
          Button("Usa la selezione attuale per questo audio"){media.useCurrentVoiceFocus(model)}.disabled(model.focusIsStale)
        }
        Button("Invia messaggio vocale") { Task { await media.sendVoice(model, "message") } }
          .disabled(model.busy || !media.voiceConsent || media.voiceNeedsFocusSelection(model))
        Button("Elimina questa registrazione locale",role:.destructive){discardAudio=true}
      }
      Button(media.dialog ? "Termina dialogo vocale" : "Parla con RIMIAM") {
        Task { if media.dialog { media.endDialog() } else { await media.beginDialog(model) } }
      }.disabled(!media.voiceConsent || media.inCall || model.busy || model.focusIsStale || (media.note.file != nil && !media.dialog))
      if model.focusIsStale {Text("Il filone è cambiato. Seleziona nuovamente un filone attivo prima di iniziare o inviare audio.").font(.caption)}
      if media.dialog {
        Text(
          media.note.recording
            ? "Ti ascolto: una pausa invia il turno."
            : "Trascrizione e risposta in preparazione. Le azioni richiedono i normali controlli di conferma."
        ).font(.caption)
      }
      if !media.error.isEmpty { Text(media.error).foregroundStyle(.red) }
      if !media.note.error.isEmpty { Text(media.note.error).foregroundStyle(.red) }
    }.confirmationDialog("Eliminare la registrazione da questo dispositivo?",isPresented:$discardAudio,titleVisibility:.visible) {
      Button("Elimina registrazione locale",role:.destructive){media.discardNote()}
      Button("Annulla",role:.cancel){}
    } message:{Text("Questa azione non annulla un eventuale invio già ricevuto dal server.")}
    .onChange(of: phase) { _, value in
      if value != .active {
        media.endDialog()
        media.note.stop()
        media.stopPlayback()
      }
    }
  }
}
struct VoiceMessageView: View {
  let model: WorkspaceModel
  let messageID: String
  var body: some View {
    if let voice = model.media.voices.first(where: { $0.messageId == messageID }) {
      VStack(alignment: .leading) {
        Button("Ascolta audio originale") {
          Task { await model.media.playSource(model, voice.sourceId) }
        }
        Button("Ferma audio") { model.media.stopPlayback() }
        Text(voice.transcript ?? voice.errorCode ?? "Trascrizione in elaborazione…")
        Text(voice.qualification).font(.caption)
        if let query = voice.researchQuery {
          Text("Ricerca proposta: \(query)")
          Button("Invia questa query al servizio di ricerca") {
            Task {
              await model.workspaceCommand(
                ["type": "research.request", "query": query, "discloseQuery": true],
                label: "Ricerca richiesta a voce")
            }
          }
        }
      }
    }
  }
}
struct WorkspaceCallView: View {
  let model: WorkspaceModel
  var body: some View {
    DisclosureGroup("Chiamata audio tra partecipanti") {
      Text("RIMIAM non partecipa dal vivo. Registrazione e analisi richiedono atti separati.").font(
        .caption)
      if model.media.calls?.configured != true { Text("Servizio chiamate da configurare.") }
      if model.media.inCall {
        Button("Lascia chiamata") { Task { await model.media.leave(model) } }
        Button(model.media.muted ? "Attiva microfono" : "Disattiva microfono") {
          Task { await model.media.toggleMute() }
        }
      } else {
        Button("Entra nella chiamata") { Task { await model.media.join(model) } }.disabled(
          model.media.calls?.configured != true || model.busy)
      }
      Text(model.media.callStatus).font(.caption)
      if let snapshot = model.media.calls {
        ForEach(snapshot.calls) { call in
          DisclosureGroup("Chiamata \(call.id.prefix(8)) · \(call.state)") {
            if let error = call.errorCode { Text(error).foregroundStyle(.red) }
            ForEach(call.participants) { p in
              Text(
                "\(p.name) · \(p.state) · \(p.consented ? "consenso espresso" : "nessun consenso corrente")"
              ).font(.caption)
            }
            if call.recordings.contains(where: {
              !$0.captureFenced && ["active", "starting", "stopping", "unknown"].contains($0.state)
            }) {
              Text("Registrazione attiva o arresto da confermare").bold()
            }
            if model.media.inCall,
              let p = call.participants.first(where: {
                $0.userId == model.credential?.user.id && $0.state == "admitted"
              })
            {
              if !call.recordingRequested {
                Button("Richiedi registrazione") {
                  Task {
                    await model.workspaceCommand(
                      ["type": "call.recording.request", "callId": call.id],
                      label: "Richiedi registrazione")
                  }
                }.disabled(!snapshot.recordingConfigured)
              } else {
                if !p.consented {
                  Text(snapshot.consentText).font(.caption)
                  Button("Acconsento personalmente") {
                    Task {
                      await model.workspaceCommand(
                        [
                          "type": "call.recording.consent", "callId": call.id, "epoch": call.epoch,
                          "consentText": snapshot.consentText,
                        ], label: "Consenso personale alla registrazione")
                    }
                  }
                }
                Button("Ritira consenso · esci e rientra senza registrazione") {
                  Task { await model.media.withdraw(model, call.id) }
                }
              }
            }
            ForEach(call.recordings) { r in
              DisclosureGroup("Audio \(r.createdAt) · \(r.state)") {
                if r.state == "complete" {
                  Button("Ascolta registrazione") {
                    Task { await model.media.playRecording(model, r.id) }
                  }
                  Button("Ferma audio") { model.media.stopPlayback() }
                }
                Text(r.transcriptionStatus ?? "Trascrizione non ancora disponibile")
                if let error = r.errorCode { Text(error) }
                ForEach(r.segments) { s in
                  DisclosureGroup("Trascrizione da \(s.startSeconds)s") {
                    Text(s.content).textSelection(.enabled)
                    Text(s.qualification).font(.caption)
                  }
                }
              }
            }
            if call.state == "ended" {
              Button(
                call.analysisRequested ? "Prosegui analisi esistente" : "Richiedi analisi a RIMIAM"
              ) {
                Task {
                  await model.workspaceCommand(
                    ["type": "call.analyze", "callId": call.id], label: "Analizza chiamata")
                }
              }
            }
            if call.recordings.contains(where: {
              ["failed", "needs_configuration"].contains($0.transcriptionStatus ?? "")
            }) {
              Button("Riprova trascrizione") {
                Task {
                  await model.workspaceCommand(
                    ["type": "call.transcription.retry", "callId": call.id],
                    label: "Riprova trascrizione")
                }
              }
            }
            DisclosureGroup("Consensi e storia") {
              ForEach(call.events) { e in
                Text("\(e.createdAt) · \(e.kind) · \(e.actorId ?? "sistema")").font(.caption)
                if let epoch = e.epoch { Text("Consenso #\(epoch)").font(.caption) }
                if let text = e.consentText { Text(text).font(.caption) }
              }
            }
          }
        }
      }
      if !model.media.error.isEmpty { Text(model.media.error).foregroundStyle(.red) }
    }
  }
}

struct CallStatusBanner: View {
  let model: WorkspaceModel
  var body: some View {
    if model.media.inCall {
      let captured =
        model.media.calls?.calls.contains { call in
          call.recordings.contains {
            !$0.captureFenced && ["active", "starting", "stopping", "unknown"].contains($0.state)
          }
        } ?? false
      HStack {
        Text(
          captured
            ? "REGISTRAZIONE attiva o in verifica"
            : "Chiamata audio · nessuna registrazione attiva rilevata"
        ).font(.caption).bold()
        Spacer()
        Button("Esci") { Task { await model.media.leave(model) } }
      }.padding(8).background(.regularMaterial)
    }
  }
}
