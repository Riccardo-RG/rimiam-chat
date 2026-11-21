// Capture and transport can resolve after a control act. Only an admission check for the current
// connection generation can open the local microphone, and closing is permanent for this identity.
type LocalCapture = { mediaStreamTrack: { enabled: boolean }; stop(): void };
export class CallMicrophone {
  private capture: LocalCapture | null = null;
  private closed = false;
  private muted = false;
  private admitted = false;
  generation = 0;

  attach(track: LocalCapture) {
    track.mediaStreamTrack.enabled = false;
    if (this.closed) {
      track.stop();
      return false;
    }
    this.capture = track;
    return true;
  }
  suspend() {
    this.generation++;
    this.admitted = false;
    if (this.capture) this.capture.mediaStreamTrack.enabled = false;
  }
  admit(generation: number) {
    if (this.closed || !this.capture || this.generation !== generation)
      return false;
    this.admitted = true;
    this.setMuted(this.muted);
    return true;
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.capture)
      this.capture.mediaStreamTrack.enabled =
        this.admitted && !this.closed && !muted;
  }
  close() {
    this.closed = true;
    this.suspend();
    this.capture?.stop();
    this.capture = null;
  }
}
