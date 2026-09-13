import { describe, it, expect, vi } from "vitest";
import { SpeechPlayback } from "../src/client/speech-playback";
describe("Device-only speech presentation", () => {
  function setup(voices: { lang: string; localService: boolean }[]) {
    const speak = vi.fn(),
      cancel = vi.fn();
    const synthesis = {
      getVoices: () => voices,
      speak,
      cancel,
    } as unknown as SpeechSynthesis;
    const utterances: SpeechSynthesisUtterance[] = [];
    const playback = new SpeechPlayback(synthesis, (text) => {
      const u = { text } as SpeechSynthesisUtterance;
      utterances.push(u);
      return u;
    });
    return { playback, speak, cancel, utterances };
  }
  it("never falls back to network speech when a matching local voice is unavailable", () => {
    const s = setup([
      { lang: "it-IT", localService: false },
      { lang: "en-US", localService: true },
    ]);
    const ended = vi.fn();
    s.playback.speak("m1", "Testo condiviso", "it-IT", ended);
    expect(s.speak).not.toHaveBeenCalled();
    expect(ended.mock.calls[0][0]).toContain("Voce locale non disponibile");
  });
  it("uses the exact text and local voice, cancels prior playback, fences late callbacks and stops only the matching boundary", () => {
    const voice = { lang: "it-IT", localService: true },
      s = setup([voice]),
      first = vi.fn(),
      second = vi.fn();
    s.playback.speak("w1:m1", "Prima risposta", "it-IT", first);
    s.playback.speak("w2:m2", "Seconda risposta", "it", second);
    expect(first).toHaveBeenCalledOnce();
    expect(s.utterances[1].voice).toBe(voice);
    expect(s.utterances[1].text).toBe("Seconda risposta");
    s.utterances[0].onend?.call(s.utterances[0], {} as SpeechSynthesisEvent);
    expect(second).not.toHaveBeenCalled();
    s.playback.stop("w1:m1");
    expect(second).not.toHaveBeenCalled();
    s.playback.stop("w2:m2");
    expect(second).toHaveBeenCalledOnce();
  });
});
