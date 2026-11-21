import { pageLanguage } from "../../../ui-language-server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/server/auth";
import { nativeSocialProviders } from "@/server/native-social";
import { accountErrorMessage } from "@/shared/account-navigation";
import {
  LinkAccountLogin,
  SwitchLinkAccount,
} from "@/client/native-link-identity";
import { ConnectSignIn } from "@/client/connect-signin";
import { BrandSignature } from "@/client/brand-signature";
import styles from "@/client/account-access.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Collega un metodo di accesso",
  referrer: "no-referrer" as const,
};
export default async function NativeLink({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t: uiText } = await pageLanguage();
  const { provider, actor, error } = await searchParams;
  if (
    (provider !== "google" && provider !== "microsoft") ||
    typeof actor !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(actor)
  )
    notFound();
  const requestHeaders = await headers(),
    session = await auth.api.getSession({ headers: requestHeaders });
  const ready =
    !!session?.user.emailVerified &&
    session.user.eligible &&
    session.user.id === actor;
  const accounts = ready
    ? await auth.api.listUserAccounts({ headers: requestHeaders })
    : [];
  const providers = nativeSocialProviders(),
    returnTo =
      "/account/native/link?" + new URLSearchParams({ actor, provider });
  const linked = accounts.some((a) => a.providerId === provider),
    name = provider === "google" ? "Google" : "Microsoft";
  return (
    <main className={styles.recovery}>
      <header className={styles.recoveryHeader}>
        <BrandSignature />
      </header>
      <article className={styles.recoveryContent}>
        <h1>
          {uiText("Collega ")}
          {name}
        </h1>
        {typeof error === "string" && (
          <p role="alert">{uiText(accountErrorMessage(error))}</p>
        )}
        {!providers[provider] ? (
          <p>
            {uiText("Questo metodo è disattivato su questa installazione.")}
          </p>
        ) : !session ? (
          <LinkAccountLogin providers={providers} returnTo={returnTo} />
        ) : !ready ? (
          <>
            <p>
              {uiText(
                "L’account del browser è diverso da quello dell’app oppure non è idoneo. Per scegliere un altro account esci dalla sessione RIMIAM aperta nel browser.",
              )}
            </p>
            <SwitchLinkAccount returnTo={returnTo} />
          </>
        ) : linked ? (
          <p>
            {name}
            {uiText(" è collegato a ")}
            {session.user.email}.
          </p>
        ) : (
          <>
            <p>
              {uiText("Collega ")}
              {name}
              {uiText(" al tuo account RIMIAM")}{" "}
              <strong>{session.user.email}</strong>
              {uiText(". L’autorizzazione riguarda il solo accesso.")}
            </p>
            <ConnectSignIn
              provider={provider}
              returnTo="/"
              nativeActor={actor}
            />
          </>
        )}
        <p>
          <a href="com.rimiam.chat:/oauth/linked">{uiText("Torna all’app")}</a>
        </p>
      </article>
    </main>
  );
}
