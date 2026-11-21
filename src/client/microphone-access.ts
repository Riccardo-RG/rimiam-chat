import { errorText } from "./api";

export function microphoneUnavailable() {
  if (!window.isSecureContext)
    return "Per usare il microfono apri RIMIAM con una connessione HTTPS.";
  if (!navigator.mediaDevices?.getUserMedia)
    return "Questo browser non permette a RIMIAM di usare il microfono.";
  return "";
}

export function microphoneError(error: unknown) {
  switch (error instanceof Error ? error.name : "") {
    case "NotAllowedError":
    case "SecurityError":
      return "Microfono bloccato. Consenti l’accesso al microfono nelle impostazioni del sito e riprova.";
    case "NotFoundError":
      return "Nessun microfono disponibile. Collega o seleziona un microfono e riprova.";
    case "NotReadableError":
    case "AbortError":
      return "Il microfono non risponde. Verifica che sia disponibile e riprova.";
    default:
      return errorText(error);
  }
}
