import { useUiLanguage } from "../i18n";
import { privateMediaCache } from "../private-media-cache";
import React, { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Switch, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { DeviceSpeech } from "./DeviceSpeech";
import { voiceReply } from "./voice-reply";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { z } from "zod";
import type { voiceMessagesSchema } from "../../../src/contracts/voice";
import type { NativeRequest } from "../api";
import { useResource } from "../useResource";
import { Action, usePalette } from "../ui";
import { captureAttachment, type Attachment } from "./commands";
import { describe, type Commands } from "./useCommands";
import { Panel } from "./SharedFiles";
import { PendingStrip } from "./PendingStrip";

type VoiceView = z.infer<typeof voiceMessagesSchema>;
export function VoicePanel({
  request,
  path,
  commands,
  canContribute,
  messageId,
  messages,
  onClose,
}: {
  request: NativeRequest;
  path: string;
  commands: Commands;
  canContribute: boolean;
  messageId?: string;
  messages: Snapshot["messages"];
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const voice = useResource<VoiceView>(request, path + "/voice", 5000);
  const [awaited, setAwaited] = useState<string | null>(null);
  const turnSession = useRef(0);
  const reply = awaited
    ? voiceReply(awaited, messages, voice.value?.messages ?? [])
    : null;
  const [mode, setMode] = useState<"message" | "miriam">("message");
  const [consent, setConsent] = useState(false);
  const [capture, setCapture] = useState<Attachment | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState("");
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const record = useAudioRecorderState(recorder, 300);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const cached = useRef<File | undefined>(undefined);
  const alive = useRef(true);
  const lock = useRef(false);
  const pendingVoice = useRef(false);
  const refreshData = voice.refresh;
  useEffect(() => {
    if (commands.pending?.intent.kind === "voice") pendingVoice.current = true;
    else if (pendingVoice.current && !commands.pending) {
      pendingVoice.current = false;
      setCapture(null);
      setConsent(false);
      refreshData();
    }
  }, [commands.pending, refreshData]);
  async function start() {
    if (lock.current || !consent || !canContribute) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted)
        throw new Error(
          "Consenti l’accesso al microfono nelle impostazioni del dispositivo.",
        );
      if (!alive.current || AppState.currentState === "background") return;
      setAwaited(null);
      player.pause();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      if (!alive.current) return;
      recorder.record({ forDuration: 300 });
    } catch (e) {
      if (alive.current) setError(describe(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function stop() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (recorder.isRecording) await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      if (!recorder.uri)
        throw new Error("La registrazione non è disponibile. Riprova.");
      const audio = await captureAttachment(recorder.uri, "Vocale.m4a");
      if (alive.current) setCapture(audio);
    } catch (e) {
      if (alive.current) setError(describe(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const close = () => {
    if (record.isRecording) {
      void stop().then(onClose);
    } else {
      onClose();
    }
  };
  useEffect(() => {
    alive.current = true;
    const a = AppState.addEventListener("change", (s) => {
      if (s !== "active") {
        turnSession.current++;
        setAwaited(null);
      }
      if (s === "background" && recorder.isRecording)
        void recorder.stop().catch(() => {});
    });
    return () => {
      alive.current = false;
      a.remove();
      if (recorder.isRecording) void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (cached.current?.exists) cached.current.delete();
    };
  }, [recorder]);
  async function play(source: string) {
    if (lock.current) return;
    if (playing === source && status.playing) {
      player.pause();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const bytes = await request.bytes(
        path + "/source-file?id=" + encodeURIComponent(source),
      );
      if (!alive.current) return;
      if (cached.current?.exists) cached.current.delete();
      const f = new File(privateMediaCache(), Crypto.randomUUID() + ".m4a");
      f.create();
      f.write(bytes);
      cached.current = f;
      player.replace(f.uri);
      player.play();
      setPlaying(source);
    } catch (e) {
      if (alive.current) setError(describe(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel
      title={messageId ? uiText("Messaggio vocale") : uiText("Voce")}
      onClose={close}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 12 }}
      >
        {voice.error && <Text style={{ color: p.text }}>{voice.error}</Text>}
        {voice.value?.transcriptionConfigured === false && (
          <Text style={{ color: p.text }}>
            {uiText(
              "La trascrizione non è configurata su questa installazione.",
            )}
          </Text>
        )}
        {canContribute && !messageId && (
          <>
            <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
              <Action
                label={uiText("Vocale al gruppo")}
                primary={mode === "message"}
                disabled={record.isRecording}
                onPress={() => {
                  turnSession.current++;
                  setAwaited(null);
                  setMode("message");
                }}
              />
              <Action
                label={uiText("Parla con Emme")}
                primary={mode === "miriam"}
                disabled={record.isRecording}
                onPress={() => setMode("miriam")}
              />
            </View>
            <View
              style={{ flexDirection: "row", gap: 7, alignItems: "center" }}
            >
              <Switch
                accessibilityLabel={uiText(
                  "Autorizzo trascrizione e condivisione",
                )}
                value={consent}
                onValueChange={setConsent}
                disabled={record.isRecording}
              />
              <Text style={{ flex: 1, color: p.text }}>
                {uiText(
                  "Con l’invio autorizzo la trascrizione e la condivisione di audio e testo nello spazio.",
                )}
              </Text>
            </View>
            {capture ? (
              <>
                <Text style={{ color: p.text }}>
                  {uiText("Vocale pronto · ")}
                  {Math.ceil(capture.size / 1024)}
                  {uiText(" KB")}
                </Text>
                <Action
                  label={uiText("Invia vocale")}
                  primary
                  disabled={
                    !consent ||
                    commands.working ||
                    !!commands.pending ||
                    !commands.ready
                  }
                  onPress={() => {
                    const session = turnSession.current;
                    void commands.send(
                      {
                        kind: "voice",
                        file: capture,
                        mode,
                        label: "Messaggio vocale",
                      },
                      (result) => {
                        if (
                          alive.current &&
                          mode === "miriam" &&
                          turnSession.current === session &&
                          AppState.currentState === "active" &&
                          typeof result.sourceId === "string"
                        )
                          setAwaited(result.sourceId);
                      },
                    );
                  }}
                />
                <Action
                  label={uiText("Scarta registrazione")}
                  disabled={!!commands.pending}
                  onPress={() => setCapture(null)}
                />
              </>
            ) : record.isRecording ? (
              <Action
                label={uiText(
                  "Termina · {0} s",
                  String(Math.floor(record.durationMillis / 1000)),
                )}
                primary
                disabled={busy}
                onPress={() => void stop()}
              />
            ) : (
              <>
                <Action
                  label={uiText("Registra")}
                  primary
                  disabled={
                    busy ||
                    !consent ||
                    !voice.value ||
                    (mode === "miriam" &&
                      !voice.value.transcriptionConfigured) ||
                    !!commands.pending
                  }
                  onPress={() => void start()}
                />
                {recorder.uri && (
                  <Action
                    label={uiText("Recupera registrazione terminata")}
                    disabled={busy}
                    onPress={() => void stop()}
                  />
                )}
              </>
            )}
          </>
        )}
        {mode === "miriam" && !messageId && (
          <Text style={{ color: p.muted }}>
            {uiText(
              "Invia il tuo turno vocale. Con la schermata aperta, la voce del dispositivo legge la risposta di Emme.",
            )}
          </Text>
        )}
        {awaited && mode === "miriam" && !messageId && (
          <View style={{ gap: 5 }}>
            {reply?.kind === "waiting" && (
              <Text style={{ color: p.text }}>
                {uiText("In attesa della risposta al tuo vocale…")}
              </Text>
            )}
            {reply?.kind === "failed" && (
              <Text style={{ color: p.text }}>
                {uiText(
                  "La risposta a questo vocale richiede attenzione. Il messaggio resta nella conversazione.",
                )}
              </Text>
            )}
            {reply?.kind === "ready" && (
              <>
                <Text selectable style={{ color: p.text }}>
                  {reply.text}
                </Text>
                <DeviceSpeech
                  key={reply.id}
                  text={reply.text}
                  startAutomatically
                />
              </>
            )}
            <Action
              label={uiText("Termina turno vocale")}
              onPress={() => setAwaited(null)}
            />
          </View>
        )}
        <PendingStrip commands={commands} />
        {!!error && <Text style={{ color: p.text }}>{error}</Text>}
        {voice.value?.messages
          .filter((m) => !messageId || m.messageId === messageId)
          .map((m) => (
            <View
              key={m.messageId}
              style={{
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: p.line,
                gap: 6,
              }}
            >
              <Text style={{ color: p.text }}>
                {m.transcript ??
                  (m.errorCode
                    ? uiText("Trascrizione non disponibile")
                    : uiText("In attesa della trascrizione"))}
              </Text>
              <Action
                label={
                  playing === m.sourceId && status.playing
                    ? uiText("Pausa")
                    : uiText("Ascolta vocale")
                }
                disabled={busy || record.isRecording}
                onPress={() => void play(m.sourceId)}
              />
            </View>
          ))}
      </ScrollView>
    </Panel>
  );
}
