import { humanCallActive } from "./call-audio-focus";
// Local presentation only: never a command, model call, transcript or canonical-state transition.
export class SpeechPlayback {
  private current: {
    id: string;
    utterance: SpeechSynthesisUtterance;
    ended: (error?: string) => void;
  } | null = null;
  constructor(
    private synthesis: SpeechSynthesis,
    private makeUtterance = (text: string) =>
      new SpeechSynthesisUtterance(text),
  ) {}
  stop(id?: string) {
    if (id && this.current?.id !== id) return;
    const previous = this.current;
    this.current = null;
    this.synthesis.cancel();
    previous?.ended();
  }
  speak(
    id: string,
    text: string,
    language: string,
    ended: (error?: string) => void,
  ) {
    if (humanCallActive()) {
      ended("Termina la chiamata prima della lettura vocale.");
      return;
    }
    this.stop();
    const voices = this.synthesis.getVoices().filter((v) => v.localService);
    const voice =
      voices.find((v) => v.lang.toLowerCase() === language.toLowerCase()) ??
      voices.find((v) => v.lang.split("-")[0] === language.split("-")[0]);
    if (!voice) {
      ended(
        "Voce locale non disponibile: installa una voce nella lingua del dispositivo. Nessun testo è stato inviato a un servizio online.",
      );
      return;
    }
    const utterance = this.makeUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    this.current = { id, utterance, ended };
    const finish = (error?: string) => {
      if (this.current?.utterance !== utterance) return;
      this.current = null;
      ended(error);
    };
    utterance.onend = () => finish();
    utterance.onerror = () =>
      finish("Lettura vocale interrotta o non disponibile sul dispositivo.");
    this.synthesis.speak(utterance);
  }
}
