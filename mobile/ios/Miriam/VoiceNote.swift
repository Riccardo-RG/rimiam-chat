import AVFoundation
import Observation
import Foundation
import SwiftUI

@MainActor @Observable final class VoiceNote {
  private var generation=0
  private var recorder: AVAudioRecorder?
  private(set) var recording=false
  private(set) var file:URL?
  var error=""
  func start() async {
    if WorkspaceMedia.callInProgress{error="Termina la chiamata prima di registrare una nota.";return}
    guard !recording else{return}
    discard()
    let token=generation
    let allowed=await AVAudioApplication.requestRecordPermission()
    guard token==generation else{return}
    guard allowed else{error="Consenti l’accesso al microfono nelle impostazioni per registrare una nota.";return}
    do {
      SpeechPlayback.shared.stop()
      let session=AVAudioSession.sharedInstance()
      try session.setCategory(.record,mode:.default)
      try session.setActive(true)
      let url=FileManager.default.temporaryDirectory.appendingPathComponent("Nota-vocale-\(UUID().uuidString).m4a")
      file=url
      let next=try AVAudioRecorder(url:url,settings:[AVFormatIDKey:kAudioFormatMPEG4AAC,AVSampleRateKey:44100,AVNumberOfChannelsKey:1,AVEncoderAudioQualityKey:AVAudioQuality.high.rawValue])
      next.isMeteringEnabled=true
      guard next.record() else{throw NSError(domain:"VoiceNote",code:1,userInfo:[NSLocalizedDescriptionKey:"Registrazione non disponibile"])}
      recorder=next;recording=true;error=""
    } catch {discard();self.error=error.localizedDescription}
  }
  func power()->Float {recorder?.updateMeters();return recorder?.averagePower(forChannel:0) ?? -160}
  func stop() {generation += 1;let captured=recorder != nil;recorder?.stop();recorder=nil;recording=false;if captured{try? AVAudioSession.sharedInstance().setActive(false)}}
  func discard() {stop();if let file {try? FileManager.default.removeItem(at:file)};file=nil}
}

@MainActor @Observable final class SpeechPlayback: NSObject, AVSpeechSynthesizerDelegate {
  static let shared=SpeechPlayback()
  private let synthesizer=AVSpeechSynthesizer()
  private var utterance:AVSpeechUtterance?
  private(set) var currentID:String?
  private(set) var error=""
  override init(){super.init();synthesizer.delegate=self}
  func stop(){let wasSpeaking=utterance != nil;utterance=nil;currentID=nil;synthesizer.stopSpeaking(at:.immediate);if wasSpeaking{try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)}}
  func speak(id:String,text:String){
    guard !WorkspaceMedia.callInProgress else{error="Termina la chiamata prima della lettura vocale.";return}
    stop();error=""
    // Only system-supplied installed voices; do not route private text to a third-party voice extension.
    let language=Locale.preferredLanguages.first ?? "it-IT"
    let voices=AVSpeechSynthesisVoice.speechVoices().filter{$0.identifier.hasPrefix("com.apple.")}
    guard let voice=voices.first(where:{$0.language==language}) ?? voices.first(where:{$0.language.split(separator:"-").first==language.split(separator:"-").first}) else{error="Voce del dispositivo non disponibile. Installa una voce nelle impostazioni.";return}
    do {try AVAudioSession.sharedInstance().setCategory(.playback,mode:.spokenAudio);try AVAudioSession.sharedInstance().setActive(true)} catch {self.error="Riproduzione vocale non disponibile.";return}
    let next=AVSpeechUtterance(string:text);next.voice=voice;utterance=next;currentID=id;synthesizer.speak(next)
  }
  nonisolated func speechSynthesizer(_ synthesizer:AVSpeechSynthesizer,didFinish utterance:AVSpeechUtterance){let identity=ObjectIdentifier(utterance);Task{@MainActor [weak self] in if self?.utterance.map(ObjectIdentifier.init)==identity {self?.stop()}}}
  nonisolated func speechSynthesizer(_ synthesizer:AVSpeechSynthesizer,didCancel utterance:AVSpeechUtterance){let identity=ObjectIdentifier(utterance);Task{@MainActor [weak self] in if self?.utterance.map(ObjectIdentifier.init)==identity {self?.stop()}}}
}
struct SpokenReplyButton:View {
  let id:String;let text:String
  @State private var speech=SpeechPlayback.shared
  @Environment(\.scenePhase) private var scenePhase
  var body:some View {
    VStack(alignment:.leading){
      Button(speech.currentID==id ? "Ferma lettura" : "Ascolta con la voce del dispositivo"){if speech.currentID==id {speech.stop()} else {speech.speak(id:id,text:text)}}.font(.caption)
      if !speech.error.isEmpty {Text(speech.error).font(.caption)}
    }.onDisappear{if speech.currentID==id {speech.stop()}}
     .onChange(of:scenePhase){_,phase in if phase != .active {speech.stop()}}
  }
}
