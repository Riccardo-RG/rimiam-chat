import { AudioSession, registerGlobals } from "@livekit/react-native";
import { CallMicrophone } from "./microphone";
import {
  ConnectionState,
  createLocalAudioTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

registerGlobals();
let audioTail: Promise<void> = Promise.resolve();
function serialize(fn: () => Promise<void>) {
  const current = audioTail.then(fn);
  audioTail = current.catch(() => {});
  return current;
}

export class HumanAudio {
  private static owner: HumanAudio | null = null;
  private readonly room = new Room({ adaptiveStream: false, dynacast: false });
  private readonly microphone = new CallMicrophone();
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly hooks: {
      reconnecting: () => void;
      reconnected: () => void;
      disconnected: () => void;
    },
  ) {
    this.room.on(RoomEvent.Reconnecting, () => {
      this.microphone.suspend();
      if (!this.closed) this.hooks.reconnecting();
    });
    this.room.on(RoomEvent.Reconnected, () => {
      if (!this.closed) this.hooks.reconnected();
    });
    this.room.on(RoomEvent.Disconnected, () => {
      if (!this.closed) {
        this.microphone.suspend();
        this.hooks.disconnected();
      }
    });
  }
  async start(url: string, token: string) {
    HumanAudio.owner = this;
    await serialize(async () => {
      if (HumanAudio.owner === this && !this.closed)
        await AudioSession.startAudioSession();
    });
    if (this.closed) return;
    await this.room.connect(url, token);
    if (this.closed) {
      await this.room.disconnect();
      return;
    }
    const track = await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
    });
    if (!this.microphone.attach(track)) return;
    await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.Microphone,
    });
    // The caller rechecks server admission after signaling and native media initialization.
  }
  get admissionGeneration() {
    return this.microphone.generation;
  }
  admit(generation: number) {
    return (
      this.room.state === ConnectionState.Connected &&
      this.microphone.admit(generation)
    );
  }
  setMuted(value: boolean) {
    this.microphone.setMuted(value);
  }
  async outputs() {
    return AudioSession.getAudioOutputs();
  }
  async output(id: string) {
    if (!this.closed) await AudioSession.selectAudioOutput(id);
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.microphone.close();
    this.closePromise = this.room.disconnect().finally(() =>
      serialize(async () => {
        if (HumanAudio.owner === this) {
          HumanAudio.owner = null;
          await AudioSession.stopAudioSession();
        }
      }),
    );
    return this.closePromise;
  }
}
