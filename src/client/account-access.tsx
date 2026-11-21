"use client";
import { useUiLanguage } from "./ui-language";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import Link from "next/link";
import { auth } from "./auth-client";
import { IdentityProviderMark } from "./identity-provider-mark";
import {
  accountErrorMessage,
  accountOAuthErrorReturn,
  safeAccountReturn,
  socialCallbackError,
} from "../shared/account-navigation";
import styles from "./account-access.module.css";

function subscribeNavigation(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
const readCallbackError = () => socialCallbackError(window.location.search);
const serverCallbackError = () => "";

export function AccountPassword({
  label = "Password",
  name = "password",
  signup,
  disabled,
  error,
  inputRef,
  onChange,
}: {
  label?: string;
  name?: string;
  signup: boolean;
  disabled: boolean;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
  onChange?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
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
          ref={inputRef}
          onChange={onChange}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={
            [signup && `${id}-requirements`, error && `${id}-error`]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        <button
          type="button"
          disabled={disabled}
          aria-controls={id}
          aria-pressed={visible}
          aria-label={
            name === "repeat"
              ? uiText(
                  visible
                    ? "Nascondi la password di conferma"
                    : "Mostra la password di conferma",
                )
              : uiText(visible ? "Nascondi password" : "Mostra password")
          }
          onClick={() => setVisible(!visible)}
        >
          {visible ? uiText("Nascondi") : uiText("Mostra")}
        </button>
      </div>
      {signup && (
        <p id={`${id}-requirements`} className={styles.help}>
          {uiText("Da 12 a 128 caratteri.")}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function AccountAccess({
  returnTo,
  localMail,
  googleAvailable,
  microsoftAvailable = false,
  sessionPending = false,
  providerConfig = "ready",
  retryConfig,
}: {
  returnTo: string;
  localMail: boolean;
  googleAvailable: boolean;
  microsoftAvailable?: boolean;
  sessionPending?: boolean;
  providerConfig?: "loading" | "ready" | "error";
  retryConfig?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const callbackURL = safeAccountReturn(returnTo);
  const invited = callbackURL.startsWith("/?invite=");
  const callbackError = useSyncExternalStore(
    subscribeNavigation,
    readCallbackError,
    serverCallbackError,
  );
  const [dismissedCallback, setDismissedCallback] = useState(false);
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState<"" | "email" | "google" | "microsoft">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nameError, setNameError] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const nameErrorId = useId();
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const shownError =
    error ||
    (!dismissedCallback && callbackError
      ? uiText(accountErrorMessage(callbackError))
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
    if (!sessionPending && (shownError || notice)) feedback.current?.focus();
  }, [shownError, notice, sessionPending]);
  useEffect(() => {
    if (!sessionPending && nameError) nameInput.current?.focus();
  }, [nameError, sessionPending]);
  const clearFeedback = () => {
    setError("");
    setNotice("");
    setDismissedCallback(true);
    setNameError(false);
  };
  const chooseMode = (nextSignup: boolean) => {
    if (nextSignup === signup) return;
    setSignup(nextSignup);
    clearFeedback();
  };
  async function submit(
    method: "email" | "google" | "microsoft",
    data?: FormData,
  ) {
    if (inFlight.current || sessionPending) return;
    inFlight.current = true;
    clearFeedback();
    setBusy(method);
    let redirecting = false;
    try {
      if (method !== "email") {
        const result = await auth.signIn.social({
          provider: method,
          callbackURL,
          errorCallbackURL: accountOAuthErrorReturn(callbackURL, method),
        });
        if (result.error)
          setError(
            uiText(accountErrorMessage(result.error.code, result.error.status)),
          );
        else if (result.data?.url && result.data.redirect) redirecting = true;
        else setError(uiText(accountErrorMessage()));
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
          setError(
            uiText(accountErrorMessage(result.error.code, result.error.status)),
          );
        else if (signup)
          setNotice(
            localMail
              ? uiText(
                  "Controlla la tua email per verificare l’account. In locale usa la casella di sviluppo.",
                )
              : uiText(
                  "Controlla la tua email e apri il link di verifica per entrare. Dai un’occhiata anche allo spam. Hai già un account? Accedi o recupera la password.",
                ),
          );
      }
    } catch {
      setError(
        uiText(
          "Non riusciamo a completare la richiesta. Controlla la connessione e riprova.",
        ),
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
      <div
        className={styles.mode}
        role="group"
        aria-label={uiText("Modalità di accesso")}
      >
        <button
          type="button"
          aria-label={uiText("Accedi con un account esistente")}
          aria-pressed={!signup}
          disabled={Boolean(busy)}
          onClick={() => chooseMode(false)}
        >
          {uiText("Accedi")}
        </button>
        <button
          type="button"
          aria-pressed={signup}
          disabled={Boolean(busy)}
          onClick={() => chooseMode(true)}
        >
          {uiText("Crea un account")}
        </button>
      </div>
      <h2 id="account-title">
        {invited
          ? signup
            ? uiText("Crea un account per aprire l’invito")
            : uiText("Accedi per aprire l’invito")
          : signup
            ? uiText("Crea il tuo account")
            : uiText("Entra in RIMIAM")}
      </h2>
      {signup && (
        <p className={styles.intro}>
          {googleAvailable || microsoftAvailable
            ? uiText("Se scegli l’email, riceverai un link di verifica.")
            : uiText("Riceverai un link per verificare la tua email.")}
        </p>
      )}
      {invited && (
        <p className={styles.feedback}>
          {uiText(
            "Hai ricevuto un invito: usa l’indirizzo a cui è stato inviato. Dopo l’accesso potrai leggere e accettare l’invito allo spazio.",
          )}
        </p>
      )}
      {googleAvailable && (
        <button
          type="button"
          className={styles.provider}
          disabled={Boolean(busy)}
          onClick={() => void submit("google")}
        >
          <IdentityProviderMark provider="google" />
          {busy === "google"
            ? uiText("Apertura di Google…")
            : uiText("Continua con Google")}
        </button>
      )}
      {microsoftAvailable && (
        <button
          type="button"
          className={styles.provider}
          disabled={Boolean(busy)}
          onClick={() => void submit("microsoft")}
        >
          <IdentityProviderMark provider="microsoft" />
          {busy === "microsoft"
            ? uiText("Apertura di Microsoft…")
            : uiText("Continua con Microsoft")}
        </button>
      )}
      {providerConfig === "loading" && (
        <p className={styles.help} role="status">
          {uiText("Verifica dei metodi di accesso…")}
        </p>
      )}
      {providerConfig === "error" && (
        <div className={styles.providerStatus} role="status">
          {uiText("Impossibile verificare l’accesso con Google e Microsoft.")}{" "}
          <button type="button" className="quiet" onClick={retryConfig}>
            {uiText("Riprova")}
          </button>
        </div>
      )}
      {providerConfig === "ready" &&
        (!googleAvailable || !microsoftAvailable) && (
          <p className={styles.providerStatus}>
            {!googleAvailable && !microsoftAvailable
              ? uiText(
                  "L’accesso con Google e Microsoft non è ancora attivo. Puoi usare email e password.",
                )
              : uiText(
                  "L’accesso con {0} non è ancora attivo.",
                  String(googleAvailable ? "Microsoft" : "Google"),
                )}
          </p>
        )}
      {(googleAvailable || microsoftAvailable) && (
        <div className={styles.divider}>{uiText("oppure con email")}</div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          if (signup && !String(data.get("name") ?? "").trim()) {
            clearFeedback();
            setNameError(true);
            nameInput.current?.focus();
            return;
          }
          void submit("email", data);
        }}
      >
        <fieldset disabled={Boolean(busy)}>
          {signup && (
            <>
              <label>
                {uiText("Nome")}
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  ref={nameInput}
                  aria-invalid={nameError || undefined}
                  aria-describedby={nameError ? nameErrorId : undefined}
                  onChange={() => setNameError(false)}
                />
              </label>
              {nameError && (
                <p id={nameErrorId} className={styles.fieldError} role="alert">
                  {uiText("Inserisci il tuo nome.")}
                </p>
              )}
            </>
          )}
          <label>
            {uiText("Email")}
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
                ? uiText("Creazione account…")
                : uiText("Accesso…")
              : signup
                ? uiText("Registrati")
                : uiText("Accedi")}
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
            {uiText("Password dimenticata?")}
          </Link>
        )}
        <Link
          href={`/account/recovery?verify=1&returnTo=${encodeURIComponent(callbackURL)}`}
        >
          {uiText("Reinvia verifica email")}
        </Link>
      </div>
      <p className={styles.legal}>
        <Link href="/beta" target="_blank" rel="noopener noreferrer">
          {uiText("Regole della beta ↗")}
        </Link>
        <Link
          href="/connessioni-e-dati"
          target="_blank"
          rel="noopener noreferrer"
        >
          {uiText("Account, calendari e dati ↗")}
        </Link>
      </p>
      {localMail && (
        <p className={styles.help}>
          <Link href="/local-mail">
            {uiText("Casella email locale di sviluppo")}
          </Link>
        </p>
      )}
    </section>
  );
}
