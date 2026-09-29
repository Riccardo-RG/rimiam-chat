"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { auth } from "./auth-client";
import {
  accountErrorMessage,
  accountOAuthErrorReturn,
  safeAccountReturn,
} from "../shared/account-navigation";
import styles from "./account-access.module.css";

function subscribeNavigation(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
const readCallbackError = () =>
  new URLSearchParams(window.location.search).get("error") ?? "";
const serverCallbackError = () => "";

export function AccountPassword({
  label = "Password",
  name = "password",
  signup,
  disabled,
}: {
  label?: string;
  name?: string;
  signup: boolean;
  disabled: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className={styles.password}>
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={signup ? "new-password" : "current-password"}
          minLength={signup ? 12 : undefined}
          maxLength={128}
          required
          disabled={disabled}
          aria-describedby={signup ? `${id}-requirements` : undefined}
        />
        <button
          type="button"
          disabled={disabled}
          aria-controls={id}
          aria-pressed={visible}
          aria-label={`${visible ? "Nascondi" : "Mostra"} ${label.toLowerCase()}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Nascondi" : "Mostra"}
        </button>
      </div>
      {signup && (
        <p id={`${id}-requirements`} className={styles.help}>
          Da 12 a 128 caratteri.
        </p>
      )}
    </>
  );
}

export function AccountAccess({
  returnTo,
  localMail,
  googleAvailable,
}: {
  returnTo: string;
  localMail: boolean;
  googleAvailable: boolean;
}) {
  const callbackURL = safeAccountReturn(returnTo);
  const callbackError = useSyncExternalStore(
    subscribeNavigation,
    readCallbackError,
    serverCallbackError,
  );
  const [dismissedCallback, setDismissedCallback] = useState(false);
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState<"" | "email" | "google">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const shownError =
    error ||
    (!dismissedCallback && callbackError
      ? accountErrorMessage(callbackError)
      : "");
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        inFlight.current = false;
        setBusy("");
      }
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  useEffect(() => {
    if (shownError || notice) feedback.current?.focus();
  }, [shownError, notice]);
  const clearFeedback = () => {
    setError("");
    setNotice("");
    setDismissedCallback(true);
  };
  async function submit(method: "email" | "google", data?: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    clearFeedback();
    setBusy(method);
    let redirecting = false;
    try {
      if (method === "google") {
        const result = await auth.signIn.social({
          provider: "google",
          callbackURL,
          errorCallbackURL: accountOAuthErrorReturn(callbackURL),
        });
        if (result.error)
          setError(accountErrorMessage(result.error.code, result.error.status));
        else if (result.data?.url && result.data.redirect) redirecting = true;
        else setError(accountErrorMessage());
      } else if (data) {
        const email = String(data.get("email") ?? "").trim();
        const password = String(data.get("password") ?? "");
        const result = signup
          ? await auth.signUp.email({
              name: String(data.get("name") ?? "").trim(),
              email,
              password,
              callbackURL,
            })
          : await auth.signIn.email({ email, password, callbackURL });
        if (result.error)
          setError(accountErrorMessage(result.error.code, result.error.status));
        else if (signup)
          setNotice(
            localMail
              ? "Controlla la tua email per verificare l’account. In locale usa la casella di sviluppo."
              : "Controlla la tua email: per entrare, apri il link di verifica. Se avevi già un account con questo indirizzo, accedi o recupera la password. Controlla anche lo spam.",
          );
      }
    } catch {
      setError(
        "Non riusciamo a completare la richiesta. Controlla la connessione e riprova.",
      );
    } finally {
      if (!redirecting) {
        inFlight.current = false;
        setBusy("");
      }
    }
  }
  return (
    <section
      className={styles.card}
      aria-labelledby="account-title"
      aria-busy={Boolean(busy)}
    >
      <h2 id="account-title">
        {signup ? "Crea il tuo account" : "Bentornato"}
      </h2>
      <p className={styles.intro}>
        {googleAvailable
          ? "Continua con Google oppure usa email e password."
          : signup
            ? "Registrati con la tua email. Ti invieremo un link per verificarla."
            : "Accedi con email e password."}
      </p>
      {callbackURL.includes("invite=") && (
        <p className={styles.feedback}>
          Hai ricevuto un invito: usa l’indirizzo a cui è stato inviato. Dopo
          l’accesso potrai leggere e accettare l’invito allo spazio.
        </p>
      )}
      {googleAvailable && (
        <>
          <button
            type="button"
            className={styles.google}
            disabled={Boolean(busy)}
            onClick={() => void submit("google")}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59A14.42 14.42 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.91 23.91 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
              />
            </svg>
            {busy === "google" ? "Apertura di Google…" : "Continua con Google"}
          </button>
          <div className={styles.divider}>oppure con email</div>
        </>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit("email", new FormData(event.currentTarget));
        }}
      >
        <fieldset disabled={Boolean(busy)}>
          {signup && (
            <label>
              Nome
              <input name="name" autoComplete="name" required maxLength={100} />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <AccountPassword
            key={signup ? "new" : "current"}
            signup={signup}
            disabled={Boolean(busy)}
          />
          <button
            className={styles.primary}
            type="submit"
            disabled={Boolean(busy)}
          >
            {busy === "email"
              ? signup
                ? "Creazione account…"
                : "Accesso…"
              : signup
                ? "Registrati"
                : "Accedi"}
          </button>
        </fieldset>
      </form>
      {shownError && (
        <p
          className={`${styles.feedback} ${styles.error}`}
          role="alert"
          tabIndex={-1}
          ref={feedback}
        >
          {shownError}
        </p>
      )}
      {notice && (
        <p
          className={styles.feedback}
          role="status"
          tabIndex={-1}
          ref={feedback}
        >
          {notice}
        </p>
      )}
      <div className={styles.links}>
        {!signup && (
          <Link
            href={`/account/recovery?returnTo=${encodeURIComponent(callbackURL)}`}
          >
            Password dimenticata?
          </Link>
        )}
        <Link
          href={`/account/recovery?verify=1&returnTo=${encodeURIComponent(callbackURL)}`}
        >
          Reinvia verifica email
        </Link>
      </div>
      <p className={styles.switch}>
        {signup ? "Hai già un account? " : "È la tua prima volta? "}
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            setSignup(!signup);
            clearFeedback();
          }}
        >
          {signup ? "Accedi" : "Crea un account"}
        </button>
      </p>
      <p className={styles.legal}>
        <Link href="/beta" target="_blank" rel="noopener noreferrer">
          Regole della beta ↗
        </Link>
      </p>
      {localMail && (
        <p className={styles.help}>
          <Link href="/local-mail">Casella email locale di sviluppo</Link>
        </p>
      )}
    </section>
  );
}
