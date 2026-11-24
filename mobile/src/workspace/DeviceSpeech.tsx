import { preferredVoiceLanguage } from "../../../src/shared/i18n/locale";
import { useUiLanguage } from "../i18n";
import * as Speech from "expo-speech";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform, Text } from "react-native";
import { Action, usePalette } from "../ui";
import { startOfflineSpeech } from "./offline-speech";

export function DeviceSpeech({
  text,
  startAutomatically = false,
}: {
  text: string;
  startAutomatically?: boolean;
}) {
  const { t: uiText, locale } = useUiLanguage();
  const p = usePalette(),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState(""),
    generation = useRef(0),
    androidPlayback = useRef<ReturnType<typeof startOfflineSpeech>>(undefined);
  useEffect(() => {
    let active = true;
    function stop() {
      generation.current++;
      if (Platform.OS === "android") androidPlayback.current?.stop();
      else void Speech.stop().catch(() => {});
      if (active) setPlaying(false);
    }
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") stop();
    });
    return () => {
      active = false;
      listener.remove();
      stop();
    };
  }, []);
  const startRef = useRef<() => Promise<void>>(undefined);
  useEffect(() => {
    if (startAutomatically && AppState.currentState === "active")
      void startRef.current?.();
  }, [startAutomatically]);
  async function speak() {
    const token = ++generation.current;
    if (playing) {
      if (Platform.OS === "android") androidPlayback.current?.stop();
      else await Speech.stop();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    setError("");
    try {
      const language = preferredVoiceLanguage(
        locale,
        Intl.DateTimeFormat().resolvedOptions().locale,
      );
      if (Platform.OS === "android") {
        const { default: engine } =
          await import("@nammayatri/react-native-tts").catch(() => {
            throw new Error(
              "Installa la versione aggiornata dell’app per usare la voce locale.",
            );
          });
        if (token !== generation.current) return;
        androidPlayback.current = startOfflineSpeech(engine, text, language);
        await androidPlayback.current.done;
      } else {
        const voices = await Speech.getAvailableVoicesAsync();
        if (token !== generation.current) return;
        const v =
          voices.find(
            (v) => v.language.toLowerCase() === language.toLowerCase(),
          ) ??
          voices.find((v) => v.language.toLowerCase().split("-")[0] === locale);
        if (!v)
          throw new Error(
            "Installa una voce per la lingua selezionata nelle impostazioni del dispositivo.",
          );
        await new Promise<void>((resolve, reject) =>
          Speech.speak(text, {
            language: v.language,
            voice: v.identifier,
            onDone: resolve,
            onStopped: resolve,
            onError: () => reject(new Error("Lettura vocale interrotta.")),
          }),
        );
      }
    } catch (e) {
      if (generation.current === token)
        setError(
          e instanceof Error
            ? uiText(e.message)
            : uiText("Voce locale non disponibile."),
        );
    } finally {
      if (generation.current === token) setPlaying(false);
    }
  }
  startRef.current = speak;
  return (
    <>
      <Action
        label={
          playing
            ? uiText("Interrompi lettura")
            : uiText("Ascolta sul dispositivo")
        }
        onPress={() => void speak()}
      />
      {!!error && <Text style={{ color: p.muted }}>{error}</Text>}
    </>
  );
}
