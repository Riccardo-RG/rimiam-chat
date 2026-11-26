"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import { auth } from "./auth-client";
import { BrandSignature } from "@/client/brand-signature";
import { WorkspaceIcon } from "./workspace-icon";
import { AppearanceControl } from "@/client/appearance-control";
import { AccountPassword } from "@/client/account-access";
import styles from "./account-access.module.css";
export function AccountRecovery({
  initialToken,
  verify,
  returnTo,
  invalidLink,
}: {
  initialToken: string;
  verify: boolean;
  returnTo: string;
  invalidLink: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const [token, setToken] = useState(initialToken);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const repeatPassword = useRef<HTMLInputElement>(null);
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(
      invalidLink
        ? "Il link non è valido o è scaduto. Richiedine uno nuovo."
        : "",
    ),
    [done, setDone] = useState(false),
    [delivery, setDelivery] = useState("");
  useEffect(() => {
    if (notice || error) feedback.current?.focus();
  }, [notice, error]);
  useEffect(() => {
    if (done) title.current?.focus();
  }, [done]);
  useEffect(() => {
    if (passwordMismatch) repeatPassword.current?.focus();
  }, [passwordMismatch]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("token")) {
      params.delete("token");
      window.history.replaceState(null, "", `/account/recovery?${params}`);
    }
    void fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setDelivery(c.accountDeliveryMode))
      .catch(() => {});
  }, []);
  return (
    <main className={styles.recovery}>
      <header className={styles.recoveryHeader}>
        <a
          className="wordmark brand-home"
          href={returnTo}
          aria-label={uiText("RIMIAM — Accesso")}
        >
          <BrandSignature />
        </a>
        <AppearanceControl />
      </header>
      <div className={styles.recoveryContent}>
        <h1 ref={title} tabIndex={done ? -1 : undefined}>
          {done
            ? uiText("Password aggiornata")
            : token
              ? uiText("Scegli una nuova password")
              : verify
                ? uiText("Verifica il tuo indirizzo")
                : uiText("Recupera l’account")}
        </h1>
        {!done && (
          <p className={styles.recoveryIntro}>
            {token
              ? uiText("Scegli una password che usi solo per RIMIAM.")
              : verify
                ? uiText(
                    "Ti invieremo un nuovo link per confermare la tua email.",
                  )
                : uiText(
                    "Inserisci la tua email per ricevere un link di recupero.",
                  )}
          </p>
        )}
        {done ? (
          <p role="status">
            {uiText(
              "Accedi di nuovo con la nuova password. Le sessioni precedenti sono state chiuse; il tuo accesso agli spazi non cambia.",
            )}
          </p>
        ) : (
          <form
            className={styles.card}
            aria-busy={busy}
            onSubmit={async (e) => {
              e.preventDefault();
              if (inFlight.current) return;
              const form = e.currentTarget,
                data = new FormData(form);
              inFlight.current = true;
              setBusy(true);
              setError("");
              setNotice("");
              setPasswordMismatch(false);
              try {
                if (token) {
                  const password = String(data.get("password"));
                  if (password !== data.get("repeat")) {
                    setPasswordMismatch(true);
                    repeatPassword.current?.focus();
                    return;
                  }
                  const result = await auth.resetPassword({
                    token,
                    newPassword: password,
                  });
                  if (result.error) {
                    setError(
                      result.error.status === 429
                        ? uiText(
                            "Troppe richieste. Attendi prima di riprovare.",
                          )
                        : result.error.status >= 500
                          ? uiText(
                              "Non possiamo confermare l’esito. Prova ad accedere con la nuova password oppure richiedi un nuovo link.",
                            )
                          : result.error.code === "INVALID_TOKEN"
                            ? uiText(
                                "Il link non è valido, è scaduto o è già stato utilizzato. Richiedine uno nuovo.",
                              )
                            : uiText(
                                "Non è stato possibile aggiornare la password. Usa da 12 a 128 caratteri e riprova; se il problema continua, richiedi un nuovo link.",
                              ),
                    );
                    return;
                  }
                  setToken("");
                  setDone(true);
                  form.reset();
                } else {
                  const email = String(data.get("email")).trim();
                  const result = verify
                    ? await auth.sendVerificationEmail({
                        email,
                        callbackURL: returnTo,
                      })
                    : await auth.requestPasswordReset({
                        email,
                        redirectTo: `${window.location.origin}/account/recovery?returnTo=${encodeURIComponent(returnTo)}`,
                      });
                  if (result.error) {
                    setError(
                      result.error.status === 429
                        ? uiText(
                            "Troppe richieste. Attendi prima di riprovare.",
                          )
                        : uiText(
                            "Non è stato possibile elaborare la richiesta. Riprova tra poco.",
                          ),
                    );
                    return;
                  }
                  setNotice(
                    uiText(
                      "Se possiamo completare la richiesta per questo indirizzo, riceverai un link via email. Controlla lo spam e attendi qualche minuto prima di riprovare.",
                    ),
                  );
                }
              } catch {
                setError(
                  token
                    ? uiText(
                        "Non possiamo confermare il cambio della password. Controlla la connessione e prova ad accedere; se necessario, richiedi un nuovo link.",
                      )
                    : uiText(
                        "Richiesta non confermata. Controlla la connessione e riprova tra poco.",
                      ),
                );
              } finally {
                inFlight.current = false;
                setBusy(false);
              }
            }}
          >
            {token ? (
              <>
                <AccountPassword
                  label={uiText("Nuova password")}
                  signup
                  disabled={busy}
                  onChange={() => setPasswordMismatch(false)}
                />
                <AccountPassword
                  label={uiText("Ripeti la nuova password")}
                  name="repeat"
                  signup
                  disabled={busy}
                  inputRef={repeatPassword}
                  error={
                    passwordMismatch
                      ? uiText("Le due password non coincidono.")
                      : undefined
                  }
                  onChange={() => setPasswordMismatch(false)}
                />
                <p className={styles.help}>
                  {uiText(
                    "Dopo il cambio dovrai accedere nuovamente sui tuoi dispositivi.",
                  )}
                </p>
              </>
            ) : (
              <label>
                {uiText("Email dell’account")}
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={busy}
                  required
                />
              </label>
            )}
            <button className={styles.primary} disabled={busy}>
              {busy
                ? uiText("Invio in corso…")
                : token
                  ? uiText("Salva nuova password")
                  : verify
                    ? uiText("Invia un nuovo link di verifica")
                    : uiText("Richiedi link di recupero")}
            </button>
          </form>
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
        {error && (
          <p
            className={`${styles.feedback} ${styles.error}`}
            role="alert"
            tabIndex={-1}
            ref={feedback}
          >
            {uiText(error)}
          </p>
        )}
        {token && error && (
          <a
            href={`/account/recovery?returnTo=${encodeURIComponent(returnTo)}`}
          >
            {uiText("Richiedi un nuovo link")}
          </a>
        )}
        {delivery === "local" && (
          <p>
            <a href="/local-mail">
              {uiText("Casella email locale di sviluppo")}
            </a>
          </p>
        )}
        {delivery === "unconfigured" && (
          <p className="processing">
            {uiText(
              "La consegna email non è ancora configurata in questo ambiente. Ripeti la richiesta dopo l’attivazione del servizio.",
            )}
          </p>
        )}
        <a className={styles.recoveryBack} href={returnTo}>
          <WorkspaceIcon name="back" />
          {uiText(" Torna all’accesso")}
        </a>
      </div>
    </main>
  );
}
