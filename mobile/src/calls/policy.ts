import type { CallView } from "../../../src/contracts/calls";
export type HumanCall = CallView["calls"][number];

export function recordingState(call: HumanCall, known = true) {
  if (!known || call.errorCode)
    return "Stato della registrazione da verificare";
  if (
    call.recordings.some(
      (r) =>
        !r.captureFenced &&
        ["active", "starting", "stopping", "unknown"].includes(r.state),
    )
  )
    return "Registrazione attiva o arresto da confermare";
  return call.recordingRequested
    ? "Registrazione richiesta · in attesa dei consensi o dell’avvio"
    : "Audio non registrato";
}

export function liveParticipant(call: HumanCall, actor: string) {
  // A participant can rejoin with a fresh identity after withdrawing.
  return [...call.participants]
    .reverse()
    .find(
      (p) => p.userId === actor && p.state !== "left" && p.state !== "leaving",
    );
}

export function audioGrant(
  value: { url: string; token: string; participantId: string; callId: string },
  callId: string,
  participantId: string,
) {
  const url = new URL(value.url);
  if (
    value.callId !== callId ||
    value.participantId !== participantId ||
    !value.token ||
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("Il collegamento audio non corrisponde alla chiamata.");
  return { url: url.href, token: value.token };
}
