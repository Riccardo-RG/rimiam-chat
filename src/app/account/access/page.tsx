import { pageLanguage } from "../../ui-language-server";
import { headers } from "next/headers";
import Link from "next/link";
import {
  auth,
  googleSignInAvailable,
  microsoftSignInAvailable,
} from "@/server/auth";
import {
  safeAccountReturn,
  accountErrorMessage,
} from "@/shared/account-navigation";
import { ConnectSignIn } from "@/client/connect-signin";
import { IdentityProviderMark } from "@/client/identity-provider-mark";
import { BrandSignature } from "@/client/brand-signature";
import styles from "@/client/account-access.module.css";

export default async function SignInMethodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t: uiText } = await pageLanguage();
  const query = await searchParams;
  const returnTo = safeAccountReturn(
    typeof query.returnTo === "string" ? query.returnTo : "/",
  );
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const ready = !!session?.user.eligible && session.user.emailVerified;
  const accounts = ready
    ? await auth.api.listUserAccounts({ headers: requestHeaders })
    : [];
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <main className={styles.recovery}>
      <header className={styles.recoveryHeader}>
        <Link
          href={returnTo}
          className="wordmark brand-home"
          aria-label={uiText("RIMIAM — Home")}
        >
          <BrandSignature />
        </Link>
      </header>
      <div className={styles.recoveryContent}>
        <h1>{uiText("Metodi di accesso")}</h1>
        <p className={styles.recoveryIntro}>
          {ready ? (
            <>
              {uiText("Per collegare un account, usa l’indirizzo")}{" "}
              <strong>{session.user.email}</strong>.
            </>
          ) : (
            uiText(
              "Accedi con il tuo account RIMIAM verificato per collegare un metodo di accesso.",
            )
          )}
        </p>
        {error && (
          <p role="alert" className={styles.feedback}>
            {ready &&
            (error === "microsoft_link_required" ||
              error === "email_does_not_match")
              ? uiText(
                  "Scegli un account con lo stesso indirizzo email del tuo profilo RIMIAM.",
                )
              : uiText(accountErrorMessage(error))}
          </p>
        )}
        {ready && (
          <>
            <ul
              className={styles.methodList}
              aria-label={uiText("Accessi con account esterni")}
            >
              {(["google", "microsoft"] as const).map((provider) => {
                const label = provider === "google" ? "Google" : "Microsoft";
                const available =
                  provider === "google"
                    ? googleSignInAvailable
                    : microsoftSignInAvailable;
                const linked = accounts.some(
                  (account) => account.providerId === provider,
                );
                return (
                  <li key={provider}>
                    <IdentityProviderMark provider={provider} />
                    <div>
                      <strong>{label}</strong>
                      <small>
                        {!available
                          ? uiText("Non attivo su questa installazione")
                          : linked
                            ? uiText("Collegato")
                            : uiText("Da collegare")}
                      </small>
                    </div>
                    {available && !linked && (
                      <ConnectSignIn provider={provider} returnTo={returnTo} />
                    )}
                  </li>
                );
              })}
            </ul>
            <p className={styles.help}>
              {uiText("Puoi collegare il calendario dalla Home.")}
            </p>
          </>
        )}
        <Link className={styles.recoveryBack} href={returnTo}>
          {ready ? uiText("Torna a RIMIAM") : uiText("Vai all’accesso")}
        </Link>
      </div>
    </main>
  );
}
