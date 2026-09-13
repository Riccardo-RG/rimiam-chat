"use client";
import { setHumanCallActive } from "./call-audio-focus";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  callViewSchema,
  recordingConsentText,
  type CallView,
} from "../contracts/calls";
import type { Command } from "../contracts/commands";
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
  const [view, setView] = useState<CallView | null>(null),
    [status, setStatus] = useState(""),
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
        "Ingresso in attesa: eventuali registrazioni devono prima essere arrestate.",
      );
      return;
    }
    if (room.current || joining.current) return;
    joining.current = true;
    const token = ++generation.current;
    void (async () => {
      try {
        window.dispatchEvent(
          new CustomEvent("miriam:microphone", { detail: "call" }),
        );
        const permission = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        permission.getTracks().forEach((t) => t.stop());
        if (token !== generation.current) return;
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
          setStatus("Riconnessione alla chiamata…"),
        );
        r.on(RoomEvent.Reconnected, () => setStatus("Chiamata connessa"));
        r.on(RoomEvent.Disconnected, () => {
          if (room.current === r) {
            room.current = null;
            setHumanCallActive(false);
            setStatus("Chiamata disconnessa. Premi Entra per riprovare.");
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
        setStatus("Chiamata connessa");
      } catch (e) {
        if (alive.current) {
          setError(errorText(e));
          await disconnect();
          setWanted(null);
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
  useEffect(() => {
    alive.current = true;
    let active = true;
    const load = () =>
      void api<unknown>(`/api/v1/workspaces/${workspace}/calls`)
        .then((x) => {
          if (active) {
            const next = callViewSchema.parse(x);
            setView(next);
            receiveCall(next);
          }
        })
        .catch((e) => {
          if (active) setError(errorText(e));
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
  return (
    <details className="workspace-call">
      <summary>
        Chiamata audio {current ? "· in corso" : "tra partecipanti"}
        {current?.recordings.some(
          (r) =>
            !r.captureFenced &&
            ["active", "starting", "stopping", "unknown"].includes(r.state),
        ) && " · REGISTRAZIONE attiva o in verifica"}
      </summary>
      <p>
        RIMIAM non partecipa dal vivo. La registrazione richiede il consenso
        personale di tutti; l’analisi si richiede dopo la chiamata.
      </p>
      {!view?.configured && (
        <p>Il servizio chiamate deve essere configurato.</p>
      )}
      {!wanted ? (
        <button
          disabled={disabled || busy || !view?.configured}
          onClick={() =>
            void act({ type: "call.join" }).then((r) => {
              if (r) setWanted(String(r.callId));
            })
          }
        >
          Entra nella chiamata
        </button>
      ) : (
        <>
          <button
            onClick={() => void leave().catch((e) => setError(errorText(e)))}
          >
            Lascia chiamata
          </button>
          <button
            disabled={status !== "Chiamata connessa"}
            onClick={() =>
              void room.current?.localParticipant
                .setMicrophoneEnabled(muted)
                .then(() => setMuted(!muted))
                .catch((e) => setError(errorText(e)))
            }
          >
            {muted ? "Attiva microfono" : "Disattiva microfono"}
          </button>
          <button onClick={() => void room.current?.startAudio()}>
            Abilita ascolto
          </button>
        </>
      )}
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
            {current.recordings.some(
              (r) =>
                !r.captureFenced &&
                ["active", "starting", "stopping", "unknown"].includes(r.state),
            )
              ? "Registrazione attiva o arresto da confermare"
              : "Audio non registrato"}
          </strong>
          {self && wanted && !current.recordingRequested && (
            <button
              disabled={busy || !view?.recordingConfigured}
              onClick={() =>
                void act({ type: "call.recording.request", callId: current.id })
              }
            >
              Richiedi registrazione
            </button>
          )}
          {self && wanted && current.recordingRequested && !self.consented && (
            <div>
              <p>{view?.consentText}</p>
              <button
                disabled={busy || self.state !== "admitted"}
                onClick={() =>
                  void act({
                    type: "call.recording.consent",
                    callId: current.id,
                    epoch: current.epoch,
                    consentText: recordingConsentText,
                  })
                }
              >
                Acconsento personalmente
              </button>
            </div>
          )}
          {self && wanted && current.recordingRequested && (
            <button
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
              Ritira consenso · esci e rientra senza registrazione
            </button>
          )}
          {current.errorCode && (
            <p role="alert">
              {errorText(current.errorCode)}. Non presumere che una
              registrazione sia terminata finché l’arresto non è confermato.
            </p>
          )}
        </div>
      )}
      {view?.calls
        .filter((c) => c.recordings.length || c.state === "ended")
        .map((c) => (
          <details key={c.id}>
            <summary>
              Storia chiamata {c.id.slice(0, 8)} · {c.state}
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
                      Trascrizione da {s.startSeconds}s · fonte non accettata
                    </summary>
                    <p>{s.content}</p>
                    <small>{s.qualification}</small>
                  </details>
                ))}
              </div>
            ))}
            <button
              disabled={disabled || busy || c.state !== "ended"}
              onClick={() => void act({ type: "call.analyze", callId: c.id })}
            >
              {c.analysisRequested
                ? "Consulta/prosegui analisi esistente"
                : "Richiedi analisi a RIMIAM"}
            </button>
            {c.recordings.some((r) =>
              ["failed", "needs_configuration"].includes(
                r.transcriptionStatus ?? "",
              ),
            ) && (
              <button
                disabled={disabled || busy}
                onClick={() =>
                  void act({ type: "call.transcription.retry", callId: c.id })
                }
              >
                Riprova trascrizione
              </button>
            )}
            <details>
              <summary>Consensi e storia</summary>
              {c.events.map((e) => (
                <p key={e.version}>
                  {e.createdAt} · {e.kind} · {e.actorId ?? "sistema"}
                  {e.epoch !== null && ` · consenso #${e.epoch}`}
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
    </details>
  );
}
