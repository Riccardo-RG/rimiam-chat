"use client";
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
import { SpeechPlayback } from "./speech-playback";

type Voice = z.infer<typeof voiceMessagesSchema>["messages"][number];
const VoiceContext = createContext<{
  workspace: string;
  voices: Voice[];
  research?: (query: string) => void;
}>({
  workspace: "",
  voices: [],
});
export function VoiceMessage({ id }: { id: string }) {
  const { workspace, voices, research } = useContext(VoiceContext),
    voice = voices.find((v) => v.messageId === id);
  if (!voice) return null;
  return (
    <div>
      <audio
        controls
        preload="none"
        src={`/api/v1/workspaces/${workspace}/source-file?id=${voice.sourceId}`}
        aria-label="Messaggio vocale originale"
      />
      <p>
        {voice.transcript ??
          (voice.errorCode
            ? errorText(voice.errorCode)
            : "Trascrizione in elaborazione…")}
      </p>
      <small>{voice.qualification}</small>
      {voice.researchQuery && (
        <p>
          Ricerca proposta: {voice.researchQuery}
          <button onClick={() => research?.(voice.researchQuery!)}>
            Invia questa query al servizio di ricerca
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
    content: string;
    reply_to_source_id: string | null;
    actor_kind: string;
  }[];
  children: ReactNode;
  workstreamFocus?: { workstreamId: string; version: number };
  focusLabel?: string;
  focusWritable?: boolean;
  reference?: { reference: ConversationReference; title: string };
}) {
  const [voices, setVoices] = useState<Voice[]>([]),
    [consent, setConsent] = useState(false),
    [recording, setRecording] = useState(false),
    [clip, setClip] = useState<Blob | null>(null),
    [busy, setBusy] = useState(false),
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
          : "La risposta richiede attenzione. Il messaggio è conservato; consulta il Context.",
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
        "Voce del dispositivo non disponibile; la risposta è leggibile in Conversation.",
      );
      end();
      return;
    }
    speech.current ??= new SpeechPlayback(window.speechSynthesis);
    speech.current.speak(
      reply.id,
      reply.content,
      navigator.language || "it-IT",
      (failure) => {
        if (failure) {
          setError(failure);
          end();
        } else if (dialogRef.current && mounted.current) void start(true);
      },
    );
    // Only a response to this device's explicit voice turn is auto-spoken.
  });
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const load = () =>
      void api<unknown>(`/api/v1/workspaces/${workspace}/voice`)
        .then((x) => {
          if (alive) {
            const next = voiceMessagesSchema.parse(x).messages;
            setVoices(next);
            receiveVoices(next);
          }
        })
        .catch((e) => {
          if (alive) setError(errorText(e));
        });
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
      setError("Termina la chiamata prima di avviare il dialogo vocale.");
      return;
    }
    if (disabled || !consent || !focusWritable || recorder.current) return;
    const token = ++generation.current;
    const capturedFocus = workstreamFocus
      ? { ...workstreamFocus, label: focusLabel }
      : undefined;
    const capturedReference = reference;
    setError("");
    setClip(null);
    setClipFocus(undefined);
    setClipReference(undefined);
    speech.current?.stop();
    window.dispatchEvent(
      new CustomEvent("miriam:microphone", { detail: "voice" }),
    );
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (token !== generation.current || !mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const type = ["audio/webm;codecs=opus", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      if (!type)
        throw new Error(
          "Registrazione audio non supportata da questo browser.",
        );
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
        setError("Registrazione interrotta: riprova.");
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
              "Turno vocale lungo: invia o riprendi con un nuovo messaggio.",
            );
            stopCapture();
          }
        }, 150);
      }
    } catch (e) {
      stopCapture();
      setError(errorText(e));
      end();
    }
  }

  return (
    <VoiceContext.Provider
      value={{
        workspace,
        voices,
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
      <details className="voice-composer">
        <summary>
          {dialog
            ? "Dialogo vocale con RIMIAM attivo"
            : recording
              ? "Registrazione vocale in corso"
              : clip
                ? "Messaggio vocale pronto da inviare"
                : "Voce · messaggio o dialogo con RIMIAM"}
          {busy || pending ? " · in elaborazione" : ""}
          {error ? " · richiede attenzione" : ""}
        </summary>
        <label>
          <input
            type="checkbox"
            checked={consent}
            disabled={recording || dialog || busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          Condivido l’audio nel Workspace e autorizzo la trascrizione con il
          servizio configurato.
        </label>
        <button
          disabled={
            disabled ||
            !consent ||
            busy ||
            dialog ||
            (!recording && !focusWritable)
          }
          onClick={() => (recording ? stopCapture() : void start())}
        >
          {recording ? "Ferma nota vocale" : "Registra messaggio vocale"}
        </button>
        {clip && (
          <>
            <p className="hint">
              {clipFocus
                ? `Registrato per il filone ${clipFocus.label ?? "selezionato"} · v${clipFocus.version}. L’invio conserva questo riferimento.`
                : "Registrato per la conversazione dello Workspace."}
            </p>
            {clipReference && (
              <p className="hint">
                Riferimento conservato: {clipReference.title} · versione{" "}
                {clipReference.reference.version}. La registrazione resta
                riferita a questo passaggio.
              </p>
            )}
            <button
              disabled={busy || disabled}
              onClick={() =>
                void send(clip, "message", clipFocus, clipReference)
              }
            >
              Invia messaggio vocale
            </button>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => {
                setClip(null);
                setClipFocus(undefined);
                setClipReference(undefined);
              }}
            >
              Scarta registrazione locale
            </button>
          </>
        )}
        <button
          disabled={
            disabled ||
            !consent ||
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
          {dialog ? "Termina dialogo vocale" : "Parla con RIMIAM"}
        </button>
        {dialog && (
          <p role="status">
            {recording
              ? "Ti ascolto. Una pausa invia il turno; puoi terminare in qualsiasi momento."
              : pending
                ? "Trascrizione e risposta in preparazione…"
                : "RIMIAM sta rispondendo…"}{" "}
            Le azioni consequenziali richiedono sempre i controlli di conferma.
          </p>
        )}
        {recording && !dialog && (
          <p role="status">
            Registrazione locale in corso; usa Invia per condividerla.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </details>
    </VoiceContext.Provider>
  );
}
