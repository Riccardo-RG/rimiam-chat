"use client";
import { preferredVoiceLanguage } from "../shared/i18n/locale";
import { useUiLanguage } from "./ui-language";

import { useEffect, useState } from "react";
import { SpeechPlayback } from "./speech-playback";
let playback: SpeechPlayback | undefined;
export function SpokenReply({ id, text }: { id: string; text: string }) {
  const { t: uiText, locale } = useUiLanguage();
  const [speaking, setSpeaking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const stop = () => {
      playback?.stop(id);
      setSpeaking(false);
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    return () => {
      playback?.stop(id);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [id]);
  return (
    <>
      <button
        type="button"
        className="quiet"
        aria-label={
          speaking
            ? uiText("Ferma lettura")
            : uiText("Ascolta con la voce del dispositivo")
        }
        title={
          speaking
            ? uiText("Ferma lettura")
            : uiText("Ascolta con la voce del dispositivo")
        }
        onClick={() => {
          if (speaking) {
            playback?.stop(id);
            setSpeaking(false);
            return;
          }
          setError("");
          if (!("speechSynthesis" in window)) {
            setError(
              uiText("Lettura vocale non disponibile in questo browser."),
            );
            return;
          }
          playback ??= new SpeechPlayback(window.speechSynthesis);
          setSpeaking(true);
          playback.speak(
            id,
            text,
            preferredVoiceLanguage(locale, navigator.language),
            (message) => {
              setSpeaking(false);
              setError(message ? uiText(message) : "");
            },
          );
        }}
      >
        {speaking ? uiText("Ferma lettura") : uiText("Ascolta")}
      </button>
      {error && <small role="status">{error}</small>}
    </>
  );
}
