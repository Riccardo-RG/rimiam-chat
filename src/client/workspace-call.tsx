"use client";
import { useUiLanguage } from "./ui-language";

import { setHumanCallActive } from "./call-audio-focus";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  callViewSchema,
  recordingConsentWordingSchema,
  type CallView,
} from "../contracts/calls";
import type { Command } from "../contracts/commands";
import { ConversationAudioTool } from "./conversation-audio-tool";
import { microphoneError, microphoneUnavailable } from "./microphone-access";
import { api, errorText } from "./api";

export function WorkspaceCall({
  workspace,
  actor,
  disabled,
  command,
}: {
  workspace: string;
  actor: string;
  disabled: boolean;
  command: (c: Command) => Promise<Record<string, unknown>>;
}) {
  const { t: uiText, locale } = useUiLanguage();
  const [view, setView] = useState<CallView | null>(null),
    [status, setStatus] = useState(""),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [muted, setMuted] = useState(false),
    [busy, setBusy] = useState(false),
    [wanted, setWanted] = useState<string | null>(null);
  const room = useRef<Room | null>(null),
    audio = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    joining = useRef(false),
    wantedRef = useRef<string | null>(null),
    alive = useRef(true);
  const receiveCall = useEffectEvent((currentView: CallView) => {
    if (!wanted) return;
    const c = currentView.calls.find((c) => c.id === wanted),
      p = c?.participants.find((p) => p.userId === actor && p.state !== "left");
    if (!p || c?.state === "ended" || p.state === "leaving") {
      void disconnect();
      setWanted(null);
      return;
    }
    if (p.state !== "admitted") {
      setStatus(
        uiText(
          "Ingresso in attesa: eventuali registrazioni devono prima essere arrestate.",
        ),
      );
      return;
    }
    if (room.current || joining.current) return;
    joining.current = true;
    const token = ++generation.current;
    void (async () => {
      try {
        const credentials = await api<{ url: string; token: string }>(
          `/api/v1/workspaces/${workspace}/call-connect`,
          { callId: wanted },
        );
        if (token !== generation.current) return;
        const r = new Room({ adaptiveStream: false, dynacast: false });
        room.current = r;
        setHumanCallActive(true);
        r.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            const element = track.attach();
            element.autoplay = true;
            audio.current?.append(element);
          }
        });
        r.on(RoomEvent.TrackUnsubscribed, (track) =>
          track.detach().forEach((e) => e.remove()),
        );
        r.on(RoomEvent.Reconnecting, () =>
          setStatus(uiText("Riconnessione alla chiamata…")),
        );
        r.on(RoomEvent.Reconnected, () =>
          setStatus(uiText("Chiamata connessa")),
        );
        r.on(RoomEvent.Disconnected, () => {
          if (room.current === r) {
            room.current = null;
            setHumanCallActive(false);
            setStatus(
              uiText("Chiamata disconnessa. Premi Entra per riprovare."),
            );
            setWanted(null);
          }
        });
        await r.connect(credentials.url, credentials.token);
        if (token !== generation.current) {
          await r.disconnect();
          return;
        }
        await r.localParticipant.setMicrophoneEnabled(true);
        setMuted(false);
        setStatus(uiText("Chiamata connessa"));
      } catch (e) {
        if (alive.current && token === generation.current) {
          setError(microphoneError(e));
          await leave().catch((failure) =>
            setError(microphoneError(e) + " " + errorText(failure)),
          );
        }
      } finally {
        joining.current = false;
      }
    })();
  });
  useEffect(() => {
    wantedRef.current = wanted;
  }, [wanted]);
  async function disconnect() {
    setHumanCallActive(false);
    generation.current++;
    joining.current = false;
    const r = room.current;
    room.current = null;
    if (r) await r.disconnect();
    audio.current?.replaceChildren();
    setStatus("");
  }
  async function leave() {
    const id = wantedRef.current;
    setWanted(null);
    wantedRef.current = null;
    await disconnect();
    if (id) await command({ type: "call.leave", callId: id });
  }
  async function act(c: Command) {
    setBusy(true);
    setError("");
    try {
      return await command(c);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function join() {
    setError("");
    setBusy(true);
    try {
      const unavailable = microphoneUnavailable();
      if (unavailable) throw new Error(unavailable);
      if (typeof RTCPeerConnection === "undefined")
        throw new Error("Questo browser non supporta le chiamate audio Web.");
      window.dispatchEvent(
        new CustomEvent("miriam:microphone", { detail: "call" }),
      );
      setStatus(uiText("Attendo l’accesso al microfono…"));
      const permission = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      permission.getTracks().forEach((t) => t.stop());
      if (!alive.current) return;
      setStatus(uiText("Ingresso nella chiamata…"));
      const result = await command({ type: "call.join" });
      if (alive.current) setWanted(String(result.callId));
    } catch (e) {
      if (alive.current) {
        setStatus("");
        setError(microphoneError(e));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    const load = () =>
      void api<unknown>(`/api/v1/workspaces/${workspace}/calls`)
        .then((x) => {
          if (active) {
            const next = callViewSchema.parse(x);
            setView(next);
            setLoadError("");
            receiveCall(next);
          }
        })
        .catch((e) => {
          if (active) setLoadError(errorText(e));
        });
    load();
    const timer = setInterval(load, 2000);
    const focus = (e: Event) => {
      if ((e as CustomEvent).detail !== "call" && wantedRef.current)
        void leave().catch(() => {});
    };
    const exit = () => {
      void room.current?.localParticipant.setMicrophoneEnabled(false);
      void room.current?.disconnect();
    };
    window.addEventListener("miriam:microphone", focus);
    window.addEventListener("pagehide", exit);
    return () => {
      active = false;
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener("miriam:microphone", focus);
      window.removeEventListener("pagehide", exit);
      // This ref is a lifecycle generation, not a captured DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      void room.current?.disconnect();
      room.current = null;
      setHumanCallActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, actor]);

  useEffect(() => {
    if (!wanted) return;
    const timer = setInterval(() => {
      void api(`/api/v1/workspaces/${workspace}/call-connect`, {
        callId: wanted,
      }).catch(async (e) => {
        setError(errorText(e));
        await disconnect();
        setWanted(null);
      });
    }, 20000);
    return () => clearInterval(timer);
  }, [wanted, workspace]);
  const current = view?.calls.find((c) => c.state === "open"),
    self = current?.participants.find(
      (p) => p.userId === actor && p.state !== "left",
    );
  const consentText = view?.currentConsentText ?? view?.consentText;
  const wording = recordingConsentWordingSchema.safeParse(consentText);
  const recording = current?.recordings.some(
    (r) =>
      !r.captureFenced &&
      ["active", "starting", "stopping", "unknown"].includes(r.state),
  );
  return (
    <ConversationAudioTool
      icon="phone"
      title={uiText("Chiamata audio")}
      status={
        recording
          ? "Registrazione attiva o in verifica"
          : current
            ? "Chiamata in corso"
            : error
              ? "Chiamata da verificare"
              : undefined
      }
    >
      {!view && !loadError && (
        <p role="status">{uiText("Verifica disponibilità della chiamata…")}</p>
      )}
      {loadError && <p role="alert">{loadError}</p>}
      {view && !view.configured && (
        <p role="status">
          {uiText(
            "Il servizio chiamate deve essere configurato. Chi gestisce RIMIAM può attivare il collegamento audio per questa installazione.",
          )}
        </p>
      )}
      {view?.configured && disabled && (
        <p role="status">
          {uiText(
            "Per entrare in chiamata serve il permesso di contribuire a questo spazio.",
          )}
        </p>
      )}
      {view?.configured && (
        <p>
          {uiText(
            "In chiamata parli con le persone dello spazio. Per registrare serve il consenso di tutti i partecipanti.",
          )}
        </p>
      )}
      {!wanted && view?.configured ? (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void join()}
        >
          {uiText("Entra nella chiamata")}
        </button>
      ) : wanted ? (
        <>
          <button
            type="button"
            onClick={() => void leave().catch((e) => setError(errorText(e)))}
          >
            {uiText("Lascia chiamata")}
          </button>
          <button
            type="button"
            disabled={status !== "Chiamata connessa"}
            onClick={() =>
              void room.current?.localParticipant
                .setMicrophoneEnabled(muted)
                .then(() => setMuted(!muted))
                .catch((e) => setError(microphoneError(e)))
            }
          >
            {muted ? uiText("Attiva microfono") : uiText("Disattiva microfono")}
          </button>
          <button
            type="button"
            onClick={() =>
              void room.current
                ?.startAudio()
                .catch((e) => setError(errorText(e)))
            }
          >
            {uiText("Abilita ascolto")}
          </button>
        </>
      ) : null}
      {status && <p role="status">{status}</p>}
      {current && (
        <div>
          <p>
            {current.participants
              .filter((p) => p.state !== "left")
              .map(
                (p) =>
                  `${p.name}: ${p.state}${p.consented ? ", consenso espresso" : ""}`,
              )
              .join(" · ")}
          </p>
          <strong role="status">
            {recording
              ? uiText("Registrazione attiva o arresto da confermare")
              : uiText("Audio non registrato")}
          </strong>
          {self &&
            wanted &&
            !current.recordingRequested &&
            (view?.recordingConfigured ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act({
                    type: "call.recording.request",
                    callId: current.id,
                  })
                }
              >
                {uiText("Richiedi registrazione")}
              </button>
            ) : (
              <p>
                {uiText(
                  "Puoi parlare in chiamata. Il servizio di registrazione non è configurato.",
                )}
              </p>
            ))}
          {self && wanted && current.recordingRequested && !self.consented && (
            <div>
              {locale === "en" && wording.success ? (
                <>
                  <p>{uiText(wording.data)}</p>
                  <details>
                    <summary>{uiText("Testo originale del consenso")}</summary>
                    <p lang="it">{wording.data}</p>
                  </details>
                </>
              ) : (
                <p>{consentText}</p>
              )}
              {!wording.success && (
                <p role="status">
                  {uiText(
                    "Aggiorna l’app per esprimere il consenso a queste condizioni.",
                  )}
                </p>
              )}
              <button
                type="button"
                disabled={busy || self.state !== "admitted" || !wording.success}
                onClick={() => {
                  if (wording.success)
                    void act({
                      type: "call.recording.consent",
                      callId: current.id,
                      epoch: current.epoch,
                      consentText: wording.data,
                    });
                }}
              >
                {uiText("Acconsento personalmente")}
              </button>
            </div>
          )}
          {self && wanted && current.recordingRequested && (
            <button
              type="button"
              onClick={() => {
                setMuted(true);
                setWanted(null);
                void disconnect();
                void act({
                  type: "call.recording.withdraw",
                  callId: current.id,
                });
              }}
            >
              {uiText("Ritira consenso · esci e rientra senza registrazione")}
            </button>
          )}
          {current.errorCode && (
            <p role="alert">
              {errorText(current.errorCode)}
              {uiText(
                ". Non presumere che una registrazione sia terminata finché l’arresto non è confermato.",
              )}
            </p>
          )}
        </div>
      )}
      {view?.calls
        .filter((c) => c.recordings.length || c.state === "ended")
        .map((c) => (
          <details key={c.id}>
            <summary>
              {uiText("Storia chiamata ")}
              {c.id.slice(0, 8)} · {c.state}
            </summary>
            {c.recordings.map((r) => (
              <div key={r.id}>
                <p>
                  {c.participants.find((p) => p.id === r.participantId)?.name} ·{" "}
                  {r.createdAt} · {r.state} · {r.transcriptionStatus}
                </p>
                {r.state === "complete" && (
                  <audio
                    controls
                    preload="none"
                    src={`/api/v1/workspaces/${workspace}/call-audio?id=${r.id}`}
                  />
                )}
                <p>{r.errorCode && errorText(r.errorCode)}</p>
                {r.segments.map((s) => (
                  <details key={s.id}>
                    <summary>
                      {uiText("Trascrizione da ")}
                      {s.startSeconds}
                      {uiText("s · fonte non accettata")}
                    </summary>
                    <p>{s.content}</p>
                    <small>{s.qualification}</small>
                  </details>
                ))}
              </div>
            ))}
            <button
              type="button"
              disabled={disabled || busy || c.state !== "ended"}
              onClick={() => void act({ type: "call.analyze", callId: c.id })}
            >
              {c.analysisRequested
                ? uiText("Consulta/prosegui analisi esistente")
                : uiText("Richiedi analisi a Emme")}
            </button>
            {c.recordings.some((r) =>
              ["failed", "needs_configuration"].includes(
                r.transcriptionStatus ?? "",
              ),
            ) && (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() =>
                  void act({ type: "call.transcription.retry", callId: c.id })
                }
              >
                {uiText("Riprova trascrizione")}
              </button>
            )}
            <details>
              <summary>{uiText("Consensi e storia")}</summary>
              {c.events.map((e) => (
                <p key={e.version}>
                  {e.createdAt} · {e.kind} · {e.actorId ?? uiText("sistema")}
                  {e.epoch !== null &&
                    uiText(" · consenso #{0}", String(e.epoch))}
                  {e.consentText && (
                    <>
                      <br />
                      {e.consentText}
                    </>
                  )}
                </p>
              ))}
            </details>
          </details>
        ))}
      {error && <p role="alert">{error}</p>}
      <div ref={audio} />
    </ConversationAudioTool>
  );
}
