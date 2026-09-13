// Prevent local AI speech or another recorder from leaking into a human call.
let active = false;
export function humanCallActive() {
  return active;
}
export function setHumanCallActive(value: boolean) {
  active = value;
  if (value && typeof window !== "undefined") {
    window.speechSynthesis?.cancel();
    document.querySelectorAll("audio").forEach((a) => a.pause());
  }
}
