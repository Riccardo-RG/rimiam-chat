"use client";
import { useEffect, useRef, useState } from "react";
import { auth } from "./auth-client";
import { BrandSignature } from "@/client/brand-signature";
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
  const [token, setToken] = useState(initialToken);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
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
    <main className="welcome">
      <AppearanceControl />
      <a
        className="wordmark brand-home"
        href={returnTo}
        aria-label="RIMIAM — Accesso"
      >
        <BrandSignature />
      </a>
      <h1>
        {done
          ? "Password aggiornata"
          : token
            ? "Scegli una nuova password"
            : verify
              ? "Verifica il tuo indirizzo"
              : "Recupera l’account"}
      </h1>
      {done ? (
        <p>
          Accedi di nuovo con la nuova password. Le sessioni precedenti sono
          state chiuse; il tuo accesso agli spazi non cambia.
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
            try {
              if (token) {
                const password = String(data.get("password"));
                if (password !== data.get("repeat")) {
                  setError("Le due password non coincidono.");
                  return;
                }
                const result = await auth.resetPassword({
                  token,
                  newPassword: password,
                });
                if (result.error) {
                  setError(
                    result.error.status === 429
                      ? "Troppe richieste. Attendi prima di riprovare."
                      : result.error.status >= 500
                        ? "Non possiamo confermare l’esito. Prova ad accedere con la nuova password oppure richiedi un nuovo link."
                        : result.error.code === "INVALID_TOKEN"
                          ? "Il link non è valido, è scaduto o è già stato utilizzato. Richiedine uno nuovo."
                          : "Non è stato possibile aggiornare la password. Usa da 12 a 128 caratteri e riprova; se il problema continua, richiedi un nuovo link.",
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
                      ? "Troppe richieste. Attendi prima di riprovare."
                      : "Non è stato possibile elaborare la richiesta. Riprova tra poco.",
                  );
                  return;
                }
                setNotice(
                  "Se l’indirizzo richiede questa operazione, riceverai un’email con il link. Controlla anche lo spam e attendi qualche minuto prima di richiederne un’altra.",
                );
              }
            } catch {
              setError(
                token
                  ? "Non possiamo confermare il cambio della password. Controlla la connessione e prova ad accedere; se necessario, richiedi un nuovo link."
                  : "Richiesta non confermata. Controlla la connessione e riprova tra poco.",
              );
            } finally {
              inFlight.current = false;
              setBusy(false);
            }
          }}
        >
          {token ? (
            <>
              <AccountPassword label="Nuova password" signup disabled={busy} />
              <AccountPassword
                label="Ripeti la nuova password"
                name="repeat"
                signup
                disabled={busy}
              />
              <p className={styles.help}>
                Dopo il cambio dovrai accedere nuovamente sui tuoi dispositivi.
              </p>
            </>
          ) : (
            <label>
              Email dell’account
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
              ? "Invio in corso…"
              : token
                ? "Salva nuova password"
                : verify
                  ? "Reinvia verifica email"
                  : "Richiedi link di recupero"}
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
          {error}
        </p>
      )}
      {token && error && (
        <a href={`/account/recovery?returnTo=${encodeURIComponent(returnTo)}`}>
          Richiedi un nuovo link
        </a>
      )}
      {delivery === "local" && (
        <p>
          <a href="/local-mail">Casella email locale di sviluppo</a>
        </p>
      )}
      {delivery === "unconfigured" && (
        <p className="processing">
          La consegna email non è ancora configurata in questo ambiente. Ripeti
          la richiesta dopo l’attivazione del servizio.
        </p>
      )}
      <a href={returnTo}>Torna all’accesso</a>
    </main>
  );
}
