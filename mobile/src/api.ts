import { translateUi } from "../../src/shared/i18n";
import { fetch as nativeFetch } from "expo/fetch";
import { apiUrl } from "./origin";

export interface NativeRequest {
  <T>(path: string, options?: RequestInit): Promise<T>;
  bytes(path: string, options?: RequestInit): Promise<Uint8Array>;
  stream(
    path: string,
    receive: (chunk: Uint8Array) => void,
    maximum: number,
    options?: RequestInit,
  ): Promise<void>;
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export function createRequest(
  origin: string,
  token?: string,
  onSessionInvalid?: () => void,
): NativeRequest {
  async function read(
    path: string,
    options: RequestInit = {},
    binary = false,
    sink?: { receive: (chunk: Uint8Array) => void; maximum: number },
  ): Promise<unknown> {
    const url = apiUrl(origin, path);
    const headers = new Headers(options.headers);
    headers.delete("Cookie");
    headers.delete("Origin");
    headers.delete("Authorization");
    if (token) headers.set("Authorization", "Bearer " + token);
    if (typeof options.body === "string")
      headers.set("Content-Type", "application/json");
    headers.set("Accept", binary ? "*/*" : "application/json");
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort);
    if (options.signal?.aborted) abort();
    let timeout = setTimeout(abort, 30000);
    try {
      const response = await nativeFetch(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body ?? undefined,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        if (
          response.status === 401 ||
          json?.error?.code === "ACCOUNT_INELIGIBLE"
        )
          onSessionInvalid?.();
        throw new ApiError(
          response.status,
          json?.error?.code ?? "REQUEST_FAILED",
        );
      }
      if (response.headers.get("X-Miriam-API-Version") !== "1")
        throw new Error("Risposta dell’installazione non riconosciuta.");
      if (sink) {
        const tooLarge = () =>
          new Error(
            "Il file audio è troppo grande per la riproduzione sul dispositivo.",
          );
        if (Number(response.headers.get("Content-Length")) > sink.maximum) {
          abort();
          throw tooLarge();
        }
        const reader = response.body?.getReader();
        if (!reader)
          throw new Error("Caricamento del file audio non disponibile.");
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > sink.maximum) throw tooLarge();
            sink.receive(value);
            clearTimeout(timeout);
            timeout = setTimeout(abort, 30000);
          }
        } catch (e) {
          abort();
          throw e;
        } finally {
          reader.releaseLock();
        }
        return;
      }
      if (binary) return new Uint8Array(await response.arrayBuffer());
      return await response.json();
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  return Object.assign(
    <T>(path: string, options?: RequestInit) =>
      read(path, options) as Promise<T>,
    {
      bytes: (path: string, options?: RequestInit) =>
        read(path, options, true) as Promise<Uint8Array>,
      stream: (
        path: string,
        receive: (chunk: Uint8Array) => void,
        maximum: number,
        options?: RequestInit,
      ) => read(path, options, true, { receive, maximum }) as Promise<void>,
    },
  );
}

export function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export function problem(
  error: unknown,
  t: (source: string, ...values: string[]) => string = (source, ...values) =>
    translateUi("it", source, ...values),
): string {
  if (error instanceof ApiError) {
    if (error.code === "EMAIL_NOT_VERIFIED")
      return t("Verifica l’indirizzo email prima di accedere.");
    if (error.status === 401)
      return t("Accesso non valido o sessione scaduta.");
    if (error.status === 403)
      return t("Il tuo account non ha accesso a questa operazione.");
    if (error.status === 409)
      return t("I dati sono cambiati. Aggiorna e controlla le modifiche.");
    if (error.status === 429)
      return t("Hai fatto più richieste ravvicinate. Riprova tra poco.");
    return t("Richiesta non riuscita ({0}).", error.code);
  }
  return t(
    "Connessione non riuscita. Controlla la rete e l’indirizzo del server.",
  );
}
