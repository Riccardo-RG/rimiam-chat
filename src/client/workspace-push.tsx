"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import styles from "./workspace-push.module.css";

type Binding = { actor: string; session: string; device: string };
type Preference = {
  configured: boolean;
  publicKey: string | null;
  deviceId: string | null;
  enabled: boolean;
  optedIn: boolean;
  lastDelivery?: {
    status: "queued" | "sending" | "submitted" | "failed" | "suppressed";
    at: string;
  } | null;
};
const deliveryStatus = {
  queued: "in coda per l’invio",
  sending: "invio in corso",
  submitted: "accettato dal servizio push del browser",
  failed: "invio non riuscito",
  suppressed: "invio annullato perché non più applicabile",
};
const supported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "locks" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
async function registration() {
  if (!supported()) return undefined;
  return navigator.serviceWorker.getRegistration("/");
}
async function message<T>(worker: ServiceWorker, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error("PUSH_DEVICE_UNAVAILABLE"));
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ok) resolve(event.data.value);
      else reject(new Error("PUSH_DEVICE_UNAVAILABLE"));
    };
    worker.postMessage(data, [channel.port2]);
  });
}
async function currentBinding(reg?: ServiceWorkerRegistration) {
  return reg?.active
    ? message<Binding | null>(reg.active, { type: "RIMIAM_PUSH_STATE" })
    : null;
}
async function setBinding(
  reg: ServiceWorkerRegistration,
  value: Binding | null,
  expected: Binding | null,
) {
  if (!reg.active) throw new Error("PUSH_DEVICE_UNAVAILABLE");
  return message<boolean>(reg.active, {
    type: "RIMIAM_PUSH_BIND",
    binding: value,
    expected,
  });
}
function deviceLock<T>(fn: () => Promise<T>, signal?: AbortSignal) {
  return navigator.locks.request("rimiam-push-device", { signal }, fn);
}
async function liveIdentityMatches(
  actor: string | null,
  session: string | null,
  signal?: AbortSignal,
) {
  const current = await api<{
    user: { id: string };
    session: { id: string };
  } | null>(
    "/api/auth/get-session",
    undefined,
    signal ?? AbortSignal.timeout(5000),
  );
  return (
    actor === (current?.user.id ?? null) &&
    session === (current?.session.id ?? null)
  );
}

