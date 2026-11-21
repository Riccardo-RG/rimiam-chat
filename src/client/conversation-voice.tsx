"use client";
import { preferredVoiceLanguage } from "../shared/i18n/locale";
import { useUiLanguage } from "./ui-language";

import { humanCallActive } from "./call-audio-focus";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import { voiceMessagesSchema } from "../contracts/voice";
import type { Command } from "../contracts/commands";
import type { ConversationReference } from "../contracts/activity";
import { api, errorText } from "./api";
import { ConversationAudioTool } from "./conversation-audio-tool";
import { microphoneError, microphoneUnavailable } from "./microphone-access";
import { SpeechPlayback } from "./speech-playback";

type Voice = z.infer<typeof voiceMessagesSchema>["messages"][number];
const VoiceContext = createContext<{
  workspace: string;
  voices: Voice[];
  throughSequence: number;
  audioTools?: ReactNode;
  research?: (query: string) => void;
}>({
  workspace: "",
  voices: [],
  throughSequence: 0,
});
export function ConversationAudioActions() {
  return useContext(VoiceContext).audioTools;
}
async function readVoices(workspace: string) {
  return voiceMessagesSchema.parse(
    await api<unknown>(`/api/v1/workspaces/${workspace}/voice`),
  );
}
export function useMessageQuestionSource(id: string, sequence: number) {
  const { workspace, voices, throughSequence } = useContext(VoiceContext);
  const voice = voices.find((item) => item.messageId === id);
  return {
    waitingForTranscript: !!voice && !voice.transcript,
    resolve: async () => {
      // A just-arrived message may precede the regular voice metadata refresh.
      const current =
        !voice && sequence > throughSequence
          ? (await readVoices(workspace)).messages.find(
              (item) => item.messageId === id,
            )
          : voice;
      if (current && !current.transcript)
        throw new Error("La trascrizione del vocale non è ancora disponibile.");
      return current?.sourceId ?? id;
    },
  };
}
export function VoiceMessage({ id }: { id: string }) {
  const { t: uiText } = useUiLanguage();
  const { workspace, voices, research } = useContext(VoiceContext),
    voice = voices.find((item) => item.messageId === id);
  if (!voice) return null;
  return (
    <div>
      <audio
        controls
        preload="none"
        src={`/api/v1/workspaces/${workspace}/source-file?id=${voice.sourceId}`}
        aria-label={uiText("Messaggio vocale originale")}
      />
      <p>
        {voice.transcript ??
          (voice.errorCode
            ? errorText(voice.errorCode)
            : uiText("Trascrizione in elaborazione…"))}
      </p>
      <small>{voice.qualification}</small>
      {voice.researchQuery && (
        <p>
          {uiText("Ricerca proposta: ")}
          {voice.researchQuery}
          <button onClick={() => research?.(voice.researchQuery!)}>
            {uiText("Invia questa query al servizio di ricerca")}
          </button>
        </p>
      )}
    </div>
  );
}
export function ConversationVoice({
  workspace,
  actor,
  disabled,
  command,
  messages,
  children,
  tools,
  workstreamFocus,
  focusLabel,
  focusWritable = true,
  reference,
}: {
  workspace: string;
  actor: string;
  disabled: boolean;
  command: (c: Command) => Promise<Record<string, unknown>>;
  messages: {
    id: string;
    sequence: number;
    content: string;
    reply_to_source_id: string | null;
    actor_kind: string;
  }[];
  children: ReactNode;
  tools: ReactNode;
  workstreamFocus?: { workstreamId: string; version: number };
  focusLabel?: string;
  focusWritable?: boolean;
  reference?: { reference: ConversationReference; title: string };
}) {
  const { t: uiText, locale } = useUiLanguage();
  const [voices, setVoices] = useState<Voice[]>([]),
    [transcriptionConfigured, setTranscriptionConfigured] = useState<boolean>(),
    [throughSequence, setThroughSequence] = useState(0),
    [consent, setConsent] = useState(false),
    [openingMic, setOpeningMic] = useState(false),
    [recording, setRecording] = useState(false),
    [clip, setClip] = useState<Blob | null>(null),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState(false),
    [pending, setPending] = useState<string | null>(null);
  const [clipFocus, setClipFocus] = useState<{
    workstreamId: string;
    version: number;
    label?: string;
  }>();
  const [clipReference, setClipReference] = useState<typeof reference>();
  const focusKey = workstreamFocus
    ? `${workstreamFocus.workstreamId}:${workstreamFocus.version}`
    : "";
  const lastFocus = useRef(focusKey);
  const referenceKey = JSON.stringify(reference?.reference ?? null);
  const lastReference = useRef(referenceKey);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    speech = useRef<SpeechPlayback | null>(null),
    generation = useRef(0),
    dialogRef = useRef(false),
    mounted = useRef(true),
    voiceTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    audioContext = useRef<AudioContext | null>(null);
  function stopCapture() {
    if (voiceTimer.current) clearInterval(voiceTimer.current);
    voiceTimer.current = null;
    void audioContext.current?.close();
    audioContext.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setRecording(false);
  }
  function end() {
    dialogRef.current = false;
    setDialog(false);
    generation.current++;
    setOpeningMic(false);
    stopCapture();
    speech.current?.stop();
    setPending(null);
  }
  const checkFocus = useEffectEvent(() => {
    if (
      dialogRef.current &&
      (lastFocus.current !== focusKey ||
        lastReference.current !== referenceKey ||
        !focusWritable)
    )
      end();
    lastFocus.current = focusKey;
    lastReference.current = referenceKey;
  });
  useEffect(() => {
    checkFocus();
  }, [focusKey, focusWritable, referenceKey]);
  const receiveVoices = useEffectEvent((currentVoices: Voice[]) => {
    if (!pending || !dialogRef.current) return;
    const voice = currentVoices.find((v) => v.sourceId === pending);
    if (
      voice?.errorCode ||
      voice?.interpretationStatus === "failed" ||
      voice?.interpretationStatus === "stale"
    ) {
      setError(
        voice.errorCode
          ? errorText(voice.errorCode)
          : uiText(
              "La risposta richiede attenzione. Il messaggio è conservato; consulta il Context.",
            ),
      );
      end();
      return;
    }
    const reply = messages.find(
      (m) => m.actor_kind === "miriam" && m.reply_to_source_id === pending,
    );
    if (!reply) return;
    setPending(null);
    if (!("speechSynthesis" in window)) {
      setError(
        uiText(
          "Voce del dispositivo non disponibile; la risposta è leggibile in Conversation.",
        ),
      );
      end();
      return;
    }
    speech.current ??= new SpeechPlayback(window.speechSynthesis);
    speech.current.speak(
      reply.id,
      reply.content,
      preferredVoiceLanguage(locale, navigator.language),
      (failure) => {
        if (failure) {
          setError(uiText(failure));
          end();
        } else if (dialogRef.current && mounted.current) void start(true);
      },
    );
    // Only a response to this device's explicit voice turn is auto-spoken.
  });
  const lastSeenSequence = useEffectEvent(() => messages.at(-1)?.sequence ?? 0);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      const latest = lastSeenSequence();
      void readVoices(workspace)
        .then((next) => {
          if (alive) {
            setVoices(next.messages);
            setTranscriptionConfigured(next.transcriptionConfigured);
            setThroughSequence(latest);
            receiveVoices(next.messages);
          }
        })
        .catch((e) => {
          if (alive) setError(errorText(e));
        })
        .finally(() => {
          loading = false;
        });
    };
    load();
    const timer = setInterval(load, 2500);
    const suspend = () => {
      if (document.hidden) end();
    };
    const focus = (e: Event) => {
      if ((e as CustomEvent).detail !== "voice") end();
    };
    document.addEventListener("visibilitychange", suspend);
    window.addEventListener("miriam:microphone", focus);
    return () => {
      alive = false;
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", suspend);
      window.removeEventListener("miriam:microphone", focus);
      // This ref invalidates pending callbacks; it is not a captured DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      dialogRef.current = false;
      stopCapture();
      speech.current?.stop();
    };
    // Scope is deliberately tied to the authenticated Workspace, not visual rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, actor]);
  async function send(
    blob: Blob,
    mode: "message" | "miriam",
    focus: typeof clipFocus,
    capturedReference: typeof reference,
  ) {
    if (disabled || !consent) return;
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length > 8388608) throw new Error("DOCUMENT_TOO_LARGE");
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      if (!mounted.current || token !== generation.current) return;
      const result = await command({
        type: "voice.send",
        filename: `Voce.${blob.type.includes("mp4") ? "m4a" : "webm"}`,
        bytesBase64: btoa(binary),
        mode,
        allowModelProcessing: true,
        ...(capturedReference
          ? { reference: capturedReference.reference }
          : {}),
        ...(focus
          ? {
              workstreamFocus: {
                workstreamId: focus.workstreamId,
                version: focus.version,
              },
            }
          : {}),
      });
      if (mounted.current && token === generation.current) {
        setClip(null);
        setClipReference(undefined);
        if (mode === "miriam") setPending(String(result.sourceId));
        else setSent(true);
      }
    } catch (e) {
      if (mounted.current && token === generation.current) {
        setError(errorText(e));
        end();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function start(asDialog = false) {
    if (humanCallActive()) {
      setError(
        uiText(
          "Termina la chiamata prima di usare il microfono per un vocale.",
        ),
      );
      end();
      return;
    }
    if (disabled || !consent || !focusWritable || recorder.current) return;
    const token = ++generation.current;
    const capturedFocus = workstreamFocus
      ? { ...workstreamFocus, label: focusLabel }
      : undefined;
    const capturedReference = reference;
    setError("");
    setSent(false);
    setClip(null);
    setClipFocus(undefined);
    setClipReference(undefined);
    speech.current?.stop();
    window.dispatchEvent(
      new CustomEvent("miriam:microphone", { detail: "voice" }),
    );
    try {
      const unavailable = microphoneUnavailable();
      if (unavailable) throw new Error(unavailable);
      const type =
        typeof MediaRecorder !== "undefined" &&
        ["audio/webm;codecs=opus", "audio/mp4"].find((t) =>
          MediaRecorder.isTypeSupported(t),
        );
      if (!type)
        throw new Error(
          "Registrazione audio non supportata da questo browser.",
        );
      setOpeningMic(true);
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (token !== generation.current || !mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const r = new MediaRecorder(media, { mimeType: type });
      recorder.current = r;
      const chunks: BlobPart[] = [];
      let size = 0;
      r.ondataavailable = (e) => {
        chunks.push(e.data);
        size += e.data.size;
        if (size > 7800000) stopCapture();
      };
      r.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        if (!mounted.current || token !== generation.current) return;
        const blob = new Blob(chunks, { type });
        if (!blob.size) {
          setError(uiText("L’audio è vuoto. Registra di nuovo il messaggio."));
          end();
          return;
        }
        setRecording(false);
        if (asDialog && dialogRef.current)
          void send(blob, "miriam", capturedFocus, capturedReference);
        else {
          setClipFocus(capturedFocus);
          setClipReference(capturedReference);
          setClip(blob);
        }
      };
      r.onerror = () => {
        if (!mounted.current || token !== generation.current) return;
        setError(uiText("Registrazione interrotta: riprova."));
        end();
      };
      r.start(250);
      setRecording(true);
      if (asDialog) {
        const ctx = new AudioContext();
        audioContext.current = ctx;
        const analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(media).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let heard = false,
          lastSpeech = Date.now();
        const started = Date.now();
        voiceTimer.current = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((n, v) => n + v * v, 0) / samples.length,
          );
          if (rms > 0.015) {
            heard = true;
            lastSpeech = Date.now();
          }
          if (heard && Date.now() - lastSpeech > 1600) stopCapture();
          else if (Date.now() - started > 120000) {
            setError(
              uiText(
                "Turno vocale lungo: invia o riprendi con un nuovo messaggio.",
              ),
            );
            stopCapture();
          }
        }, 150);
      }
    } catch (e) {
      if (mounted.current && token === generation.current) {
        setError(microphoneError(e));
        end();
      }
    } finally {
      if (mounted.current && token === generation.current) setOpeningMic(false);
    }
  }

  const voiceStatus = dialog
    ? "Dialogo vocale attivo"
    : recording
      ? "Registrazione in corso"
      : clip
        ? "Vocale pronto"
        : busy || pending
          ? "Voce in elaborazione"
          : error
            ? "Voce da verificare"
            : undefined;
  const audioTools = (
    <>
      <ConversationAudioTool
        icon="microphone"
        title={uiText("Voce")}
        status={voiceStatus}
        onClose={() => {
          if (openingMic) end();
        }}
      >
        {transcriptionConfigured === false && (
          <p role="status">
            {uiText(
              "La trascrizione non è configurata. Puoi registrare e condividere un vocale. Il dialogo a voce con Emme richiede la trascrizione.",
            )}
          </p>
        )}
        {disabled || !focusWritable ? (
          <p role="status">
            {disabled
              ? uiText(
                  "Puoi leggere la chat. Per inviare un vocale serve il permesso di scrivere.",
                )
              : uiText(
                  "Questo argomento non accetta nuovi messaggi. Apri la conversazione per registrare un vocale.",
                )}
          </p>
        ) : null}
        <label>
          <input
            type="checkbox"
            checked={consent}
            disabled={openingMic || recording || dialog || busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {uiText(
            "Autorizzo la condivisione dell’audio in questo spazio e la sua trascrizione quando il servizio è disponibile.",
          )}
        </label>
        <button
          type="button"
          disabled={
            disabled ||
            !consent ||
            openingMic ||
            busy ||
            dialog ||
            (!recording && !focusWritable)
          }
          onClick={() => (recording ? stopCapture() : void start())}
        >
          {recording
            ? uiText("Ferma nota vocale")
            : uiText("Registra messaggio vocale")}
        </button>
        {clip && (
          <>
            <p className="hint">
              {clipFocus
                ? uiText(
                    "Registrato per l’argomento {0} · v{1}. L’invio conserva questo riferimento.",
                    String(clipFocus.label ?? "selezionato"),
                    String(clipFocus.version),
                  )
                : uiText("Vocale registrato per la chat dello spazio.")}
            </p>
            {clipReference && (
              <p className="hint">
                {uiText("Riferimento conservato: ")}
                {clipReference.title}
                {uiText(" · versione")} {clipReference.reference.version}
                {uiText(
                  ". La registrazione resta riferita a questo passaggio.",
                )}
              </p>
            )}
            <button
              type="button"
              disabled={busy || disabled || !consent}
              onClick={() =>
                void send(clip, "message", clipFocus, clipReference)
              }
            >
              {uiText("Invia messaggio vocale")}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                setClip(null);
                setClipFocus(undefined);
                setClipReference(undefined);
              }}
            >
              {uiText("Scarta registrazione locale")}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={
            disabled ||
            !consent ||
            (!dialog && (openingMic || transcriptionConfigured === false)) ||
            busy ||
            (recording && !dialog) ||
            (!dialog && !focusWritable)
          }
          onClick={() => {
            if (dialog) end();
            else {
              dialogRef.current = true;
              setDialog(true);
              void start(true);
            }
          }}
        >
          {dialog ? uiText("Termina dialogo vocale") : uiText("Parla con Emme")}
        </button>
        {openingMic && (
          <p role="status">{uiText("Attendo l’accesso al microfono…")}</p>
        )}
        {sent && <p role="status">{uiText("Vocale inviato in chat.")}</p>}
        {dialog && !openingMic && (
          <p role="status">
            {recording
              ? uiText(
                  "Ti ascolto. Una pausa invia il turno; puoi terminare in qualsiasi momento.",
                )
              : pending
                ? uiText("Trascrizione e risposta in preparazione…")
                : uiText("Emme sta rispondendo…")}{" "}
            {uiText(
              "Le azioni consequenziali richiedono sempre i controlli di conferma.",
            )}
          </p>
        )}
        {recording && !dialog && (
          <p role="status">
            {uiText(
              "Registrazione locale in corso; usa Invia per condividerla.",
            )}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </ConversationAudioTool>
      {tools}
    </>
  );
  return (
    <VoiceContext.Provider
      value={{
        workspace,
        voices,
        throughSequence,
        audioTools,
        research: (query) => {
          void command({
            type: "research.request",
            query,
            discloseQuery: true,
          }).catch((e) => setError(errorText(e)));
        },
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
