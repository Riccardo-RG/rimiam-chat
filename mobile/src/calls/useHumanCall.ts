import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import { requestRecordingPermissionsAsync } from "expo-audio";
import type { CallView } from "../../../src/contracts/calls";
import type { Command } from "../../../src/contracts/commands";
import type { CommandReceipt } from "../../../src/contracts/v1";
import { post, type NativeRequest } from "../api";
import { describe, useCommands } from "../workspace/useCommands";
import { workspacePath } from "../workspace/commands";
import { audioGrant, liveParticipant } from "./policy";
import type { HumanAudio } from "./rtc";

export function useHumanCall(
  request: NativeRequest,
  origin: string,
  workspaceId: string,
  actorId: string,
) {
  const scope = useMemo(
    () => ({ origin, actorId, workspaceId }),
    [origin, actorId, workspaceId],
  );
  const exitScope = useMemo(
    () => ({ ...scope, lane: "call-exit" as const }),
    [scope],
  );
  const base = workspacePath(workspaceId);
  const [view, setView] = useState<CallView | null>(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [status, setStatus] = useState("");
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [wanted, setWanted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [known, setKnown] = useState(false);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const live = useRef(true);
  const joinIntent = useRef(false);
  const attempt = useRef(0);
  const room = useRef<HumanAudio | null>(null);
  const bound = useRef<{ callId: string; participantId: string } | null>(null);
  const command = useCommands(request, scope, (p) => {
    if (
      p.intent.kind === "command" &&
      p.intent.command.type === "call.join" &&
      joinIntent.current
    ) {
      const generation = attempt.current;
      void request<CommandReceipt>(base + "/receipts/" + p.id)
        .then((receipt) => {
          if (
            !live.current ||
            !joinIntent.current ||
            attempt.current !== generation
          )
            return;
          const { callId, participantId } = receipt.result;
          if (
            receipt.commandId !== p.id ||
            receipt.status !== "committed" ||
            typeof callId !== "string" ||
            typeof participantId !== "string"
          )
            throw new Error("Ingresso non riconosciuto.");
          bound.current = { callId, participantId };
          setView(null);
          setKnown(false);
          setWanted(true);
          setStatus("Attendo l’ammissione alla chiamata…");
          refresh();
        })
        .catch((e) => {
          if (live.current && attempt.current === generation) {
            joinIntent.current = false;
            setError(describe(e));
            setStatus("");
          }
        });
    }
    refresh();
  });
  const exitCommand = useCommands(request, exitScope, refresh);
  const exitRef = useRef(exitCommand);
  exitRef.current = exitCommand;
  const actorCall = view?.calls.find((c) => c.state === "open");
  const self = actorCall && liveParticipant(actorCall, actorId);
  const reset = useCallback(() => {
    attempt.current++;
    joinIntent.current = false;
    const r = room.current;
    room.current = null;
    if (r) void r.close().catch(() => {});
    if (live.current) {
      setWanted(false);
      setConnected(false);
      setConnecting(false);
      setOutputs([]);
      setMuted(false);
    }
  }, []);
  const exit = useCallback(
    (
      type: "call.leave" | "call.recording.withdraw" = "call.leave",
      id?: string,
    ) => {
      const callId = id ?? bound.current?.callId;
      reset();
      bound.current = null;
      if (live.current)
        setStatus(
          type === "call.recording.withdraw"
            ? "Microfono scollegato. Verifica il ritiro nella storia dei consensi."
            : "Audio scollegato.",
        );
      if (callId)
        void exitRef.current.send({
          kind: "command",
          command: { type, callId },
          label:
            type === "call.recording.withdraw"
              ? "Ritira il consenso"
              : "Lascia chiamata",
        });
    },
    [reset],
  );
  useEffect(() => {
    live.current = true;
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "background" && (joinIntent.current || room.current))
        exit();
      if (state === "active") refresh();
    });
    return () => {
      live.current = false;
      listener.remove();
      if (joinIntent.current || room.current) exit();
    };
  }, [exit, refresh]);
  useEffect(() => {
    const abort = new AbortController();
    let reading = false;
    async function read() {
      if (reading || AppState.currentState === "background") return;
      reading = true;
      try {
        const result = await request<CallView>(base + "/calls", {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setView(result);
          setKnown(true);
          setReadError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setView(null);
          setKnown(false);
          setReadError(describe(e));
          if (joinIntent.current || room.current) exit();
        }
      } finally {
        reading = false;
      }
    }
    void read();
    const timer = setInterval(() => void read(), wanted ? 2000 : 5000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [base, request, exit, wanted, reload]);

  async function join() {
    if (
      wanted ||
      connecting ||
      !command.ready ||
      command.working ||
      command.pending ||
      !exitCommand.ready ||
      exitCommand.working ||
      exitCommand.pending
    )
      return;
    joinIntent.current = true;
    setConnecting(true);
    setPermissionBlocked(false);
    setError("");
    setStatus("Controllo il microfono…");
    try {
      await import("./rtc"); // Report unsupported native builds before recording any participation.
      const permission = await requestRecordingPermissionsAsync();
      if (!live.current || !joinIntent.current) return;
      if (!permission.granted) {
        setPermissionBlocked(!permission.canAskAgain);
        throw new Error(
          "Consenti l’accesso al microfono per entrare nella chiamata.",
        );
      }
      setStatus("Richiesta di ingresso…");
      await command.send({
        kind: "command",
        command: { type: "call.join" },
        label: "Entra in chiamata",
      });
      // A lost receipt can be reconciled. Only this explicit foreground intent can start the microphone.
    } catch (e) {
      joinIntent.current = false;
      if (live.current) {
        setError(describe(e));
        setStatus("");
      }
    } finally {
      if (live.current) setConnecting(false);
    }
  }
  const callId = actorCall?.id;
  const participantId = self?.id;
  const state = self?.state;
  useEffect(() => {
    if (!wanted || !known) return;
    if (
      !callId ||
      !participantId ||
      callId !== bound.current?.callId ||
      participantId !== bound.current?.participantId
    ) {
      if (bound.current) {
        reset();
        bound.current = null;
        setStatus("La partecipazione alla chiamata è terminata.");
      }
      return;
    }
    if (state !== "admitted") {
      setStatus(
        "Attendo l’ammissione. Un’eventuale registrazione deve essere prima fermata.",
      );
      return;
    }
    const generation = ++attempt.current;
    const abort = new AbortController();
    let rtc: HumanAudio | null = null;
    let pendingLease = false;
    let recheck = false;
    const current = () =>
      live.current &&
      !abort.signal.aborted &&
      generation === attempt.current &&
      joinIntent.current;
    async function grant() {
      const value = await request<{
        url: string;
        token: string;
        participantId: string;
        callId: string;
      }>(base + "/call-connect", { ...post({ callId }), signal: abort.signal });
      return audioGrant(value, callId!, participantId!);
    }
    function failed(e: unknown) {
      if (!current()) return;
      setError(describe(e));
      exit("call.leave", callId);
    }
    async function revalidate() {
      if (!current() || !rtc) return;
      if (pendingLease) {
        recheck = true;
        return;
      }
      const fence = rtc.admissionGeneration;
      pendingLease = true;
      try {
        await grant();
        if (current() && rtc.admit(fence)) {
          setStatus("Chiamata connessa");
          setConnected(true);
        }
      } catch (e) {
        failed(e);
      } finally {
        pendingLease = false;
        if (recheck) {
          recheck = false;
          void revalidate();
        }
      }
    }
    async function connect() {
      try {
        setConnecting(true);
        setStatus("Connessione audio…");
        const { HumanAudio } = await import("./rtc");
        const auth = await grant();
        if (!current()) return;
        rtc = new HumanAudio({
          reconnecting: () => {
            if (current()) {
              setConnected(false);
              setStatus("Riconnessione · microfono sospeso");
            }
          },
          reconnected: () => {
            void revalidate();
          },
          disconnected: () =>
            failed(
              new Error(
                "Collegamento audio interrotto. Puoi rientrare nella chiamata.",
              ),
            ),
        });
        room.current = rtc;
        await rtc.start(auth.url, auth.token);
        if (!current()) {
          await rtc.close();
          return;
        }
        await revalidate();
        if (current()) setOutputs(await rtc.outputs().catch(() => []));
      } catch (e) {
        failed(e);
      } finally {
        if (current()) setConnecting(false);
      }
    }
    void connect();
    // Refresh only an admitted connection. The backend rechecks membership, the access version and session.
    const timer = setInterval(() => {
      if (current() && room.current && AppState.currentState === "active")
        void revalidate();
    }, 20000);
    return () => {
      abort.abort();
      clearInterval(timer);
      if (room.current === rtc) room.current = null;
      if (rtc) void rtc.close().catch(() => {});
    };
  }, [wanted, known, callId, participantId, state, request, base, exit, reset]);
  function mute() {
    const r = room.current;
    if (r) {
      r.setMuted(!muted);
      setMuted(!muted);
    }
  }
  async function output(id: string) {
    try {
      await room.current?.output(id);
    } catch (e) {
      if (live.current) setError(describe(e));
    }
  }
  return {
    view,
    error: error || readError,
    status,
    known,
    wanted,
    connecting,
    connected,
    muted,
    outputs,
    permissionBlocked,
    actorCall,
    self,
    command,
    exitCommand,
    refresh,
    join,
    exit,
    mute,
    output,
    settings: () => {
      void Linking.openSettings().catch((e) => setError(describe(e)));
    },
    act: (c: Command, label: string) => {
      if (live.current)
        void command.send({ kind: "command", command: c, label });
    },
  };
}