/** Call before sign-out; failure must never prevent signing out. */
export async function disablePushBeforeLogout(actor?: string) {
  const timeout = AbortSignal.timeout(2500);
  try {
    if (!supported()) return;
    await Promise.race([
      deviceLock(async () => {
        const reg = await registration();
        if (!reg) return;
        const previous = await currentBinding(reg);
        if (!previous || previous.actor !== actor || timeout.aborted) return;
        if (!(await setBinding(reg, null, previous))) return;
        if (!timeout.aborted)
          await api(
            "/api/web-push",
            {
              operation: "disable_device",
              expectedActorId: actor,
              expectedSessionId: previous.session,
              deviceId: previous.device,
            },
            timeout,
          );
      }, timeout),
      new Promise<void>((resolve) =>
        timeout.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
  } catch {
    /* Revoked/ended sessions are fenced independently by the server. */
  }
}

/** Mount once at the account boundary, including the signed-out state. */
export function PushIdentityGuard({
  actor,
  sessionId,
  checking = false,
}: {
  actor: string | null;
  sessionId: string | null;
  checking?: boolean;
}) {
  useEffect(() => {
    if (checking) return;
    let current = true;
    const abort = new AbortController();
    if (!supported()) return;
    void deviceLock(async () => {
      const reg = await registration();
      if (!reg) return;
      const previous = await currentBinding(reg);
      if (
        current &&
        previous &&
        (previous.actor !== actor || previous.session !== sessionId) &&
        (await liveIdentityMatches(actor, sessionId, abort.signal)) &&
        current
      ) {
        await setBinding(reg, null, previous);
      }
    }, abort.signal).catch(() => {});
    return () => {
      current = false;
      abort.abort();
    };
  }, [actor, sessionId, checking]);
  return null;
}
function readable(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "PUSH_DEVICE_ACCOUNT_CHANGED")
    return "Questa iscrizione appartiene a un altro account. Disattiva le notifiche del sito nel browser, poi riattivale qui.";
  if (code === "PUSH_CONFIGURATION_REQUIRED")
    return "Le notifiche non sono ancora configurate sul servizio.";
  if (code === "PUSH_DEVICE_LIMIT")
    return "Hai raggiunto il limite di dispositivi con notifiche attive.";
  if (code === "AUTH_CONTEXT_CHANGED" || code === "AUTHENTICATION_REQUIRED")
    return "La sessione è cambiata. Accedi di nuovo prima di attivare le notifiche.";
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "Il browser non ha autorizzato le notifiche. Puoi modificarne il permesso nelle impostazioni del sito.";
  return "Non riesco ad aggiornare le notifiche. Verifica la connessione e riprova.";
}
type PushSettingsProps = {
  workspaceId: string;
  actor: string;
  sessionId: string;
};
export function WorkspacePushSettings(props: PushSettingsProps) {
  return (
    <PushSettings
      key={`${props.actor}:${props.sessionId}:${props.workspaceId}`}
      {...props}
    />
  );
}

function isAppleMobile() {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
function clientAvailability() {
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (window.isSecureContext && isAppleMobile() && !standalone)
    return "install";
  if (!supported()) return "unavailable";
  return Notification.permission === "denied" ? "denied" : "supported";
}
function blockedPermissionHelp() {
  const ua = navigator.userAgent;
  if (isAppleMobile())
    return "Apri Impostazioni › Notifiche › RIMIAM e attiva «Consenti notifiche».";
  const chrome = /Chrome\//.test(ua) && !/SamsungBrowser|Edg|OPR\//.test(ua);
  if (chrome && /Android/.test(ua))
    return "In Chrome apri i controlli del sito › Autorizzazioni › Notifiche e scegli «Consenti».";
  if (chrome)
    return "In Chrome fai clic sull’icona a sinistra dell’indirizzo e attiva «Notifiche» per questo sito.";
  if (
    /Macintosh/.test(ua) &&
    /Safari\//.test(ua) &&
    !/Chrome|Chromium|Edg|Firefox|OPR\//.test(ua)
  ) {
    if (matchMedia("(display-mode: standalone)").matches)
      return "Apri Impostazioni di Sistema › Notifiche › RIMIAM e attiva «Consenti notifiche».";
    return "In Safari apri Impostazioni › Siti web › Notifiche e scegli «Consenti» accanto a questo sito.";
  }
  return "Apri i permessi di questo sito nel browser e consenti le notifiche.";
}
function observeAvailability(changed: () => void) {
  let permission: PermissionStatus | undefined;
  let active = true;
  // Site controls can change without the tab losing focus. Safari versions
  // which do not expose this permission still report it on return.
  if (navigator.permissions) {
    void navigator.permissions
      .query({ name: "notifications" })
      .then((status) => {
        if (active) {
          permission = status;
          status.addEventListener("change", changed);
        }
      })
      .catch(() => {});
  }
  window.addEventListener("focus", changed);
  document.addEventListener("visibilitychange", changed);
  return () => {
    active = false;
    permission?.removeEventListener("change", changed);
    window.removeEventListener("focus", changed);
    document.removeEventListener("visibilitychange", changed);
  };
}
function useAvailability() {
  return useSyncExternalStore(
    observeAvailability,
    clientAvailability,
    () => "checking" as const,
  );
}
async function readPreference(
  { actor, sessionId, workspaceId }: PushSettingsProps,
  signal: AbortSignal,
) {
  const reg = await registration();
  const binding = await currentBinding(reg);
  const device =
    binding?.actor === actor && binding.session === sessionId
      ? binding.device
      : null;
  const result = await api<Preference>(
    `/api/web-push?workspace=${workspaceId}${device ? `&device=${device}` : ""}`,
    undefined,
    signal,
  );
  const subscribed = await reg?.pushManager.getSubscription();
  return {
    ...result,
    enabled:
      result.enabled && !!subscribed && Notification.permission === "granted",
  };
}

// This is a device-local presentation preference, never notification consent.
const promptKey = (actor: string) => `rimiam:push-intro:v1:${actor}`;
const promptEvent = "rimiam:push-intro-dismissed";
function introDismissed(actor: string) {
  try {
    return localStorage.getItem(promptKey(actor)) === "1";
  } catch {
    return true;
  }
}
function dismissIntro(actor: string) {
  try {
    localStorage.setItem(promptKey(actor), "1");
  } catch {
    // The manual bell remains available if preference storage is restricted.
  }
  window.dispatchEvent(new Event(promptEvent));
}
function observeDismissal(changed: () => void) {
  window.addEventListener(promptEvent, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(promptEvent, changed);
    window.removeEventListener("storage", changed);
  };
}

export function WorkspacePushPrompt({
  workspaceId,
  actor,
  sessionId,
  hidden,
  openSettings,
}: PushSettingsProps & { hidden: boolean; openSettings: () => void }) {
  const { t: uiText } = useUiLanguage();
  const availability = useAvailability();
  const dismissed = useSyncExternalStore(
    observeDismissal,
    () => introDismissed(actor),
    () => true,
  );
  const [offered, setOffered] = useState(false);
  const prompt = useRef<HTMLElement>(null);
  useEffect(() => {
    if (
      dismissed ||
      (availability !== "supported" && availability !== "install")
    )
      return;
    const abort = new AbortController();
    async function check() {
      try {
        const p = await readPreference(
          { actor, sessionId, workspaceId },
          abort.signal,
        );
        if (!abort.signal.aborted)
          setOffered(p.configured && !p.optedIn && !p.enabled);
      } catch {
        if (!abort.signal.aborted)
          window.addEventListener("online", check, {
            once: true,
            signal: abort.signal,
          });
      }
    }
    void check();
    return () => abort.abort();
  }, [workspaceId, actor, sessionId, availability, dismissed]);
  if (
    hidden ||
    dismissed ||
    !offered ||
    (availability !== "supported" && availability !== "install")
  )
    return null;
  function close() {
    const bell =
      prompt.current?.parentElement?.querySelector<HTMLButtonElement>(
        ".notification-shortcut",
      );
    dismissIntro(actor);
    setOffered(false);
    bell?.focus();
  }
  return (
    <aside
      ref={prompt}
      className={styles.prompt}
      aria-label={uiText("Avvisi della chat")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <strong>{uiText("Vuoi ricevere i nuovi messaggi?")}</strong>
      <p>
        {availability === "install"
          ? uiText(
              "Su iPhone e iPad gli avvisi arrivano aprendo RIMIAM dalla schermata Home.",
            )
          : uiText(
              "Puoi ricevere un avviso su questo dispositivo anche quando la chat è chiusa.",
            )}
      </p>
      <div>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            close();
            openSettings();
          }}
        >
          {availability === "install"
            ? uiText("Come attivarli")
            : uiText("Configura notifiche")}
        </button>
        <button type="button" className="quiet" onClick={close}>
          {uiText("Non ora")}
        </button>
      </div>
    </aside>
  );
}
function PushSettings({ workspaceId, actor, sessionId }: PushSettingsProps) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [preference, setPreference] = useState<Preference | null>(null);
  const availability = useAvailability();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState("");
  const [dismissedRequest, setDismissedRequest] = useState(false);
  const scope = useRef(0);
  const updating = useRef(false);
  useEffect(
    () => () => {
      scope.current++;
    },
    [],
  );
  useEffect(() => dismissIntro(actor), [actor]);
  useEffect(() => {
    function refresh() {
      if (!updating.current && document.visibilityState === "visible") {
        setError("");
        setAttempt((n) => n + 1);
      }
    }
    return observeAvailability(refresh);
  }, []);
  useEffect(() => {
    if (updating.current || clientAvailability() === "unavailable") return;
    const turn = scope.current;
    const abort = new AbortController();
    void readPreference({ actor, sessionId, workspaceId }, abort.signal)
      .then((p) => {
        if (!abort.signal.aborted && turn === scope.current) setPreference(p);
      })
      .catch((e) => {
        if (!abort.signal.aborted && turn === scope.current)
          setError(readable(e));
      });
    return () => abort.abort();
  }, [workspaceId, actor, sessionId, attempt]);

  async function enable() {
    if (updating.current || !preference?.publicKey) return;
    const publicKey = preference.publicKey;
    setDismissedRequest(false);
    const turn = ++scope.current;
    updating.current = true;
    setBusy(true);
    setError("");
    try {
      // Both begin in the click handler; never ask permission on mount.
      const registering = navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      const [, permission] = await Promise.all([
        registering,
        Notification.requestPermission(),
      ]);
      if (permission === "default") {
        if (turn === scope.current) setDismissedRequest(true);
        return;
      }
      if (permission !== "granted") {
        if (Notification.permission === "denied") return;
        throw new DOMException("Permission denied", "NotAllowedError");
      }
      const reg = await navigator.serviceWorker.ready;
      if (turn !== scope.current) return;
      await deviceLock(async () => {
        if (
          turn !== scope.current ||
          !(await liveIdentityMatches(actor, sessionId))
        )
          throw new Error("AUTH_CONTEXT_CHANGED");
        let prior = await currentBinding(reg);
        let subscription = await reg.pushManager.getSubscription();
        if (!prior || prior.actor !== actor || prior.session !== sessionId) {
          if (!(await setBinding(reg, null, prior)))
            throw new Error("AUTH_CONTEXT_CHANGED");
          prior = null;
          await subscription?.unsubscribe();
          subscription = null;
        }
        const key = Uint8Array.from(
          atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0),
        );
        if (
          subscription &&
          subscription.options.applicationServerKey &&
          new Uint8Array(subscription.options.applicationServerKey).join() !==
            key.join()
        ) {
          if (!(await setBinding(reg, null, prior)))
            throw new Error("AUTH_CONTEXT_CHANGED");
          prior = null;
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ??= await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        if (turn !== scope.current) return;
        const json = subscription.toJSON();
        const result = await api<{ deviceId: string; enabled: boolean }>(
          "/api/web-push",
          {
            operation: "enable",
            workspaceId,
            expectedActorId: actor,
            expectedSessionId: sessionId,
            consent: true,
            subscription: { endpoint: json.endpoint, keys: json.keys },
          },
        );
        if (turn !== scope.current) return;
        if (
          !(await setBinding(
            reg,
            {
              actor,
              session: sessionId,
              device: result.deviceId,
            },
            prior,
          ))
        )
          throw new Error("AUTH_CONTEXT_CHANGED");
        if (turn === scope.current)
          setPreference({ ...preference, ...result, optedIn: true });
      });
    } catch (e) {
      if (turn === scope.current) setError(readable(e));
    } finally {
      updating.current = false;
      if (turn === scope.current) setBusy(false);
    }
  }
  async function disable() {
    if (updating.current || !preference?.deviceId) return;
    const turn = ++scope.current;
    updating.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/api/web-push", {
        operation: "disable",
        workspaceId,
        expectedActorId: actor,
        expectedSessionId: sessionId,
        deviceId: preference.deviceId,
      });
      if (turn === scope.current)
        setPreference({ ...preference, enabled: false, optedIn: false });
    } catch (e) {
      if (turn === scope.current) setError(readable(e));
    } finally {
      updating.current = false;
      if (turn === scope.current) setBusy(false);
    }
  }
  async function tryDisplay() {
    if (updating.current || !preference?.enabled || !preference.deviceId)
      return;
    const turn = ++scope.current;
    updating.current = true;
    setBusy(true);
    setPreview("");
    try {
      const reg = await registration();
      const local = await currentBinding(reg);
      if (
        !reg ||
        !local ||
        local.device !== preference.deviceId ||
        local.actor !== actor ||
        local.session !== sessionId ||
        !(await liveIdentityMatches(actor, sessionId)) ||
        turn !== scope.current
      )
        throw new Error("AUTH_CONTEXT_CHANGED");
      await reg.showNotification("RIMIAM", {
        body: "Questa è la prova degli avvisi su questo dispositivo.",
        icon: "/icons/rimiam-192.png",
        tag: "rimiam-local-preview",
      });
      if (turn === scope.current)
        setPreview(
          "Prova richiesta al dispositivo. Controlla lo schermo o il centro notifiche.",
        );
    } catch {
      if (turn === scope.current)
        setPreview(
          "Prova non riuscita. Controlla i permessi del dispositivo e riprova.",
        );
    } finally {
      updating.current = false;
      if (turn === scope.current) setBusy(false);
    }
  }
  return (
    <section className="card" aria-label={uiText("Preferenze delle notifiche")}>
      <p>
        {uiText(
          "Ricevi un avviso quando un’altra persona scrive o invia un vocale in questo spazio, anche negli argomenti. Sullo schermo bloccato compare solo un avviso generico di RIMIAM.",
        )}
      </p>
      <p className="hint">
        {uiText(
          "La scelta vale per questo dispositivo e questa sessione. Include anche le risposte di Emme, gli aggiornamenti sul lavoro e i tuoi promemoria.",
        )}
      </p>
      {availability === "unavailable" ? (
        <p>
          {uiText(
            "Questo browser non supporta le notifiche di RIMIAM qui. Apri lo spazio in un browser compatibile tramite HTTPS.",
          )}
        </p>
      ) : error ? (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPreference(null);
              setError("");
              setAttempt(attempt + 1);
            }}
          >
            {uiText("Riprova verifica")}
          </button>
        </p>
      ) : !preference ? (
        <p role="status">{uiText("Verifica delle notifiche…")}</p>
      ) : !preference.configured ? (
        <p>{uiText("Notifiche non ancora attivate sul servizio.")}</p>
      ) : null}
      {preference?.configured && availability === "install" && (
        <p>
          {uiText(
            "Su iPhone o iPad, da Safari tocca Condividi e poi «Aggiungi alla schermata Home». Se compare «Apri come app web», attivalo. Apri RIMIAM dall’icona sulla Home e scegli «Attiva per questo spazio» dalla campanella.",
          )}{" "}
          <a
            href="https://support.apple.com/it-it/guide/iphone/iphea86e5236/ios"
            target="_blank"
            rel="noreferrer"
          >
            {uiText("Guida Apple")}
          </a>
        </p>
      )}
      {availability === "denied" && (
        <p>
          {uiText("Il dispositivo blocca gli avvisi. ")}
          {uiText(blockedPermissionHelp())}
          {uiText(" Quando torni qui il permesso viene ricontrollato.")}
        </p>
      )}
      {preference?.configured &&
        !preference.enabled &&
        availability === "supported" && (
          <>
            {dismissedRequest && Notification.permission === "default" && (
              <p role="status">
                {uiText(
                  "Il browser aspetta ancora la tua scelta. Puoi riprovare quando vuoi.",
                )}
              </p>
            )}
            {preference.optedIn && (
              <p>
                {uiText(
                  "Il collegamento salvato va riattivato su questo dispositivo.",
                )}
              </p>
            )}
            <button type="button" disabled={busy} onClick={() => void enable()}>
              {busy
                ? uiText("Aggiornamento…")
                : uiText("Attiva per questo spazio")}
            </button>
          </>
        )}
      {preference?.optedIn && (
        <button type="button" disabled={busy} onClick={() => void disable()}>
          {busy
            ? uiText("Aggiornamento…")
            : uiText("Disattiva per questo spazio")}
        </button>
      )}
      {preference?.enabled && availability === "supported" && (
        <>
          <p role="status">
            {uiText(
              "Notifiche attive per questo spazio su questo dispositivo.",
            )}
          </p>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void tryDisplay()}
          >
            {uiText("Prova avviso sul dispositivo")}
          </button>
          {preview && <p role="status">{preview}</p>}
        </>
      )}
      {preference?.configured && preference.optedIn && (
        <details>
          <summary>{uiText("Controlla l’ultimo invio")}</summary>
          <p>
            {preference.lastDelivery
              ? uiText(
                  "Ultimo avviso dello spazio · {0} · {1}.",
                  String(
                    new Date(preference.lastDelivery.at).toLocaleString(
                      uiLocale,
                    ),
                  ),
                  String(deliveryStatus[preference.lastDelivery.status]),
                )
              : uiText(
                  "Nessun avviso in questa iscrizione. Chiedi a un’altra persona di scrivere nello spazio, poi aggiorna il controllo.",
                )}
          </p>
          <p className="hint">
            {uiText(
              "Il servizio push può accettare un avviso anche quando il telefono lo silenzia. La prova sul dispositivo controlla solo la visualizzazione locale.",
            )}
          </p>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {uiText("Ricontrolla le notifiche")}
          </button>
        </details>
      )}
      <details>
        <summary>{uiText("Come ricevere gli avvisi sul telefono")}</summary>
        <p>
          <strong>{uiText("iPhone e iPad (16.4 o successivo).")}</strong>
          {uiText(
            " In Safari apri Condividi e scegli «Aggiungi alla schermata Home». Apri RIMIAM dalla nuova icona, accedi allo spazio e scegli «Attiva per questo spazio». Se una prova resta silenziosa, controlla Impostazioni › Notifiche › RIMIAM e la modalità Full immersion.",
          )}
        </p>
        <p>
          <strong>{uiText("Android.")}</strong>
          {uiText(
            " Apri lo spazio in Chrome, scegli «Attiva per questo spazio» e consenti le notifiche. Se gli avvisi sono bloccati, verifica i permessi del sito e del browser nelle impostazioni del telefono.",
          )}{" "}
          <a
            href="https://support.google.com/chrome/answer/114662?co=GENIE.Platform%3DAndroid&amp;hl=it"
            target="_blank"
            rel="noreferrer"
          >
            {uiText("Guida di Chrome")}
          </a>
        </p>
      </details>
    </section>
  );
}
