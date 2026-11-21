import test from "node:test";
import assert from "node:assert/strict";
import { CallMicrophone } from "../src/calls/microphone.ts";
import {
  audioGrant,
  liveParticipant,
  recordingState,
  type HumanCall,
} from "../src/calls/policy.ts";

function capture() {
  return {
    mediaStreamTrack: { enabled: true },
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
}
test("an arriving track is silent until admitted and cannot return after withdrawal", () => {
  const microphone = new CallMicrophone();
  const first = capture();
  assert.equal(microphone.attach(first), true);
  assert.equal(first.mediaStreamTrack.enabled, false);
  assert.equal(microphone.admit(microphone.generation), true);
  assert.equal(first.mediaStreamTrack.enabled, true);
  const previous = microphone.generation;
  microphone.close();
  assert.equal(first.stopped, true);
  assert.equal(first.mediaStreamTrack.enabled, false);
  assert.equal(microphone.admit(previous), false);
  const late = capture();
  assert.equal(microphone.attach(late), false);
  assert.equal(late.stopped, true);
  assert.equal(late.mediaStreamTrack.enabled, false);
});
test("reconnect rejects an old admission and preserves the participant's mute", () => {
  const gate = new CallMicrophone();
  const mic = capture();
  gate.attach(mic);
  const previous = gate.generation;
  gate.admit(previous);
  gate.suspend();
  assert.equal(mic.mediaStreamTrack.enabled, false);
  assert.equal(gate.admit(previous), false);
  gate.setMuted(true);
  assert.equal(gate.admit(gate.generation), true);
  assert.equal(mic.mediaStreamTrack.enabled, false);
  gate.setMuted(false);
  assert.equal(mic.mediaStreamTrack.enabled, true);
});
test("native call tokens bind the precise call and participant over a secure transport", () => {
  const grant = {
    url: "wss://my.livekit.cloud",
    token: "scoped",
    callId: "call",
    participantId: "fresh",
  };
  assert.equal(audioGrant(grant, "call", "fresh").token, "scoped");
  for (const change of [
    { callId: "other" },
    { participantId: "old" },
    { token: "" },
    { url: "ws://my.livekit.cloud" },
    { url: "wss://x:y@my.livekit.cloud" },
    { url: "wss://my.livekit.cloud?token=wrong" },
  ]) {
    assert.throws(() => audioGrant({ ...grant, ...change }, "call", "fresh"));
  }
});
test("a previous consent is never presented as belonging to a reentered participant", () => {
  const members = [
    { state: "left", userId: "me", id: "old", name: "Io", consented: true },
    { state: "waiting", userId: "me", id: "new", name: "Io", consented: false },
  ];
  const call = {
    id: "call",
    version: 5,
    state: "open",
    recordingRequested: true,
    epoch: 4,
    errorCode: null,
    participants: members,
    recordings: [],
    events: [],
    analysisRequested: false,
  } satisfies HumanCall;
  assert.equal(liveParticipant(call, "me")?.id, "new");
  assert.equal(liveParticipant(call, "me")?.consented, false);
  assert.match(recordingState(call), /attesa/);
  assert.match(recordingState(call, false), /verificare/);
});
