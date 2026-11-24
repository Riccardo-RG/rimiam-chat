import type Tts from "@nammayatri/react-native-tts";

type SpeechEngine = Pick<
  typeof Tts,
  "getInitStatus" | "voices" | "setDefaultVoice" | "speak" | "stop"
> & {
  addEventListener(
    event: "tts-finish" | "tts-error" | "tts-cancel",
    listener: (event: { utteranceId: string }) => void,
  ): { remove(): void };
};

let stopPrevious: (() => void) | undefined;

/** The system speech engine is shared by all message rows. */
export function startOfflineSpeech(
  engine: SpeechEngine,
  text: string,
  language: string,
) {
  stopPrevious?.();
  let closed = false;
  const listeners: { remove(): void }[] = [];
  let finish!: (error?: Error, interrupt?: boolean) => void;
  const stop = () => finish(undefined, true);
  const done = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error("Lettura vocale interrotta."), true),
      10 * 60 * 1000,
    );
    finish = (error, interrupt = false) => {
      if (closed) return;
      closed = true;
      stopPrevious = undefined;
      clearTimeout(timeout);
      for (const listener of listeners) listener.remove();
      if (interrupt) void engine.stop().catch(() => {});
      if (error) reject(error);
      else resolve();
    };
  });
  stopPrevious = stop;
  void read().catch(() =>
    finish(new Error("Voce locale non disponibile."), true),
  );
  return { done, stop };

  async function read() {
    if (!text.trim() || text.length > 12000) {
      finish(new Error("Lettura non disponibile."));
      return;
    }
    await engine.getInitStatus();
    if (closed) return;
    const voices = await engine.voices();
    if (closed) return;
    const locale = language.toLowerCase();
    const local = voices
      .filter(
        (voice) =>
          voice.networkConnectionRequired === false &&
          voice.notInstalled === false &&
          voice.language.toLowerCase().split("-")[0] === locale.split("-")[0],
      )
      .sort(
        (a, b) =>
          Number(b.language.toLowerCase() === locale) -
            Number(a.language.toLowerCase() === locale) ||
          (b.quality ?? 0) - (a.quality ?? 0),
      )[0];
    if (!local) {
      finish(new Error("Installa una voce locale nella lingua selezionata."));
      return;
    }
    // The adapter rejects a missing voice or a rejected TextToSpeech.setVoice.
    await engine.setDefaultVoice(local.id);
    if (closed) return;
    let expectedId: string | undefined;
    let offset = 0;
    const early = new Map<string, boolean>();
    function completed(id: string, failed: boolean) {
      if (closed) return;
      if (expectedId === undefined) {
        // A short utterance can finish before its enqueue promise returns.
        early.set(id, failed);
        return;
      }
      if (id !== expectedId) return;
      expectedId = undefined;
      if (failed) finish(new Error("Lettura vocale interrotta."), true);
      else
        void next().catch(() =>
          finish(new Error("Lettura vocale interrotta."), true),
        );
    }
    for (const event of ["tts-finish", "tts-error", "tts-cancel"] as const) {
      listeners.push(
        engine.addEventListener(event, ({ utteranceId }) =>
          completed(utteranceId, event !== "tts-finish"),
        ),
      );
    }

    await next();

    async function next() {
      if (offset >= text.length) {
        finish();
        return;
      }
      // Stay below Android's 4,000-unit limit and preserve surrogate pairs.
      let end = Math.min(offset + 3999, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const id = await engine.speak(text.slice(offset, end));
      if (closed) return;
      offset = end;
      expectedId = id;
      const result = early.get(id);
      early.clear();
      if (result !== undefined) completed(id, result);
    }
  }
}
