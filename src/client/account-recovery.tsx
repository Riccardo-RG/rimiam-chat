"use client";
import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { BrandSignature } from "@/client/brand-signature";
import { AppearanceControl } from "@/client/appearance-control";
const auth = createAuthClient();
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
          state revocate; membership, adesioni e authority non sono cambiate.
        </p>
      ) : (
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form);
            setBusy(true);
            setError("");
            setNotice("");
            try {
              if (token) {
                const password = String(data.get("password"));
                if (password !== data.get("repeat"))
                  throw new Error("Le due password non coincidono.");
                const result = await auth.resetPassword({
                  token,
                  newPassword: password,
                });
                if (result.error)
                  throw new Error(
                    result.error.status === 429
                      ? "Troppe richieste. Attendi prima di riprovare."
                      : result.error.status >= 500
                        ? "Non possiamo confermare l’esito. Prova ad accedere con la nuova password oppure richiedi un nuovo link."
                        : "Il link non è valido, è scaduto o è già stato utilizzato. Richiedine uno nuovo.",
                  );
                setToken("");
                setDone(true);
                form.reset();
              } else {
                const email = String(data.get("email"));
                const result = verify
                  ? await auth.sendVerificationEmail({
                      email,
                      callbackURL: returnTo,
                    })
                  : await auth.requestPasswordReset({
                      email,
                      redirectTo: `${window.location.origin}/account/recovery?returnTo=${encodeURIComponent(returnTo)}`,
                    });
                if (result.error)
                  throw new Error(
                    result.error.status === 429
                      ? "Troppe richieste. Attendi prima di riprovare."
                      : "Non è stato possibile elaborare la richiesta. Riprova tra poco.",
                  );
                setNotice(
                  "Se l’indirizzo richiede questa operazione, la richiesta verrà elaborata. Controlla la casella email; l’arrivo del messaggio dipende dalla consegna del servizio.",
                );
              }
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Operazione non riuscita.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {token ? (
            <>
              <label>
                Nuova password
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <label>
                Ripeti la nuova password
                <input
                  type="password"
                  name="repeat"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <p className="hint">
                Almeno 12 caratteri. Dopo il cambio dovrai accedere nuovamente
                sui tuoi dispositivi.
              </p>
            </>
          ) : (
            <label>
              Email dell’account
              <input type="email" name="email" autoComplete="email" required />
            </label>
          )}
          <button disabled={busy}>
            {token
              ? "Salva nuova password"
              : verify
                ? "Reinvia verifica email"
                : "Richiedi link di recupero"}
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
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
